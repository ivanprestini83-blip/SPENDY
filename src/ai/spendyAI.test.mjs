// Test di SPENDY AI — Fase A (provider mock, nessuna rete). `npm test`.
//
// Ogni scenario percorre il flusso VERO della Home, nello stesso ordine:
//   dati → buildFinancialData → getSpendyCoach → BehaviorEngine → eventi
//   → contesto → decisione → spendyAI.generate (mock) → guard → voce
// Tutti i dati sono inventati per il test, nessuno viene dall'app.

import { check, section, report } from '../sync/testkit.mjs'
import { buildFinancialData } from '../utils/budgetCalculations.js'
import { getSpendyCoach } from '../utils/spendyCoach.js'
import { humorLibrary } from '../utils/humorLibrary.js'
import * as reactionLibrary from '../data/spendyReactionLibrary.js'
import { prepareSpendyVoice } from './spendyVoice.js'
import { SPENDY_EVENTS } from './spendyEvents.js'
import { createSpendyAI } from './spendyAI.js'
import { createMockProvider, composeMockResponse } from './providers/mockProvider.js'
import { validateAIResponse, extractNumbers } from './spendyAIGuard.js'
import {
  decideSpendyVoice, requestSpendyVoice, resolveSpendyVoice, VOICE_LIMITS,
} from './spendyVoicePolicy.js'
import {
  emptyVoiceCache, loadVoiceCache, saveVoiceCache, recordShown, VOICE_CACHE_KEY,
} from './spendyVoiceCache.js'
import {
  structureProblems, narrativeFrames, hasStaleStructure, buildSpendyPrompt, SPENDY_PERSONALITY,
} from './spendyPersonality.js'

const TODAY = '2026-09-20'
const NOW = Date.parse('2026-09-20T10:00:00Z')
let seq = 0
const expense = (date, amount, categoryId) => ({ id: `e-${seq++}`, date, amount, categoryId, description: `nota privata ${seq}` })
const threeCycles = (categoryId, values, day = '10') =>
  ['06', '07', '08'].map((month, i) => expense(`2026-${month}-${day}`, values[i], categoryId))

function countingAI({ mode = 'normal', timeoutMs = 500 } = {}) {
  const provider = createMockProvider({ mode, latencyMs: 0 })
  let calls = 0
  const wrapped = {
    name: provider.name,
    available: provider.available,
    generate: (...args) => {
      calls += 1
      return provider.generate(...args)
    },
  }
  return { ai: createSpendyAI({ provider: wrapped, timeoutMs }), calls: () => calls }
}

// Il flusso della Home, dall'inizio alla fine, senza React.
async function runHome({
  expenses = [], goals = [], monthlyBudget = 1000, cache = emptyVoiceCache(), ai = countingAI().ai,
  limits = VOICE_LIMITS, now = NOW,
} = {}) {
  const financialData = buildFinancialData({ today: TODAY, monthlyBudget, expenses, incomes: [], goals, cycleStartDay: 1 })
  const coach = getSpendyCoach(financialData, {
    expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals, jokeHistory: [], financialData,
  })
  const { events, context, meta } = prepareSpendyVoice({
    coach, financialData, expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals,
  })
  const first = decideSpendyVoice({ coach, meta, today: TODAY, cache, now, limits })
  let nextCache = cache
  let result = null
  if (first.action === 'ai') {
    ({ cache: nextCache, result } = await requestSpendyVoice({ ai, context, meta, cache, today: TODAY, now }))
  }
  const after = decideSpendyVoice({ coach, meta, today: TODAY, cache: nextCache, now, limits })
  const voice = resolveSpendyVoice({ decision: after, coach, cache: nextCache })
  return { coach, events, context, meta, first, after, result, cache: nextCache, voice }
}

const allNumbersIn = (text, context) => {
  const allowed = new Set()
  JSON.stringify(context).match(/-?\d+(\.\d+)?/g)?.forEach((n) => allowed.add(Math.round(Math.abs(Number(n)))))
  return extractNumbers(text).every((n) => [...allowed].some((a) => Math.abs(a - n) <= 1))
}

// Scenari riusati da più sezioni
const categoryRise = () => [
  ...threeCycles('ristoranti', [50, 60, 55]),
  expense('2026-09-05', 80, 'ristoranti'),
  expense('2026-09-12', 80, 'ristoranti'),
]

