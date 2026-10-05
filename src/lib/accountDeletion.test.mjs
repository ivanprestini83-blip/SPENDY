// Eliminazione account — lato server (Edge Function delete-account), schema
// del database, richiesta dal client e assenza della service_role nel frontend.
// `npm test`, senza rete e senza Supabase: nessun account reale viene toccato.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, section, report } from '../sync/testkit.mjs'
import { createDeleteAccountHandler, DELETE_ACCOUNT_ERRORS } from '../../supabase/functions/delete-account/handler.js'
import { createSupabaseUserDeleter } from '../../supabase/functions/delete-account/admin.js'
import { requestAccountDeletion, DELETE_ACCOUNT_FUNCTION, DELETE_ACCOUNT_MESSAGES } from './accountDeletion.js'
import { SYNC_COLLECTIONS, SETTINGS_TABLE } from '../sync/mappers.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const A = 'utente-a-0001'
const B = 'utente-b-0002'

// Il verificatore vero chiede a Supabase Auth di chi è il token: qui una tabella fissa.
const TOKENS = { 'token-di-a': { id: A, emailConfirmed: true }, 'token-di-b-non-confermato': { id: B, emailConfirmed: false } }
const verifyUser = async (token) => TOKENS[token] ?? null

function setup({ deleteUser } = {}) {
  const deleted = []
  const logs = []
  const handler = createDeleteAccountHandler({
    verifyUser,
    deleteUser: deleteUser === undefined ? async (id) => { deleted.push(id) } : deleteUser,
    log: (entry) => logs.push(entry),
  })
  return { handler, deleted, logs }
}

const request = ({ method = 'POST', token, body, url = 'https://x.supabase.co/functions/v1/delete-account', headers = {} } = {}) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined || method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })

const read = async (response) => ({ status: response.status, body: await response.json().catch(() => null) })

// =====================================================================
section('1. Utente autenticato: elimina il proprio account')
// =====================================================================
{
  const { handler, deleted, logs } = setup()
  const res = await read(await handler(request({ token: 'token-di-a' })))
  check('risposta 200 { deleted: true }', res.status === 200 && res.body?.deleted === true, JSON.stringify(res))
  check('   eliminato esattamente l\'utente del token', deleted.length === 1 && deleted[0] === A)
  check('   nei log solo l\'esito (niente id, token o email)', !JSON.stringify(logs).includes(A) && !JSON.stringify(logs).includes('token-di-a'))

  const unconfirmed = setup()
  const res2 = await read(await unconfirmed.handler(request({ token: 'token-di-b-non-confermato' })))
  check('anche con email non confermata si può eliminare il proprio account', res2.status === 200 && unconfirmed.deleted[0] === B)
}

// =====================================================================
section('2. user_id manipolato dal client: conta solo il token')
// =====================================================================
{
  const { handler, deleted } = setup()
  await handler(request({ token: 'token-di-a', body: { user_id: B, userId: B, id: B } }))
  await handler(request({ token: 'token-di-a', url: `https://x.supabase.co/functions/v1/delete-account?user_id=${B}` }))
  await handler(request({ token: 'token-di-a', headers: { 'x-user-id': B } }))
  await handler(request({ token: 'token-di-a', body: '{ non è json' }))
  check('con user_id di B nel corpo, nella query o negli header: eliminato solo A', deleted.length === 4 && deleted.every((id) => id === A), JSON.stringify(deleted))
  check('   B non è MAI stato passato alla cancellazione', !deleted.includes(B))

  const source = readFileSync(join(ROOT, 'supabase/functions/delete-account/handler.js'), 'utf8')
  check('   il corpo della richiesta non viene nemmeno letto', !/request\.(json|text|formData|body)\b/.test(source))
}

