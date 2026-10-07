// "Spese di oggi" e "Spese di questo mese": la pagina Spese mostra solo il
// periodo del riquadro toccato, e "oggi" resta il giorno vero anche con l'app
// aperta da ieri. `npm test`, senza rete.
//
// Le date delle spese sono stringhe 'AAAA-MM-GG' nella data LOCALE
// (date.js todayStr); il ciclo è quello di cycle.js (cycleStartDay, inizio
// incluso, fine esclusa). Niente viene cancellato: si filtra soltanto.

import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, section, report } from '../sync/testkit.mjs'
import { expensesForPeriod, totalForMonth, todaysExpenses } from '../utils/budgetCalculations.js'
import { buildAndamento } from '../utils/andamentoEngine.js'
import { startTodayWatcher } from '../store/todayWatcher.js'
import { scopeFor } from '../store/scope.js'

const expense = (id, date, amount, categoryId = 'bar') => ({ id, date, amount, categoryId, description: id, updatedAt: '2026-10-20T08:00:00.000Z' })
// Ciclo dal 7: in corso 7 ott – 6 nov, precedente 7 set – 6 ott.
const EXPENSES = [
  expense('oggi', '2026-10-20', 12),
  expense('oggi-2', '2026-10-20', 3.5),
  expense('ieri', '2026-10-19', 20),
  expense('inizio-ciclo', '2026-10-07', 40),
  expense('fine-ciclo-prec', '2026-10-06', 55),
  expense('ciclo-prec', '2026-09-15', 70),
  expense('inizio-ciclo-prec', '2026-09-07', 9),
  expense('due-cicli-fa', '2026-08-20', 100),
]
const ids = (items) => items.map((e) => e.id).sort().join()
const TODAY = '2026-10-20'

// =====================================================================
section('1. Spese di oggi')
// =====================================================================
{
  const period = expensesForPeriod(EXPENSES, { view: 'today', today: TODAY, cycleStartDay: 7 })
  check('solo le spese con la data di oggi', ids(period.items) === 'oggi,oggi-2')
  check('   quella di ieri no', !period.items.some((e) => e.id === 'ieri'))
  check('   totale 15,50 €, uguale al riquadro della Home (todaysExpenses)', period.total === 15.5 && period.total === todaysExpenses(EXPENSES, TODAY).total)
}

// =====================================================================
section('2. Spese del ciclo in corso (cycleStartDay 7)')
// =====================================================================
{
  const period = expensesForPeriod(EXPENSES, { view: 'cycle', today: TODAY, cycleStartDay: 7 })
  check('ciclo 7 ott – 6 nov', period.range.start === '2026-10-07' && period.range.end === '2026-11-07')
  check('solo le spese del ciclo in corso, compreso il primo giorno (7/10)', ids(period.items) === 'ieri,inizio-ciclo,oggi,oggi-2')
  check('   il 6/10 (ultimo giorno del ciclo precedente) no, né i cicli più vecchi', !period.items.some((e) => ['fine-ciclo-prec', 'ciclo-prec', 'inizio-ciclo-prec', 'due-cicli-fa'].includes(e.id)))
  check('   totale uguale al riquadro della Home (totalForMonth)', period.total === 75.5 && period.total === totalForMonth(EXPENSES, TODAY, 7))
  const calendar = expensesForPeriod(EXPENSES, { view: 'cycle', today: TODAY, cycleStartDay: 1 })
  check('con il mese di calendario (giorno 1) il periodo cambia davvero: 1 – 31 ottobre', calendar.range.start === '2026-10-01' && ids(calendar.items) === 'fine-ciclo-prec,ieri,inizio-ciclo,oggi,oggi-2')
  const day31 = expensesForPeriod([expense('fine-feb', '2026-02-28', 5), expense('fine-gen', '2026-01-30', 6)], { view: 'cycle', today: '2026-03-10', cycleStartDay: 31 })
  check('giorno 31 in un mese corto: stessi confini di cycle.js (28 feb – 30 mar)', day31.range.start === '2026-02-28' && ids(day31.items) === 'fine-feb')
}

