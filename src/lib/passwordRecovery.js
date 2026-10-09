// Recupero password con Supabase Auth: tutta la logica che non è disegno.
//
// Niente qui importa il client Supabase: lo si passa dall'esterno, così i
// test usano un client finto e nessun segreto o token passa da questo file.
// Nessuna funzione scrive password, token o email nei log.
//
// Flusso (quello ufficiale di Supabase):
//   1. resetPasswordForEmail(email, { redirectTo }) → Supabase manda l'email.
//   2. L'utente apre il link: Supabase lo riporta all'app con
//      `#access_token=…&type=recovery` e il client emette PASSWORD_RECOVERY.
//   3. updateUser({ password }) salva la nuova password (la sessione di
//      recupero è quella che autorizza la modifica).

import { tr } from '../i18n/currentLanguage.js'

export const MIN_PASSWORD_LENGTH = 6

// Nella lingua dell'app, letti nel momento in cui servono. `resetSent` è la
// stessa risposta se l'indirizzo esiste o no: Supabase non lo rivela e
// nemmeno noi.
export const MESSAGES = {
  get resetSent() { return tr('recovery.message.resetsent') },
  get emailInvalid() { return tr('recovery.message.emailinvalid') },
  get passwordShort() { return tr('recovery.message.passwordshort', { count: MIN_PASSWORD_LENGTH }) },
  get passwordMismatch() { return tr('recovery.message.passwordmismatch') },
  get rateLimit() { return tr('recovery.message.ratelimit') },
  get network() { return tr('recovery.message.network') },
  get samePassword() { return tr('recovery.message.samepassword') },
  get weakPassword() { return tr('recovery.message.weakpassword') },
  get linkInvalid() { return tr('recovery.message.linkinvalid') },
  get generic() { return tr('recovery.message.generic') },
}

// L'app nativa (Capacitor) non ha un indirizzo web a cui far tornare il link:
// lì si lascia decidere a Supabase (Site URL del progetto).
export const isNativeApp = (win) => Boolean(win?.Capacitor?.isNativePlatform?.())

// Dove riporta il link dell'email. Solo sul web, e solo l'origine dell'app
// stessa; deve comparire tra i Redirect URLs del progetto Supabase.
export function recoveryRedirectUrl(win = globalThis.window) {
  if (!win?.location || isNativeApp(win)) return undefined
  const { origin } = win.location
  return typeof origin === 'string' && /^https?:\/\//.test(origin) ? `${origin}/` : undefined
}

export function classifyAuthError(error) {
  if (!error) return null
  const code = String(error.code ?? '')
  const text = String(error.message ?? '')
  const status = Number(error.status)
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429 || /rate limit/i.test(text)) return 'rateLimit'
  if (code === 'same_password' || /different from the old password/i.test(text)) return 'samePassword'
  if (code === 'weak_password' || /weak/i.test(text)) return 'weakPassword'
  if (status === 0 || /failed to fetch|network|load failed/i.test(text) || error.name === 'AuthRetryableFetchError') return 'network'
  if (status === 401 || status === 403 || /session missing|expired|invalid/i.test(`${code} ${text}`)) return 'linkInvalid'
  return 'generic'
}
export const friendlyError = (error) => MESSAGES[classifyAuthError(error) ?? 'generic']

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

// Passo 1. Ritorna { ok: true, message } oppure { ok: false, message }.
export async function requestPasswordReset(client, email, win = globalThis.window) {
  const address = String(email ?? '').trim()
  if (!looksLikeEmail(address)) return { ok: false, message: MESSAGES.emailInvalid }
  if (!client?.auth) return { ok: false, message: MESSAGES.generic }
  const redirectTo = recoveryRedirectUrl(win)
  try {
    const { error } = await client.auth.resetPasswordForEmail(address, redirectTo ? { redirectTo } : undefined)
    if (error) {
      const kind = classifyAuthError(error)
      // Solo problemi che non dicono nulla sull'indirizzo (limite di invii,
      // rete): tutto il resto riceve la stessa risposta di un invio riuscito.
      if (kind === 'rateLimit' || kind === 'network') return { ok: false, message: MESSAGES[kind] }
    }
  } catch (error) {
    if (classifyAuthError(error) === 'network') return { ok: false, message: MESSAGES.network }
  }
  return { ok: true, message: MESSAGES.resetSent }
}

export function validateNewPassword(password, confirmation) {
  if (String(password ?? '').length < MIN_PASSWORD_LENGTH) return MESSAGES.passwordShort
  if (password !== confirmation) return MESSAGES.passwordMismatch
  return null
}

// Passo 3. Ritorna { ok: true } oppure { ok: false, message }.
export async function submitNewPassword(client, password, confirmation) {
  const invalid = validateNewPassword(password, confirmation)
  if (invalid) return { ok: false, message: invalid }
  if (!client?.auth) return { ok: false, message: MESSAGES.generic }
  try {
    const { error } = await client.auth.updateUser({ password })
    if (error) return { ok: false, message: friendlyError(error) }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: friendlyError(error) }
  }
}

// Passo 2, lato URL: l'indirizzo con cui si apre l'app dal link dell'email.
// Va letto SUBITO, prima che il client Supabase ripulisca l'indirizzo.
export function detectRecoveryFromUrl(loc) {
  if (!loc) return null
  const params = new URLSearchParams(String(loc.hash ?? '').replace(/^#/, ''))
  const query = new URLSearchParams(String(loc.search ?? ''))
  const get = (key) => params.get(key) ?? query.get(key)
  if (get('type') === 'recovery') return { kind: 'recovery' }
  if (get('error_code') || get('error')) return { kind: 'invalid-link' }
  return null
}

// Stato condiviso (fuori da React): sopravvive ai rimontaggi dell'interfaccia
// che avvengono quando la sessione di recupero cambia l'ambito dei dati.
let state = detectRecoveryFromUrl(globalThis.window?.location)
const listeners = new Set()
export const getRecoveryState = () => state
export const subscribeRecovery = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function setRecoveryState(next) {
  state = next
  listeners.forEach((listener) => listener())
}
