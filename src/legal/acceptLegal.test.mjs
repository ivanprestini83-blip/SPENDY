// Accettazione di Termini e Privacy per gli account esistenti — lato server
// (Edge Function accept-legal), regola di confronto e richiesta dall'app.
// `npm test`, senza rete e senza Supabase: nessun account reale toccato.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, section, report } from '../sync/testkit.mjs'
import { createAcceptLegalHandler, ACCEPT_LEGAL_ERRORS } from '../../supabase/functions/accept-legal/handler.js'
import { createSupabaseLegalAcceptanceWriter } from '../../supabase/functions/accept-legal/store.js'
import { LEGAL_VERSIONS } from '../../supabase/functions/_shared/legalVersions.js'
import { LEGAL_DOCUMENTS } from './legal.js'
import { needsAcceptance, requestLegalAcceptance, currentLegalVersionKey, ACCEPT_LEGAL_FUNCTION, LEGAL_GATE_MESSAGES } from './legalGate.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const A = 'utente-a-0001'
const B = 'utente-b-0002'
const SERVER_NOW = Date.parse('2026-10-06T09:00:00.000Z')
const TOKENS = { 'token-di-a': { id: A, emailConfirmed: true }, 'token-di-b': { id: B, emailConfirmed: false } }
const current = { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy }

function setup({ recordAcceptance } = {}) {
  const recorded = []
  const logs = []
  const handler = createAcceptLegalHandler({
    verifyUser: async (token) => TOKENS[token] ?? null,
    recordAcceptance: recordAcceptance === undefined ? async (entry) => { recorded.push(entry) } : recordAcceptance,
    currentVersions: LEGAL_VERSIONS,
    now: () => SERVER_NOW,
    log: (entry) => logs.push(entry),
  })
  return { handler, recorded, logs }
}

