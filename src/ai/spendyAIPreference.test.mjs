// Spendy AI attivabile dall'utente. `npm test`, senza rete.
//
//   - spenta (default): nessuna chiamata, sempre la frase locale del coach;
//   - accesa: ESATTAMENTE il comportamento di prima (stesse decisioni di
//     decideSpendyVoice, stessa chiamata, stessa cache);
//   - è una scelta dell'account: separata per account sul dispositivo,
//     mantenuta tra logout e login, sincronizzata tra i dispositivi dello
//     stesso account e mai visibile a un altro.

import { check, section, report, installFakeLocalStorage } from '../sync/testkit.mjs'
import { buildFinancialData } from '../utils/budgetCalculations.js'
import { getSpendyCoach } from '../utils/spendyCoach.js'
import { prepareSpendyVoice } from './spendyVoice.js'
import { createSpendyAI } from './spendyAI.js'
import { createMockProvider } from './providers/mockProvider.js'
import { decideSpendyVoice, decideSpendyVoiceFor, requestSpendyVoice, resolveSpendyVoice, VOICE_LIMITS } from './spendyVoicePolicy.js'
import { emptyVoiceCache } from './spendyVoiceCache.js'
import { createMemoryDatabase, createMemoryRemote } from '../sync/memoryRemote.mjs'
import { createSyncEngine } from '../sync/syncEngine.js'
import { settingsToRemote, settingsToLocal } from '../sync/mappers.js'
import { scopeFor, GUEST } from '../store/scope.js'
import { readFileSync } from 'node:fs'

const TODAY = '2026-09-20'
const NOW = Date.parse('2026-09-20T10:00:00Z')
let seq = 0
const expense = (date, amount, categoryId) => ({ id: `e-${seq++}`, date, amount, categoryId, description: 'nota' })
const categoryRise = () => [
  ...['06', '07', '08'].map((month, i) => expense(`2026-${month}-10`, [50, 60, 55][i], 'ristoranti')),
  expense('2026-09-05', 80, 'ristoranti'),
  expense('2026-09-12', 80, 'ristoranti'),
]

function countingAI() {
  const provider = createMockProvider({ mode: 'normal', latencyMs: 0 })
  let calls = 0
  const wrapped = { name: provider.name, available: provider.available, generate: (...args) => { calls += 1; return provider.generate(...args) } }
  return { ai: createSpendyAI({ provider: wrapped, timeoutMs: 500 }), calls: () => calls }
}

// Il flusso della Home come lo esegue useSpendyVoice, con la preferenza.
async function runHome({ aiEnabled, expenses = categoryRise(), monthlyBudget = 2000, cache = emptyVoiceCache(), ai, limits = VOICE_LIMITS, now = NOW }) {
  const financialData = buildFinancialData({ today: TODAY, monthlyBudget, expenses, incomes: [], goals: [], cycleStartDay: 1 })
  const coach = getSpendyCoach(financialData, { expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals: [], jokeHistory: [], financialData })
  const { context, meta } = prepareSpendyVoice({ coach, financialData, expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals: [] })
  const first = decideSpendyVoiceFor({ aiEnabled, coach, meta, today: TODAY, cache, now, limits })
  let nextCache = cache
  if (first.action === 'ai') ({ cache: nextCache } = await requestSpendyVoice({ ai, context, meta, cache, today: TODAY, now }))
  const after = decideSpendyVoiceFor({ aiEnabled, coach, meta, today: TODAY, cache: nextCache, now, limits })
  return { coach, meta, first, cache: nextCache, voice: resolveSpendyVoice({ decision: after, coach, cache: nextCache }) }
}

