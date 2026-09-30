// Quota giornaliera di Spendy AI, lato server.
//
// Il limite dell'app (3 al giorno in localStorage) è solo un primo filtro:
// chiunque abbia un account potrebbe chiamare la funzione direttamente.
// Questo è il limite che protegge davvero il costo del modello.
//
// Cosa conta come "chiamata": una richiesta che la funzione autorizza a
// raggiungere il modello. Non contano le richieste non autenticate, con un
// corpo non valido o senza nessun evento da raccontare. Se il provider non
// risponde affatto (timeout, rete, 5xx, suo limite) la chiamata viene
// restituita; se risponde — anche con un rifiuto o un JSON scartato — conta,
// perché il costo c'è stato.
//
// Lo stato vive nella tabella `ai_usage` (supabase/ai_usage.sql) e si tocca
// solo con due funzioni Postgres eseguibili dalla service_role: l'utente è
// sempre quello verificato dal token, mai un valore del corpo.

export const AI_DAILY_LIMIT = 3
export const AI_DAILY_LIMIT_REACHED = 'AI_DAILY_LIMIT_REACHED'

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

// → { reserve({ userId, day, limit }) → { allowed, used }, release({ userId, day }) }
// Lancia se il database non risponde: chi chiama deve rifiutare la
// richiesta AI (fail closed), non lasciarla passare senza quota.
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
    return response.json()
  }

  return {
    async reserve({ userId, day, limit }) {
      const rows = await rpc('spendy_ai_reserve', { p_user_id: userId, p_usage_date: day, p_limit: limit })
      const row = Array.isArray(rows) ? rows[0] : rows
      if (!row || typeof row.allowed !== 'boolean') throw new Error('quota_bad_response')
      return { allowed: row.allowed, used: Number(row.used ?? 0) }
    },
    async release({ userId, day }) {
      await rpc('spendy_ai_release', { p_user_id: userId, p_usage_date: day })
    },
  }
}
