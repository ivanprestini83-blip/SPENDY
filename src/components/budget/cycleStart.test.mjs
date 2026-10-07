// Lo storico delle entrate di ogni ciclo resta suo quando ne inizia un altro.
// `npm test`, senza rete.
//
// Ciclo A → stipendio 2.000 € → nuovo ciclo B → stipendio 0 € deve dare
// A: entrate 2.000 €, B: entrate 0 €, senza perdere A: né al cambio di ciclo,
// né riaprendo l'app, né su un altro dispositivo, né cambiando lo stipendio di B.
//
// Le schede sono i VERI CycleStartCard.jsx e CurrentSalaryCard.jsx caricati da
// Vite; il modulo dello store che importano gira sullo store VERO di ogni
// "dispositivo" (React è finto solo per lo useState di CurrentSalaryCard).

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, section, report } from '../../sync/testkit.mjs'
import { createMemoryDatabase, createMemoryRemote } from '../../sync/memoryRemote.mjs'
import { createSyncEngine } from '../../sync/syncEngine.js'
import { scopeFor } from '../../store/scope.js'
import { buildFinancialData } from '../../utils/budgetCalculations.js'
import { buildAndamento } from '../../utils/andamentoEngine.js'
import { currentCycleSalary, isSalary, LEGACY_SALARY_MODEL_END, legacySalaryCycles, needsCycleConfirmation } from '../../utils/salary.js'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const STORE_FAKE = `
  const store = () => globalThis.__cycleTest.store
  export const useAppStore = Object.assign((selector) => selector(store().getState()), { getState: () => store().getState() })`
const FAKE_MODULES = {
  '../../store/useAppStore.js': STORE_FAKE,
  './CycleStartCard.css': 'export default {}',
  react: `export const useState = (initial) => globalThis.__cycleTest.useState(initial)`,
}
const harnessPlugin = {
  name: 'cycle-start-harness',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '/__cycle-fake/react') return '\0cycle-fake:react'
    const ours = importer && (importer.includes('CycleStartCard.jsx') || importer.includes('CurrentSalaryCard.jsx'))
    if (ours && source in FAKE_MODULES) return `\0cycle-fake:${source}`
    return null
  },
  load(id) {
    return id.startsWith('\0cycle-fake:') ? FAKE_MODULES[id.slice('\0cycle-fake:'.length)] : null
  },
  transform(code, id) {
    if (!id.includes('CurrentSalaryCard.jsx')) return null
    return code.replace("from 'react'", "from '/__cycle-fake/react'")
  },
}

// --- dispositivi ---------------------------------------------------------------

function installStorage(map) {
  const fake = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'window', { value: { localStorage: fake, addEventListener: () => {}, removeEventListener: () => {} }, configurable: true, writable: true })
}
let boots = 0
async function device(db, userId, { map = new Map(), realtime = false, today } = {}) {
  installStorage(map)
  const { useAppStore } = await import(`../../store/useAppStore.js?cycle-start=${(boots += 1)}`)
  if (useAppStore.getState().scopeId !== scopeFor(userId)) useAppStore.getState().switchScope(scopeFor(userId))
  if (today) useAppStore.setState({ today })
  const remote = createMemoryRemote(db, userId, { realtime })
  const engine = createSyncEngine({ store: useAppStore, remote, autoFlushMs: 10_000 })
  useAppStore.getState().setSyncUser(userId)
  return { map, store: useAppStore, S: () => useAppStore.getState(), engine }
}
const andamento = (S) => buildAndamento({ ...S(), cycleStartDay: S().cycleStartDay ?? 1 })
const cycleAt = (S, start) => andamento(S).cycles.find((c) => c.key === start)
const homeSalary = (S) => currentCycleSalary(S().incomes, S().today, S().cycleStartDay ?? 1)
const homeAvailable = (S) => {
  const s = S()
  return buildFinancialData({ today: s.today, monthlyBudget: homeSalary(S), expenses: s.expenses, incomes: s.incomes, goals: s.goals, cycleStartDay: s.cycleStartDay ?? 1 }).available
}
const fingerprint = (S) => JSON.stringify({ e: S().expenses, i: S().incomes })

// --- rendering delle schede ---------------------------------------------------

