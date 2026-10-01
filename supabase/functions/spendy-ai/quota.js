// Quota giornaliera di Spendy AI, lato server.
//
// Il limite dell'app (3 al giorno in localStorage) è solo un primo filtro:
// chiunque abbia un account potrebbe chiamare la funzione direttamente.
// Questo è il limite che protegge davvero il costo del modello.
//
// Cosa conta come "chiamata": una richiesta che la funzione autorizza a
// raggiungere il modello. Non contano le richieste non autenticate, con un
// corpo non valido o senza nessun evento da raccontare.
//
// Dopo la prenotazione la chiamata TORNA all'utente solo se è certo che il
// provider non ha fatturato nulla:
//   - errore prima dell'invio (la richiesta non è mai partita);
//   - rifiuto esplicito con HTTP 400, 401, 403, 404, 429 o 529 (400/404 sono
//     una richiesta o una configurazione sbagliata lato nostro).
// Resta CONSUMATA in ogni altro caso: risposta valida, risposta rifiutata o
// scartata, timeout, errore di rete, 5xx, altri errori HTTP (es. 422),
// errori non classificati. Una richiesta partita può essere fatturata anche se la
// risposta non è arrivata, quindi nel dubbio conta.
// La classificazione è in anthropicModel.js (ModelError.refund).
//
// Lo stato vive nella tabella `ai_usage` (supabase/ai_usage.sql) e si tocca
// solo con due funzioni Postgres eseguibili dalla service_role: l'utente è
// sempre quello verificato dal token, mai un valore del corpo.

// Limiti predefiniti. Non sono scolpiti nella funzione: readConfig (handler.js)
// li legge dai secret AI_DAILY_LIMIT, AI_MONTHLY_LIMIT e AI_GLOBAL_DAILY_LIMIT
// e usa questi valori solo se mancano o non sono numeri positivi.
//   daily    chiamate al giorno per utente (giornata UTC)
//   monthly  chiamate al mese per utente (mese di calendario UTC)
//   global   chiamate al giorno di TUTTI gli utenti insieme: una valvola di
//            sicurezza contro costi imprevisti, NON un budget. Il valore
//            predefinito è volutamente basso e prudente (circa 100 utenti al
//            massimo giornaliero): chi gestisce il progetto lo alza o lo
//            abbassa con il secret quando conosce il costo reale per chiamata.
export const AI_DAILY_LIMIT = 3
export const AI_MONTHLY_LIMIT = 30
export const AI_GLOBAL_DAILY_LIMIT = 300

// Il codice che l'app riceve (HTTP 429) per ciascun limite.
export const AI_DAILY_LIMIT_REACHED = 'AI_DAILY_LIMIT_REACHED'
export const AI_MONTHLY_LIMIT_REACHED = 'AI_MONTHLY_LIMIT_REACHED'
export const AI_GLOBAL_LIMIT_REACHED = 'AI_GLOBAL_LIMIT_REACHED'

// Il motivo del rifiuto, com'è restituito da spendy_ai_reserve_v2, e come lo
// raccontano risposta e log.
export const QUOTA_REASONS = {
  daily: { error: AI_DAILY_LIMIT_REACHED, outcome: 'daily_limit' },
  monthly: { error: AI_MONTHLY_LIMIT_REACHED, outcome: 'monthly_limit' },
  global: { error: AI_GLOBAL_LIMIT_REACHED, outcome: 'global_limit' },
}

// Giornata = data UTC ("2026-09-29"). Vedi supabase/ai_usage.sql.
export const usageDay = (nowMs) => new Date(nowMs).toISOString().slice(0, 10)

// La chiave con cui la funzione scrive su ai_usage. Supabase la fornisce da
// solo alle Edge Functions: SUPABASE_SERVICE_ROLE_KEY (chiavi legacy) o
// SUPABASE_SECRET_KEYS (nuove chiavi). Non esce mai dal server.
export function supabaseServiceKey(getEnv) {
  const direct = getEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (direct) return direct
  try {
    const keys = JSON.parse(getEnv('SUPABASE_SECRET_KEYS') ?? '{}')
    return keys.default ?? Object.values(keys)[0] ?? null
  } catch {
    return null
  }
}

// → { reserve({ userId, day, limits }) → { allowed, reason, ... },
//     release({ userId, day }),
//     recordUsage({ userId, day, model, inputTokens, outputTokens }) }
//   limits = { daily, monthly, global }
// reserve e release lanciano se il database non risponde: chi chiama deve
// rifiutare la richiesta AI (fail closed), non lasciarla passare senza quota.
// recordUsage invece è solo misura: chi chiama non deve mai farne dipendere
// la risposta all'utente.
export function createSupabaseQuota({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  const base = supabaseUrl.replace(/\/$/, '')
  const headers = {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    // Le chiavi legacy sono JWT e vanno anche come Bearer; le nuove chiavi
    // segrete (sb_secret_…) si presentano solo come apikey.
    ...(serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {}),
  }

  async function rpc(name, args) {
    const response = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    })
    if (!response.ok) throw new Error(`quota_rpc_${response.status}`)
    // spendy_ai_record_usage non restituisce niente (corpo vuoto).
    return response.json().catch(() => null)
  }

  return {
    async reserve({ userId, day, limits }) {
      const rows = await rpc('spendy_ai_reserve_v2', {
        p_user_id: userId,
        p_usage_date: day,
        p_daily_limit: limits.daily,
        p_monthly_limit: limits.monthly,
        p_global_daily_limit: limits.global,
      })
      const row = Array.isArray(rows) ? rows[0] : rows
      if (!row || typeof row.allowed !== 'boolean') throw new Error('quota_bad_response')
      if (row.allowed) return { allowed: true, reason: null, used: Number(row.daily_used ?? 0) }
      // Un rifiuto resta un rifiuto anche se il motivo non è riconosciuto.
      return { allowed: false, reason: Object.hasOwn(QUOTA_REASONS, row.reason) ? row.reason : 'daily', used: Number(row.daily_used ?? 0) }
    },
    async release({ userId, day }) {
      await rpc('spendy_ai_release', { p_user_id: userId, p_usage_date: day })
    },
    async recordUsage({ userId, day, model, inputTokens, outputTokens }) {
      await rpc('spendy_ai_record_usage', {
        p_user_id: userId,
        p_usage_date: day,
        p_model: model,
        p_input_tokens: inputTokens,
        p_output_tokens: outputTokens,
      })
    },
  }
}
