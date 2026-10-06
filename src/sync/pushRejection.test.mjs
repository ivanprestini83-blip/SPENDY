// Importi fuori scala e righe rifiutate dal database: il sync non resta mai
// bloccato. `npm test`, senza rete.
//
// Il database finto (memoryRemote.mjs) si comporta come Postgres/PostgREST:
// upsert atomico, numeric(12,2) che rifiuta oltre 9.999.999.999,99 (codice
// 22003), RLS che rifiuta con 42501, massimo 1.000 righe per richiesta.

import { readFileSync } from 'node:fs'
import { check, section, report, installFakeLocalStorage } from './testkit.mjs'
import { createMemoryDatabase, createMemoryRemote } from './memoryRemote.mjs'
import { createSyncEngine, isPermanentRejection } from './syncEngine.js'
import { MAX_AMOUNT, isValidAmount, isValidBudget, isOverLimit, parseAmountInput, AMOUNT_LIMIT_MESSAGE } from '../utils/amounts.js'
import { scopeFor, stateKey } from '../store/scope.js'

let boots = 0
async function device(db, userId, { remote: wrap } = {}) {
  installFakeLocalStorage()
  const storage = globalThis.localStorage
  const { useAppStore } = await import(`../store/useAppStore.js?push-rejection=${(boots += 1)}`)
  useAppStore.getState().switchScope(scopeFor(userId))
  const base = createMemoryRemote(db, userId)
  const remote = wrap ? wrap(base) : base
  const engine = createSyncEngine({ store: useAppStore, remote, autoFlushMs: 10_000 })
  useAppStore.getState().setSyncUser(userId)
  return { store: useAppStore, S: () => useAppStore.getState(), engine, storage, remote }
}
// Un'operazione già in coda con un importo che lo store di oggi non accetterebbe:
// arriva da una versione precedente dell'app, da un vecchio backup o da un bug.
function injectExpense(d, { id, amount, description = 'fuori scala' }) {
  const row = { id, amount, categoryId: 'bar', description, date: '2026-10-01', updatedAt: new Date().toISOString() }
  d.store.setState((state) => ({
    expenses: [row, ...state.expenses],
    sync: { ...state.sync, outbox: [...state.sync.outbox, { collection: 'expenses', rowId: id, row, updatedAt: row.updatedAt }] },
  }))
}
const countingUpserts = (calls) => (base) => ({ ...base, upsert: async (table, rows) => { calls.push({ table, n: rows.length }); return base.upsert(table, rows) } })

// =====================================================================
section('Limite degli importi')
// =====================================================================
check('limite di SPENDY: 1.000.000 €, molto sotto numeric(12,2)', MAX_AMOUNT === 1_000_000 && MAX_AMOUNT < 9_999_999_999.99)
check('validi: 0,01 · 1.000.000', isValidAmount(0.01) && isValidAmount(1_000_000))
check('non validi: 0, negativi, oltre il limite, NaN, infinito, testo', [0, -5, 1_000_000.01, 2e10, NaN, Infinity, '10', null, undefined].every((v) => !isValidAmount(v)))
check('stipendio: zero ammesso, oltre il limite no', isValidBudget(0) && isValidBudget(2500) && !isValidBudget(5e6) && !isValidBudget(-1))
check('campo testo "1000000,01" → oltre il limite', isOverLimit(parseAmountInput('1000000,01')) && !isOverLimit(parseAmountInput('999,99')))

