// Lo stipendio appartiene al ciclo in cui è inserito. `npm test`, senza rete.
//
// Il caso da cui nasce: all'inizio del secondo ciclo SPENDY mostrava di nuovo
// lo stipendio del ciclo precedente, perché lo stipendio era un unico valore
// ricorrente (monthlyBudget) letto da ogni ciclo. Ora è un'entrata datata
// (useAppStore.addSalary, tabella incomes) e ogni ciclo usa solo la sua.

import { readFileSync } from 'node:fs'
import { check, section, report, installFakeLocalStorage } from './testkit.mjs'
import { createMemoryDatabase, createMemoryRemote } from './memoryRemote.mjs'
import { createSyncEngine } from './syncEngine.js'
import { scopeFor } from '../store/scope.js'
import { buildFinancialData } from '../utils/budgetCalculations.js'
import { buildAndamento } from '../utils/andamentoEngine.js'
import { currentCycleSalary, extraIncomes, lastKnownSalary, salaryForPeriod, isSalary } from '../utils/salary.js'
import { budgetNotifications } from '../notifications/notificationRules.js'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

let boots = 0
async function device(db, userId, { realtime = false } = {}) {
  installFakeLocalStorage()
  const { useAppStore } = await import(`../store/useAppStore.js?salary=${(boots += 1)}`)
  useAppStore.getState().switchScope(scopeFor(userId))
  const remote = createMemoryRemote(db, userId, { realtime })
  const engine = createSyncEngine({ store: useAppStore, remote, autoFlushMs: 10_000 })
  useAppStore.getState().setSyncUser(userId)
  return { store: useAppStore, S: () => useAppStore.getState(), engine, remote }
}
async function localDevice() {
  installFakeLocalStorage()
  const { useAppStore } = await import(`../store/useAppStore.js?salary=${(boots += 1)}`)
  return { store: useAppStore, S: () => useAppStore.getState() }
}
// Quello che fa la Home (HomePage.jsx): stipendio del ciclo + buildFinancialData.
const home = (S) => {
  const s = S()
  const monthlyBudget = currentCycleSalary(s.incomes, s.today, s.cycleStartDay ?? 1)
  return { salary: monthlyBudget, ...buildFinancialData({ today: s.today, monthlyBudget, expenses: s.expenses, incomes: s.incomes, goals: s.goals, cycleStartDay: s.cycleStartDay ?? 1 }) }
}
const andamento = (S) => {
  const s = S()
  return buildAndamento({ expenses: s.expenses, incomes: s.incomes, monthlyBudget: s.monthlyBudget, today: s.today, cycleStartDay: s.cycleStartDay ?? 1 })
}
const cycleAt = (result, start) => result.cycles.find((cycle) => cycle.key === start)

