// Cancellazione di un utente con l'API admin di Supabase Auth.
//
// Usa la service_role (o la chiave segreta del progetto): esiste SOLO nei
// secret della Edge Function, mai nel frontend. Stesse intestazioni di
// spendy-ai/quota.js: `apikey` sempre, `Authorization` solo per le chiavi
// legacy in formato JWT.
export function createSupabaseUserDeleter({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  const base = supabaseUrl.replace(/\/$/, '')
  const headers = {
    apikey: serviceKey,
    ...(serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {}),
  }

  return async function deleteUser(userId) {
    if (typeof userId !== 'string' || userId.length === 0) throw new Error('missing_user_id')
    const response = await fetchImpl(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) throw new Error(`auth_admin_${response.status}`)
  }
}