// =====================================================================
section('1. Nessun evento → niente AI, frase locale')
// =====================================================================
{
  const { ai, calls } = countingAI()
  const run = await runHome({
    ai,
    expenses: [...threeCycles('spesa', [100, 110, 105]), expense('2026-09-05', 100, 'spesa')],
  })
  check('la decisione è "locale"', run.first.action === 'local', run.first.reason)
  check('il motivo è "niente di interessante"', ['no_event', 'not_interesting'].includes(run.first.reason), run.first.reason)
  check("l'AI non è stata chiamata", calls() === 0)
  check('Spendy mostra la frase del coach', run.voice.source === 'local' && run.voice.message === run.coach.message)
}

// =====================================================================
section('2. Spesa anomala (600 € oggi)')
// =====================================================================
{
  const { ai, calls } = countingAI()
  const run = await runHome({ ai, monthlyBudget: 3000, expenses: [expense(TODAY, 600, 'shopping')] })
  check("l'evento principale è big_expense", run.events[0]?.id === SPENDY_EVENTS.BIG_EXPENSE, run.events[0]?.id)
  check('il contesto porta importo e categoria della spesa',
    run.context.primaryEvent.expense?.amount === 600 && run.context.primaryEvent.expense?.category === 'Shopping')
  check("l'AI è stata chiamata una volta", calls() === 1)
  check('la voce viene dall\'AI', run.voice.source === 'ai', run.result?.error)
  check('la frase cita i 600 €', /600/.test(run.voice.message), run.voice.message)
  check('ogni numero della frase esiste nel contesto', allNumbersIn(run.voice.message, run.context))
  check('la reazione locale (reaction library) sarebbe stata diversa — l\'AI la sostituisce',
    run.coach.reason === 'mega_expense_500' && run.voice.message !== run.coach.message)
}

// =====================================================================
section('3. Aumento di una categoria')
// =====================================================================
let categoryRun
{
  categoryRun = await runHome({ monthlyBudget: 2000, expenses: categoryRise() })
  const primary = categoryRun.events[0]
  check('evento di categoria in salita',
    [SPENDY_EVENTS.CATEGORY_ABOVE_USUAL, SPENDY_EVENTS.CATEGORY_TREND_UP].includes(primary?.id), primary?.id)
  check('un solo evento per l\'argomento "ristoranti su"',
    categoryRun.events.filter((event) => event.key === 'ristoranti:up').length === 1)
  check('il contesto ha attuale e media del ciclo',
    categoryRun.context.primaryEvent.cycle?.current === 160 && categoryRun.context.primaryEvent.cycle?.usual > 0)
  check('frase generata', categoryRun.voice.source === 'ai', categoryRun.result?.error)
  check('la frase nomina la categoria', /ristorante/i.test(categoryRun.voice.message), categoryRun.voice.message)
  check('budget tranquillo → tono giocoso', categoryRun.voice.tone === 'playful')
}

// =====================================================================
section('4. Budget quasi esaurito')
// =====================================================================
{
  const run = await runHome({ expenses: [expense('2026-09-10', 900, 'spesa')] })
  check("evento budget_near_limit", run.events[0]?.id === SPENDY_EVENTS.BUDGET_NEAR_LIMIT, run.events[0]?.id)
  check('fascia "high" nel contesto', run.context.budget.band === 'high')
  check('Spendy è preoccupato, non ironico', run.voice.state === 'concerned')
  check('prima aiuta: percentuale e residuo', /90%/.test(run.voice.message) && /100 €/.test(run.voice.message), run.voice.message)
  check('numeri tutti veri', allNumbersIn(run.voice.message, run.context))
}

// =====================================================================
section('5. Budget superato')
// =====================================================================
{
  const run = await runHome({ expenses: [expense('2026-09-10', 1200, 'spesa')] })
  check('evento budget_exceeded', run.events[0]?.id === SPENDY_EVENTS.BUDGET_EXCEEDED, run.events[0]?.id)
  check('stato concerned, tono concerned', run.voice.state === 'concerned' && run.voice.tone === 'concerned')
  check('cita di quanto si è oltre (200 €)', /200 €/.test(run.voice.message), run.voice.message)
  check('niente battuta: nessuna frase della reaction library "budget superato"',
    !reactionLibrary.BUDGET_SUPERATO.some((line) => run.voice.message.includes(line)))
  check('layout sovrapposto alla card budget', run.voice.layout === 'overlap')
}

