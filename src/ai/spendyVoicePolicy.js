// QUANDO SPENDY PARLA — la regola "non parlare sempre", più la cache.
//
//   coach (frase locale) + contesto + memoria → decisione → voce per SpendyHero
//
// decideSpendyVoice è sincrona e pura: la Home la chiama a ogni render e
// sa subito cosa mostrare. Solo quando la risposta è 'ai' parte una
// chiamata (requestSpendyVoice), e intanto resta visibile la frase locale:
// la Home non aspetta mai l'AI.
//
// Ordine delle regole (la prima che scatta decide):
//   1. nessuno stipendio impostato          → locale (il coach ha già la frase giusta)
//   2. stessa situazione, stesso giorno     → frase in cache (niente chiamata),
//      ma solo se i dati finanziari sono ancora quelli con cui è stata
//      generata; altrimenti locale (mai una frase con numeri vecchi, e
//      mai una chiamata in più solo perché sono cambiati gli importi)
//   3. l'AI ha fallito per questa situazione → locale (niente tentativi a raffica)
//   4. nessun evento                        → locale
//   5. evento poco importante               → locale
//   6. stesso evento già detto di recente   → locale
//   7. limite giornaliero di chiamate       → locale
//   8. ultima chiamata troppo recente       → locale (salvo eventi urgenti)
//   9. altrimenti                           → AI
import { defaultToneFor, defaultAnimationFor, isOverBudget } from './spendyAIGuard.js'
import { recordAICall, recordAIFailure, recordAIVoice } from './spendyVoiceCache.js'
import { translate } from '../i18n/translate.js'
import { formatCurrency, formatCurrencyWhole, maskedCurrency } from '../utils/format.js'

export const VOICE_LIMITS = {
  minImportance: 40, // stessa scala 0-100 di importantEventSelector
  eventCooldownDays: 3, // lo stesso evento non torna dall'AI prima di N giorni
  maxCallsPerDay: 3,
  minMinutesBetweenCalls: 30,
  urgentImportance: 85, // budget sforato, spesa enorme, obiettivo raggiunto
}

// Per provare la Home in sviluppo senza aspettare (vedi devTools.js).
export const NO_LIMITS = {
  minImportance: 40,
  eventCooldownDays: 0,
  maxCallsPerDay: Infinity,
  minMinutesBetweenCalls: 0,
  urgentImportance: 0,
}

function daysBetween(fromDay, toDay) {
  const from = new Date(`${fromDay}T00:00:00`)
  const to = new Date(`${toDay}T00:00:00`)
  return Math.round((to - from) / 86400000)
}

const decision = (action, reason) => ({ action, reason })

export function decideSpendyVoice({ coach, meta, today, cache, now = Date.now(), limits = VOICE_LIMITS }) {
  if (!coach || coach.reason === 'awaiting_income') return decision('local', 'no_budget')

  const { current, failure, history, calls } = cache
  if (current && current.fingerprint === meta.fingerprint && current.day === today) {
    if (!current.voice) return decision('local', 'ai_chose_silence')
    // Una cache salvata prima di questo controllo non ha `facts`: non si
    // può sapere con quali numeri è nata, quindi non si riusa.
    const sameFacts = typeof current.facts === 'string' && current.facts === meta.facts
    return sameFacts ? decision('cache', 'cached') : decision('local', 'stale_facts')
  }
  if (failure && failure.fingerprint === meta.fingerprint && failure.day === today) {
    return decision('local', `ai_failed:${failure.error}`)
  }

  if (!meta.eventKey) return decision('local', 'no_event')
  if (meta.importance < limits.minImportance) return decision('local', 'not_interesting')

  const recentlySaid = history.some(
    (entry) => entry.eventKey === meta.eventKey && daysBetween(entry.day, today) < limits.eventCooldownDays,
  )
  if (recentlySaid) return decision('local', 'event_recently_shown')

  const callsToday = calls.day === today ? calls.count : 0
  if (callsToday >= limits.maxCallsPerDay) return decision('local', 'daily_limit')

  const urgent = meta.importance >= limits.urgentImportance
  const minutesSinceLast = calls.lastAt ? (now - calls.lastAt) / 60000 : Infinity
  if (!urgent && minutesSinceLast < limits.minMinutesBetweenCalls) return decision('local', 'too_soon')

  return decision('ai', 'new_event')
}

// La scelta dell'utente viene prima di tutte le regole: con Spendy AI spenta
// (default) la decisione è sempre locale e nessuna chiamata parte. Accesa,
// è esattamente decideSpendyVoice, regole e limiti invariati.
export function decideSpendyVoiceFor({ aiEnabled, ...input }) {
  if (aiEnabled !== true) return decision('local', 'ai_disabled')
  return decideSpendyVoice(input)
}

// 'daily_limit' / 'monthly_limit' / 'global_limit': il server ha rifiutato
// PRIMA del modello (quota esaurita), quindi nessun costo e nessuna chiamata
// da contare qui.
const NOT_REACHED = new Set(['unavailable', 'unauthenticated', 'network', 'daily_limit', 'monthly_limit', 'global_limit'])

