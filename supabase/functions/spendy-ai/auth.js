// "Di chi è questo token?" — chiesto direttamente a Supabase Auth.
//
// Vale per qualunque formato di chiavi del progetto (legacy JWT o nuove
// chiavi asimmetriche): è Auth stesso a dire se la sessione è valida.
// Un token anonimo (la chiave pubblica usata come Bearer) non corrisponde
// a nessun utente e viene respinto.
export function createSupabaseUserVerifier({ supabaseUrl, publicKey, fetchImpl = fetch }) {
  return async function verifyUser(token) {
    if (!supabaseUrl || !publicKey || !token) return null
    const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null
    const user = await response.json().catch(() => null)
    return user?.id ? { id: user.id } : null
  }
}
