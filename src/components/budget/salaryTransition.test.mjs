// Passaggio allo stipendio per ciclo per chi aveva solo il vecchio stipendio
// unico (monthlyBudget). `npm test`, senza rete.
//
// La scheda è il VERO SalaryTransitionCard.jsx caricato da Vite; il modulo
// dello store che importa è sostituito da uno che gira sullo store VERO di
// ogni "dispositivo", con il database finto, il sync e il realtime veri. I
// pulsanti si premono chiamando i loro onClick.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, section, report } from '../../sync/testkit.mjs'
import { createMemoryDatabase, createMemoryRemote } from '../../sync/memoryRemote.mjs'
import { createSyncEngine } from '../../sync/syncEngine.js'
import { scopeFor, stateKey } from '../../store/scope.js'
import { buildFinancialData } from '../../utils/budgetCalculations.js'
import { buildAndamento } from '../../utils/andamentoEngine.js'
import { currentCycleSalary, isSalary, needsSalaryTransition } from '../../utils/salary.js'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CARD = '/src/components/budget/SalaryTransitionCard.jsx'

const FAKE_MODULES = {
  '../../store/useAppStore.js': `
    const store = () => globalThis.__salaryCard.store
    export const useAppStore = Object.assign((selector) => selector(store().getState()), { getState: () => store().getState() })`,
  './SalaryTransitionCard.css': 'export default {}',
}
const harnessPlugin = {
  name: 'salary-transition-harness',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer && importer.includes('SalaryTransitionCard.jsx') && source in FAKE_MODULES) return `\0salary-fake:${source}`
    return null
  },
  load(id) {
    return id.startsWith('\0salary-fake:') ? FAKE_MODULES[id.slice('\0salary-fake:'.length)] : null
  },
}

// --- dispositivi: store vero, localStorage per dispositivo ------------------

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
async function device(db, userId, { map = new Map(), realtime = false } = {}) {
  installStorage(map)
  const { useAppStore } = await import(`../../store/useAppStore.js?salary-transition=${(boots += 1)}`)
  if (useAppStore.getState().scopeId !== scopeFor(userId)) useAppStore.getState().switchScope(scopeFor(userId))
  const remote = createMemoryRemote(db, userId, { realtime })
  const engine = createSyncEngine({ store: useAppStore, remote, autoFlushMs: 10_000 })
  useAppStore.getState().setSyncUser(userId)
  return { map, store: useAppStore, S: () => useAppStore.getState(), engine, remote }
}
// Un utente di prima: solo monthlyBudget e cycleStartDay, già sincronizzati.
async function legacyUser(db, userId, { monthlyBudget = 1700, today = '2026-10-02' } = {}) {
  const d = await device(db, userId)
  d.store.setState({ today })
  d.S().setMonthlyBudget(monthlyBudget, '2026-09-01') // il vecchio "+ → Stipendio"
  await d.engine.syncNow()
  return d
}

// --- la scheda -------------------------------------------------------------

let Card
const renderCard = (d) => {
  globalThis.__salaryCard = { store: d.store }
  return Card()
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
const buttonOf = (tree, label) => {
  let found = null
  walk(tree, (n) => { if (!found && n.type === 'button' && textOf(n).includes(label)) found = n })
  return found
}
const press = (d, label) => {
  const tree = renderCard(d)
  const target = buttonOf(tree, label)
  if (!target) throw new Error(`pulsante "${label}" non trovato`)
  target.props.onClick()
}
const salaries = (S) => S().incomes.filter(isSalary)
const homeSalary = (S) => currentCycleSalary(S().incomes, S().today, S().cycleStartDay ?? 1)
const homeAvailable = (S) => {
  const s = S()
  return buildFinancialData({ today: s.today, monthlyBudget: homeSalary(S), expenses: s.expenses, incomes: s.incomes, goals: s.goals, cycleStartDay: s.cycleStartDay ?? 1 }).available
}

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-salary-transition-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [harnessPlugin, react()],
})