const request = ({ method = 'POST', token, body = current, url = 'https://x.supabase.co/functions/v1/accept-legal', headers = {} } = {}) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(method === 'GET' || method === 'OPTIONS' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
const read = async (response) => ({ status: response.status, body: await response.json().catch(() => null) })

// =====================================================================
section('Una sola versione corrente, per app e server')
// =====================================================================
{
  check('legal.js usa le versioni del modulo condiviso', LEGAL_DOCUMENTS.terms.version === LEGAL_VERSIONS.terms && LEGAL_DOCUMENTS.privacy.version === LEGAL_VERSIONS.privacy)
  check('   versione corrente 2026-10-06', LEGAL_VERSIONS.terms === '2026-10-06' && LEGAL_VERSIONS.privacy === '2026-10-06')
  check('   immutabili', Object.isFrozen(LEGAL_VERSIONS))
  const index = readFileSync(join(ROOT, 'supabase/functions/accept-legal/index.ts'), 'utf8')
  check('la funzione deployata usa le stesse versioni (_shared/legalVersions.js)', /currentVersions: LEGAL_VERSIONS/.test(index) && /from '\.\.\/_shared\/legalVersions\.js'/.test(index))
  check('   e lo stesso verificatore dell\'utente di spendy-ai', /createSupabaseUserVerifier/.test(index) && /from '\.\.\/spendy-ai\/auth\.js'/.test(index))
  check('nessuna versione scritta a mano nell\'app o nella funzione', !/2026-10-06/.test(readFileSync(join(ROOT, 'src/legal/legal.js'), 'utf8'))
    && !/2026-10-06/.test(readFileSync(join(ROOT, 'supabase/functions/accept-legal/handler.js'), 'utf8')))
}

// =====================================================================
section('needsAcceptance: confronto esatto con la versione corrente')
// =====================================================================
{
  check('nessuna riga → da accettare', needsAcceptance(null) === true && needsAcceptance(undefined) === true)
  check('vecchia bozza → da accettare', needsAcceptance({ terms_version: 'bozza-2026-10-05', privacy_version: 'bozza-2026-10-05' }) === true)
  check('solo i Termini aggiornati → da accettare', needsAcceptance({ terms_version: LEGAL_VERSIONS.terms, privacy_version: 'bozza-2026-10-05' }) === true)
  check('solo la Privacy aggiornata → da accettare', needsAcceptance({ terms_version: '2025-01-01', privacy_version: LEGAL_VERSIONS.privacy }) === true)
  check('versione "successiva" o diversa → da accettare (niente confronti maggiore/minore)', needsAcceptance({ terms_version: '2099-01-01', privacy_version: '2099-01-01' }) === true)
  check('entrambe correnti → niente da accettare', needsAcceptance(current) === false)
  check('chiave locale con le due versioni', currentLegalVersionKey() === `terms:${LEGAL_VERSIONS.terms}|privacy:${LEGAL_VERSIONS.privacy}`)
}

// =====================================================================
section('accept-legal: utente autenticato, orario del server')
// =====================================================================
{
  const { handler, recorded, logs } = setup()
  const res = await read(await handler(request({ token: 'token-di-a' })))
  check('200 { accepted: true } con le versioni correnti', res.status === 200 && res.body?.accepted === true
    && res.body?.terms_version === LEGAL_VERSIONS.terms && res.body?.privacy_version === LEGAL_VERSIONS.privacy, JSON.stringify(res))
  check('   registrato per l\'utente del token, con le versioni correnti', recorded.length === 1 && recorded[0].userId === A
    && recorded[0].termsVersion === LEGAL_VERSIONS.terms && recorded[0].privacyVersion === LEGAL_VERSIONS.privacy)
  check('   data e ora del SERVER della funzione', recorded[0]?.at === new Date(SERVER_NOW).toISOString() && res.body?.accepted_at === recorded[0]?.at)
  const withClientTime = setup()
  await withClientTime.handler(request({ token: 'token-di-a', body: { ...current, terms_accepted_at: '1999-01-01T00:00:00.000Z', at: '1999-01-01' } }))
  check('   un orario mandato dal client viene ignorato', withClientTime.recorded[0]?.at === new Date(SERVER_NOW).toISOString())
  check('   nei log solo l\'esito', logs.some((l) => l.outcome === 'accepted') && !JSON.stringify(logs).includes(A))
  const unconfirmed = setup()
  check('anche con email non confermata (account già esistente)', (await unconfirmed.handler(request({ token: 'token-di-b' }))).status === 200 && unconfirmed.recorded[0]?.userId === B)
}

// =====================================================================
section('accept-legal: user_id solo dal token')
// =====================================================================
{
  const { handler, recorded } = setup()
  await handler(request({ token: 'token-di-a', body: { ...current, user_id: B, userId: B } }))
  await handler(request({ token: 'token-di-a', url: `https://x.supabase.co/functions/v1/accept-legal?user_id=${B}` }))
  await handler(request({ token: 'token-di-a', headers: { 'x-user-id': B } }))
  check('user_id di B nel corpo, nella query o negli header: registrato solo A', recorded.length === 3 && recorded.every((r) => r.userId === A))
}

// =====================================================================
section('accept-legal: rifiuti, mai un falso successo')
// =====================================================================
{
  const { handler, recorded } = setup()
  check('senza token: 401', (await handler(request({}))).status === 401)
  check('token non valido: 401', (await handler(request({ token: 'inventato' }))).status === 401)
  check('chiave pubblica come token: 401', (await handler(request({ token: 'sb_publishable_x' }))).status === 401)
  const old = await read(await handler(request({ token: 'token-di-a', body: { terms_version: 'bozza-2026-10-05', privacy_version: 'bozza-2026-10-05' } })))
  check('versione vecchia: 400 version_mismatch', old.status === 400 && old.body?.error === ACCEPT_LEGAL_ERRORS.versionMismatch)
  check('solo una versione corrente: 400', (await handler(request({ token: 'token-di-a', body: { terms_version: LEGAL_VERSIONS.terms, privacy_version: 'x' } }))).status === 400)
  check('versioni mancanti: 400', (await handler(request({ token: 'token-di-a', body: {} }))).status === 400)
  check('corpo non JSON: 400', (await handler(request({ token: 'token-di-a', body: '{ non json' }))).status === 400)
  check('corpo troppo grande: 413', (await handler(request({ token: 'token-di-a', body: { ...current, pad: 'x'.repeat(2000) } }))).status === 413)
  check('GET: 405', (await handler(request({ method: 'GET', token: 'token-di-a' }))).status === 405)
  check('OPTIONS (preflight): 204', (await handler(request({ method: 'OPTIONS' }))).status === 204)
  check('   in nessuno di questi casi viene registrato qualcosa', recorded.length === 0)

  const failing = setup({ recordAcceptance: async () => { throw new Error('legal_acceptances_500') } })
  const res = await read(await failing.handler(request({ token: 'token-di-a' })))
  check('database che fallisce: 502, niente accepted:true', res.status === 502 && res.body?.accepted !== true && res.body?.error === ACCEPT_LEGAL_ERRORS.recordFailed)
  const notConfigured = setup({ recordAcceptance: null })
  const res2 = await read(await notConfigured.handler(request({ token: 'token-di-a' })))
  check('funzione senza chiave di servizio: 503, niente accepted:true', res2.status === 503 && res2.body?.accepted !== true)
}

// =====================================================================
section('Scrittura in legal_acceptances (chiave di servizio, upsert)')
// =====================================================================
{
  const calls = []
  const ok = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201 } }
  const at = new Date(SERVER_NOW).toISOString()
  await createSupabaseLegalAcceptanceWriter({ supabaseUrl: 'https://p.supabase.co/', serviceKey: 'sb_secret_x', fetchImpl: ok })({ userId: A, termsVersion: 'T', privacyVersion: 'P', at })
  const body = JSON.parse(calls[0]?.init.body ?? '[]')[0] ?? {}
  check('POST su legal_acceptances con upsert sulla chiave user_id', calls[0]?.url === 'https://p.supabase.co/rest/v1/legal_acceptances?on_conflict=user_id'
    && calls[0]?.init.method === 'POST' && /resolution=merge-duplicates/.test(calls[0]?.init.headers.Prefer))
  check('   una riga per l\'utente, versioni e date del server', body.user_id === A && body.terms_version === 'T' && body.privacy_version === 'P'
    && body.terms_accepted_at === at && body.privacy_acknowledged_at === at)
  check('   nessun orario "del dispositivo"', body.client_terms_accepted_at === null && body.client_privacy_acknowledged_at === null)
  check('   chiave segreta in apikey, Authorization solo per le chiavi JWT', calls[0]?.init.headers.apikey === 'sb_secret_x' && !('Authorization' in calls[0].init.headers))
  let threw = null
  try {
    await createSupabaseLegalAcceptanceWriter({ supabaseUrl: 'https://p.supabase.co', serviceKey: 'k', fetchImpl: async () => ({ ok: false, status: 500 }) })({ userId: A, termsVersion: 'T', privacyVersion: 'P', at })
  } catch (error) { threw = error }
  check('risposta non ok: lancia (diventa 502)', threw?.message === 'legal_acceptances_500')
}

