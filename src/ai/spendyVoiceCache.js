// La memoria locale di Spendy AI: l'ultima frase generata, quelle già
// dette, e quante chiamate sono state fatte oggi.
//
// Vive in una chiave localStorage TUTTA SUA ('spendy-ai-voice'): non entra
// in 'spendy-storage', nel backup JSON o nella sincronizzazione Supabase.
// È per dispositivo, come spendyJokeHistory. Se si perde, Spendy torna a
// parlare con le frasi locali e ricomincia: nessun dato finanziario è qui.
//
// Tutte le funzioni che la modificano sono pure (vecchia cache → nuova
// cache): solo load/save toccano lo storage, ed entrambe non lanciano mai.
export const VOICE_CACHE_KEY = 'spendy-ai-voice'
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

export function loadVoiceCache(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(VOICE_CACHE_KEY)
    if (!raw) return emptyVoiceCache()
    const parsed = JSON.parse(raw)
    if (parsed?.version !== VOICE_CACHE_VERSION) return emptyVoiceCache()
    return { ...emptyVoiceCache(), ...parsed }
  } catch {
    return emptyVoiceCache()
  }
}

export function saveVoiceCache(cache, storage = defaultStorage()) {
  try {
    storage?.setItem(VOICE_CACHE_KEY, JSON.stringify(cache))
    return true
  } catch {
    return false
  }
}

// Solo la chiave di Spendy AI — mai 'spendy-storage'.
export function clearVoiceCache(storage = defaultStorage()) {
  try {
    storage?.removeItem(VOICE_CACHE_KEY)
  } catch {
    // niente da fare: senza storage non c'è niente da cancellare
  }
}

export function recordAICall(cache, { day, now }) {
  const sameDay = cache.calls.day === day
  return { ...cache, calls: { day, count: sameDay ? cache.calls.count + 1 : 1, lastAt: now } }
}

export function recordAIVoice(cache, { fingerprint, day, eventKey, voice, now }) {
  const history = voice
    ? [...cache.history, { eventKey, message: voice.message, day }].slice(-VOICE_HISTORY_LIMIT)
    : cache.history
  return {
    ...cache,
    current: { fingerprint, day, eventKey, voice: voice ?? null, silent: !voice, createdAt: now },
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