// =====================================================================
section('6. Risparmio positivo')
// =====================================================================
{
  const goals = [{ id: 'g-1', label: 'Viaggio Giappone', saved: 300, target: 3000 }]
  const run = await runHome({
    goals,
    expenses: [...threeCycles('spesa', [800, 780, 820]), expense('2026-09-05', 200, 'spesa')],
  })
  const positive = [SPENDY_EVENTS.SAVINGS_ABOVE_USUAL, SPENDY_EVENTS.CATEGORY_BELOW_USUAL, SPENDY_EVENTS.CATEGORY_TREND_DOWN]
  check('evento positivo rilevato', positive.includes(run.events[0]?.id), run.events.map((e) => e.id).join(','))
  check('stato positivo', ['happy', 'advisor', 'celebrating'].includes(run.voice.state), run.voice.state)
  check("il nome dell'obiettivo arriva nel contesto", run.context.goal?.label === 'Viaggio Giappone')
  check("quando Spendy consiglia, usa il nome dell'obiettivo",
    run.voice.state !== 'advisor' || run.voice.message.includes('"Viaggio Giappone"'), run.voice.message)
  const angles = new Set([null, 'x', 'y', 'z'].map((previous) => composeMockResponse(run.context, [], previous).message))
  check("l'obiettivo è uno degli angoli possibili, non un obbligo",
    [...angles].some((m) => m.includes('"Viaggio Giappone"')) && [...angles].some((m) => !m.includes('Viaggio Giappone')), [...angles].join(' | '))
}

{
  // Il coach sceglie il consiglio di risparmio (tier 5): l'evento
  // principale deve essere la stessa categoria, non un altro tema.
  const goals = [{ id: 'g-1', label: 'Viaggio Giappone', saved: 1200, target: 3000 }]
  const run = await runHome({
    monthlyBudget: 2500,
    goals,
    expenses: [...threeCycles('trasporti', [160, 160, 160]), expense('2026-09-05', 80, 'trasporti')],
  })
  check('coach su "savings_opportunity"', run.coach.reason === 'savings_opportunity', run.coach.reason)
  check('evento principale = la categoria del coach',
    run.events[0]?.id === SPENDY_EVENTS.CATEGORY_BELOW_USUAL && run.events[0]?.categoryId === 'trasporti',
    `${run.events[0]?.id}:${run.events[0]?.categoryId}`)
}

// =====================================================================
section('7. Obiettivo raggiunto')
// =====================================================================
{
  const run = await runHome({
    goals: [{ id: 'g-1', label: 'Vacanze', saved: 1000, target: 1000 }],
    expenses: [expense('2026-09-10', 50, 'spesa')],
  })
  check('evento goal_reached', run.events[0]?.id === SPENDY_EVENTS.GOAL_REACHED)
  check('Spendy festeggia al centro', run.voice.state === 'celebrating' && run.voice.layout === 'center')
  check('animazione celebrativa', run.voice.animation === 'celebrate')
  check('nomina l\'obiettivo', run.voice.message.includes('Vacanze'), run.voice.message)
}

// =====================================================================
section('8. Evento celebrativo (obiettivo al 90%)')
// =====================================================================
{
  const run = await runHome({
    goals: [{ id: 'g-9', label: 'Bici nuova', saved: 900, target: 1000 }],
    expenses: [expense('2026-09-05', 100, 'spesa')],
  })
  check('evento goal_near', run.events[0]?.id === SPENDY_EVENTS.GOAL_NEAR, run.events[0]?.id)
  check('celebrating + tono celebrativo', run.voice.state === 'celebrating' && run.voice.tone === 'celebratory')
  check('cita percentuale e quanto manca', /90%/.test(run.voice.message) && /100 €/.test(run.voice.message), run.voice.message)
}