// =====================================================================
section('Richiesta dall\'app: successo solo con conferma esplicita')
// =====================================================================
{
  const calls = []
  const client = (reply) => ({ functions: { invoke: async (name, options) => { calls.push({ name, options }); return typeof reply === 'function' ? reply() : reply } } })
  const ok = await requestLegalAcceptance(client({ data: { accepted: true, ...current }, error: null }))
  check('{ accepted: true } con le versioni correnti → riuscita', ok.ok === true)
  check('   chiama accept-legal in POST con le versioni correnti e nessun id', calls[0]?.name === ACCEPT_LEGAL_FUNCTION && calls[0]?.options.method === 'POST'
    && JSON.stringify(calls[0]?.options.body) === JSON.stringify(current))
  check('accepted senza le versioni giuste → NON riuscita', (await requestLegalAcceptance(client({ data: { accepted: true, terms_version: 'x', privacy_version: 'y' }, error: null }))).ok === false)
  check('risposta senza accepted → NON riuscita', (await requestLegalAcceptance(client({ data: { ok: true }, error: null }))).ok === false)
  check('401 → sessione non valida', (await requestLegalAcceptance(client({ data: null, error: { name: 'FunctionsHttpError', context: { status: 401 } } }))).message === LEGAL_GATE_MESSAGES.unauthenticated)
  check('errore del server → messaggio di errore', (await requestLegalAcceptance(client({ data: null, error: { name: 'FunctionsHttpError', context: { status: 502 } } }))).message === LEGAL_GATE_MESSAGES.failed)
  check('senza rete → messaggio offline', (await requestLegalAcceptance(client({ data: null, error: { name: 'FunctionsFetchError' } }))).message === LEGAL_GATE_MESSAGES.offline)
  check('eccezione → non riuscita, nessun crash', (await requestLegalAcceptance(client(() => { throw new Error('boom') }))).ok === false)
  check('client assente → non riuscita', (await requestLegalAcceptance(null)).ok === false)
}

report('Accettazione documenti (server)')
