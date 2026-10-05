// La memoria locale di Spendy AI: l'ultima frase generata, quelle già
// dette, e quante chiamate sono state fatte oggi.
//
// Vive in una chiave localStorage TUTTA SUA, una per ambito
// ('spendy-ai-voice:guest', 'spendy-ai-voice:u:<userId>': vedi
// store/scope.js): non entra nello stato dell'app, nel backup JSON o nella
// sincronizzazione Supabase, e le frasi e i conteggi di un account non
// raggiungono mai un altro. Se si perde, Spendy torna a parlare con le frasi
// locali e ricomincia: nessun dato finanziario è qui.
//
// Tutte le funzioni che la modificano sono pure (vecchia cache → nuova
// cache): solo load/save/clear toccano lo storage, e non lanciano mai.
// `scope` è l'ambito della cache: chi salva una risposta arrivata in ritardo
// deve passare quello con cui la richiesta era partita, non quello attivo.
import { GUEST, voiceKey } from '../store/scope.js'

export const VOICE_CACHE_KEY = 'spendy-ai-voice'
export const voiceCacheKey = voiceKey
export const VOICE_CACHE_VERSION = 1
export const VOICE_HISTORY_LIMIT = 30

export function emptyVoiceCache() {
  return {
    version: VOICE_CACHE_VERSION,
    current: null, // { fingerprint, day, eventKey, voice | null, silent, createdAt }
    failure: null, // { fingerprint, day, error, at }
    history: [], // [{ eventKey, message, day }]
    lastShown: null, // { message, day } — l'ultima frase che l'utente ha letto, AI o locale
    calls: { day: null, count: 0, lastAt: null },
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadVoiceCache(storage = defaultStorage(), scope = GUEST) {
  try {
    const raw = storage?.getItem(voiceKey(scope))
    if (!raw) return emptyVoiceCache()
    const parsed = JSON.parse(raw)
    if (parsed?.version !== VOICE_CACHE_VERSION) return emptyVoiceCache()
    return { ...emptyVoiceCache(), ...parsed }
  } catch {
    return emptyVoiceCache()
  }
}

export function saveVoiceCache(cache, storage = defaultStorage(), scope = GUEST) {
  try {
    storage?.setItem(voiceKey(scope), JSON.stringify(cache))
    return true
  } catch {
    return false
  }
}

// Solo la chiave di Spendy AI di quell'ambito — mai lo stato dell'app.
export function clearVoiceCache(storage = defaultStorage(), scope = GUEST) {
  try {
    storage?.removeItem(voiceKey(scope))
  } catch {
    // niente da fare: senza storage non c'è niente da cancellare
  }
}

export function recordAICall(cache, { day, now }) {
  const sameDay = cache.calls.day === day
  return { ...cache, calls: { day, count: sameDay ? cache.calls.count + 1 : 1, lastAt: now } }
}

// `facts`: i dati finanziari con cui la frase è stata generata (vedi
// spendyAIContext.js). Una frase si riusa solo se sono ancora gli stessi.
export function recordAIVoice(cache, { fingerprint, day, eventKey, voice, now, facts }) {
  const history = voice
    ? [...cache.history, { eventKey, message: voice.message, day }].slice(-VOICE_HISTORY_LIMIT)
    : cache.history
  return {
    ...cache,
    current: {
      fingerprint, day, eventKey, voice: voice ?? null, silent: !voice, createdAt: now,
      facts: typeof facts === 'string' ? facts : null,
    },
    failure: null,
    history,
  }
}

export function recordAIFailure(cache, { fingerprint, day, error, now }) {
  return { ...cache, failure: { fingerprint, day, error, at: now } }
}

// L'ultima frase rimasta davvero sullo schermo, qualunque sia la fonte:
// è la "frase precedente" che l'AI riceve per non ripeterne la struttura.
export function recordShown(cache, { message, day }) {
  if (!message || cache.lastShown?.message === message) return cache
  return { ...cache, lastShown: { message, day } }
}
