// "Questo utente ha attivato Spendy AI?" — letto dal DATABASE, mai dal client.
//
// La scelta sta in profiles.spendy_ai_enabled (supabase/privacy_consent.sql),
// default false. La legge la funzione con la service_role (che esiste solo
// nei suoi secret), per l'utente già verificato: nessun parametro della
// richiesta conta. Stesse intestazioni di quota.js.
//
// → true solo se la riga c'è e vale esattamente true; false se manca la riga
//   o il valore. Lancia se il database non risponde (o la colonna non esiste
//   ancora): chi chiama non contatta il modello in nessuno dei due casi.
export function createSupabaseAIPreference({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  const base = supabaseUrl.replace(/\/$/, '')
  const headers = {
    apikey: serviceKey,
    Accept: 'application/json',
    ...(serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {}),
  }

  return async function isSpendyAIEnabled(userId) {
    if (typeof userId !== 'string' || userId.length === 0) return false
    const url = `${base}/rest/v1/profiles?select=spendy_ai_enabled&id=eq.${encodeURIComponent(userId)}&limit=1`
    const response = await fetchImpl(url, { method: 'GET', headers })
    if (!response.ok) throw new Error(`preference_${response.status}`)
    const rows = await response.json().catch(() => null)
    if (!Array.isArray(rows)) throw new Error('preference_bad_response')
    return rows[0]?.spendy_ai_enabled === true
  }
}