// =====================================================================
section('5–6. Spendy AI spenta: nessuna chiamata, frase locale')
// =====================================================================
{
  const { ai, calls } = countingAI()
  const off = await runHome({ aiEnabled: false, ai })
  check('decisione locale "ai_disabled"', off.first.action === 'local' && off.first.reason === 'ai_disabled')
  check('nessuna chiamata all\'AI', calls() === 0)
  check('la frase è quella locale del coach', off.voice.source === 'local' && off.voice.message === off.coach.message)
  check('la cache non cambia', JSON.stringify(off.cache) === JSON.stringify(emptyVoiceCache()))

  for (const value of [undefined, null, 'true', 1, {}]) {
    check(`valore ${JSON.stringify(value) ?? 'undefined'}: considerata spenta`, decideSpendyVoiceFor({ aiEnabled: value, coach: off.coach, meta: off.meta, today: TODAY, cache: emptyVoiceCache(), now: NOW }).reason === 'ai_disabled')
  }

  // Una frase AI già in cache (di quando era accesa) non viene mostrata da spenta.
  const { ai: ai2 } = countingAI()
  const on = await runHome({ aiEnabled: true, ai: ai2 })
  const offWithCache = await runHome({ aiEnabled: false, ai, cache: on.cache })
  check('frase AI in cache + spenta: si vede la frase locale', on.voice.source === 'ai' && offWithCache.voice.source === 'local' && offWithCache.voice.message === offWithCache.coach.message)
  check('   e nessuna chiamata', calls() === 0)
  const urgent = await runHome({ aiEnabled: false, ai, expenses: [expense('2026-09-10', 3000, 'spesa')] })
  check('anche con un evento urgente (budget sforato): nessuna chiamata', urgent.first.reason === 'ai_disabled' && calls() === 0)
}

// =====================================================================
section('7. Spendy AI accesa: comportamento identico a prima')
// =====================================================================
{
  const busy = { ...emptyVoiceCache(), calls: { day: TODAY, count: 3, lastAt: NOW - 3 * 3600000 } }
  const recent = { ...emptyVoiceCache(), calls: { day: TODAY, count: 1, lastAt: NOW - 5 * 60000 } }
  const scenarios = [
    ['nuovo evento', { cache: emptyVoiceCache() }],
    ['3 chiamate oggi', { cache: busy }],
    ['chiamata 5 minuti fa', { cache: recent }],
    ['senza stipendio', { monthlyBudget: 0, cache: emptyVoiceCache() }],
    ['budget sforato', { expenses: [expense('2026-09-10', 3000, 'spesa')], cache: recent }],
  ]
  for (const [name, opts] of scenarios) {
    const expenses = opts.expenses ?? categoryRise()
    const monthlyBudget = opts.monthlyBudget ?? 2000
    const financialData = buildFinancialData({ today: TODAY, monthlyBudget, expenses, incomes: [], goals: [], cycleStartDay: 1 })
    const coach = getSpendyCoach(financialData, { expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals: [], jokeHistory: [], financialData })
    const { meta } = prepareSpendyVoice({ coach, financialData, expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals: [] })
    const input = { coach, meta, today: TODAY, cache: opts.cache, now: NOW, limits: VOICE_LIMITS }
    check(`${name}: stessa decisione di prima`, JSON.stringify(decideSpendyVoiceFor({ aiEnabled: true, ...input })) === JSON.stringify(decideSpendyVoice(input)), decideSpendyVoice(input).reason)
  }
  const { ai, calls } = countingAI()
  const first = await runHome({ aiEnabled: true, ai })
  check('accesa: una chiamata e la frase dell\'AI', calls() === 1 && first.voice.source === 'ai')
  const second = await runHome({ aiEnabled: true, ai, cache: first.cache })
  check('   riapertura: dalla cache, nessuna chiamata in più (cache e facts invariati)', second.first.action === 'cache' && calls() === 1 && second.voice.message === first.voice.message)
}

// =====================================================================
section('Impostazioni: la preferenza viaggia solo quando è nota')
// =====================================================================
{
  check('settingsToRemote con preferenza: spendy_ai_enabled', settingsToRemote({ monthlyBudget: 1, spendyAIEnabled: true, updatedAt: 'x' }, 'u').spendy_ai_enabled === true)
  const withoutPref = settingsToRemote({ monthlyBudget: 1, amountHidden: false, updatedAt: 'x' }, 'u')
  check('   senza preferenza (backup, migrazione): la colonna non viene inviata', !('spendy_ai_enabled' in withoutPref))
  check('settingsToLocal: valore della colonna', settingsToLocal({ spendy_ai_enabled: true }).spendyAIEnabled === true && settingsToLocal({ spendy_ai_enabled: false }).spendyAIEnabled === false)
  check('   colonna assente (migration non eseguita): nessun valore', settingsToLocal({ monthly_budget: 10 }).spendyAIEnabled === undefined)
}