// =====================================================================
section('Lo store ignora importi fuori limite (da qualunque strada arrivino)')
// =====================================================================
{
  const db = createMemoryDatabase()
  const d = await device(db, 'utente-limiti')
  const S = d.S
  S().addExpense({ amount: 1_000_000, categoryId: 'casa', description: 'al limite', date: '2026-10-01' })
  check('spesa di 1.000.000 €: accettata', S().expenses.length === 1 && S().sync.outbox.length === 1)
  S().addExpense({ amount: 1_000_000.01, categoryId: 'casa', description: 'oltre', date: '2026-10-01' })
  S().addExpense({ amount: 2e10, categoryId: 'casa', description: 'oltre il database', date: '2026-10-01' })
  S().addExpense({ amount: -3, categoryId: 'casa', description: 'negativa', date: '2026-10-01' })
  check('oltre il limite, oltre il database, negativa: ignorate (né in lista né in coda)', S().expenses.length === 1 && S().sync.outbox.length === 1)
  const id = S().expenses[0].id
  S().editExpense(id, { amount: 5e6 })
  check('modifica a 5.000.000 €: ignorata', S().expenses[0].amount === 1_000_000)
  S().editExpense(id, { description: 'solo testo' })
  check('modifica senza importo: invariata come prima', S().expenses[0].description === 'solo testo')
  S().addIncome({ amount: 3e6, categoryId: 'extra', description: 'x', date: '2026-10-01' })
  check('entrata oltre il limite: ignorata', S().incomes.length === 0)
  S().setMonthlyBudget(2e10, '2026-10-07')
  check('stipendio oltre il limite: ignorato', S().monthlyBudget === 0)
  S().setMonthlyBudget(2500, '2026-10-07')
  check('stipendio normale: accettato', S().monthlyBudget === 2500)
  S().addGoal({ label: 'Casa', emoji: '🏠', target: 5e6, etaMonths: 12 })
  S().addGoal({ label: 'Viaggio', emoji: '✈️', target: 3000, saved: 2e6, etaMonths: 12 })
  check('obiettivo con traguardo o importo iniziale oltre il limite: ignorato', S().goals.length === 0)
  S().addGoal({ label: 'Viaggio', emoji: '✈️', target: 3000, etaMonths: 12 })
  S().contributeToGoal(S().goals[0].id, 2e6)
  check('versamento su obiettivo oltre il limite: ignorato', S().goals.length === 1 && S().goalContributions.length === 0)
  S().contributeToEmergencyFund(2e10)
  S().contributeToEmergencyFund(150)
  check('fondo emergenza: oltre il limite ignorato, normale accettato', S().emergencyFundContributions.length === 1 && S().emergencyFundSaved === 150)
  S().editEmergencyFundContribution(S().emergencyFundContributions[0].id, { amount: 2e10 })
  check('   modifica oltre il limite: ignorata', S().emergencyFundSaved === 150)
}

// =====================================================================
section('Le schermate usano lo stesso limite e lo spiegano')
// =====================================================================
{
  const screens = ['src/components/modals/QuickAddScreen.jsx', 'src/components/modals/EditExpenseModal.jsx', 'src/components/modals/EditIncomeModal.jsx',
    'src/components/modals/ContributeToGoalModal.jsx', 'src/components/modals/NewGoalModal.jsx', 'src/components/goals/EmergencyFundScreen.jsx']
  for (const file of screens) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    check(`${file.split('/').pop()}: isValidAmount e avviso sul limite`, source.includes('isValidAmount(') && source.includes('<AmountLimitHint') && !/Number\.isFinite\((amountValue|targetValue)\) && (amountValue|targetValue) > 0/.test(source))
  }
  check('il testo dell\'avviso', AMOUNT_LIMIT_MESSAGE === 'Importo massimo: 1.000.000 €')
}

// =====================================================================
section('Classificazione degli errori del database')
// =====================================================================
check('definitivi: 22003 overflow, 22P02 dato non valido, 23502 not null, 23514 check, 42501 RLS', ['22003', '22P02', '23502', '23514', '42501'].every(isPermanentRejection))
check('temporanei: rete, timeout, 5xx, colonna mancante (PGRST204), tabella mancante (42P01)', [null, undefined, '', 'PGRST204', '42P01', '57014', '08006', '503'].every((c) => !isPermanentRejection(c)))

