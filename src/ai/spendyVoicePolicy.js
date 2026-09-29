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
//   2. stessa situazione, stesso giorno     → frase in cache (niente chiamata)
//   3. l'AI ha fallito per questa situazione → locale (niente tentativi a raffica)
//   4. nessun evento                        → locale
//   5. evento poco importante               → locale
//   6. stesso evento già detto di recente   → locale
//   7. limite giornaliero di chiamate       → locale
//   8. ultima chiamata troppo recente       → locale (salvo eventi urgenti)
//   9. altrimenti                           → AI
import { defaultToneFor, defaultAnimationFor } from './spendyAIGuard.js'
import { recordAICall, recordAIFailure, recordAIVoice } from './spendyVoiceCache.js'

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
    return current.voice ? decision('cache', 'cached') : decision('local', 'ai_chose_silence')
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

const NOT_REACHED = new Set(['unavailable', 'unauthenticated', 'network'])

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
    next = recordAIVoice(next, { fingerprint: meta.fingerprint, day: today, eventKey: meta.eventKey, voice, now })
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

export function voiceFromAI(response) {
  return {
    source: 'ai',
    message: response.message,
    secondaryText: null,
    state: response.state,
    tone: response.tone,
    layout: response.layout,
    animation: response.animation,
  }
}

export function resolveSpendyVoice({ decision: choice, coach, cache }) {
  if (choice.action === 'cache' && cache.current?.voice) return voiceFromAI(cache.current.voice)
  return voiceFromCoach(coach)
}
