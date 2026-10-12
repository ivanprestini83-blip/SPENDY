// Il client Supabase VERO (@supabase/supabase-js e @supabase/auth-js installati),
// con fetch e storage controllati: nessuna credenziale, nessuna rete, nessuna
// chiamata al progetto. Il server finto risponde come Supabase Auth e PostgREST
// (forma HTTP delle risposte, codici di errore); qualunque altra richiesta fa
// fallire il test.
//
// Parte 1 — il comportamento della libreria su cui conta l'app, osservato
//   solo dalle API pubbliche (onAuthStateChange, getSession, getUser, signOut,
//   signInWithPassword): INITIAL_SESSION, SIGNED_OUT all'avvio e tra schede,
//   rete assente, getUser con token esplicito (user_not_found,
//   session_not_found). E la verifica dell'app (probeAccount) sulle STESSE
//   risposte: deve concordare con la lettura della libreria.
// Parte 2 — spendySync vero sopra il client vero, all'avvio dell'app.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createClient } from '@supabase/supabase-js'
import { check, section, report } from './testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import { LEGAL_VERSIONS } from '../../supabase/functions/_shared/legalVersions.js'
import { stateKey, scopeFor, GUEST } from '../store/scope.js'
import { ACCOUNT_DELETED, ACCOUNT_PRESENT, ACCOUNT_UNKNOWN, isRetryableAuthError, probeAccount } from './sessionGate.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 25; i += 1) await tick() }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// window e document finti: per auth-js è un browser (BroadcastChannel tra schede).
const map = new Map()
installFakeDom(map)
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })

const FAKE_URL = 'https://progetto-finto.supabase.invalid'
const FAKE_KEY = 'chiave-pubblica-finta'
const STORAGE_KEY = 'sb-progetto-finto-auth-token'