// Una chiamata all'AI e il suo effetto sulla memoria. Non tocca lo
// storage: restituisce la cache nuova e il risultato, chi chiama salva.
export async function requestSpendyVoice({ ai, context, meta, cache, today, now = Date.now() }) {
  const history = cache.history.map((entry) => entry.message).slice(-20)
  // La frase precedente: l'ultima letta dall'utente (anche se era locale),
  // altrimenti l'ultima generata. L'AI la usa per cambiare struttura.
  const previous = cache.lastShown?.message ?? history[history.length - 1] ?? null
  const result = await ai.generate(context, { history, previous })
  // Conta solo le chiamate che possono aver raggiunto il modello: senza
  // sessione o senza rete non si spende niente, e il limite di 3 al
  // giorno non va consumato.
  const reachedModel = result.ok || !NOT_REACHED.has(result.error)
  let next = reachedModel ? recordAICall(cache, { day: today, now }) : cache

  if (result.ok) {
    const voice = result.response.shouldShow ? result.response : null
    next = recordAIVoice(next, { fingerprint: meta.fingerprint, day: today, eventKey: meta.eventKey, voice, now, facts: meta.facts })
  } else {
    next = recordAIFailure(next, { fingerprint: meta.fingerprint, day: today, error: result.error, now })
  }
  return { cache: next, result }
}

// La voce locale: esattamente ciò che getSpendyCoach ha deciso
// (HumorEngine, reaction library, frasi fisse). È il fallback di tutto.
export function voiceFromCoach(coach) {
  const state = coach?.state ?? 'happy'
  const tone = defaultToneFor(state)
  return {
    source: 'local',
    message: coach?.message ?? '',
    secondaryText: coach?.secondaryInsightText ?? null,
    state,
    tone,
    layout: null,
    animation: defaultAnimationFor(tone),
  }
}

// La frase di fatti sotto una risposta di Spendy AI. Le cifre del budget non
// le scrive mai il modello (il guard lo impone): le dice l'app, dal contesto da
// cui è partita la richiesta, nella lingua e nella valuta dell'account. Il
// testo del modello non entra mai qui.
//   budget sforato (2B.3)  "Budget superato di 120,40 €."
//   budget sano    (2B.4)  "Disponibile: 493,60 €, circa 18 € al giorno."
// Fase 2B.5:
//   - il disponibile con i centesimi e lo stesso formato della BudgetCard
//     (formatCurrency): 493,60 € non diventa 494 €; uno sforamento di 0,40 €
//     resta uno sforamento; la quota giornaliera, già intera, resta intera;
//   - nell'ultimo giorno del ciclo niente quota giornaliera (sarebbe tutto il
//     disponibile: "494 €, circa 494 € al giorno");
//   - `hideAmounts` (la preferenza "nascondi gli importi" della BudgetCard): gli
//     importi diventano "•••• €" come nella card, la frase resta.
//   - Fase 2B.7: l'importo (anche mascherato) non va a capo tra la cifra e il
//     simbolo ("0,40 / €."): solo nella riga di fatti gli spazi DENTRO l'importo
//     diventano non separabili. formatCurrency, e il resto dell'app, restano
//     com'erano; gli spazi tra le parole della frase restano normali.
const unbreakable = (amount) => amount.replace(/ /g, '\u00a0')

export function budgetFactLine(context, { hideAmounts = false } = {}) {
  const available = context?.budget?.available
  if (typeof available !== 'number' || !Number.isFinite(available)) return null
  const masked = () => unbreakable(maskedCurrency(context.locale, context.currency))
  const money = (value) => (hideAmounts ? masked() : unbreakable(formatCurrency(value, context.locale, context.currency)))
  const whole = (value) => (hideAmounts ? masked() : unbreakable(formatCurrencyWhole(value, context.locale, context.currency)))
  if (isOverBudget(context)) {
    return available < 0 ? translate(context.locale, 'spendyai.overbudget', { amount: money(Math.abs(available)) }) : null
  }
  const daily = context.budget.dailyAllowance
  const lastDay = context.budget.cyclePhase === 'last_day' || context.budget.daysRemaining === 0
  return typeof daily === 'number' && daily > 0 && !lastDay
    ? translate(context.locale, 'spendyai.availabledaily', { amount: money(available), daily: whole(daily) })
    : translate(context.locale, 'spendyai.available', { amount: money(available) })
}

// `context`: lo stesso con cui la frase è stata generata (in cache si riusa
// solo se i dati sono identici: vedi decideSpendyVoice, regola 2).
// `hideAmounts`: la preferenza "nascondi gli importi" (store.amountHidden).
export function voiceFromAI(response, context = null, { hideAmounts = false } = {}) {
  return {
    source: 'ai',
    message: response.message,
    secondaryText: budgetFactLine(context, { hideAmounts }),
    state: response.state,
    tone: response.tone,
    layout: response.layout,
    animation: response.animation,
  }
}

export function resolveSpendyVoice({ decision: choice, coach, cache, context = null, hideAmounts = false }) {
  if (choice.action === 'cache' && cache.current?.voice) return voiceFromAI(cache.current.voice, context, { hideAmounts })
  return voiceFromCoach(coach)
}