// =====================================================================
section('3. Cicli precedenti: restano tutti consultabili')
// =====================================================================
{
  const previous = expensesForPeriod(EXPENSES, { view: 'cycle', today: TODAY, cycleStartDay: 7, cycleOffset: 1 })
  check('un ciclo fa (7 set – 6 ott): le sue spese, 6/10 compreso', previous.range.start === '2026-09-07' && ids(previous.items) === 'ciclo-prec,fine-ciclo-prec,inizio-ciclo-prec')
  const older = expensesForPeriod(EXPENSES, { view: 'cycle', today: TODAY, cycleStartDay: 7, cycleOffset: 2 })
  check('due cicli fa (7 ago – 6 set)', older.range.start === '2026-08-07' && ids(older.items) === 'due-cicli-fa')
  const all = [0, 1, 2].flatMap((cycleOffset) => expensesForPeriod(EXPENSES, { view: 'cycle', today: TODAY, cycleStartDay: 7, cycleOffset }).items)
  check('ogni spesa sta in esattamente un ciclo: nessuna persa, nessuna doppia', all.length === EXPENSES.length && ids(all) === ids(EXPENSES))
  check('l\'elenco filtrato non modifica l\'array delle spese', EXPENSES.length === 8 && EXPENSES[0].id === 'oggi')
  check('offset non valido → ciclo in corso', expensesForPeriod(EXPENSES, { view: 'cycle', today: TODAY, cycleStartDay: 7, cycleOffset: -3 }).range.start === '2026-10-07')
  const andamento = buildAndamento({ expenses: EXPENSES, incomes: [], today: TODAY, cycleStartDay: 7 })
  check('Andamento invariato: il ciclo precedente ha ancora le sue spese (134 €)', andamento.cycles.find((c) => c.key === '2026-09-07')?.spent === 134)
}

// =====================================================================
section('4. Cambio di ciclo: niente si perde')
// =====================================================================
{
  const before = JSON.stringify(EXPENSES)
  const nextCycle = expensesForPeriod(EXPENSES, { view: 'cycle', today: '2026-11-07', cycleStartDay: 7 })
  check('il 7/11 il ciclo in corso è nuovo e vuoto', nextCycle.range.start === '2026-11-07' && nextCycle.items.length === 0 && nextCycle.total === 0)
  check('   quello di ottobre è ora "un ciclo fa", con le stesse 4 spese', ids(expensesForPeriod(EXPENSES, { view: 'cycle', today: '2026-11-07', cycleStartDay: 7, cycleOffset: 1 }).items) === 'ieri,inizio-ciclo,oggi,oggi-2')
  check('   le spese non sono state toccate', JSON.stringify(EXPENSES) === before)
}