// =====================================================================
section('Un importo oltre il database non blocca le altre spese')
// =====================================================================
{
  const db = createMemoryDatabase()
  const OWNER = 'utente-overflow'
  const calls = []
  const d = await device(db, OWNER, { remote: countingUpserts(calls) })
  for (let i = 0; i < 5; i += 1) d.S().addExpense({ amount: 10 + i, categoryId: 'spesa', description: `valida-${i}`, date: '2026-10-02' })
  injectExpense(d, { id: 'e-overflow', amount: 2e10 })
  await d.engine.syncNow()
  const cloud = db.rows('expenses').filter((r) => r.user_id === OWNER)
  check('le 5 spese valide sono sul cloud', cloud.length === 5 && cloud.every((r) => r.description.startsWith('valida-')))
  check('quella oltre numeric(12,2) no', !cloud.some((r) => r.id === 'e-overflow'))
  check('   è uscita dalla coda: la coda è vuota', d.S().sync.outbox.length === 0)
  check('   ed è registrata tra le rifiutate, con il motivo', d.S().sync.rejected.length === 1 && d.S().sync.rejected[0].rowId === 'e-overflow' && /numeric field overflow/.test(d.S().sync.rejected[0].error))
  check('   resta sul dispositivo', d.S().expenses.some((e) => e.id === 'e-overflow'))
  check('sync riuscito, nessun errore bloccante', d.S().sync.status === 'synced' && !d.S().sync.error)
  check('   poche richieste per isolarla (6 operazioni → ' + calls.length + ')', calls.length <= 7)

  d.S().addExpense({ amount: 7, categoryId: 'bar', description: 'dopo', date: '2026-10-03' })
  await d.engine.syncNow()
  check('le spese successive partono normalmente', db.rows('expenses').some((r) => r.description === 'dopo') && d.S().sync.outbox.length === 0)
  check('   e la rifiutata non viene ritentata', d.S().sync.rejected.length === 1 && !db.rows('expenses').some((r) => r.id === 'e-overflow'))

  const saved = JSON.parse(d.storage.getItem(stateKey(scopeFor(OWNER))))
  check('le rifiutate sopravvivono a un ricaricamento (salvate in locale)', saved.state.sync.rejected?.length === 1)
}

// =====================================================================
section('Isolamento efficiente: 1.000 operazioni valide e 3 non valide')
// =====================================================================
{
  const db = createMemoryDatabase()
  const OWNER = 'utente-mille'
  const calls = []
  const d = await device(db, OWNER, { remote: countingUpserts(calls) })
  for (let i = 0; i < 1000; i += 1) d.S().addExpense({ amount: 1 + (i % 90), categoryId: 'spesa', description: `ok-${i}`, date: '2026-10-02' })
  injectExpense(d, { id: 'e-bad-1', amount: 5e10 })
  injectExpense(d, { id: 'e-bad-2', amount: 9.9e12 })
  injectExpense(d, { id: 'e-bad-3', amount: 1e10 })
  await d.engine.syncNow()
  const cloud = db.rows('expenses').filter((r) => r.user_id === OWNER)
  check('1.000 spese valide sul cloud', cloud.length === 1000, String(cloud.length))
  check('   le 3 non valide isolate e rifiutate', d.S().sync.rejected.map((r) => r.rowId).sort().join() === 'e-bad-1,e-bad-2,e-bad-3')
  check('   coda vuota, sync riuscito', d.S().sync.outbox.length === 0 && d.S().sync.status === 'synced')
  check(`   richieste: ${calls.length} (non 1.003)`, calls.length <= 45)

  const fresh = await device(db, OWNER)
  await fresh.engine.syncNow()
  check('un altro dispositivo dello stesso utente le riceve tutte e 1.000 (pull paginato invariato)', fresh.S().expenses.length === 1000)
}

// =====================================================================
section('Riga di un altro utente (RLS, 42501): rifiutata solo lei')
// =====================================================================
{
  const db = createMemoryDatabase()
  const a = await device(db, 'utente-a-rls')
  a.S().contributeToEmergencyFund(100)
  a.store.setState((state) => ({ sync: { ...state.sync, outbox: state.sync.outbox.map((op) => ({ ...op, rowId: 'ef-legacy', row: { ...op.row, id: 'ef-legacy' } })) } }))
  await a.engine.syncNow()
  check('premessa: "ef-legacy" sul cloud appartiene ad A', db.rows('emergency_fund_contributions').some((r) => r.id === 'ef-legacy' && r.user_id === 'utente-a-rls'))

  const b = await device(db, 'utente-b-rls')
  b.S().contributeToEmergencyFund(50)
  b.store.setState((state) => ({ sync: { ...state.sync, outbox: state.sync.outbox.map((op) => ({ ...op, rowId: 'ef-legacy', row: { ...op.row, id: 'ef-legacy' } })) } }))
  b.S().addExpense({ amount: 12, categoryId: 'bar', description: 'spesa di B', date: '2026-10-02' })
  await b.engine.syncNow()
  check('la riga "ef-legacy" di B è rifiutata (42501), senza toccare quella di A', b.S().sync.rejected.some((r) => r.rowId === 'ef-legacy')
    && db.rows('emergency_fund_contributions').find((r) => r.id === 'ef-legacy')?.user_id === 'utente-a-rls')
  check('   la spesa di B parte comunque', db.rows('expenses').some((r) => r.description === 'spesa di B' && r.user_id === 'utente-b-rls'))
  check('   coda di B vuota, sync riuscito', b.S().sync.outbox.length === 0 && b.S().sync.status === 'synced')
}