try {
  ;({ SalaryTransitionCard: Card } = await server.ssrLoadModule(CARD))

  // =====================================================================
  section('1. Chi vede la scheda')
  // =====================================================================
  {
    check('vecchio utente (monthlyBudget > 0, nessuno stipendio, già sincronizzato): sì', needsSalaryTransition({ monthlyBudget: 1700, incomes: [], sync: { userId: 'u', lastSyncAt: '2026-10-02T08:00:00Z' } }))
    check('senza account (ospite): sì', needsSalaryTransition({ monthlyBudget: 1700, incomes: [], sync: { userId: null } }))
    check('con account ma prima del primo sync: no (gli stipendi potrebbero non essere ancora arrivati)', !needsSalaryTransition({ monthlyBudget: 1700, incomes: [], sync: { userId: 'u', lastSyncAt: null } }))
    check('chi ha già uno stipendio: no', !needsSalaryTransition({ monthlyBudget: 1700, incomes: [{ categoryId: 'stipendio', amount: 1700, date: '2026-09-01' }], sync: {} }))
    check('chi ha solo entrate extra: sì (non sono stipendi)', needsSalaryTransition({ monthlyBudget: 1700, incomes: [{ categoryId: 'extra', amount: 50, date: '2026-09-01' }], sync: {} }))
    check('utente nuovo (monthlyBudget 0): no', !needsSalaryTransition({ monthlyBudget: 0, incomes: [], sync: {} }))
    check('già risposto: no', !needsSalaryTransition({ monthlyBudget: 1700, incomes: [], salaryTransitionDone: true, sync: {} }))
  }
  {
    const db = createMemoryDatabase()
    const d = await legacyUser(db, 'utente-scheda')
    const tree = renderCard(d)
    const html = renderToStaticMarkup(tree)
    check('la scheda compare con titolo e testo richiesti', html.includes('Nuovo modo di gestire lo stipendio') && html.includes('Da ora SPENDY registra lo stipendio per ogni ciclo, così puoi cambiarlo ogni mese.') && html.includes('come ultimo stipendio salvato. Vuoi inserirlo nel ciclo corrente?'))
    check('   con l\'importo e i tre pulsanti', /1700,00/.test(html) && Boolean(buttonOf(tree, 'Inserisci 1700,00 €')) && Boolean(buttonOf(tree, 'Inserisci un altro importo')) && Boolean(buttonOf(tree, 'Non ora')))
    check('mostrarla non crea nulla: nessuno stipendio, niente in coda, stipendio del ciclo 0', salaries(d.S).length === 0 && d.S().sync.outbox.length === 0 && homeSalary(d.S) === 0)
    d.store.setState({ amountHidden: true })
    const hidden = renderToStaticMarkup(renderCard(d))
    check('con gli importi nascosti non mostra la cifra', !/1700,00/.test(hidden) && hidden.includes('Inserisci l&#x27;ultimo stipendio'))
  }

  // =====================================================================
  section('2. [Inserisci €X]')
  // =====================================================================
  {
    const db = createMemoryDatabase()
    const d = await legacyUser(db, 'utente-inserisci')
    const budgetBefore = d.S().monthlyBudget
    const cycleDayBefore = d.S().cycleStartDay
    press(d, 'Inserisci 1700,00 €')
    const rows = salaries(d.S)
    check('un solo stipendio, normale entrata datata oggi', rows.length === 1 && rows[0].amount === 1700 && rows[0].date === '2026-10-02' && rows[0].categoryId === 'stipendio')
    check('   nel ciclo corrente: stipendio 1700, disponibile 1700', homeSalary(d.S) === 1700 && homeAvailable(d.S) === 1700)
    check('   monthlyBudget e giorno di inizio ciclo invariati', d.S().monthlyBudget === budgetBefore && d.S().cycleStartDay === cycleDayBefore)
    check('   i cicli precedenti restano senza stipendio (nessuna data inventata)', buildAndamento({ ...d.S(), cycleStartDay: d.S().cycleStartDay }).cycles.filter((c) => !c.isCurrent).every((c) => c.salary === 0))
    check('   la scheda sparisce', renderCard(d) === null && d.S().salaryTransitionDone === true)
    await d.engine.syncNow()
    check('   e arriva sul cloud come una sola riga "stipendio"', db.rows('incomes').filter((r) => r.category_id === 'stipendio').length === 1)
  }
  {
    // Doppio tocco: il secondo onClick è quello della stessa scheda già disegnata.
    const db = createMemoryDatabase()
    const d = await legacyUser(db, 'utente-doppio-tocco')
    const tree = renderCard(d)
    const insert = buttonOf(tree, 'Inserisci 1700,00 €')
    insert.props.onClick()
    insert.props.onClick()
    check('doppio tocco: comunque un solo stipendio', salaries(d.S).length === 1)
  }

  // =====================================================================
  section('3. [Inserisci un altro importo]')
  // =====================================================================
  {
    const db = createMemoryDatabase()
    const d = await legacyUser(db, 'utente-altro')
    press(d, 'Inserisci un altro importo')
    check('apre l\'inserimento normale dello stipendio', d.S().modal === 'quickAdd' && d.S().modalPayload?.type === 'income' && d.S().modalPayload?.categoryId === 'stipendio')
    check('   senza creare nulla', salaries(d.S).length === 0 && homeSalary(d.S) === 0)
    check('   la scheda non ricompare', renderCard(d) === null)
    d.S().addSalary({ amount: 1550, date: d.S().today }) // ciò che fa la Conferma di QuickAddScreen
    check('l\'importo scelto diventa lo stipendio del ciclo (1550)', homeSalary(d.S) === 1550 && salaries(d.S).length === 1)
  }

  // =====================================================================
  section('4. [Non ora]')
  // =====================================================================
  {
    const db = createMemoryDatabase()
    const map = new Map()
    const d = await device(db, 'utente-non-ora', { map })
    d.store.setState({ today: '2026-10-02' })
    d.S().setMonthlyBudget(1700, '2026-09-01')
    await d.engine.syncNow()
    press(d, 'Non ora')
    check('nessuna entrata, ciclo con stipendio 0, disponibile 0', salaries(d.S).length === 0 && homeSalary(d.S) === 0 && homeAvailable(d.S) === 0)
    check('   monthlyBudget invariato (resta per precompilazione e fondo emergenza)', d.S().monthlyBudget === 1700)
    check('   la scheda sparisce', renderCard(d) === null)
    const saved = JSON.parse(map.get(stateKey(scopeFor('utente-non-ora'))))
    check('   la risposta è salvata nel contenitore dell\'account', saved.state.salaryTransitionDone === true)
    // Riapertura dell'app: stesso localStorage, nuovo store.
    const reopened = await device(db, 'utente-non-ora', { map })
    reopened.store.setState({ today: '2026-10-03' })
    await reopened.engine.syncNow()
    check('riaprendo l\'app la scheda non ricompare', reopened.S().salaryTransitionDone === true && renderCard(reopened) === null)
    reopened.store.setState({ today: '2026-11-02' })
    check('   nemmeno al ciclo successivo, che parte con stipendio 0', renderCard(reopened) === null && homeSalary(reopened.S) === 0)
  }

  // =====================================================================
  section('5. Chi ha già uno stipendio non vede la scheda')
  // =====================================================================
  {
    const db = createMemoryDatabase()
    const d = await device(db, 'utente-nuovo-modello')
    d.store.setState({ today: '2026-10-02' })
    d.S().addSalary({ amount: 1500, date: '2026-09-01' })
    await d.engine.syncNow()
    check('stipendio di settembre registrato: nessuna scheda, anche nel ciclo nuovo senza stipendio', renderCard(d) === null && homeSalary(d.S) === 0)
    const other = await device(db, 'utente-nuovo-modello')
    other.store.setState({ today: '2026-10-02' })
    check('secondo dispositivo prima del primo sync: nessuna scheda', renderCard(other) === null)
    await other.engine.syncNow()
    check('   dopo il sync ha lo stipendio di settembre: ancora nessuna scheda', salaries(other.S).length === 1 && renderCard(other) === null)
  }

  // =====================================================================
  section('6. Due dispositivi e realtime')
  // =====================================================================
  {
    const db = createMemoryDatabase()
    const USER = 'utente-due-dispositivi'
    const phone = await legacyUser(db, USER)
    const mac = await device(db, USER, { realtime: true })
    mac.store.setState({ today: '2026-10-02' })
    await mac.engine.syncNow()
    await mac.engine.start(USER)
    check('entrambi vedono la scheda (risposta per dispositivo)', renderCard(phone) !== null && renderCard(mac) !== null)
    press(phone, 'Inserisci 1700,00 €')
    await phone.engine.syncNow()
    await new Promise((r) => setTimeout(r, 20))
    check('inserito sul telefono: il Mac riceve lo stipendio in realtime', salaries(mac.S).length === 1 && homeSalary(mac.S) === 1700)
    check('   e sul Mac la scheda sparisce da sola', renderCard(mac) === null)
    check('   nessun duplicato: una sola riga sul cloud', db.rows('incomes').filter((r) => r.category_id === 'stipendio').length === 1)
    mac.engine.stop()

    // Modifica ed eliminazione dopo il passaggio.
    const id = salaries(phone.S)[0].id
    await new Promise((r) => setTimeout(r, 5))
    mac.S().editIncome(id, { amount: 1650 })
    await mac.engine.syncNow()
    await phone.engine.syncNow()
    check('modifica dal Mac (1650) → il telefono la vede', homeSalary(phone.S) === 1650)
    await new Promise((r) => setTimeout(r, 5))
    phone.S().deleteIncome(id)
    await phone.engine.syncNow()
    await mac.engine.syncNow()
    check('eliminazione dal telefono → stipendio 0 su entrambi', homeSalary(phone.S) === 0 && homeSalary(mac.S) === 0)
    check('   e la scheda non ricompare (risposta già data)', renderCard(phone) === null && renderCard(mac) === null)
  }
  {
    // Lo stipendio arriva da un altro dispositivo mentre la scheda è aperta.
    const db = createMemoryDatabase()
    const USER = 'utente-arrivo'
    const a = await legacyUser(db, USER)
    const b = await device(db, USER)
    b.store.setState({ today: '2026-10-02' })
    await b.engine.syncNow()
    const openCard = renderCard(b)
    a.S().addSalary({ amount: 1600, date: '2026-10-02' })
    await a.engine.syncNow()
    await b.engine.syncNow()
    buttonOf(openCard, 'Inserisci 1700,00 €').props.onClick() // tocco sulla scheda disegnata prima del sync
    check('stipendio arrivato nel frattempo: "Inserisci" non crea un duplicato', salaries(b.S).length === 1 && homeSalary(b.S) === 1600)
  }

  // =====================================================================
  section('7. Vecchio client (usa monthlyBudget) e nuovo client sullo stesso account')
  // =====================================================================
  {
    const db = createMemoryDatabase()
    const USER = 'utente-misto'
    const nuovo = await device(db, USER)
    nuovo.store.setState({ today: '2026-10-02' })
    nuovo.S().addSalary({ amount: 1550, date: '2026-10-01' })
    await nuovo.engine.syncNow()
    // Il vecchio client: per lo stipendio chiama setMonthlyBudget (QuickAddScreen
    // fino a db3ef67), e scrive solo le impostazioni.
    const vecchio = await device(db, USER)
    vecchio.store.setState({ today: '2026-10-02' })
    await vecchio.engine.syncNow()
    const incomeRowsBefore = db.rows('incomes').length
    await new Promise((r) => setTimeout(r, 5))
    vecchio.S().setMonthlyBudget(1800, '2026-10-02')
    await vecchio.engine.syncNow()
    await nuovo.engine.syncNow()
    check('il vecchio client non crea entrate', db.rows('incomes').length === incomeRowsBefore)
    check('   sul nuovo: lo stipendio del ciclo resta 1550 (quello registrato)', homeSalary(nuovo.S) === 1550)
    check('   cambia solo l\'ultimo stipendio noto (precompilazione, fondo emergenza)', nuovo.S().monthlyBudget === 1800)
    check('   nessuna scheda di passaggio (c\'è già uno stipendio)', renderCard(nuovo) === null)
    // Ciò che il vecchio client CALCOLA (rischio documentato, non risolvibile da qui):
    // disponibile = monthlyBudget + TUTTE le entrate del ciclo − spese.
    const legacyAvailable = vecchio.S().monthlyBudget + vecchio.S().incomes.filter((i) => i.date >= '2026-10-01').reduce((sum, i) => sum + i.amount, 0)
    check('(rischio noto) sul vecchio client lo stipendio registrato si somma a monthlyBudget: 1800 + 1550', legacyAvailable === 3350)
    check('   mentre il nuovo mostra 1550', homeAvailable(nuovo.S) === 1550)
  }
} finally {
  await server.close()
}

report('Stipendio: passaggio per gli utenti esistenti')