// =====================================================================
section('5. "Oggi" resta il giorno vero con l\'app aperta (todayWatcher)')
// =====================================================================
{
  const RealDate = Date
  let now = new RealDate(2026, 9, 20, 23, 58) // 20 ottobre, 23:58 ora locale
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(now.getTime()); else super(...args) }
    static now() { return now.getTime() }
  }
  globalThis.Date = FakeDate
  try {
    const map = new Map()
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
    const { useAppStore } = await import('../store/useAppStore.js?expenses-period=1')
    useAppStore.getState().switchScope(scopeFor('utente-oggi'))
    useAppStore.setState({ expenses: EXPENSES, cycleStartDay: 7 })
    useAppStore.getState().refreshToday()
    check('prima di mezzanotte: oggi è il 20/10', useAppStore.getState().today === '2026-10-20')

    const listeners = {}
    const doc = { visibilityState: 'hidden', addEventListener: (type, fn) => { listeners[type] = fn }, removeEventListener: (type) => { delete listeners[type] } }
    let tick = null
    const stop = startTodayWatcher(useAppStore, { doc, win: null, setTimer: (fn) => { tick = fn; return 1 }, clearTimer: () => { tick = null } })
    const before = useAppStore.getState()
    tick()
    check('stesso giorno: il controllo periodico non cambia lo stato (nessun ridisegno)', useAppStore.getState() === before)

    now = new RealDate(2026, 9, 21, 0, 3) // l'app resta aperta oltre la mezzanotte
    doc.visibilityState = 'visible'
    listeners.visibilitychange()
    check('tornata visibile dopo mezzanotte: oggi è il 21/10', useAppStore.getState().today === '2026-10-21')
    check('   "Spese di oggi" non mostra più quelle del 20/10', expensesForPeriod(useAppStore.getState().expenses, { view: 'today', today: useAppStore.getState().today }).items.length === 0)
    check('   le spese restano tutte', useAppStore.getState().expenses.length === EXPENSES.length)

    now = new RealDate(2026, 10, 7, 0, 1) // l'app aperta fino al nuovo ciclo
    tick()
    check('controllo periodico al cambio di ciclo: oggi 7/11, ciclo nuovo', useAppStore.getState().today === '2026-11-07'
      && expensesForPeriod(useAppStore.getState().expenses, { view: 'cycle', today: '2026-11-07', cycleStartDay: 7 }).items.length === 0)
    stop()
    check('stop: ascoltatore e timer rimossi', !listeners.visibilitychange && tick === null)

    // Navigazione: il riquadro decide il periodo con cui si apre la pagina Spese.
    useAppStore.getState().openExpenses('today')
    check('"Spese di oggi" → pagina Spese su Oggi', useAppStore.getState().activeTab === 'expenses' && useAppStore.getState().expensesView === 'today')
    useAppStore.getState().openExpenses('cycle')
    check('"Spese di questo mese" → pagina Spese sul ciclo', useAppStore.getState().expensesView === 'cycle')
    useAppStore.getState().openExpenses('today')
    useAppStore.getState().setActiveTab('expenses')
    check('dalla barra di navigazione: sempre il ciclo in corso', useAppStore.getState().expensesView === 'cycle')
    check('expensesView non viene salvato (solo interfaccia)', !('expensesView' in (JSON.parse(map.get(`spendy-storage-v2:${scopeFor('utente-oggi')}`)).state)))
  } finally {
    globalThis.Date = RealDate
  }
}

// =====================================================================
section('6. Fuso orario: la data è quella locale, non UTC')
// =====================================================================
{
  const script = (instant) => `
    const RealDate = Date
    globalThis.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(${instant}) } }
    const { todayStr } = await import(${JSON.stringify(new URL('../utils/date.js', import.meta.url).href)})
    process.stdout.write(todayStr() + '|' + new RealDate(${instant}).toISOString().slice(0, 10))`
  const run = (tz, instant) => execFileSync(process.execPath, ['--input-type=module', '-e', script(instant)], { env: { ...process.env, TZ: tz } }).toString()
  // 20/10 alle 10:30 UTC = già 21/10 alle 00:30 a Kiritimati (UTC+14).
  const [east, eastUtc] = run('Pacific/Kiritimati', Date.UTC(2026, 9, 20, 10, 30)).split('|')
  check('UTC+14 dopo mezzanotte locale: oggi è il 21/10 (in UTC sarebbe ancora il 20)', east === '2026-10-21' && eastUtc === '2026-10-20')
  // 21/10 alle 08:30 UTC = ancora 20/10 alle 22:30 a Honolulu (UTC−10).
  const [west, westUtc] = run('Pacific/Honolulu', Date.UTC(2026, 9, 21, 8, 30)).split('|')
  check('UTC−10 in serata: oggi è ancora il 20/10 (in UTC sarebbe già il 21)', west === '2026-10-20' && westUtc === '2026-10-21')
  const [rome] = run('Europe/Rome', Date.UTC(2026, 9, 20, 22, 30)).split('|')
  check('Italia alle 00:30 del 21/10 (22:30 UTC del 20): oggi è il 21/10', rome === '2026-10-21')
}

