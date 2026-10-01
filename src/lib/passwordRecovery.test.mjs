// Recupero password: logica (client Supabase finto) e schermate (react-dom/server vero).

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import * as rec from './passwordRecovery.js'

const web = { location: { origin: 'http://localhost:5199' } }
const native = { location: { origin: 'https://localhost' }, Capacitor: { isNativePlatform: () => true } }

const fakeClient = (overrides = {}) => {
  const calls = { reset: [], update: [] }
  return {
    calls,
    auth: {
      resetPasswordForEmail: async (...args) => { calls.reset.push(args); return overrides.reset ?? { data: {}, error: null } },
      updateUser: async (...args) => { calls.update.push(args); return overrides.update ?? { data: {}, error: null } },
    },
  }
}

// Niente password/token nei log: si intercetta tutta l'uscita della console.
const logged = []
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    const line = args.map(String).join(' ')
    if (!line.startsWith('  ✓') && !line.startsWith('  ✗')) logged.push(line)
    original(...args)
  }
}
const SECRET_PASSWORD = 'Sup3r-Segreta-Pwd!'
const SECRET_TOKEN = 'tok-abc-123-segreto'

// =====================================================================
section('1. Richiesta del link')
// =====================================================================
{
  const c = fakeClient()
  const r = await rec.requestPasswordReset(c, '  utente@esempio.invalid ', web)
  check('chiama resetPasswordForEmail con l\'email ripulita', c.calls.reset.length === 1 && c.calls.reset[0][0] === 'utente@esempio.invalid')
  check('   redirectTo = origine dell\'app sul web', c.calls.reset[0][1]?.redirectTo === 'http://localhost:5199/')
  check('   messaggio di invio generico', r.ok === true && r.message === rec.RESET_SENT_MESSAGE)

  const n = fakeClient()
  await rec.requestPasswordReset(n, 'utente@esempio.invalid', native)
  check('app nativa: nessun redirectTo inventato (decide il Site URL di Supabase)', n.calls.reset[0][1] === undefined)
  check('nessuna window (Node): nessun redirectTo', rec.recoveryRedirectUrl(undefined) === undefined)
  check('origine non http(s) (es. capacitor://): nessun redirectTo', rec.recoveryRedirectUrl({ location: { origin: 'capacitor://localhost' } }) === undefined)

  for (const bad of ['', '   ', 'senza-chiocciola', 'a@b', 'a b@c.it', null, undefined]) {
    const x = fakeClient()
    const out = await rec.requestPasswordReset(x, bad, web)
    check(`email non valida (${JSON.stringify(bad)}): errore locale, nessuna richiesta`, out.ok === false && out.message === rec.MESSAGES.emailInvalid && x.calls.reset.length === 0)
  }
}

// =====================================================================
section('2. Non rivela se l\'indirizzo esiste')
// =====================================================================
{
  const sent = await rec.requestPasswordReset(fakeClient(), 'esiste@esempio.invalid', web)
  const notFound = await rec.requestPasswordReset(fakeClient({ reset: { data: null, error: { status: 400, code: 'user_not_found', message: 'User not found' } } }), 'nonesiste@esempio.invalid', web)
  const thrown = { auth: { resetPasswordForEmail: async () => { throw new Error('boom') } } }
  const odd = await rec.requestPasswordReset(thrown, 'x@esempio.invalid', web)
  check('indirizzo inesistente: stessa risposta di uno esistente', notFound.ok === true && notFound.message === sent.message)
  check('   anche con un errore imprevisto del server', odd.ok === true && odd.message === sent.message)
  check('il testo non cita l\'indirizzo né "non esiste"', !/esempio|non esiste|nessun account/i.test(sent.message))
}

// =====================================================================
section('3. Errori comprensibili')
// =====================================================================
{
  const rate = await rec.requestPasswordReset(fakeClient({ reset: { error: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } } }), 'a@esempio.invalid', web)
  check('limite di invii → messaggio dedicato', rate.ok === false && rate.message === rec.MESSAGES.rateLimit)
  const net = await rec.requestPasswordReset(fakeClient({ reset: { error: { status: 0, name: 'AuthRetryableFetchError', message: 'Failed to fetch' } } }), 'a@esempio.invalid', web)
  check('rete assente → messaggio dedicato', net.ok === false && net.message === rec.MESSAGES.network)
  check('nessun messaggio mostra testo grezzo del server', ![rate, net].some((r) => /exceeded|fetch|AuthRetry/i.test(r.message)))
  check('classificazione: same_password', rec.classifyAuthError({ code: 'same_password', message: 'x' }) === 'samePassword')
  check('classificazione: weak_password', rec.classifyAuthError({ code: 'weak_password', message: 'x' }) === 'weakPassword')
  check('classificazione: sessione/link scaduto', rec.classifyAuthError({ status: 401, message: 'Auth session missing!' }) === 'linkInvalid')
  check('classificazione: sconosciuto → generico', rec.classifyAuthError({ status: 500, message: 'boh' }) === 'generic')
}