// --- JWT e sessioni nel formato di Supabase Auth -------------------------------
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const nowS = () => Math.floor(Date.now() / 1000)
const jwt = (sub, exp, sid = `sess-${sub}`) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp, session_id: sid, role: 'authenticated', aud: 'authenticated' })}.firma-finta`
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
const userOf = (id) => ({ id, aud: 'authenticated', role: 'authenticated', email: `${id}@esempio.invalid`, app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T10:00:00.000Z' })
const session = (id, { expiresIn = 3600 } = {}) => {
  const exp = nowS() + expiresIn
  return { access_token: jwt(id, exp), token_type: 'bearer', expires_in: expiresIn, expires_at: exp, refresh_token: `ref-${id}`, user: userOf(id) }
}

// --- il server finto ---------------------------------------------------------
const server = {
  users: new Set(),
  revokedSessions: new Set(),
  refresh: 'ok', // 'ok' | 'reject' | 'network'
  noLegalRow: new Set(), // utenti senza riga in legal_acceptances (account eliminato: cascata)
  userMode: 'normal', // 'normal' | 'network' | 'server-error'
  hold: null,
  requests: [],
}
const headersOut = { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' }
const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: headersOut })
const authError = (status, code, message) => json(status, { code, message })
const header = (init, name) => {
  const h = init?.headers
  if (!h) return null
  if (typeof h.get === 'function') return h.get(name)
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? h[key] : null
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const method = (init.method ?? 'GET').toUpperCase()
  server.requests.push(`${method} ${url.pathname}${url.search}`)
  if (url.origin !== FAKE_URL) throw new Error(`richiesta verso un indirizzo non previsto: ${url.origin}`)
  if (server.hold) await server.hold
  const bearer = String(header(init, 'Authorization') ?? '').replace(/^Bearer /, '')

  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    if (server.refresh === 'network') throw new TypeError('fetch failed')
    if (server.refresh === 'reject') return authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found')
    const { refresh_token: refreshToken } = JSON.parse(init.body)
    return json(200, session(refreshToken.replace(/^ref-/, '')))
  }
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const { email } = JSON.parse(init.body)
    return json(200, session(email.split('@')[0]))
  }
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 })
  if (url.pathname === '/auth/v1/user') {
    if (server.userMode === 'network') throw new TypeError('fetch failed')
    if (server.userMode === 'server-error') return authError(503, 'unexpected_failure', 'Service Unavailable')
    let claims
    try { claims = claimsOf(bearer) } catch { return authError(401, 'no_authorization', 'invalid token') }
    if (claims.exp <= nowS()) return authError(403, 'bad_jwt', 'invalid JWT: token is expired')
    // Come Supabase Auth: prima l'utente, poi la sessione.
    if (!server.users.has(claims.sub)) return authError(403, 'user_not_found', 'User from sub claim in JWT does not exist')
    if (server.revokedSessions.has(claims.session_id)) return authError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist')
    return json(200, userOf(claims.sub))
  }
  if (url.pathname === '/rest/v1/legal_acceptances') {
    const sub = (() => { try { return claimsOf(bearer).sub } catch { return null } })()
    if (server.noLegalRow.has(sub)) return json(200, [])
    return json(200, [{ terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy }])
  }
  throw new Error(`richiesta non prevista dal server finto: ${method} ${url.pathname}`)
}

// Uno storage per "dispositivo" (le schede dello stesso browser lo condividono).
const memoryStorage = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) }, _map: m }
}
const clients = []
const makeClient = (storage) => {
  const client = createClient(FAKE_URL, FAKE_KEY, {
    auth: { storage, storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  })
  clients.push(client)
  return client
}
const recorder = (client) => {
  const events = []
  const { data } = client.auth.onAuthStateChange((event, s) => { events.push({ event, userId: s?.user?.id ?? null }) })
  return { events, stop: () => data.subscription.unsubscribe() }
}
const probeConfig = { url: FAKE_URL, apiKey: FAKE_KEY, fetch: (...args) => globalThis.fetch(...args) }
const probe = (userId, token) => probeAccount(probeConfig, { userId, accessToken: token })

try {
  // =====================================================================
  section('INITIAL_SESSION: sessione salvata valida')
  // =====================================================================
  {
    server.users.add('u-a')
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(session('u-a')))
    const client = makeClient(storage)
    const rec = recorder(client)
    await settle()
    // La libreria emette SIGNED_IN (sessione ritrovata) e poi INITIAL_SESSION: l'app li tratta allo stesso modo.
    check('INITIAL_SESSION con la sessione di u-a (preceduto da SIGNED_IN)', rec.events.some((e) => e.event === 'INITIAL_SESSION' && e.userId === 'u-a') && rec.events.every((e) => e.userId === 'u-a'), JSON.stringify(rec.events))
    const { data, error } = await client.auth.getSession()
    check('   getSession la restituisce, senza errori', data.session?.user?.id === 'u-a' && !error)
    rec.stop()
  }

  // =====================================================================
  section('Avvio con sessione scaduta e rinnovo RIFIUTATO dal server')
  // =====================================================================
  {
    server.refresh = 'reject'
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(session('u-a', { expiresIn: -120 })))
    const client = createClient(FAKE_URL, FAKE_KEY, {
      auth: { storage, storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
    clients.push(client)
    // Registrato subito dopo la creazione, come fa spendySync al caricamento del modulo.
    const rec = recorder(client)
    await settle()
    const { data, error } = await client.auth.getSession()
    await client.auth.stopAutoRefresh()
    const kinds = rec.events.map((e) => e.event)
    check('la libreria emette SIGNED_OUT durante l\'inizializzazione (prova che la sessione è FINITA)', kinds.includes('SIGNED_OUT'), kinds.join(','))
    check('   poi getSession → nessuna sessione, senza errore ritentabile', !data.session && !isRetryableAuthError(error))
    check('   e la sessione salvata non c\'è più', storage.getItem(STORAGE_KEY) === null)
    rec.stop()
  }

  // =====================================================================
  section('Avvio OFFLINE con sessione scaduta: niente SIGNED_OUT, sessione conservata')
  // =====================================================================
  {
    server.refresh = 'network'
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(session('u-a', { expiresIn: -120 })))
    const client = createClient(FAKE_URL, FAKE_KEY, {
      auth: { storage, storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
    clients.push(client)
    const rec = recorder(client)
    await settle()
    const { data, error } = await client.auth.getSession()
    await client.auth.stopAutoRefresh()
    check('nessun SIGNED_OUT', !rec.events.some((e) => e.event === 'SIGNED_OUT'), rec.events.map((e) => e.event).join(','))
    check('   getSession → nessuna sessione CON errore ritentabile (la regola di avvio dell\'app)', !data.session && isRetryableAuthError(error), `${error?.name} ${error?.status}`)
    check('   la sessione salvata resta (si rinnova quando torna la rete)', storage.getItem(STORAGE_KEY) !== null)
    rec.stop()
    server.refresh = 'ok'
  }

  // =====================================================================
  section('getUser(jwt) della libreria e verifica dell\'app sulle stesse risposte')
  // =====================================================================
  {
    server.users.add('u-b')
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(session('u-b')))
    const client = makeClient(storage)
    const rec = recorder(client)
    await settle()
    const tokenA = jwt('u-gone', nowS() + 3600)

    // user_not_found
    const lib1 = await client.auth.getUser(tokenA)
    const app1 = await probe('u-gone', tokenA)
    check('user_not_found: la libreria → AuthApiError 403 con code "user_not_found"', lib1.error?.code === 'user_not_found' && lib1.error?.status === 403, `${lib1.error?.name} ${lib1.error?.status} ${lib1.error?.code}`)
    check('   l\'app → deleted (stessa lettura)', app1 === ACCOUNT_DELETED)
    check('   la sessione corrente (u-b) non è stata toccata', (await client.auth.getSession()).data.session?.user?.id === 'u-b')

    // utente presente
    check('utente presente: libreria → utente, app → present', (await client.auth.getUser(jwt('u-b', nowS() + 3600))).data.user?.id === 'u-b' && await probe('u-b', jwt('u-b', nowS() + 3600)) === ACCOUNT_PRESENT)

    // rete e 5xx
    server.userMode = 'network'
    const libNet = await client.auth.getUser(tokenA)
    check('rete assente: libreria → errore ritentabile, app → unknown', isRetryableAuthError(libNet.error) && await probe('u-gone', tokenA) === ACCOUNT_UNKNOWN)
    server.userMode = 'server-error'
    check('5xx: app → unknown', await probe('u-gone', tokenA) === ACCOUNT_UNKNOWN)
    server.userMode = 'normal'

    // token scaduto
    const expired = jwt('u-gone', nowS() - 60)
    check('token scaduto: libreria → bad_jwt, app → unknown (non chiede nemmeno)', (await client.auth.getUser(expired)).error?.code === 'bad_jwt' && await probe('u-gone', expired) === ACCOUNT_UNKNOWN)

    // session_not_found: QUI la libreria toglie la sessione corrente
    server.users.add('u-revocato')
    const tokenRevoked = jwt('u-revocato', nowS() + 3600, 'sessione-revocata')
    server.revokedSessions.add('sessione-revocata')
    check('session_not_found: l\'app → unknown e la sessione di u-b resta', await probe('u-revocato', tokenRevoked) === ACCOUNT_UNKNOWN && (await client.auth.getSession()).data.session?.user?.id === 'u-b')
    rec.events.length = 0
    const lib2 = await client.auth.getUser(tokenRevoked)
    await settle()
    const after = (await client.auth.getSession()).data.session
    check('   invece la libreria (getUser con token di un ALTRO) → AuthSessionMissingError…', lib2.error?.name === 'AuthSessionMissingError', lib2.error?.name)
    check('   …e chiude la sessione CORRENTE di u-b, con SIGNED_OUT: per questo l\'app non usa getUser', after === null && rec.events.some((e) => e.event === 'SIGNED_OUT'))
    rec.stop()
  }

  // =====================================================================
  section('SIGNED_OUT tra schede (stesso storage, BroadcastChannel)')
  // =====================================================================
  {
    server.users.add('u-c')
    const shared = memoryStorage()
    shared.setItem(STORAGE_KEY, JSON.stringify(session('u-c')))
    const tab1 = makeClient(shared)
    const tab2 = makeClient(shared)
    const rec2 = recorder(tab2)
    await settle()
    rec2.events.length = 0
    await tab1.auth.signOut({ scope: 'local' })
    await wait(50)
    await settle()
    check('logout nella scheda 1 → la scheda 2 riceve SIGNED_OUT', rec2.events.some((e) => e.event === 'SIGNED_OUT'), rec2.events.map((e) => e.event).join(','))
    rec2.stop()
  }

  // =====================================================================
  section('Cambio account mentre la verifica è in volo')
  // =====================================================================
  {
    server.users.add('u-d')
    server.users.add('u-e')
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(session('u-d')))
    const client = makeClient(storage)
    await settle()
    const tokenD = (await client.auth.getSession()).data.session.access_token
    server.revokedSessions.add('sess-u-d') // la sessione di u-d è stata revocata altrove
    let release
    server.hold = new Promise((resolve) => { release = resolve })
    const inFlight = probe('u-d', tokenD)
    await settle()
    server.hold = null
    const signIn = client.auth.signInWithPassword({ email: 'u-e@esempio.invalid', password: 'password-di-prova' })
    await settle()
    await signIn
    release()
    const verdict = await inFlight
    await settle()
    check('la verifica di u-d (sessione revocata) → unknown, niente da cancellare', verdict === ACCOUNT_UNKNOWN)
    check('   la sessione di u-e, entrato nel frattempo, è intatta', (await client.auth.getSession()).data.session?.user?.id === 'u-e')
  }

  // =====================================================================
  section('spendySync vero sopra il client vero, all\'avvio dell\'app')
  // =====================================================================
  {
    const ROOT = fileURLToPath(new URL('../..', import.meta.url))
    // lib/supabase.js VERO: URL e chiave finti come variabili d'ambiente di
    // questo test (envDir vuota: .env.local non viene letto).
    process.env.VITE_SUPABASE_URL = FAKE_URL
    process.env.VITE_SUPABASE_ANON_KEY = FAKE_KEY
    const ENV_DIR = join(tmpdir(), 'spendy-real-auth-test-env-vuota')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(ENV_DIR, { recursive: true })
    const STUBS = {
      './supabaseRemote.js': 'export const createSupabaseRemote = () => ({})',
      './syncEngine.js': 'export const createSyncEngine = () => ({ start: async () => ({}), stop() {}, syncNow: async () => ({}) })',
    }
    let vite = null
    let app = null
    const openApp = async () => {
      if (app) { app.cleanup(); await app.supabase.auth.stopAutoRefresh() }
      if (vite) await vite.close()
      vite = await createServer({
        root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
        cacheDir: join(tmpdir(), 'spendy-real-auth-test-vite'),
        envDir: ENV_DIR,
        server: { middlewareMode: true, hmr: false, watch: null },
        optimizeDeps: { noDiscovery: true, include: [] },
        plugins: [{
          name: 'real-auth-stubs',
          enforce: 'pre',
          resolveId(source, importer) {
            if (importer?.split('?')[0].endsWith('/src/sync/spendySync.js') && source in STUBS) return `\0real:${source}`
            return null
          },
          load: (id) => (id.startsWith('\0real:') ? STUBS[id.slice(6)] : null),
        }],
      })
      const { useAppStore } = await vite.ssrLoadModule('/src/store/useAppStore.js')
      const sync = await vite.ssrLoadModule('/src/sync/spendySync.js')
      const gate = await vite.ssrLoadModule('/src/sync/sessionGate.js')
      const legal = await vite.ssrLoadModule('/src/legal/legalGate.js')
      const legalStates = []
      legal.subscribeLegalGate(() => legalStates.push(legal.getLegalGateState()?.status ?? null))
      const { supabase, authStorageKey } = await vite.ssrLoadModule('/src/lib/supabase.js')
      if (authStorageKey !== STORAGE_KEY) throw new Error(`chiave di storage inattesa: ${authStorageKey}`)
      const cleanup = sync.bootstrapSync()
      await wait(30)
      await settle()
      app = { S: useAppStore.getState, sync, gate, supabase, cleanup, legalStates }
      return app
    }
    const seedAccount = (id, description) => {
      map.set(stateKey(scopeFor(id)), JSON.stringify({ state: { expenses: [{ id: `e-${id}`, amount: 9, categoryId: 'bar', description, date: '2026-10-01', updatedAt: '2026-10-01T10:00:00.000Z' }], sync: { userId: id, outbox: [], cursors: {} }, legalAcceptedVersion: `terms:${LEGAL_VERSIONS.terms}|privacy:${LEGAL_VERSIONS.privacy}` }, version: 0 }))
      map.set('spendy-active-scope', scopeFor(id))
    }

    {
      const plain = createClient(FAKE_URL, FAKE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
      clients.push(plain)
      check('la chiave di storage scelta dall\'app è IDENTICA a quella predefinita della libreria (nessuno viene disconnesso)', plain.auth.storageKey === STORAGE_KEY, plain.auth.storageKey)
    }

    // a) sessione valida, account esistente
    server.users.add('u-ok')
    seedAccount('u-ok', 'DATI-OK')
    map.set(STORAGE_KEY, JSON.stringify(session('u-ok')))
    let a = await openApp()
    check('sessione valida: ambito dell\'account, nessuna schermata, dati in memoria', a.S().scopeId === scopeFor('u-ok') && a.gate.getSessionGateState() === null && a.S().expenses.some((e) => e.description === 'DATI-OK'))

    // b) sessione salvata scaduta, rinnovo rifiutato → dati nascosti
    seedAccount('u-rifiutato', 'DATI-RIFIUTATO')
    map.set(STORAGE_KEY, JSON.stringify(session('u-rifiutato', { expiresIn: -120 })))
    server.refresh = 'reject'
    a = await openApp()
    check('rinnovo rifiutato all\'avvio: "Sessione terminata", contenitore intatto', a.gate.getSessionGateState()?.status === 'ended' && a.gate.getSessionGateState().userId === 'u-rifiutato' && map.get(stateKey(scopeFor('u-rifiutato')))?.includes('DATI-RIFIUTATO'))

    // c) offline con sessione scaduta → niente blocco
    seedAccount('u-offline', 'DATI-OFFLINE')
    map.set(STORAGE_KEY, JSON.stringify(session('u-offline', { expiresIn: -120 })))
    server.refresh = 'network'
    a = await openApp()
    check('offline all\'avvio: nessuna schermata, dati utilizzabili', a.gate.getSessionGateState() === null && a.S().scopeId === scopeFor('u-offline') && a.S().expenses.some((e) => e.description === 'DATI-OFFLINE'))
    check('   e la sessione salvata resta', map.get(STORAGE_KEY) !== undefined)
    server.refresh = 'ok'

    // d) sessione valida di un account eliminato nel frattempo → pulizia all'avvio
    seedAccount('u-eliminato', 'DATI-ELIMINATO')
    map.set(STORAGE_KEY, JSON.stringify(session('u-eliminato')))
    a = await openApp()
    const g = a.gate.getSessionGateState()
    check('account eliminato (token valido): "Account eliminato", contenitore rimosso', g?.status === 'deleted' && g.removed === true && !map.has(stateKey(scopeFor('u-eliminato'))), JSON.stringify(g))
    check('   ambito guest e sessione chiusa su questo dispositivo', a.S().scopeId === GUEST && (await a.supabase.auth.getSession()).data.session === null)
    check('   contenitori degli altri account intatti', map.get(stateKey(scopeFor('u-ok')))?.includes('DATI-OK') && map.get(stateKey(scopeFor('u-rifiutato')))?.includes('DATI-RIFIUTATO'))

    // e) come nel test reale: account eliminato, riga dei Termini sparita (cascata),
    //    accettazione già salvata sul dispositivo → controllo dei Termini in background
    seedAccount('u-eliminato-termini', 'DATI-ELIMINATO-TERMINI')
    map.set(STORAGE_KEY, JSON.stringify(session('u-eliminato-termini')))
    server.noLegalRow.add('u-eliminato-termini')
    a = await openApp()
    const ge = a.gate.getSessionGateState()
    check('account eliminato e Termini spariti: "Account eliminato", mai la schermata dei Termini', ge?.status === 'deleted' && !a.legalStates.includes('required'), `${JSON.stringify(ge)} ${a.legalStates.join(',')}`)
    check('   avviso salvato senza identificativi', typeof map.get('spendy-account-deleted-notice') === 'string' && !map.get('spendy-account-deleted-notice').includes('u-eliminato-termini'))

    app.cleanup()
    await app.supabase.auth.stopAutoRefresh()
    await vite.close()
  }

  // (PUT /auth/v1/user è il salvataggio della lingua dell'account: legittimo.)
  check('nessuna richiesta fuori dal server finto', server.requests.length > 0 && server.requests.every((r) => /^(GET|POST|PUT|DELETE|PATCH|HEAD) \//.test(r)), server.requests.filter((r) => !/^(GET|POST|PUT|DELETE|PATCH|HEAD) \//.test(r)).join(','))
} finally {
  for (const client of clients) await client.auth.stopAutoRefresh().catch(() => {})
}

report('Client Supabase reale (auth-js installato)')