// =====================================================================
section('Stipendio oltre il database: le impostazioni non bloccano il resto')
// =====================================================================
{
  const db = createMemoryDatabase()
  const d = await device(db, 'utente-stipendio')
  const at = new Date().toISOString()
  d.store.setState((state) => ({ monthlyBudget: 3e10, sync: { ...state.sync, outbox: [...state.sync.outbox, { collection: '__settings', rowId: 'me', row: { monthlyBudget: 3e10, currency: '€', cycleStartDay: 1, amountHidden: false, updatedAt: at }, updatedAt: at }] } }))
  d.S().addExpense({ amount: 30, categoryId: 'spesa', description: 'insieme allo stipendio', date: '2026-10-02' })
  await d.engine.syncNow()
  check('impostazioni rifiutate (22003), fuori dalla coda', d.S().sync.rejected.some((r) => r.collection === '__settings') && d.S().sync.outbox.length === 0)
  check('   la spesa parte', db.rows('expenses').some((r) => r.description === 'insieme allo stipendio'))
  check('   sync riuscito', d.S().sync.status === 'synced' && !d.S().sync.error)
}

// =====================================================================
section('Errore temporaneo dell\'invio: niente scartato, il pull avviene comunque')
// =====================================================================
{
  const db = createMemoryDatabase()
  const OWNER = 'utente-rete'
  const other = await device(db, OWNER)
  other.S().addExpense({ amount: 44, categoryId: 'casa', description: 'dall\'altro dispositivo', date: '2026-10-02' })
  await other.engine.syncNow()

  let failing = true
  const d = await device(db, OWNER, { remote: (base) => ({ ...base, upsert: async (t, r) => (failing ? { error: `${t}: 503 Service Unavailable`, code: null } : base.upsert(t, r)) }) })
  d.S().addExpense({ amount: 9, categoryId: 'bar', description: 'locale in attesa', date: '2026-10-03' })
  const result = await d.engine.syncNow()
  check('invio fallito (503): l\'operazione resta in coda, non è rifiutata', d.S().sync.outbox.length === 1 && d.S().sync.rejected.length === 0)
  check('   il pull è avvenuto lo stesso: arriva la spesa dell\'altro dispositivo', d.S().expenses.some((e) => e.description === 'dall\'altro dispositivo'))
  check('   stato di errore con il motivo, ultimo sync non aggiornato', d.S().sync.status === 'error' && /503/.test(d.S().sync.error) && result.error && d.S().sync.lastSyncAt === null)
  check('   la spesa locale in attesa resta', d.S().expenses.some((e) => e.description === 'locale in attesa'))
  failing = false
  await d.engine.syncNow()
  check('tornato il server: la coda parte, stato riuscito', d.S().sync.outbox.length === 0 && d.S().sync.status === 'synced' && db.rows('expenses').some((r) => r.description === 'locale in attesa'))

  // Una modifica locale in attesa non viene sovrascritta dal pull fatto dopo un invio fallito.
  failing = true
  const target = d.S().expenses.find((e) => e.description === 'dall\'altro dispositivo')
  d.S().editExpense(target.id, { description: 'corretta qui' })
  other.S().editExpense(target.id, { description: 'corretta di là' })
  await other.engine.syncNow()
  await d.engine.syncNow()
  check('pull dopo un invio fallito: la modifica locale in coda non viene sovrascritta', d.S().expenses.find((e) => e.id === target.id)?.description === 'corretta qui' && d.S().sync.outbox.length === 1)
}

report('Importi fuori scala e righe rifiutate')