// =====================================================================
section('8–10. Una scelta per account')
// =====================================================================
{
  installFakeLocalStorage()
  const { useAppStore } = await import('../store/useAppStore.js?ai-preference=1')
  const S = useAppStore.getState
  const A = 'utente-a-pref'
  const B = 'utente-b-pref'

  check('nuovo stato: spenta', S().spendyAIEnabled === false)
  S().switchScope(scopeFor(A))
  check('nuovo account A: spenta di default', S().spendyAIEnabled === false)
  S().setSpendyAIEnabled(true)
  check('A la accende', S().spendyAIEnabled === true)
  check('   la scelta entra nella coda delle impostazioni', S().sync.outbox.some((op) => op.rowId === 'me' && op.row.spendyAIEnabled === true))

  S().switchScope(scopeFor(B))
  check('10. B non vede la scelta di A', S().spendyAIEnabled === false)
  S().switchScope(GUEST)
  check('   il guest nemmeno', S().spendyAIEnabled === false)

  S().switchScope(scopeFor(A))
  check('9. logout/login: A ritrova la sua scelta', S().spendyAIEnabled === true)
  S().setSpendyAIEnabled(false)
  S().switchScope(scopeFor(B))
  S().switchScope(scopeFor(A))
  check('   anche quando la spegne', S().spendyAIEnabled === false)

  // Altre impostazioni non toccano la preferenza.
  S().setSpendyAIEnabled(true)
  S().setCycleStartDay(7)
  check('cambiare il ciclo non cambia la preferenza', S().spendyAIEnabled === true)
  check('   e l\'ultima operazione impostazioni la porta con sé', S().sync.outbox.filter((op) => op.rowId === 'me').at(-1)?.row.spendyAIEnabled === true)
}

// =====================================================================
section('8–10. Sincronizzazione tra dispositivi e isolamento sul cloud')
// =====================================================================
{
  const db = createMemoryDatabase()
  const A = 'utente-a-cloud'
  const B = 'utente-b-cloud'
  const device = async (name, userId) => {
    installFakeLocalStorage()
    const { useAppStore } = await import(`../store/useAppStore.js?ai-device=${name}`)
    useAppStore.getState().switchScope(scopeFor(userId))
    const engine = createSyncEngine({ store: useAppStore, remote: createMemoryRemote(db, userId), autoFlushMs: 10_000 })
    return { state: () => useAppStore.getState(), engine }
  }

  const phoneA = await device('telefono-a', A)
  phoneA.state().setSpendyAIEnabled(true)
  await phoneA.engine.syncNow()
  check('A sul telefono: salvata sul cloud nella SUA riga', db.rows('profiles').some((r) => r.id === A && r.spendy_ai_enabled === true))

  const macA = await device('mac-a', A)
  await macA.engine.syncNow()
  check('A sul Mac: ritrova la scelta fatta sul telefono', macA.state().spendyAIEnabled === true)

  const phoneB = await device('telefono-b', B)
  await phoneB.engine.syncNow()
  check('B: non riceve la scelta di A', phoneB.state().spendyAIEnabled === false)
  phoneB.state().setSpendyAIEnabled(true)
  await phoneB.engine.syncNow()
  phoneA.state().setSpendyAIEnabled(false)
  await phoneA.engine.syncNow()
  await phoneB.engine.syncNow()
  check('A la spegne: B resta com\'era', phoneB.state().spendyAIEnabled === true && db.rows('profiles').find((r) => r.id === B)?.spendy_ai_enabled === true)
  await macA.engine.syncNow()
  check('   e il Mac di A si spegne', macA.state().spendyAIEnabled === false)

  // Righe profiles senza colonna (migration non ancora eseguita): niente cambia.
  const before = macA.state().spendyAIEnabled
  macA.state().applyRemoteSettings({ id: A, monthly_budget: '1500', currency: '€', cycle_start_day: 1, amount_hidden: false, client_updated_at: new Date().toISOString() })
  check('impostazioni dal cloud senza la colonna: la scelta locale resta', macA.state().spendyAIEnabled === before && macA.state().monthlyBudget === 1500)
}