// =====================================================================
section('9. Stesso evento già mostrato di recente')
// =====================================================================
{
  // Situazione cambiata (impronta diversa) ma l'evento principale è lo
  // stesso già detto oggi dall'AI → non si ripete.
  const stale = { ...categoryRun.cache, current: { ...categoryRun.cache.current, fingerprint: 'situazione-precedente' } }
  const { ai, calls } = countingAI()
  const run = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise(), cache: stale })
  check('decisione locale: evento già mostrato', run.first.reason === 'event_recently_shown', run.first.reason)
  check("nessuna nuova chiamata", calls() === 0)

  // Dopo il cooldown lo stesso evento può tornare.
  const old = {
    ...stale,
    history: stale.history.map((entry) => ({ ...entry, day: '2026-09-10' })),
    calls: { day: '2026-09-10', count: 1, lastAt: NOW - 10 * 86400000 },
  }
  const later = await runHome({ monthlyBudget: 2000, expenses: categoryRise(), cache: old })
  check('dopo il cooldown torna all\'AI', later.first.action === 'ai', later.first.reason)
  check('e non ripete la stessa frase', later.voice.message !== categoryRun.voice.message, later.voice.message)
}

// =====================================================================
section('10. AI non disponibile')
// =====================================================================
{
  const { ai } = countingAI({ mode: 'offline' })
  const run = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise() })
  check('errore "unavailable"', run.result?.error === 'unavailable')
  check('la Home mostra la frase locale', run.voice.source === 'local' && run.voice.message === run.coach.message)
  check('il fallimento è ricordato: niente nuovo tentativo per la stessa situazione',
    run.after.action === 'local' && run.after.reason === 'ai_failed:unavailable')
  check('anche errore del server e limite API ripiegano',
    (await runHome({ ai: countingAI({ mode: 'error' }).ai, monthlyBudget: 2000, expenses: categoryRise() })).voice.source === 'local'
    && (await runHome({ ai: countingAI({ mode: 'rate_limited' }).ai, monthlyBudget: 2000, expenses: categoryRise() })).result.error === 'rate_limited')
}

// =====================================================================
section('11. Timeout')
// =====================================================================
{
  const { ai } = countingAI({ mode: 'timeout', timeoutMs: 30 })
  const started = Date.now()
  const run = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise() })
  check('errore "timeout"', run.result?.error === 'timeout', run.result?.error)
  check('non aspetta oltre il limite', Date.now() - started < 1000)
  check('frase locale', run.voice.source === 'local')
}

// =====================================================================
section('12. Risposta AI non valida')
// =====================================================================
{
  const { ai } = countingAI({ mode: 'invalid' })
  const run = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise() })
  check('scartata come "invalid"', run.result?.error === 'invalid')
  check('frase locale', run.voice.source === 'local')

  const ctx = categoryRun.context
  const base = { message: 'Ok.', state: 'happy', tone: 'friendly', shouldShow: true }
  check('stato sconosciuto rifiutato', !validateAIResponse({ ...base, state: 'angry' }, ctx).valid)
  check('tono sconosciuto rifiutato', !validateAIResponse({ ...base, tone: 'sarcastic' }, ctx).valid)
  check('layout sconosciuto rifiutato', !validateAIResponse({ ...base, layout: 'top' }, ctx).valid)
  check('shouldShow mancante rifiutato', !validateAIResponse({ message: 'Ok.', state: 'happy' }, ctx).valid)
  check('più di 3 frasi rifiutato', !validateAIResponse({ ...base, message: 'Uno. Due. Tre. Quattro.' }, ctx).valid)
  check('"Ok... e poi?" è una frase sola', validateAIResponse({ ...base, message: 'Ok... e poi? Vediamo. Bene.' }, ctx).valid)
  check('troppo lunga rifiutata', !validateAIResponse({ ...base, message: 'a'.repeat(300) }, ctx).valid)
  check('consiglio di investimento rifiutato',
    !validateAIResponse({ ...base, message: 'Metti tutto in crypto, fidati.' }, ctx).valid)
  check('frase giudicante rifiutata',
    !validateAIResponse({ ...base, message: 'Sei proprio uno spendaccione.' }, ctx).valid)
  check('festa con il budget sforato rifiutata',
    !validateAIResponse({ ...base, state: 'celebrating' }, { ...ctx, budget: { ...ctx.budget, band: 'exceeded' } }).valid)
  check('shouldShow:false valido anche senza messaggio',
    validateAIResponse({ state: 'happy', shouldShow: false }, ctx).valid)
}

