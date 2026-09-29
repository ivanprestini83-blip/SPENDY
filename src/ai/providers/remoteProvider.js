// REMOTE PROVIDER — la vera AI, attraverso la Supabase Edge Function.
//
//   app → POST /functions/v1/spendy-ai → (server) modello → guard → app
//
// Stesso contratto del mock (vedi spendyAI.js): riceve il contesto, lo
// manda al server e restituisce la risposta grezza, che spendyAI poi
// ri-valida con il guard. Nessuna chiave API qui: l'app si presenta con
// la SESSIONE dell'utente (token Supabase) e con la chiave pubblica del
// progetto, che è pubblica per definizione. La chiave del modello vive
// solo tra i secret della funzione.
//
// Privacy: prima di partire il contesto passa dalla stessa lista bianca
// che usa il server (sanitizeSpendyContext). Alla funzione arrivano solo
// il riassunto, la frase precedente e le ultime dette — mai spese,
// descrizioni, note, id o dati di sincronizzazione.
//
// Nessuna dipendenza da import.meta.env o dal client Supabase: chi lo
// crea (spendyAIConfig.js) passa URL, chiave pubblica e come ottenere il
// token. Così gira anche nei test Node.
import { sanitizeSpendyContext, sanitizeMessages } from '../../../supabase/functions/_shared/spendyAIRules.js'

export const SPENDY_AI_FUNCTION = 'spendy-ai'
// Più largo del timeout del server (12 s di default): se il modello è
// lento risponde il server con un 504, non il browser con un abort.
export const REMOTE_TIMEOUT_MS = 15000

function providerError(code, message = code) {
  const error = new Error(message)
  error.code = code
  return error
}

// Stato HTTP della funzione → codice che spendyAI sa gestire.
const STATUS_TO_CODE = {
  401: 'unauthenticated',
  403: 'unauthenticated',
  422: 'invalid',
  429: 'rate_limited',
  503: 'unavailable',
  504: 'timeout',
}

export function functionsUrl(supabaseUrl) {
  return supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${SPENDY_AI_FUNCTION}` : null
}

export function createRemoteProvider({ url, publicKey, getAccessToken, fetchImpl = globalThis.fetch?.bind(globalThis) }) {
  return {
    name: 'remote',
    available: Boolean(url && publicKey && typeof getAccessToken === 'function' && fetchImpl),
    timeoutMs: REMOTE_TIMEOUT_MS,

    async generate(context, { signal, history = [], previous = null } = {}) {
      // Senza sessione non si parte nemmeno: il server risponderebbe 401.
      const token = await getAccessToken().catch(() => null)
      if (!token) throw providerError('unauthenticated')

      const payload = {
        context: sanitizeSpendyContext(context),
        previous: sanitizeMessages([previous], 1)[0] ?? null,
        history: sanitizeMessages(history),
      }
      if (!payload.context) throw providerError('invalid', 'contesto non valido')

      let response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: publicKey,
          },
          body: JSON.stringify(payload),
          signal,
        })
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        throw providerError('network', String(error?.message ?? error))
      }

      if (!response.ok) {
        throw providerError(STATUS_TO_CODE[response.status] ?? 'server_error', `HTTP ${response.status}`)
      }

      let body
      try {
        body = await response.json()
      } catch {
        throw providerError('invalid', 'risposta non JSON')
      }
      // La risposta grezza: spendyAI la passa comunque dal guard.
      return body?.response ?? body
    },
  }
}