// =====================================================================
section('1. L\'esempio: ciclo A 1700, nuovo ciclo B parte da 0, poi 1550')
// =====================================================================
{
  const { store, S } = await localDevice()
  store.setState({ today: '2026-09-20' })
  S().addSalary({ amount: 1700, date: '2026-09-01' })
  S().addExpense({ amount: 1200, categoryId: 'casa', description: 'affitto e spese', date: '2026-09-05' })
  check('il primo stipendio fissa il giorno di inizio ciclo dalla sua data (1)', S().cycleStartDay === 1)
  check('ciclo A: stipendio 1700, spese 1200, disponibile 500', home(S).salary === 1700 && home(S).spentThisMonth === 1200 && home(S).available === 500)

  const incomesBefore = S().incomes.length
  const outboxBefore = S().sync.outbox.length
  store.setState({ today: '2026-10-02' }) // inizia il ciclo B
  check('ciclo B: nessuna entrata creata, nessuna operazione in coda', S().incomes.length === incomesBefore && S().sync.outbox.length === outboxBefore)
  check('ciclo B: stipendio 0, spese 0, disponibile 0', home(S).salary === 0 && home(S).spentThisMonth === 0 && home(S).available === 0)
  check('   budget usato 0, senza divisione per zero', home(S).spentRatio === 0 && Number.isFinite(home(S).spentRatio))
  S().addExpense({ amount: 40, categoryId: 'bar', description: 'colazioni', date: '2026-10-02' })
  check('ciclo B senza stipendio: disponibile = extra − spese (−40), niente eredità', home(S).available === -40)
  {
    const big = { id: 'e-grande', amount: 5000, categoryId: 'casa', description: 'x', date: '2026-10-02', updatedAt: '2026-10-02T10:00:00.000Z' }
    const prev = S()
    const next = { ...prev, expenses: [big, ...prev.expenses] }
    check('   nessun budget da superare: nessuna notifica di budget, nemmeno con 5000 € di spese', budgetNotifications(prev, next).length === 0)
    const withSalary = (state) => ({ ...state, incomes: [{ id: 'i-s', categoryId: 'stipendio', amount: 1000, date: '2026-10-02', updatedAt: '2026-10-02T09:00:00.000Z' }, ...state.incomes] })
    check('   (controprova: con uno stipendio nel ciclo la stessa spesa la genera)', budgetNotifications(withSalary(prev), withSalary(next)).length === 1)
  }

  S().addSalary({ amount: 1550, date: '2026-10-02' })
  check('inserito 1550: ciclo B stipendio 1550, disponibile 1510', home(S).salary === 1550 && home(S).available === 1510)
  const a = cycleAt(andamento(S), '2026-09-01')
  const b = cycleAt(andamento(S), '2026-10-01')
  check('Andamento: ciclo A stipendio 1700, ciclo B 1550', a.salary === 1700 && b.salary === 1550)
  check('   A: spese 1200, risparmio 500, budget usato 1200/1700', a.spent === 1200 && a.savings === 500 && Math.abs(a.budgetUsed - (1200 / 1700) * 100) < 1e-9)
  check('   B: spese 40, risparmio 1510', b.spent === 40 && b.savings === 1510)
  check('il giorno di inizio ciclo non cambia con il secondo stipendio', S().cycleStartDay === 1)

  // Correggere lo stipendio di B non riscrive A.
  const salaryB = S().incomes.find((i) => isSalary(i) && i.date === '2026-10-02')
  S().editIncome(salaryB.id, { amount: 1600 })
  check('modificare lo stipendio di B (1600) non tocca A (1700)', cycleAt(andamento(S), '2026-09-01').salary === 1700 && cycleAt(andamento(S), '2026-10-01').salary === 1600)
  check('   e la Home di B usa 1600', home(S).salary === 1600)
  S().deleteIncome(salaryB.id)
  check('eliminare lo stipendio di B: B torna a 0 (anche se monthlyBudget vale ancora 1550)', home(S).salary === 0 && S().monthlyBudget === 1550)
  check('   A resta 1700', cycleAt(andamento(S), '2026-09-01').salary === 1700)
}

// =====================================================================
section('2. Lo stipendio non è mai contato due volte come extra')
// =====================================================================
{
  const { store, S } = await localDevice()
  store.setState({ today: '2026-10-10', cycleStartDay: 1 })
  S().addSalary({ amount: 1550, date: '2026-10-01' })
  S().addIncome({ amount: 100, categoryId: 'extra', description: 'ripetizioni', date: '2026-10-03' })
  S().addIncome({ amount: 30, categoryId: 'rimborso', description: 'rimborso', date: '2026-10-04' })
  check('Home: entrate extra = 130, non 1680', home(S).extraIncomeThisMonth === 130)
  check('   disponibile = 1550 + 130', home(S).available === 1680)
  const current = andamento(S).current
  check('Andamento: stipendio 1550, extra 130, entrate 1680', current.salary === 1550 && current.extraIncome === 130 && current.income === 1680)
  check('extraIncomes esclude lo stipendio', extraIncomes(S().incomes).every((i) => i.categoryId !== 'stipendio') && extraIncomes(S().incomes).length === 2)
  check('due stipendi nello stesso ciclo si sommano (es. tredicesima registrata come stipendio)', (S().addSalary({ amount: 400, date: '2026-10-05' }), home(S).salary === 1950))
}