// =====================================================================
section('13. Risposta AI con dati inventati')
// =====================================================================
{
  const { ai } = countingAI({ mode: 'hallucinate' })
  const run = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise() })
  check('scartata', run.result?.error === 'invalid')
  check('motivo: numeri inventati', run.result?.details?.some((e) => e.startsWith('invented_numbers')), run.result?.details)
  check('motivo: obiettivo inesistente', run.result?.details?.includes('unknown_reference'))
  check('frase locale', run.voice.source === 'local')

  const ctx = categoryRun.context
  const ok = { state: 'ironic', tone: 'playful', shouldShow: true }
  check('numeri presenti nel contesto accettati',
    validateAIResponse({ ...ok, message: `Ristorante a ${ctx.primaryEvent.cycle.current} €.` }, ctx).valid)
  check('percentuale inventata rifiutata', !validateAIResponse({ ...ok, message: 'Ristorante +340%.' }, ctx).valid)
  check('importo con migliaia inventato rifiutato', !validateAIResponse({ ...ok, message: 'Hai 1.234 € da parte.' }, ctx).valid)
}

// =====================================================================
section('14. Fallback sulla HumorLibrary')
// =====================================================================
{
  const { ai } = countingAI({ mode: 'error' })
  const run = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise() })
  const itLines = new Set([
    ...Object.values(humorLibrary.it.categories).flatMap((bank) => [...(bank.high ?? []), ...(bank.low ?? [])]),
    ...Object.values(humorLibrary.it.types).flat(),
  ])
  check('voce locale = coach', run.voice.source === 'local' && run.voice.message === run.coach.message)
  check('la frase locale viene dalla HumorLibrary', itLines.has(run.voice.message), run.voice.message)
  check('il dato resta come testo secondario', run.voice.secondaryText === run.coach.secondaryInsightText)
}

// =====================================================================
section('15. Cache')
// =====================================================================
{
  const { ai, calls } = countingAI()
  const first = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise() })
  const second = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise(), cache: first.cache })
  check('prima apertura: una chiamata', calls() === 1)
  check('seconda apertura, stessa situazione: dalla cache', second.first.action === 'cache')
  check('nessuna chiamata in più', calls() === 1)
  check('stessa frase', second.voice.message === first.voice.message && second.voice.source === 'ai')

  // Un caffè in più non cambia l'impronta (niente importi esatti)...
  const coffee = await runHome({
    ai, monthlyBudget: 2000, cache: first.cache, expenses: [...categoryRise(), expense('2026-09-14', 2, 'bar')],
  })
  check('un caffè non genera una frase nuova', coffee.first.action === 'cache', coffee.first.reason)
  // ...una spesa grossa sì.
  const big = await runHome({
    ai, monthlyBudget: 2000, cache: first.cache, expenses: [expense(TODAY, 700, 'shopping'), ...categoryRise()],
  })
  check('una spesa grossa sì', big.first.action === 'ai' && big.events[0].id === SPENDY_EVENTS.BIG_EXPENSE)

  // Persistenza: chiave propria, mai 'spendy-storage'.
  const store = new Map([['spendy-storage', '{"intoccabile":true}']])
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  saveVoiceCache(first.cache, storage)
  check('salvata sotto la sua chiave', store.has(VOICE_CACHE_KEY))
  check("'spendy-storage' intatto", store.get('spendy-storage') === '{"intoccabile":true}')
  check('ricaricata identica', JSON.stringify(loadVoiceCache(storage)) === JSON.stringify(first.cache))
  check('storage rotto → cache vuota, nessun errore',
    loadVoiceCache({ getItem: () => { throw new Error('bloccato') } }).history.length === 0)
}