// =====================================================================
section('3. Senza autenticazione: rifiutata')
// =====================================================================
{
  const { handler, deleted } = setup()
  const none = await read(await handler(request({})))
  const fake = await read(await handler(request({ token: 'token-inventato' })))
  const anonKey = await read(await handler(request({ token: 'sb_publishable_chiave-pubblica' })))
  const malformed = await read(await handler(request({ headers: { Authorization: 'Basic abc' } })))
  check('senza token: 401', none.status === 401 && none.body?.error === DELETE_ACCOUNT_ERRORS.unauthenticated)
  check('token non valido: 401', fake.status === 401)
  check('chiave pubblica usata come token: 401', anonKey.status === 401)
  check('header non Bearer: 401', malformed.status === 401)
  check('   nessuna cancellazione', deleted.length === 0)

  const throwing = createDeleteAccountHandler({ verifyUser: async () => { throw new Error('auth giù') }, deleteUser: async () => { throw new Error('non doveva') } })
  check('verifica che lancia: 401, nessuna cancellazione', (await throwing(request({ token: 'token-di-a' }))).status === 401)

  const get = await handler(request({ method: 'GET', token: 'token-di-a' }))
  check('GET: 405, nessuna cancellazione', get.status === 405 && deleted.length === 0)
  const options = await handler(request({ method: 'OPTIONS' }))
  check('OPTIONS (preflight CORS): 204', options.status === 204 && options.headers.get('Access-Control-Allow-Methods') === 'POST, OPTIONS')
}

// =====================================================================
section('Errori del server: mai un falso successo')
// =====================================================================
{
  const failing = setup({ deleteUser: async () => { throw new Error('auth_admin_500') } })
  const res = await read(await failing.handler(request({ token: 'token-di-a' })))
  check('cancellazione fallita: 502, niente deleted:true', res.status === 502 && res.body?.deleted !== true && res.body?.error === DELETE_ACCOUNT_ERRORS.deleteFailed)
  const notConfigured = setup({ deleteUser: null })
  const res2 = await read(await notConfigured.handler(request({ token: 'token-di-a' })))
  check('funzione senza service_role: 503, niente deleted:true', res2.status === 503 && res2.body?.deleted !== true)
}

// =====================================================================
section('Cancellazione via API admin di Supabase Auth')
// =====================================================================
{
  const calls = []
  const fetchOk = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  await createSupabaseUserDeleter({ supabaseUrl: 'https://progetto.supabase.co/', serviceKey: 'sb_secret_xyz', fetchImpl: fetchOk })(A)
  check('DELETE su /auth/v1/admin/users/<id del token>', calls[0]?.url === `https://progetto.supabase.co/auth/v1/admin/users/${A}` && calls[0]?.init.method === 'DELETE')
  check('   chiave segreta in apikey, nessun Authorization per le chiavi nuove', calls[0]?.init.headers.apikey === 'sb_secret_xyz' && !('Authorization' in calls[0].init.headers))
  await createSupabaseUserDeleter({ supabaseUrl: 'https://progetto.supabase.co', serviceKey: 'eyJlegacy', fetchImpl: fetchOk })(A)
  check('   chiave legacy JWT anche in Authorization', calls[1]?.init.headers.Authorization === 'Bearer eyJlegacy')
  const weird = []
  await createSupabaseUserDeleter({ supabaseUrl: 'https://p.supabase.co', serviceKey: 'k', fetchImpl: async (url) => { weird.push(url); return { ok: true } } })('../../altro?x=1')
  check('   l\'id è codificato nell\'URL (niente percorsi alternativi)', weird[0] === 'https://p.supabase.co/auth/v1/admin/users/..%2F..%2Faltro%3Fx%3D1')

  let threw = null
  try {
    await createSupabaseUserDeleter({ supabaseUrl: 'https://p.supabase.co', serviceKey: 'k', fetchImpl: async () => ({ ok: false, status: 500 }) })(A)
  } catch (error) { threw = error }
  check('risposta non ok: lancia (diventa 502, mai un successo)', threw?.message === 'auth_admin_500')
}

