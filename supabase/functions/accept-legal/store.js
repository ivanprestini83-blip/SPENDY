// Scrittura in legal_acceptances con la service_role, che esiste SOLO nei
// secret della Edge Function. Upsert sulla chiave user_id: una riga per
// utente (nessuno storico, per scelta). Stesse intestazioni di
// spendy-ai/quota.js: `apikey` sempre, `Authorization` solo per le chiavi
// legacy in formato JWT. Le date arrivano da chi chiama (orario del server
// della funzione); gli orari "dichiarati dal dispositivo" restano vuoti.
export function createSupabaseLegalAcceptanceWriter({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  const base = supabaseUrl.replace(/\/$/, '')
  const headers = {
    apikey: serviceKey,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
    ...(serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {}),
  }

  return async function recordAcceptance({ userId, termsVersion, privacyVersion, at }) {
    if (typeof userId !== 'string' || userId.length === 0) throw new Error('missing_user_id')
    const response = await fetchImpl(`${base}/rest/v1/legal_acceptances?on_conflict=user_id`, {
      method: 'POST',
      headers,
      body: JSON.stringify([{
        user_id: userId,
        terms_version: termsVersion,
        terms_accepted_at: at,
        privacy_version: privacyVersion,
        privacy_acknowledged_at: at,
        client_terms_accepted_at: null,
        client_privacy_acknowledged_at: null,
      }]),
    })
    if (!response.ok) throw new Error(`legal_acceptances_${response.status}`)
  }
}