// =====================================================================
section('Frequenza: non parlare sempre')
// =====================================================================
{
  const busy = { ...emptyVoiceCache(), calls: { day: TODAY, count: 3, lastAt: NOW - 3 * 3600000 } }
  const capped = await runHome({ monthlyBudget: 2000, expenses: categoryRise(), cache: busy })
  check('dopo 3 chiamate oggi: locale', capped.first.reason === 'daily_limit')

  const recent = { ...emptyVoiceCache(), calls: { day: TODAY, count: 1, lastAt: NOW - 5 * 60000 } }
  const tooSoon = await runHome({ monthlyBudget: 2000, expenses: categoryRise(), cache: recent })
  check('chiamata 5 minuti fa: locale', tooSoon.first.reason === 'too_soon')
  const urgent = await runHome({ expenses: [expense('2026-09-10', 1200, 'spesa')], cache: recent })
  check('ma un budget sforato passa lo stesso', urgent.first.action === 'ai')

  const noIncome = await runHome({ monthlyBudget: 0, expenses: categoryRise() })
  check('senza stipendio: il coach, mai l\'AI', noIncome.first.reason === 'no_budget')
}

// =====================================================================
section('Privacy del contesto')
// =====================================================================
{
  const json = JSON.stringify(categoryRun.context)
  check('niente descrizioni/note delle spese', !json.includes('nota privata'))
  check('niente id delle spese', !/"e-\d+"/.test(json))
  check("niente date tranne oggi", (json.match(/\d{4}-\d{2}-\d{2}/g) ?? []).every((date) => date === TODAY))
  check("niente elenco transazioni", !('expenses' in categoryRun.context))
  const withGoals = await runHome({
    goals: [{ id: 'g-1', label: 'Vacanze', saved: 1000, target: 1000 }, { id: 'g-2', label: 'Segreto', saved: 1, target: 50 }],
    expenses: [expense('2026-09-10', 50, 'spesa')],
  })
  check('solo l\'obiettivo rilevante, non tutti', !JSON.stringify(withGoals.context).includes('Segreto'))
}

// =====================================================================
section('Il mock ragiona sul contesto (non è una lista fissa)')
// =====================================================================
{
  const ctx = categoryRun.context
  const a = composeMockResponse(ctx, [])
  const b = composeMockResponse(ctx, [])
  check('stesso contesto → stessa risposta', a.message === b.message)
  const tight = { ...ctx, budget: { ...ctx.budget, band: 'warning', available: 400, dailyAllowance: 36, spentPercent: 80 } }
  const c = composeMockResponse(tight, [])
  check('stessa categoria, budget al limite → tono e consiglio diversi', c.tone === 'helpful' && c.message !== a.message)
  const quiet = composeMockResponse({ ...ctx, primaryEvent: { ...ctx.primaryEvent, importance: 20 } }, [])
  check('evento poco importante → shouldShow false', quiet.shouldShow === false)
  check('nessun evento → shouldShow false', composeMockResponse({ ...ctx, primaryEvent: null }, []).shouldShow === false)
  const again = composeMockResponse(ctx, [a.message])
  check('con la frase già in history ne produce un\'altra', again.message !== a.message, again.message)
}

// =====================================================================
section('Struttura narrativa: niente "questa categoria è tornata" in 20 forme')
// =====================================================================
{
  const stale = [
    'Ecco una categoria che non si vedeva da un po’.',
    "Ecco una categoria che non si vedeva da un po'.",
    'Ecco lo shopping che torna a trovarti.',
    'Si vede che lo svago è tornato di moda.',
    'Il bar è tornato tra le tue spese.',
  ]
  for (const line of stale) check(`schema logoro rifiutato: "${line}"`, hasStaleStructure(line))

  const ctx = categoryRun.context
  const ok = { state: 'ironic', tone: 'playful', shouldShow: true }
  check('il guard rifiuta lo schema logoro',
    validateAIResponse({ ...ok, message: 'Ecco una categoria che non si vedeva da un po’.' }, ctx)
      .errors?.includes('stale_structure'))
  check('stessa struttura della frase precedente, parole diverse → rifiutata',
    validateAIResponse({ ...ok, message: 'Si vede che il cinema ti manca.' }, ctx, { previous: 'Si vede che hai fame.' })
      .errors?.some((e) => e.startsWith('repeated_structure')))
  check('due domande di fila → rifiutata',
    !validateAIResponse({ ...ok, message: 'Ristorante a 160 €: ciclo speciale?' }, ctx, { previous: 'Nuova routine?' }).valid)
  check('stessa apertura "Hai usato…" → rifiutata',
    !validateAIResponse({ ...ok, message: 'Hai usato il 8% del budget.' }, ctx, { previous: 'Hai usato il 90% del budget.' }).valid)
  check('"ritorno" già usato nelle ultime frasi → rifiutato anche se la precedente era diversa',
    validateAIResponse({ ...ok, message: 'Bentornato, ristorante.' }, ctx, {
      history: ['Ci sei tornato così tante volte che ormai sembra un abbonamento.'], previous: 'Il budget regge.',
    }).errors?.includes('overused_structure:comeback'))
  check('struttura diversa dalla precedente → accettata',
    validateAIResponse({ ...ok, message: 'Ristorante a 160 €, la tua media è 55 €.' }, ctx, { previous: 'Si vede che hai fame.' }).valid)
}

