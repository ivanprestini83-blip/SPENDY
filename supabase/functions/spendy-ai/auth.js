// "Di chi è questo token?" — chiesto direttamente a Supabase Auth.
//
// Vale per qualunque formato di chiavi del progetto (legacy JWT o nuove
// chiavi asimmetriche): è Auth stesso a dire se la sessione è valida.
// Un token anonimo (la chiave pubblica usata come Bearer) non corrisponde
// a nessun utente e viene respinto. Restituisce anche se l'email è confermata:
// la funzione la richiede prima di consentire l'AI (vedi handler.js).
export function createSupabaseUserVerifier({ supabaseUrl, publicKey, fetchImpl = fetch }) {
  return async function verifyUser(token) {
    if (!supabaseUrl || !publicKey || !token) return null
    const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null
    const user = await response.json().catch(() => null)
    if (!user?.id) return null
    // email_confirmed_at è valorizzato se l'indirizzo è stato confermato (o se
    // il progetto conferma da solo, con "Confirm email" spento). Un account
    // anonimo o con l'indirizzo non confermato non lo ha.
    return { id: user.id, emailConfirmed: Boolean(user.email_confirmed_at) }
  }
}
