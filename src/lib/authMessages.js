// Gli errori di accesso e registrazione di Supabase Auth, tradotti nella
// lingua dell'app. Il testo tecnico di Supabase (in inglese, a volte con
// dettagli interni) non arriva mai a schermo: si guarda il codice, poi lo
// stato HTTP, poi alcune parole note del messaggio.
import { tr } from '../i18n/currentLanguage.js'

export function classifySignInUpError(error) {
  if (!error) return null
  const code = String(error.code ?? '')
  const text = String(error.message ?? '')
  const status = Number(error.status)
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(text)) return 'credentials'
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(text)) return 'unconfirmed'
  if (code === 'user_already_exists' || code === 'email_exists' || /already (registered|exists)/i.test(text)) return 'exists'
  if (code === 'weak_password' || /password should be|weak password/i.test(text)) return 'weakPassword'
  if (code === 'email_address_invalid' || /email address .*invalid|invalid email/i.test(text)) return 'emailInvalid'
  // Il server di invio email non accetta quell'indirizzo (per esempio il
  // servizio predefinito di Supabase, limitato ai membri del progetto).
  if (code === 'email_address_not_authorized' || /not authorized/i.test(text)) return 'emailRejected'
  if (code === 'signup_disabled' || /signups? not allowed|signup.*disabled/i.test(text)) return 'signupDisabled'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429 || /rate limit/i.test(text)) return 'rateLimit'
  if (status === 0 || /failed to fetch|network|load failed/i.test(text) || error.name === 'AuthRetryableFetchError') return 'network'
  return 'generic'
}

export const authErrorMessage = (error) => tr(`auth.error.${(classifySignInUpError(error) ?? 'generic').toLowerCase()}`)