// Una categoria "riapparsa" (unusual_purchase) in tanti contesti diversi.
function unusualContext({ category, amount, band = 'ok', day = 1 }) {
  const today = `2026-09-${String(day).padStart(2, '0')}`
  return {
    version: 1,
    locale: 'it',
    today,
    budget: {
      monthly: 2000, spent: band === 'ok' ? 600 : 1500, available: band === 'ok' ? 1400 : 500,
      spentPercent: band === 'ok' ? 30 : 75, daysRemaining: 10, band, dailyAllowance: band === 'ok' ? 140 : 50,
    },
    spending: { today: 0 },
    primaryEvent: { id: SPENDY_EVENTS.UNUSUAL_PURCHASE, importance: 55, category, amount },
    otherEvents: [],
    goal: null,
    suggestedState: 'attentive',
  }
}

{
  const categories = ['Svago', 'Viaggi', 'Bar', 'Sport', 'Tecnologia', 'Animali']
  const messages = []
  for (const category of categories) {
    for (let day = 1; day <= 28; day += 1) {
      for (const band of ['ok', 'warning']) {
        const response = composeMockResponse(unusualContext({ category, amount: 40 + day, band, day }), [], null)
        if (response.shouldShow) messages.push(response.message)
      }
    }
  }
  check('336 contesti di "categoria riapparsa" generati', messages.length === 336, messages.length)
  check('mai "non si vedeva da un po’"', messages.every((m) => !/non si vedeva/i.test(m)))
  check('mai uno schema logoro', messages.every((m) => !hasStaleStructure(m)), messages.find(hasStaleStructure))
  check('mai raccontata come "tornata" o "novità"',
    messages.every((m) => !narrativeFrames(m).has('comeback') && !narrativeFrames(m).has('novelty')),
    messages.find((m) => narrativeFrames(m).has('comeback') || narrativeFrames(m).has('novelty')))
  const openings = new Set(messages.map((m) => [...narrativeFrames(m)].find((f) => f.startsWith('open:'))))
  check('almeno 4 aperture diverse', openings.size >= 4, [...openings].join(' | '))

  check('interpreta, non descrive: mai la semplice constatazione quando c\'è un angolo nuovo',
    messages.every((m) => !/ spesi in .* in questo ciclo\.$/.test(m)), messages.find((m) => / spesi in .* in questo ciclo\.$/.test(m)))

  const nothing = composeMockResponse(unusualContext({ category: 'Svago', amount: null }), [], null)
  check('senza importo: frase semplice, niente battuta forzata',
    nothing.message === 'Spesa in svago fuori dalle tue abitudini recenti.', nothing.message)
}

{
  // Spendy che parla più volte di fila di categorie riapparse: ogni frase
  // tiene conto della precedente.
  const history = []
  let previous = null
  const shown = []
  const categories = ['Svago', 'Viaggi', 'Sport', 'Bar', 'Tecnologia', 'Animali', 'Svago', 'Viaggi']
  categories.forEach((category, i) => {
    const context = unusualContext({ category, amount: 60 + i * 7, day: i + 1 })
    const response = composeMockResponse(context, history, previous)
    if (!response.shouldShow) return
    const check1 = validateAIResponse(response, context, { history, previous })
    shown.push({ message: response.message, previous, valid: check1.valid, errors: check1.errors })
    history.push(response.message)
    previous = response.message
  })
  check('almeno 4 frasi di fila', shown.length >= 4, shown.length)
  check('ogni frase passa il guard rispetto alla precedente', shown.every((s) => s.valid), JSON.stringify(shown.find((s) => !s.valid)))
  check('nessuna coppia consecutiva con la stessa struttura',
    shown.every((s) => !s.previous || structureProblems(s.message, { previous: s.previous }).length === 0))
  check('nessuna apertura ripetuta di fila',
    shown.every((s, i) => i === 0 || [...narrativeFrames(s.message)].find((f) => f.startsWith('open:'))
      !== [...narrativeFrames(shown[i - 1].message)].find((f) => f.startsWith('open:'))))
}