// =====================================================================
section('5–6. Database: ogni tabella di un utente si elimina a cascata (ai_usage compresa)')
// =====================================================================
{
  const sql = ['supabase/schema.sql', 'supabase/ai_usage.sql', 'supabase/privacy_consent.sql'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')
  const tables = {}
  for (const match of sql.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) tables[match[1]] = match[2]
  const expected = [...Object.values(SYNC_COLLECTIONS).map((c) => c.table), SETTINGS_TABLE, 'ai_usage', 'legal_acceptances'].sort()
  check('lo schema dichiara tutte e sole le tabelle note', JSON.stringify(Object.keys(tables).sort()) === JSON.stringify(expected), Object.keys(tables).sort().join(','))
  for (const name of expected) {
    const body = tables[name] ?? ''
    check(`   ${name}: references auth.users ... on delete cascade`, /references auth\.users\(id\) on delete cascade/.test(body))
  }
  check('ai_usage è inclusa', /references auth\.users\(id\) on delete cascade/.test(tables.ai_usage ?? ''))
  check('legal_acceptances (Termini e Privacy accettati) è inclusa', /references auth\.users\(id\) on delete cascade/.test(tables.legal_acceptances ?? ''))
  check('nessuna altra tabella pubblica con dati (niente orfani)', !/create table (if not exists )?public\.(?!(expenses|incomes|goals|goal_contributions|emergency_fund_contributions|custom_categories|profiles|ai_usage|legal_acceptances)\b)/.test(sql))
}

// =====================================================================
section('4. La service_role non è nel frontend')
// =====================================================================
{
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
  const frontend = walk(join(ROOT, 'src')).filter((p) => ['.js', '.jsx', '.ts', '.tsx'].includes(extname(p)) && !p.includes('.test.'))
  const code = frontend.map((p) => ({ p, text: readFileSync(p, 'utf8') }))
  const offenders = code.filter(({ text }) =>
    /import\.meta\.env\.\w*(SERVICE|SECRET)/i.test(text) || /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS/.test(text) || /sb_secret_[A-Za-z0-9]{8,}/.test(text))
  check('nessun file del frontend legge o contiene la service_role', offenders.length === 0, offenders.map((o) => o.p).join(','))
  check('   il client di eliminazione non manda nessun id', !/user_?id/i.test(readFileSync(join(ROOT, 'src/lib/accountDeletion.js'), 'utf8').replace(/\/\/.*$/gm, '')))

  const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local', '.env.example'].map((f) => join(ROOT, f)).filter(existsSync)
  const exposed = envFiles.filter((f) => /^VITE_\w*(SERVICE|SECRET)/m.test(readFileSync(f, 'utf8')))
  check('nessuna variabile VITE_* con service/secret nei file .env', exposed.length === 0, exposed.join(','))

  const dist = join(ROOT, 'dist/assets')
  if (existsSync(dist)) {
    const bundle = readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, f), 'utf8')).join('\n')
    const jwtRoles = [...bundle.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]+/g)].map((m) => {
      try { return JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role } catch { return null }
    })
    check('bundle (dist): nessuna chiave segreta né JWT service_role', !/sb_secret_[A-Za-z0-9]{8,}/.test(bundle) && !jwtRoles.includes('service_role'))
  } else {
    check('bundle (dist) non presente: controllo sul build saltato (resta quello sui sorgenti)', true)
  }
}

// =====================================================================
section('Richiesta dal client')
// =====================================================================
{
  const calls = []
  const client = (reply) => ({ functions: { invoke: async (name, options) => { calls.push({ name, options }); return typeof reply === 'function' ? reply() : reply } } })
  const ok = await requestAccountDeletion(client({ data: { deleted: true }, error: null }))
  check('risposta { deleted: true } → riuscita', ok.ok === true)
  check('   chiama delete-account in POST senza nessun id', calls[0]?.name === DELETE_ACCOUNT_FUNCTION && calls[0]?.options?.method === 'POST' && JSON.stringify(calls[0]?.options?.body) === '{}')
  const noFlag = await requestAccountDeletion(client({ data: { ok: true }, error: null }))
  check('risposta senza deleted:true → NON riuscita', noFlag.ok === false && noFlag.message === DELETE_ACCOUNT_MESSAGES.failed)
  const unauth = await requestAccountDeletion(client({ data: null, error: { name: 'FunctionsHttpError', context: { status: 401 } } }))
  check('401 → messaggio di sessione non valida', unauth.ok === false && unauth.message === DELETE_ACCOUNT_MESSAGES.unauthenticated)
  const server = await requestAccountDeletion(client({ data: null, error: { name: 'FunctionsHttpError', context: { status: 502 } } }))
  check('errore del server → non riuscita', server.ok === false && server.message === DELETE_ACCOUNT_MESSAGES.failed)
  const network = await requestAccountDeletion(client({ data: null, error: { name: 'FunctionsFetchError' } }))
  check('senza rete → messaggio offline', network.ok === false && network.message === DELETE_ACCOUNT_MESSAGES.offline)
  const thrown = await requestAccountDeletion(client(() => { throw new Error('boom') }))
  check('eccezione → non riuscita, nessun crash', thrown.ok === false)
  check('client senza functions → non riuscita', (await requestAccountDeletion(null)).ok === false)
}

report('Eliminazione account (server)')