// =====================================================================
section('7. La pagina Spese vera (componente, store vero)')
// =====================================================================
{
  const { installFakeDom } = await import('../store/fakeDom.mjs')
  const dom = installFakeDom(new Map())
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const { createElement: h } = await import('react')
  const { createServer } = await import('vite')
  const { default: reactPlugin } = await import('@vitejs/plugin-react')
  const server = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    cacheDir: join(tmpdir(), 'spendy-expenses-period-test-vite'),
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
      reactPlugin(),
    ],
  })
  const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
  const text = (node) => (typeof node.data === 'string' ? node.data : (node.childNodes ?? []).map(text).join(''))
  const cls = (node) => node.attributes?.get?.('class') ?? ''
  const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
  const tickUi = () => new Promise((resolve) => setTimeout(resolve, 0))
  const act = async (fn) => { flushSync(fn); for (let i = 0; i < 4; i += 1) await tickUi() }
  try {
    const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
    const { ExpensesPage } = await server.ssrLoadModule('/src/pages/ExpensesPage.jsx')
    const { ExpenseSummaryCards } = await server.ssrLoadModule('/src/components/budget/ExpenseSummaryCards.jsx')
    useAppStore.getState().switchScope(scopeFor('utente-pagina'))
    useAppStore.setState({ today: TODAY, cycleStartDay: 7, expenses: EXPENSES })
    const dataBefore = JSON.stringify(useAppStore.getState().expenses)
    const items = (root) => nodes(root).filter((n) => cls(n) === 'expenses-page__item-desc').map(text).sort().join()
    const button = (root, label) => nodes(root).find((n) => n.localName === 'button' && (text(n).trim() === label || n.attributes?.get?.('aria-label') === label))

    // Il riquadro "Spese di oggi" della Home.
    const home = dom.createContainer()
    const homeRoot = createRoot(home, { onRecoverableError: () => {} })
    await act(() => homeRoot.render(h(ExpenseSummaryCards, { today: todaysExpenses(EXPENSES, TODAY), month: { total: totalForMonth(EXPENSES, TODAY, 7) }, monthlyBudget: 0, onOpenExpenses: useAppStore.getState().openExpenses })))
    const cards = nodes(home).filter((n) => n.localName === 'button')
    await act(() => propsOf(cards[0]).onClick({}))
    check('tocco su "Spese di oggi": la pagina Spese si apre su Oggi', useAppStore.getState().expensesView === 'today' && useAppStore.getState().activeTab === 'expenses')

    const container = dom.createContainer()
    const root = createRoot(container, { onRecoverableError: () => {} })
    await act(() => root.render(h(ExpensesPage)))
    check('Oggi: solo le due spese di oggi, totale 15,50 €', items(container) === 'oggi,oggi-2' && text(container).includes('Spese di oggi') && text(container).includes('15,50 €'))
    await act(() => root.unmount())

    await act(() => propsOf(cards[1]).onClick({}))
    const root2 = createRoot(container, { onRecoverableError: () => {} })
    await act(() => root2.render(h(ExpensesPage)))
    check('tocco su "Spese di questo mese": solo il ciclo 7 ott – 6 nov, totale 75,50 €', items(container) === 'ieri,inizio-ciclo,oggi,oggi-2' && text(container).includes('75,50 €') && text(container).includes('7 Ott – 6 Nov'))
    check('   nessuna spesa del ciclo precedente', !/fine-ciclo-prec|ciclo-prec|due-cicli-fa/.test(items(container)))
    check('   "Ciclo successivo" disattivato sul ciclo in corso', button(container, 'Ciclo successivo').attributes.has('disabled'))
    await act(() => propsOf(button(container, 'Ciclo precedente')).onClick({}))
    check('← ciclo precedente: 7 set – 6 ott con le sue spese', items(container) === 'ciclo-prec,fine-ciclo-prec,inizio-ciclo-prec' && text(container).includes('Spese del ciclo 7 Set – 6 Ott') && text(container).includes('134,00 €'))
    await act(() => propsOf(button(container, 'Ciclo precedente')).onClick({}))
    check('← ancora: 7 ago – 6 set, poi niente di più vecchio', items(container) === 'due-cicli-fa' && button(container, 'Ciclo precedente').attributes.has('disabled'))
    await act(() => propsOf(button(container, 'Ciclo successivo')).onClick({}))
    await act(() => propsOf(button(container, 'Ciclo successivo')).onClick({}))
    check('→ → di nuovo il ciclo in corso', items(container) === 'ieri,inizio-ciclo,oggi,oggi-2')
    await act(() => propsOf(button(container, 'Oggi')).onClick({}))
    check('scheda "Oggi" dentro la pagina: di nuovo solo oggi', items(container) === 'oggi,oggi-2')
    check('nessuna spesa modificata da tutta la navigazione', JSON.stringify(useAppStore.getState().expenses) === dataBefore)
    await act(() => root2.unmount())
    await act(() => homeRoot.unmount())
  } finally {
    await server.close()
  }
}

report('Spese di oggi e del ciclo')