{
  // Stessa cosa per una categoria sopra la media.
  const history = []
  let previous = null
  const shown = []
  for (let day = 1; day <= 6; day += 1) {
    const context = { ...categoryRun.context, today: `2026-09-${String(day).padStart(2, '0')}` }
    const response = composeMockResponse(context, history, previous)
    if (!response.shouldShow) break
    shown.push(response.message)
    history.push(response.message)
    previous = response.message
  }
  check('categoria in salita: almeno 3 frasi diverse di fila', shown.length >= 3, shown.join(' | '))
  check('tutte con struttura diversa dalla precedente',
    shown.every((m, i) => i === 0 || structureProblems(m, { previous: shown[i - 1] }).length === 0), shown.join(' | '))
  check('prima aiuta: ogni frase contiene un dato del contesto', shown.every((m) => /\d/.test(m)))
}

// =====================================================================
section('La frase precedente arriva all\'AI')
// =====================================================================
{
  let received = null
  const spy = createSpendyAI({
    provider: {
      name: 'spy',
      async generate(context, options) {
        received = options
        return composeMockResponse(context, options.history, options.previous)
      },
    },
  })
  const cache = recordShown(emptyVoiceCache(), { message: 'Si vede che il budget sta bene.', day: TODAY })
  const run = await runHome({ ai: spy, monthlyBudget: 2000, expenses: categoryRise(), cache })
  check('il provider riceve `previous` = ultima frase letta', received?.previous === 'Si vede che il budget sta bene.')
  check('e la nuova frase non ne ricalca la struttura',
    structureProblems(run.voice.message, { previous: received.previous }).length === 0, run.voice.message)

  const parrot = createSpendyAI({
    provider: { name: 'parrot', generate: async () => ({ message: 'Si vede che il ristorante ti piace.', state: 'ironic', tone: 'playful', shouldShow: true }) },
  })
  const parroted = await runHome({ ai: parrot, monthlyBudget: 2000, expenses: categoryRise(), cache })
  check('un modello che ricalca la frase precedente viene scartato', parroted.result?.error === 'invalid'
    && parroted.result.details.some((e) => e.startsWith('repeated_structure')), parroted.result?.details)
  check('e Spendy ripiega sulla frase locale', parroted.voice.source === 'local')

  check('recordShown ignora la stessa frase due volte', recordShown(cache, { message: 'Si vede che il budget sta bene.', day: TODAY }) === cache)
}

// =====================================================================
section('Spese grosse: le frasi restano quelle di prima')
// =====================================================================
{
  const run = await runHome({ monthlyBudget: 2500, expenses: [expense(TODAY, 150, 'shopping')] })
  check('stessa struttura "… di shopping oggi: si fa notare" / "Oggi sono partiti…"',
    /^(150 € di shopping oggi: si fa notare\.|Oggi sono partiti 150 € in shopping\.)/.test(run.voice.message), run.voice.message)
}

// =====================================================================
section('Prompt per la Fase B')
// =====================================================================
{
  const prompt = buildSpendyPrompt(categoryRun.context, { previous: 'Frase di prima.', history: ['a', 'b'] })
  check('system = personalità di Spendy', prompt.system === SPENDY_PERSONALITY)
  check('porta la frase precedente', prompt.input.previous === 'Frase di prima.')
  check('porta il contesto, non i dati grezzi', prompt.input.context === categoryRun.context)
  check('vieta esplicitamente lo schema "è tornata"', /non si vedeva da un po/i.test(SPENDY_PERSONALITY))
  check('regola "prima aiuta, poi fa sorridere"', /PRIMA AIUTA, POI FA SORRIDERE/.test(SPENDY_PERSONALITY))
}

report('Spendy AI (Fase A)')