// =====================================================================
section('3. addSalary: data, ciclo, ultimo stipendio')
// =====================================================================
{
  const { store, S } = await localDevice()
  store.setState({ today: '2026-10-08' })
  S().addSalary({ amount: 1700, date: '2026-09-27' })
  check('stipendio arrivato il 27 e inserito l\'8: il ciclo parte dal 27', S().cycleStartDay === 27)
  const row = S().incomes[0]
  check('è un\'entrata "stipendio" datata 27/9, in coda per il sync', row.categoryId === 'stipendio' && row.date === '2026-09-27' && S().sync.outbox.some((op) => op.collection === 'incomes' && op.rowId === row.id))
  check('ciclo corrente (27 set – 26 ott): stipendio 1700', home(S).salary === 1700)
  check('monthlyBudget = ultimo stipendio inserito (fondo emergenza, versioni precedenti)', S().monthlyBudget === 1700)
  S().addSalary({ amount: 1500, date: '2026-08-27' })
  check('uno stipendio di un ciclo passato inserito dopo non cambia l\'ultimo stipendio', S().monthlyBudget === 1700)
  check('   e va nel suo ciclo', salaryForPeriod(S().incomes, { start: '2026-08-27', end: '2026-09-27' }) === 1500 && home(S).salary === 1700)
  check('lastKnownSalary: il più recente per data', lastKnownSalary(S().incomes, 0) === 1700)
  S().addSalary({ amount: 2e10, date: '2026-10-08' })
  check('importo oltre il limite: ignorato', S().incomes.length === 2)
  check('lastKnownSalary senza stipendi: il vecchio monthlyBudget, oppure 0', lastKnownSalary([], 1700) === 1700 && lastKnownSalary([], 0) === 0)
}

// =====================================================================
section('4. Dati di prima (solo monthlyBudget): nessuna entrata inventata')
// =====================================================================
{
  const { store, S } = await localDevice()
  store.setState({ today: '2026-10-02', monthlyBudget: 1700, cycleStartDay: 1 })
  S().addExpense({ amount: 20, categoryId: 'bar', description: 'x', date: '2026-10-02' })
  check('nessuno stipendio viene creato dal vecchio monthlyBudget', !S().incomes.some(isSalary))
  check('il ciclo corrente non eredita 1700: stipendio 0', home(S).salary === 0 && home(S).available === -20)
  check('Andamento non usa monthlyBudget come stipendio di nessun ciclo', andamento(S).cycles.every((c) => c.salary === 0))
  check('   ma resta per l\'obiettivo del fondo emergenza (logica invariata)', S().monthlyBudget === 1700)
}