// =====================================================================
section('Colonna spendy_ai_enabled non ancora creata: nessun errore di sync')
// =====================================================================
{
  // Il database com'è PRIMA di privacy_consent.sql: profiles rifiuta la
  // colonna sconosciuta con lo stesso messaggio di PostgREST.
  const db = createMemoryDatabase()
  const U = 'utente-prima-della-migration'
  const base = createMemoryRemote(db, U)
  const attempts = []
  const remote = {
    ...base,
    upsert: async (table, rows) => {
      attempts.push({ table, columns: Object.keys(rows[0] ?? {}) })
      if (table === 'profiles' && rows.some((r) => 'spendy_ai_enabled' in r)) {
        return { error: "profiles: Could not find the 'spendy_ai_enabled' column of 'profiles' in the schema cache" }
      }
      return base.upsert(table, rows)
    },
  }
  installFakeLocalStorage()
  const { useAppStore } = await import('../store/useAppStore.js?ai-no-column=1')
  const S = useAppStore.getState
  S().switchScope(scopeFor(U))
  const engine = createSyncEngine({ store: useAppStore, remote, autoFlushMs: 10_000 })
  S().setSpendyAIEnabled(true)
  S().setCycleStartDay(9)
  S().addExpense({ amount: 12, categoryId: 'bar', description: 'dopo', date: S().today })
  await engine.syncNow()
  check('sync riuscito, nessun errore', S().sync.status === 'synced' && !S().sync.error, String(S().sync.error))
  check('   coda svuotata (impostazioni e spesa inviate)', S().sync.outbox.length === 0)
  check('   le impostazioni sono arrivate, senza la colonna mancante', db.rows('profiles').some((r) => r.id === U && r.cycle_start_day === 9 && !('spendy_ai_enabled' in r)))
  check('   è stato fatto un solo secondo tentativo, senza la colonna', attempts.filter((a) => a.table === 'profiles').length === 2 && !attempts.filter((a) => a.table === 'profiles')[1].columns.includes('spendy_ai_enabled'))
  check('   la spesa è sul cloud', db.rows('expenses').some((r) => r.user_id === U && r.description === 'dopo'))
  check('   la scelta resta su questo dispositivo', S().spendyAIEnabled === true)
  await engine.pullAll()
  check('   e il pull (riga senza colonna) non la cambia', S().spendyAIEnabled === true)

  // Un errore DIVERSO sulle impostazioni continua a fermare il sync come prima.
  const failing = { ...base, upsert: async (table, rows) => (table === 'profiles' ? { error: 'profiles: permission denied' } : base.upsert(table, rows)) }
  installFakeLocalStorage()
  const { useAppStore: other } = await import('../store/useAppStore.js?ai-no-column=2')
  other.getState().switchScope(scopeFor(U))
  const engine2 = createSyncEngine({ store: other, remote: failing, autoFlushMs: 10_000 })
  other.getState().setCycleStartDay(3)
  await engine2.syncNow()
  check('altri errori sulle impostazioni: restano errori, la modifica resta in coda', other.getState().sync.status === 'error' && other.getState().sync.outbox.length === 1)
}

// =====================================================================
section('La Home usa la preferenza')
// =====================================================================
{
  const hook = readFileSync(new URL('./useSpendyVoice.js', import.meta.url), 'utf8')
  check('useSpendyVoice legge spendyAIEnabled dallo store', /useAppStore\(\(state\) => state\.spendyAIEnabled === true\)/.test(hook))
  check('   e decide con decideSpendyVoiceFor({ aiEnabled, ... })', /decideSpendyVoiceFor\(\{ aiEnabled,/.test(hook) && !/\bdecideSpendyVoice\(\{/.test(hook))
  check('   la chiamata parte solo con decisione "ai"', /const shouldCallAI = decision\.action === 'ai'/.test(hook))
}

report('Spendy AI attivabile')