let CycleStartCard
let CurrentSalaryCard
function hooks() {
  const slots = []
  let cursor = 0
  return {
    reset() { cursor = 0 },
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
  }
}
const render = (Component, d, h = hooks()) => {
  globalThis.__cycleTest = { store: d.store, useState: h.useState }
  h.reset()
  return Component()
}
const walk = (node, visit) => {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit))
  if (node && typeof node === 'object' && node.props) { visit(node); walk(node.props.children, visit) }
  return undefined
}
const textOf = (node) => {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && node.props) return textOf(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
const find = (tree, predicate) => {
  let found = null
  walk(tree, (n) => { if (!found && predicate(n)) found = n })
  return found
}
const buttonOf = (tree, label) => find(tree, (n) => n.type === 'button' && textOf(n).includes(label))
const submitLegacy = (tree, value) => find(tree, (n) => n.type === 'form').props.onSubmit({
  preventDefault() {}, currentTarget: { elements: { legacySalary: { value } } },
})

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-cycle-start-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [harnessPlugin, react()],
})

try {
  ;({ CycleStartCard } = await server.ssrLoadModule('/src/components/budget/CycleStartCard.jsx'))
  ;({ CurrentSalaryCard } = await server.ssrLoadModule('/src/components/settings/CurrentSalaryCard.jsx'))

  // =====================================================================
  section('1. Ciclo A → stipendio 2.000 € → nuovo ciclo → stipendio 0 €')
  // =====================================================================
  const db = createMemoryDatabase()
  const USER = 'utente-storico'
  const map = new Map()
  const phone = await device(db, USER, { map, today: '2026-11-20' })
  // Ciclo A: 7 novembre – 6 dicembre (giorno di inizio 7, dallo stipendio).
  phone.S().addSalary({ amount: 2000, date: '2026-11-07' })
  phone.S().addExpense({ amount: 1250, categoryId: 'casa', description: 'affitto', date: '2026-11-10' })
  await phone.engine.syncNow()
  check('ciclo A: stipendio 2.000, disponibile 750', phone.S().cycleStartDay === 7 && homeSalary(phone.S) === 2000 && homeAvailable(phone.S) === 750)

  const before = fingerprint(phone.S)
  phone.store.setState({ today: '2026-12-07' }) // inizia il ciclo B
  check('al cambio di ciclo i dati non cambiano: nessuna entrata creata, cancellata o modificata', fingerprint(phone.S) === before)
  check('ciclo B: stipendio 0, disponibile 0', homeSalary(phone.S) === 0 && homeAvailable(phone.S) === 0)
  check('Andamento → Ciclo A: entrate 2.000 €', cycleAt(phone.S, '2026-11-07').income === 2000 && cycleAt(phone.S, '2026-11-07').salary === 2000)
  check('Andamento → Ciclo B: entrate 0 €', cycleAt(phone.S, '2026-12-07').income === 0 && cycleAt(phone.S, '2026-12-07').salary === 0)
  check('   ciclo A conserva anche spese (1.250) e risparmio (750)', cycleAt(phone.S, '2026-11-07').spent === 1250 && cycleAt(phone.S, '2026-11-07').savings === 750)

  {
    const reopened = await device(db, USER, { map, today: '2026-12-07' })
    check('riaprendo l\'app (stesso dispositivo): A ha ancora 2.000 €, B 0 €', cycleAt(reopened.S, '2026-11-07').income === 2000 && cycleAt(reopened.S, '2026-12-07').income === 0)
    const mac = await device(db, USER, { today: '2026-12-07' })
    await mac.engine.syncNow()
    check('su un altro dispositivo, dal cloud: A 2.000 €, B 0 €', cycleAt(mac.S, '2026-11-07').income === 2000 && cycleAt(mac.S, '2026-12-07').income === 0)
  }

  phone.S().addSalary({ amount: 1800, date: '2026-12-07' })
  check('stipendio di B (1.800): B entrate 1.800, A resta 2.000', cycleAt(phone.S, '2026-12-07').income === 1800 && cycleAt(phone.S, '2026-11-07').income === 2000)
  const salaryB = phone.S().incomes.find((i) => isSalary(i) && i.date === '2026-12-07')
  phone.S().editIncome(salaryB.id, { amount: 1950 })
  check('modificato B (1.950): A resta 2.000', cycleAt(phone.S, '2026-12-07').income === 1950 && cycleAt(phone.S, '2026-11-07').income === 2000)
  phone.S().deleteIncome(salaryB.id)
  check('cancellato B: B torna 0, A resta 2.000', cycleAt(phone.S, '2026-12-07').income === 0 && cycleAt(phone.S, '2026-11-07').income === 2000)
  await phone.engine.syncNow()
  check('sul cloud lo stipendio di A è intatto', db.rows('incomes').some((r) => r.category_id === 'stipendio' && r.date === '2026-11-07' && Number(r.amount) === 2000 && r.deleted_at === null))

  // =====================================================================
  section('2. Conferma dell\'inizio del nuovo ciclo')
  // =====================================================================
  {
    const d = await device(createMemoryDatabase(), 'utente-conferma', { today: '2026-11-20' })
    d.S().addSalary({ amount: 2000, date: '2026-11-07' })
    d.S().addExpense({ amount: 300, categoryId: 'spesa', description: 'x', date: '2026-11-12' })
    await d.engine.syncNow()
    check('nel primo ciclo, con lo stipendio: nessuna scheda', render(CycleStartCard, d) === null)
    d.store.setState({ today: '2026-12-07' })
    const tree = render(CycleStartCard, d)
    const html = renderToStaticMarkup(tree)
    check('inizia B: compare la richiesta di conferma', html.includes('È iniziato un nuovo ciclo'))
    check('   dice che il ciclo precedente resta in Andamento con i suoi numeri', html.includes('resta salvato in Andamento') && html.includes('entrate 2000,00 €') && html.includes('spese 300,00 €'))
    check('   e che il nuovo parte da 0 € finché non si inserisce lo stipendio', html.includes('parte da 0 €') && Boolean(buttonOf(tree, 'Inserisci il nuovo stipendio')) && Boolean(buttonOf(tree, 'Inizia il ciclo da 0 €')))
    const outboxBefore = d.S().sync.outbox.length
    const dataBefore = fingerprint(d.S)
    buttonOf(tree, 'Inizia il ciclo da 0 €').props.onClick()
    check('"Inizia il ciclo da 0 €": confermato, nessun dato toccato, niente in coda', d.S().confirmedCycleStart === '2026-12-07' && fingerprint(d.S) === dataBefore && d.S().sync.outbox.length === outboxBefore)
    check('   la scheda sparisce', render(CycleStartCard, d) === null)
    check('   Andamento: A 2.000, B 0', cycleAt(d.S, '2026-11-07').income === 2000 && cycleAt(d.S, '2026-12-07').income === 0)
    const reopened = await device(createMemoryDatabase(), 'utente-conferma', { map: d.map, today: '2026-12-08' })
    check('riaprendo l\'app non ricompare nello stesso ciclo', render(CycleStartCard, reopened) === null)
    reopened.store.setState({ today: '2027-01-07' })
    check('ricompare all\'inizio del ciclo successivo', needsCycleConfirmation(reopened.S()) && render(CycleStartCard, reopened) !== null)
    const insert = buttonOf(render(CycleStartCard, reopened), 'Inserisci il nuovo stipendio')
    insert.props.onClick()
    check('"Inserisci il nuovo stipendio": conferma il ciclo e apre l\'inserimento dello stipendio, senza crearlo', reopened.S().confirmedCycleStart === '2027-01-07'
      && reopened.S().modal === 'quickAdd' && reopened.S().modalPayload?.categoryId === 'stipendio' && homeSalary(reopened.S) === 0)
  }
  {
    const d = await device(createMemoryDatabase(), 'utente-primo-ciclo', { today: '2026-12-07' })
    d.S().addExpense({ amount: 10, categoryId: 'bar', description: 'x', date: '2026-12-07' })
    await d.engine.syncNow()
    check('utente al primo ciclo (nessun ciclo passato): nessuna scheda', render(CycleStartCard, d) === null)
    const e = await device(createMemoryDatabase(), 'utente-con-stipendio-b', { today: '2026-12-08' })
    e.S().addSalary({ amount: 1000, date: '2026-11-07' })
    e.S().addSalary({ amount: 1100, date: '2026-12-07' })
    await e.engine.syncNow()
    check('ciclo nuovo con lo stipendio già inserito: nessuna richiesta', !needsCycleConfirmation(e.S()))
  }

  // =====================================================================
  section('3. Storico del vecchio modello (stipendio unico, prima del 7/10/2026)')
  // =====================================================================
  const legacy = async (map = new Map()) => {
    const d = await device(createMemoryDatabase(), 'utente-vecchio', { map, today: '2026-10-07' })
    d.S().setMonthlyBudget(1700, '2026-09-07') // il vecchio "+ → Stipendio"
    d.S().addExpense({ amount: 1200, categoryId: 'casa', description: 'x', date: '2026-09-21' })
    d.S().addExpense({ amount: 80, categoryId: 'bar', description: 'x', date: '2026-10-03' })
    await d.engine.syncNow()
    return d
  }
  {
    const d = await legacy()
    check(`il ciclo 7 set – 6 ott (finito entro ${LEGACY_SALARY_MODEL_END}) è del vecchio modello e non ha stipendio`, legacySalaryCycles(d.S()).map((r) => r.start).join() === '2026-09-07' && cycleAt(d.S, '2026-09-07').salary === 0)
    const tree = render(CycleStartCard, d)
    const html = renderToStaticMarkup(tree)
    check('la scheda propone di conservarlo, con l\'importo modificabile', html.includes('Stipendio dei cicli precedenti') && html.includes('1700,00 €') && html.includes('value="1700"') && Boolean(buttonOf(tree, 'Conserva nello storico')) && Boolean(buttonOf(tree, 'Non conservare')))
    check('mostrarla non crea nulla', !d.S().incomes.some(isSalary))
    submitLegacy(tree, '1700')
    const kept = d.S().incomes.filter(isSalary)
    check('"Conserva": una entrata stipendio nel ciclo 7 set – 6 ott, datata al suo inizio e indicata come impostazione precedente', kept.length === 1 && kept[0].date === '2026-09-07' && kept[0].amount === 1700 && kept[0].description === 'Stipendio (impostazione precedente)')
    check('   Andamento: il ciclo precedente torna con entrate 1.700 €, spese 1.280, risparmio 420', cycleAt(d.S, '2026-09-07').income === 1700 && cycleAt(d.S, '2026-09-07').spent === 1280 && cycleAt(d.S, '2026-09-07').savings === 420)
    check('   il ciclo corrente resta a 0 (nessuna eredità)', homeSalary(d.S) === 0 && cycleAt(d.S, '2026-10-07').income === 0)
    check('   monthlyBudget e giorno di ciclo invariati', d.S().monthlyBudget === 1700 && d.S().cycleStartDay === 7)
    check('   la domanda non ricompare', !render(CycleStartCard, d) || !renderToStaticMarkup(render(CycleStartCard, d)).includes('Stipendio dei cicli precedenti'))
    submitLegacy(tree, '1700')
    check('un secondo invio della stessa scheda non crea duplicati', d.S().incomes.filter(isSalary).length === 1)
  }
  {
    const d = await legacy()
    submitLegacy(render(CycleStartCard, d), '1650,50')
    check('importo corretto dall\'utente (1.650,50): è quello conservato', cycleAt(d.S, '2026-09-07').salary === 1650.5 && d.S().monthlyBudget === 1700)
  }
  {
    const map = new Map()
    const d = await legacy(map)
    buttonOf(render(CycleStartCard, d), 'Non conservare').props.onClick()
    check('"Non conservare": nessuna entrata, risposta salvata', !d.S().incomes.some(isSalary) && d.S().legacySalaryHistoryDone === true)
    const reopened = await device(createMemoryDatabase(), 'utente-vecchio', { map, today: '2026-10-08' })
    check('   riaprendo l\'app la domanda non ricompare', reopened.S().legacySalaryHistoryDone === true && !renderToStaticMarkup(render(CycleStartCard, reopened) ?? '').includes('Stipendio dei cicli precedenti'))
  }
  {
    const d = await device(createMemoryDatabase(), 'utente-due-cicli-vecchi', { today: '2026-10-07' })
    d.S().setMonthlyBudget(1500, '2026-08-07')
    d.S().addExpense({ amount: 100, categoryId: 'bar', description: 'x', date: '2026-08-10' })
    d.S().addExpense({ amount: 200, categoryId: 'bar', description: 'x', date: '2026-09-10' })
    d.S().addSalary({ amount: 1600, date: '2026-09-07', keepLastSalary: true }) // settembre ha già il suo
    await d.engine.syncNow()
    submitLegacy(render(CycleStartCard, d), '1500')
    check('solo i cicli senza stipendio lo ricevono: agosto 1.500, settembre resta 1.600', cycleAt(d.S, '2026-08-07').salary === 1500 && cycleAt(d.S, '2026-09-07').salary === 1600 && d.S().incomes.filter(isSalary).length === 2)
  }
  {
    // Un ciclo finito DOPO il rilascio non è del vecchio modello: niente proposta.
    const d = await device(createMemoryDatabase(), 'utente-dopo', { today: '2026-12-08' })
    d.S().setMonthlyBudget(1700, '2026-11-07')
    d.S().addExpense({ amount: 50, categoryId: 'bar', description: 'x', date: '2026-11-15' })
    await d.engine.syncNow()
    check('ciclo 7 nov – 6 dic (dopo il 7/10/2026) senza stipendio: non è "vecchio modello"', legacySalaryCycles(d.S()).length === 0)
    const html = renderToStaticMarkup(render(CycleStartCard, d) ?? '')
    check('   nessuna proposta di copiarvi il vecchio stipendio (solo la conferma del nuovo ciclo)', !html.includes('Stipendio dei cicli precedenti') && html.includes('È iniziato un nuovo ciclo'))
  }
  {
    // Sync: conservato su un dispositivo, l'altro non ripropone la domanda.
    const shared = createMemoryDatabase()
    const a = await device(shared, 'utente-sync-vecchio', { today: '2026-10-07' })
    a.S().setMonthlyBudget(1700, '2026-09-07')
    a.S().addExpense({ amount: 1200, categoryId: 'casa', description: 'x', date: '2026-09-21' })
    await a.engine.syncNow()
    const b = await device(shared, 'utente-sync-vecchio', { today: '2026-10-07' })
    check('secondo dispositivo prima del sync: nessuna scheda', render(CycleStartCard, b) === null)
    submitLegacy(render(CycleStartCard, a), '1700')
    await a.engine.syncNow()
    await b.engine.syncNow()
    check('dopo il sync: il ciclo vecchio ha già lo stipendio, nessuna domanda sull\'altro dispositivo', legacySalaryCycles(b.S()).length === 0 && cycleAt(b.S, '2026-09-07').income === 1700)
    check('   una sola riga sul cloud', shared.rows('incomes').filter((r) => r.category_id === 'stipendio').length === 1)
  }

  // =====================================================================
  section('4. Impostazioni → Stipendio di questo ciclo (test UI)')
  // =====================================================================
  {
    const d = await device(createMemoryDatabase(), 'utente-impostazioni', { today: '2026-12-10' })
    d.S().addSalary({ amount: 2250, date: '2026-11-07' }) // ciclo precedente
    d.S().addSalary({ amount: 2250, date: '2026-12-07' }) // ciclo in corso
    const h = hooks()
    const ui = () => render(CurrentSalaryCard, d, h)
    const html = () => renderToStaticMarkup(ui())
    const input = (tree) => find(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Importo dello stipendio di questo ciclo')
    const previousIncome = () => cycleAt(d.S, '2026-11-07').income

    check('sezione sempre presente, con il titolo "Stipendio di questo ciclo"', html().includes('Stipendio di questo ciclo'))
    // 1. Con lo stipendio: importo, Modifica, Elimina.
    check('1. con lo stipendio: mostra l\'importo (2250,00 €) e i pulsanti Modifica ed Elimina', html().includes('2250,00 €') && Boolean(buttonOf(ui(), 'Modifica')) && Boolean(buttonOf(ui(), 'Elimina')))
    check('   mostra solo il ciclo in corso: una sola riga, anche se il ciclo precedente ha uno stipendio uguale', (html().match(/2250,00 €/g) ?? []).length === 1)

    // 2. Modifica: si cambia la cifra.
    buttonOf(ui(), 'Modifica').props.onClick()
    check('2. "Modifica" apre il campo con la cifra attuale', input(ui())?.props.value === '2250' && Boolean(buttonOf(ui(), 'Salva')))
    input(ui()).props.onChange({ target: { value: '2000' } })
    buttonOf(ui(), 'Salva').props.onClick()
    check('   salvato 2000: la sezione mostra 2000,00 €, il ciclo in corso vale 2000', html().includes('2000,00 €') && !input(ui()) && homeSalary(d.S) === 2000)
    check('   Andamento: il ciclo precedente mantiene il suo importo originale (2250)', previousIncome() === 2250 && cycleAt(d.S, '2026-12-07').income === 2000)
    buttonOf(ui(), 'Modifica').props.onClick()
    input(ui()).props.onChange({ target: { value: '2e10' } })
    check('   una cifra fuori limite non si può salvare', find(ui(), (n) => n.type === 'button' && textOf(n) === 'Salva').props.disabled === true)
    buttonOf(ui(), 'Annulla').props.onClick()
    check('   "Annulla" non cambia nulla', homeSalary(d.S) === 2000 && !input(ui()))

    // 3. Elimina chiede conferma.
    buttonOf(ui(), 'Elimina').props.onClick()
    check('3. "Elimina" al primo tocco non cancella e chiede conferma', homeSalary(d.S) === 2000 && html().includes('Tocca di nuovo per confermare'))
    buttonOf(ui(), 'Tocca di nuovo per confermare').props.onClick()
    check('   al secondo tocco elimina lo stipendio del ciclo in corso', homeSalary(d.S) === 0)
    check('   il ciclo precedente resta 2250', previousIncome() === 2250)

    // 4. Dopo l'eliminazione: "Nessuno stipendio…" e "Inserisci stipendio".
    check('4. dopo l\'eliminazione: "Nessuno stipendio inserito per questo ciclo" e "Inserisci stipendio"', html().includes('Nessuno stipendio inserito per questo ciclo') && Boolean(buttonOf(ui(), 'Inserisci stipendio')) && !buttonOf(ui(), 'Modifica'))

    // 5. Reinserimento.
    buttonOf(ui(), 'Inserisci stipendio').props.onClick()
    check('5. "Inserisci stipendio" apre il campo, con l\'ultimo stipendio proposto e nessuna entrata ancora creata', input(ui())?.props.value === '2250' && homeSalary(d.S) === 0)
    input(ui()).props.onChange({ target: { value: '2100' } })
    buttonOf(ui(), 'Salva').props.onClick()
    check('   salvato: lo stipendio torna visibile (2100,00 €, con Modifica ed Elimina)', html().includes('2100,00 €') && Boolean(buttonOf(ui(), 'Modifica')) && homeSalary(d.S) === 2100)
    const reinserted = d.S().incomes.find((i) => isSalary(i) && i.amount === 2100)
    check('   è una normale entrata stipendio datata oggi, nel ciclo in corso', reinserted?.date === '2026-12-10' && reinserted?.categoryId === 'stipendio')

    // 6. Nessuna operazione ha toccato il ciclo precedente.
    const previous = d.S().incomes.filter((i) => isSalary(i) && i.date === '2026-11-07')
    check('6. il ciclo precedente non è mai stato toccato: una sola entrata, 2250, stessa data', previous.length === 1 && previous[0].amount === 2250 && previousIncome() === 2250)
  }
  {
    // Il campo "Giorno di inizio ciclo" segue il giorno salvato finché non lo si modifica.
    const source = (await import('node:fs')).readFileSync(new URL('../modals/SettingsScreen.jsx', import.meta.url), 'utf8')
    check('Impostazioni: il giorno di inizio ciclo mostrato è quello salvato (non uno letto all\'apertura)', source.includes('const day = dayDraft ?? String(cycleStartDay ?? 1)') && source.includes('<CurrentSalaryCard />'))
  }
} finally {
  await server.close()
}

report('Storico delle entrate per ciclo')