// =====================================================================
section('5. Due dispositivi: stipendio, modifica, eliminazione')
// =====================================================================
const db = createMemoryDatabase()
const USER = 'utente-stipendio'
const phone = await device(db, USER)
const mac = await device(db, USER)
{
  phone.store.setState({ today: '2026-10-03' })
  mac.store.setState({ today: '2026-10-03' })
  phone.S().addSalary({ amount: 1550, date: '2026-10-01' })
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  const onMac = mac.S().incomes.find(isSalary)
  check('il Mac riceve lo stipendio come entrata "stipendio" datata', onMac?.amount === 1550 && onMac?.date === '2026-10-01')
  check('   e le impostazioni (giorno di inizio ciclo, ultimo stipendio)', mac.S().cycleStartDay === 1 && mac.S().monthlyBudget === 1550)
  check('   la Home del Mac: stipendio 1550', home(mac.S).salary === 1550)
  const cloud = db.rows('incomes').find((r) => r.id === onMac.id)
  check('sul cloud: una riga incomes con category_id "stipendio"', cloud?.category_id === 'stipendio' && Number(cloud.amount) === 1550 && cloud.user_id === USER)
  await wait()
  mac.S().editIncome(onMac.id, { amount: 1580 })
  await mac.engine.syncNow()
  await phone.engine.syncNow()
  check('modifica sul Mac → il telefono vede 1580', home(phone.S).salary === 1580)
  await wait()
  phone.S().deleteIncome(onMac.id)
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  check('eliminato sul telefono → sul Mac lo stipendio del ciclo torna 0', home(mac.S).salary === 0 && !mac.S().incomes.some(isSalary))
  check('   nessuno stipendio ricreato dal sync', db.rows('incomes').every((r) => r.deleted_at !== null))

  // Cambio ciclo su entrambi + sync: nessuna entrata nuova.
  phone.S().addSalary({ amount: 1500, date: '2026-10-01' })
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  const rowsBefore = db.rows('incomes').length
  phone.store.setState({ today: '2026-11-02' })
  mac.store.setState({ today: '2026-11-02' })
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  check('nuovo ciclo su entrambi i dispositivi, dopo il sync: nessuna riga nuova', db.rows('incomes').length === rowsBefore && phone.S().incomes.length === mac.S().incomes.length)
  check('   stipendio del nuovo ciclo 0 su entrambi', home(phone.S).salary === 0 && home(mac.S).salary === 0)
  check('   ottobre resta 1500 nell\'Andamento di entrambi', cycleAt(andamento(phone.S), '2026-10-01').salary === 1500 && cycleAt(andamento(mac.S), '2026-10-01').salary === 1500)
}

// =====================================================================
section('6. Realtime: lo stipendio arriva senza aspettare il pull')
// =====================================================================
{
  const live = await device(db, USER, { realtime: true })
  live.store.setState({ today: '2026-11-02' })
  await live.engine.start(USER)
  phone.S().addSalary({ amount: 1620, date: '2026-11-01' })
  await phone.engine.syncNow()
  await wait(20)
  check('il dispositivo aperto vede lo stipendio di novembre', home(live.S).salary === 1620)
  check('   e l\'Andamento lo mette solo in novembre', cycleAt(andamento(live.S), '2026-11-01').salary === 1620 && cycleAt(andamento(live.S), '2026-10-01').salary === 1500)
  live.engine.stop()
}

// =====================================================================
section('7. Home, Spendy, Radar, Spese, notifiche: lo stipendio del ciclo')
// =====================================================================
{
  const files = {
    'src/pages/HomePage.jsx': true,
    'src/pages/SpendyPage.jsx': false,
    'src/components/radar/RadarScreen.jsx': false,
    'src/pages/ExpensesPage.jsx': false,
    'src/components/affordability/AffordabilityScreen.jsx': false,
  }
  for (const [file, keepsLastSalary] of Object.entries(files)) {
    const source = read(file)
    check(`${file.split('/').pop()}: budget = currentCycleSalary, non state.monthlyBudget`, source.includes('const monthlyBudget = currentCycleSalary(incomes, today, cycleStartDay)')
      && !source.includes('const monthlyBudget = useAppStore((state) => state.monthlyBudget)')
      && (!keepsLastSalary || /target: lastSalary \* EMERGENCY_FUND_TARGET_MONTHS/.test(source)))
  }
  const rules = read('src/notifications/notificationRules.js')
  check('notificationRules: soglie sullo stipendio del ciclo', rules.includes('currentCycleSalary(state.incomes') && !/state\.monthlyBudget/.test(rules))
  check('AndamentoScreen non passa più monthlyBudget', !read('src/components/andamento/AndamentoScreen.jsx').includes('monthlyBudget'))
  check('BudgetCard: a inizio ciclo dice che lo stipendio non è ancora inserito', read('src/components/budget/BudgetCard.jsx').includes('Stipendio di questo ciclo non ancora inserito'))
  check('fondo emergenza: logica invariata (monthlyBudget × mesi)', read('src/components/goals/EmergencyFundScreen.jsx').includes('const target = monthlyBudget * EMERGENCY_FUND_TARGET_MONTHS'))
}

report('Stipendio per ciclo')