// =====================================================================
section('4. Nuova password')
// =====================================================================
{
  check('troppo corta → rifiutata', rec.validateNewPassword('abc', 'abc') === rec.MESSAGES.passwordShort)
  check('le due non coincidono → rifiutata', rec.validateNewPassword('password1', 'password2') === rec.MESSAGES.passwordMismatch)
  check('valida → nessun errore', rec.validateNewPassword('password1', 'password1') === null)

  const c = fakeClient()
  const bad = await rec.submitNewPassword(c, 'password1', 'diversa')
  check('non coincidono: updateUser NON viene chiamato', bad.ok === false && c.calls.update.length === 0)
  const ok = await rec.submitNewPassword(c, SECRET_PASSWORD, SECRET_PASSWORD)
  check('valida: updateUser({ password }) chiamato una volta', ok.ok === true && c.calls.update.length === 1 && c.calls.update[0][0].password === SECRET_PASSWORD)
  check('   e nient\'altro viene inviato', Object.keys(c.calls.update[0][0]).join() === 'password')

  const same = await rec.submitNewPassword(fakeClient({ update: { error: { code: 'same_password', message: 'New password should be different from the old password.' } } }), 'password1', 'password1')
  check('stessa password di prima → messaggio chiaro', same.ok === false && same.message === rec.MESSAGES.samePassword)
  const expired = await rec.submitNewPassword(fakeClient({ update: { error: { status: 401, message: 'Auth session missing!' } } }), 'password1', 'password1')
  check('link scaduto (nessuna sessione) → messaggio chiaro', expired.ok === false && expired.message === rec.MESSAGES.linkInvalid)
  const thrown = await rec.submitNewPassword({ auth: { updateUser: async () => { throw new Error(`rete ${SECRET_TOKEN}`) } } }, 'password1', 'password1')
  check('eccezione imprevista → messaggio generico, senza il testo grezzo', thrown.ok === false && !thrown.message.includes(SECRET_TOKEN))
}

// =====================================================================
section('5. Riconoscere il link dell\'email nell\'indirizzo')
// =====================================================================
{
  check('#access_token=…&type=recovery → recupero', rec.detectRecoveryFromUrl({ hash: `#access_token=${SECRET_TOKEN}&type=recovery`, search: '' })?.kind === 'recovery')
  check('?type=recovery → recupero', rec.detectRecoveryFromUrl({ hash: '', search: '?type=recovery' })?.kind === 'recovery')
  check('link scaduto (#error_code=otp_expired) → link non valido', rec.detectRecoveryFromUrl({ hash: '#error=access_denied&error_code=otp_expired', search: '' })?.kind === 'invalid-link')
  check('indirizzo normale → niente', rec.detectRecoveryFromUrl({ hash: '', search: '?spendyDebug=1' }) === null)
  check('nessuna location → niente', rec.detectRecoveryFromUrl(undefined) === null)
  check('login normale (#type=signup) non è un recupero', rec.detectRecoveryFromUrl({ hash: '#access_token=x&type=signup', search: '' }) === null)
}

// =====================================================================
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-recovery-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [react(), { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) }],
})

try {
  const { ForgotPasswordForm } = await server.ssrLoadModule('/src/components/settings/ForgotPasswordForm.jsx')
  const { PasswordRecoveryScreen } = await server.ssrLoadModule('/src/components/settings/PasswordRecoveryScreen.jsx')
  const recMod = await server.ssrLoadModule('/src/lib/passwordRecovery.js')

  section('6. Schermata "Password dimenticata?"')
  {
    const html = renderToStaticMarkup(h(ForgotPasswordForm, { initialEmail: 'a@esempio.invalid', onBack() {}, client: fakeClient() }))
    check('campo email precompilato dall\'accesso', html.includes('type="email"') && html.includes('value="a@esempio.invalid"'))
    check('   pulsante di invio e ritorno all\'accesso', html.includes('Invia il link') && html.includes('Torna all&#x27;accesso'))
    check('   nessun campo password', !html.includes('type="password"'))
  }

  section('7. Schermata della nuova password')
  {
    recMod.setRecoveryState(null)
    check('nessun recupero in corso: la schermata non compare', renderToStaticMarkup(h(PasswordRecoveryScreen, { client: null })) === '')
    recMod.setRecoveryState({ kind: 'recovery' })
    const html = renderToStaticMarkup(h(PasswordRecoveryScreen, { client: null }))
    check('link aperto: compare "Scegli una nuova password"', html.includes('Scegli una nuova password'))
    check('   due campi con type="password"', (html.match(/type="password"/g) ?? []).length === 2)
    check('   autoComplete new-password (il gestore password salva quella nuova)', (html.match(/autoComplete="new-password"/g) ?? []).length === 2)
    check('   si può rinunciare ("Non ora")', html.includes('Non ora'))
    recMod.setRecoveryState({ kind: 'invalid-link' })
    const bad = renderToStaticMarkup(h(PasswordRecoveryScreen, { client: null }))
    check('link scaduto: messaggio e Chiudi, nessun campo password', bad.includes('Link non valido') && bad.includes('Chiudi') && !bad.includes('type="password"'))
    recMod.setRecoveryState(null)
  }
} finally {
  await server.close()
}

section('8. Niente dati sensibili nei log')
check('né password né token né email sono stati scritti nella console', !logged.some((line) => line.includes(SECRET_PASSWORD) || line.includes(SECRET_TOKEN) || line.includes('@esempio.invalid')))

report('Recupero password')
