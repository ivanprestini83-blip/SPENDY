// Account eliminato da un ALTRO dispositivo: cosa succede ai dati locali qui.
//
// spendySync vero, store vero, App vera; un localStorage finto in cui convivono
// guest, vecchio storage, altri account e chiavi di altre app. Il client
// Supabase è finto ma risponde come quello vero (nessuna rete, nessun account
// reale): getUser(jwt) come Supabase Auth (`user_not_found` se l'utente non
// esiste più, `bad_jwt` se il token è scaduto…), e un SIGNED_OUT "dal server"
// come quando la libreria si vede rifiutare il rinnovo della sessione.
// L'altro dispositivo è il server stesso: eliminare un account qui vuol dire
// fare ciò che fa la Edge Function delete-account (utente tolto da Auth).
// Ogni "riavvio" è una nuova istanza dell'app (nuovo Vite) sullo STESSO storage.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report, italianDevice } from './testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import { LEGAL_VERSIONS } from '../../supabase/functions/_shared/legalVersions.js'
import { stateKey, voiceKey, scopeFor, GUEST, LEGACY_STATE_KEY, GUEST_CLAIM_KEY, ACTIVE_SCOPE_KEY } from '../store/scope.js'
import { SESSION_ENDED_KEY } from './sessionGate.js'

const A = 'utente-a-due-dispositivi'
const C = 'utente-c-altro-account'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 16; i += 1) await tick() }

// --- il dispositivo B: guest, vecchio storage, un altro account (C), altre app ---
const map = italianDevice(new Map())
const containerOf = (description, userId = null) => JSON.stringify({
  state: {
    expenses: [{ id: `e-${description}`, amount: 10, categoryId: 'bar', description, date: '2026-10-01', updatedAt: '2026-10-01T10:00:00.000Z' }],
    sync: { userId, outbox: [], cursors: {} },
  },
  version: 0,
})
const UNTOUCHABLE = {
  [stateKey(GUEST)]: containerOf('DATI-GUEST'),
  [LEGACY_STATE_KEY]: containerOf('VECCHIO-STORAGE'),
  [stateKey(scopeFor(C))]: containerOf('DATI-DI-C', C),
  [voiceKey(scopeFor(C))]: '{"version":1,"history":[{"message":"frase di C"}]}',
  'chiave-di-un-altra-app': 'non toccare',
}
for (const [key, value] of Object.entries(UNTOUCHABLE)) map.set(key, value)
// C è stato il primo account del dispositivo: i dati guest restano guest.
map.set(GUEST_CLAIM_KEY, C)
const dom = installFakeDom(map)
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
// Guest e C vengono usati nel test (accesso, logout): lo store li riscrive
// come sempre. "Intatti" vuol dire: ancora lì, con i loro dati. Vecchio
// storage e chiavi di altre app l'app non li scrive mai: identici.
const untouched = () => map.get(stateKey(GUEST))?.includes('DATI-GUEST')
  && map.get(stateKey(scopeFor(C)))?.includes('DATI-DI-C') && map.has(voiceKey(scopeFor(C)))
  && map.get(LEGACY_STATE_KEY) === UNTOUCHABLE[LEGACY_STATE_KEY] && map.get('chiave-di-un-altra-app') === 'non toccare'

// Il documento finto ignora gli eventi: qui servono quelli di visibilità.
const docListeners = new Map()
dom.document.addEventListener = (type, fn) => docListeners.set(type, [...(docListeners.get(type) ?? []), fn])
dom.document.removeEventListener = (type, fn) => docListeners.set(type, (docListeners.get(type) ?? []).filter((f) => f !== fn))
const backToForeground = async () => {
  dom.document.visibilityState = 'visible'
  for (const fn of docListeners.get('visibilitychange') ?? []) fn()
  await settle()
}

// Orologio spostabile (la verifica in primo piano è al massimo ogni 5 minuti).
const realNow = Date.now
let clockShift = 0
Date.now = () => realNow() + clockShift
const laterBy = (minutes) => { clockShift += minutes * 60 * 1000 }

const setOnline = (value) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: value }, configurable: true, writable: true })

// --- JWT finti (firma finta: la verifica la farebbe il server) --------------
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (sub, exp) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp, role: 'authenticated' })}.firma-finta`
const inOneHour = () => Math.floor(Date.now() / 1000) + 3600
const alreadyExpired = () => Math.floor(Date.now() / 1000) - 60

// --- Supabase finto, condiviso tra i "riavvii" ------------------------------
const cloud = {
  users: new Set([A, C]),
  current: null,
  listeners: [],
  mode: 'normal',
  getUserCalls: [],
  signOutCalls: [],
  engine: { starts: [], stops: 0, running: null },
  startup: null, // come risponde getSession all'avvio (null = sessione salvata, se c'è)
  emit: async (event, session) => { for (const cb of [...cloud.listeners]) await cb(event, session) },
  session: (id, { exp = inOneHour(), sub = id } = {}) => ({ access_token: jwt(sub, exp), refresh_token: `ref-${id}`, user: { id } }),
  login: async (id, options) => { cloud.current = cloud.session(id, options); await cloud.emit('SIGNED_IN', cloud.current); await settle() },
  // Il server rifiuta il rinnovo della sessione: la libreria la toglie ed
  // emette SIGNED_OUT. NON è un logout fatto da qui.
  serverEndsSession: async () => { cloud.current = null; await cloud.emit('SIGNED_OUT', null); await settle() },
  // Quello che fa la Edge Function delete-account (chiamata dall'altro dispositivo).
  deleteOnServer: (id) => { cloud.users.delete(id) },
}
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
cloud.supabase = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy }, error: null }) }) }) }),
  auth: {
    async getSession() {
      if (cloud.startup) {
        const startup = cloud.startup
        cloud.startup = null
        return startup()
      }
      return { data: { session: cloud.current }, error: null }
    },
    onAuthStateChange: (cb) => {
      cloud.listeners.push(cb)
      return { data: { subscription: { unsubscribe() { cloud.listeners = cloud.listeners.filter((other) => other !== cb) } } } }
    },
    // Nessun getUser: la verifica dell'app NON passa dal client Auth (vedi
    // sessionGate.probeAccount), ma dall'endpoint HTTP qui sotto.
    getUser: async () => { throw new Error('getUser non deve essere usato dalla verifica') },
    async signOut(options) {
      cloud.signOutCalls.push(options)
      cloud.current = null
      await cloud.emit('SIGNED_OUT', null)
      return { error: null }
    },
  },
}
globalThis.__cloud = cloud

// --- Supabase Auth finto via HTTP: GET /auth/v1/user, come il server vero ---
const FAKE_URL = 'https://progetto-finto.supabase.invalid'
const FAKE_KEY = 'chiave-pubblica-finta'
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' } })
globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  if (!url.startsWith(`${FAKE_URL}/auth/v1/user`)) throw new Error(`richiesta inattesa: ${url}`)
  if (init.headers?.apikey !== FAKE_KEY) return json(401, { code: 'no_api_key', message: 'No API key found in request' })
  const token = String(init.headers?.Authorization ?? '').replace(/^Bearer /, '')
  cloud.getUserCalls.push(token)
  if (cloud.mode === 'network' || cloud.mode === 'throw') throw new TypeError('Failed to fetch')
  if (cloud.mode === 'server-error') return json(503, { code: 'unexpected_failure', message: 'Service Unavailable' })
  if (cloud.mode === 'unauthorized') return json(401, { code: 'no_authorization', message: 'This endpoint requires a valid Bearer token' })
  if (cloud.mode === 'session-missing') return json(403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' })
  if (cloud.mode === 'odd-status') return json(500, { code: 'user_not_found', message: '?' })
  if (cloud.mode === 'not-json') return new Response('<html>gateway</html>', { status: 403 })
  const claims = claimsOf(token)
  if (claims.exp * 1000 <= Date.now()) return json(403, { code: 'bad_jwt', message: 'invalid JWT: token is expired' })
  if (!cloud.users.has(claims.sub)) {
    // Formato vecchio degli errori (senza intestazione di versione): { code: 403, error_code }
    if (cloud.mode === 'legacy-format') return new Response(JSON.stringify({ code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }), { status: 403 })
    return json(403, { code: 'user_not_found', message: 'User from sub claim in JWT does not exist' })
  }
  return json(200, { id: claims.sub, aud: 'authenticated', role: 'authenticated' })
}
const probeConfig = { url: FAKE_URL, apiKey: FAKE_KEY, fetch: (...args) => globalThis.fetch(...args) }

const STUBS = {
  './supabaseRemote.js': 'export const createSupabaseRemote = () => ({})',
  './syncEngine.js': `
    export const createSyncEngine = () => {
      const e = globalThis.__cloud.engine
      return {
        start: (userId) => { e.starts.push(userId); e.running = userId; return Promise.resolve({}) },
        stop: () => { e.stops += 1; e.running = null },
        syncNow: async () => ({}),
      }
    }`,
}
const SUPABASE_STUB = `
  export const isSupabaseConfigured = true
  export const supabaseUrl = '${FAKE_URL}'
  export const supabaseAnonKey = '${FAKE_KEY}'
  export const supabase = globalThis.__cloud.supabase`
const harness = {
  name: 'session-gate-stubs',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source.endsWith('/lib/supabase.js')) return '\0stub:supabase'
    if (importer && importer.split('?')[0].endsWith('/src/sync/spendySync.js') && source in STUBS) return `\0stub:${source}`
    return null
  },
  load(id) {
    if (id === '\0stub:supabase') return SUPABASE_STUB
    if (id.startsWith('\0stub:')) return STUBS[id.slice(6)]
    if (id.split('?')[0].endsWith('.css')) return 'export default {}'
    return null
  },
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
let server = null
let root = null
let container = null
const errors = []
const act = async (fn) => { flushSync(fn); await settle() }
// Ciò che l'utente vede adesso.
const screen = () => dom.toHtml(container)
const shown = () => screen().includes('app-shell')
// Un'apertura dell'app: istanza nuova di tutti i moduli, stesso storage, App
// vera montata (è lei ad avviare il sync, come in produzione).
async function closeApp() {
  if (root) await act(() => root.unmount())
  root = null
  if (server) await server.close()
  server = null
}
async function openApp() {
  await closeApp()
  cloud.listeners.length = 0 // l'app precedente è chiusa: non ascolta più niente
  server = await createServer({
    root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
    cacheDir: join(tmpdir(), 'spendy-session-gate-test-vite'),
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [harness, react()],
  })
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const sync = await server.ssrLoadModule('/src/sync/spendySync.js')
  const gate = await server.ssrLoadModule('/src/sync/sessionGate.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  container = dom.createContainer()
  root = createRoot(container, { onCaughtError: (e) => errors.push(e), onUncaughtError: (e) => errors.push(e), onRecoverableError: () => {} })
  await act(() => root.render(h(App)))
  await settle()
  return { S: useAppStore.getState, sync, gate }
}

const has = (S, text) => S().expenses.some((e) => e.description === text)
// Un obiettivo per account: il suo nome è a schermo nella Home.
const addGoal = (S, label) => S().addGoal({ emoji: '🎯', label, target: 1000, etaMonths: 5 })
const keysOf = (id) => [...map.keys()].filter((key) => key.includes(scopeFor(id)) || key.includes(`u-${id}`))

try {
  setOnline(true)

  // =====================================================================
  section('Verifica senza effetti: probeAccount (la sola prova accettata)')
  // =====================================================================
  {
    const probe = (await import('./sessionGate.js')).probeAccount
    const run = async (mode, { userId = 'p1', token = jwt('p1', inOneHour()) } = {}) => {
      cloud.mode = mode
      const result = await probe(probeConfig, { userId, accessToken: token })
      cloud.mode = 'normal'
      return result
    }
    cloud.users.add('p1')
    check('utente presente → present', await run('normal') === 'present')
    cloud.users.delete('p1')
    check('user_not_found (403) con token valido di quell\'id → deleted', await run('normal') === 'deleted')
    const before = cloud.getUserCalls.length
    check('token di un ALTRO id → unknown, senza nemmeno chiedere', await run('normal', { token: jwt('qualcun-altro', inOneHour()) }) === 'unknown' && cloud.getUserCalls.length === before)
    check('token scaduto → unknown, senza chiedere', await run('normal', { token: jwt('p1', alreadyExpired()) }) === 'unknown' && cloud.getUserCalls.length === before)
    check('token non JWT → unknown', await run('normal', { token: 'tok-p1' }) === 'unknown')
    check('rete assente → unknown', await run('network') === 'unknown')
    check('eccezione di rete → unknown', await run('throw') === 'unknown')
    check('5xx → unknown', await run('server-error') === 'unknown')
    check('401 → unknown', await run('unauthorized') === 'unknown')
    check('sessione revocata (session_not_found) → unknown', await run('session-missing') === 'unknown')
    check('user_not_found con uno status inatteso → unknown', await run('odd-status') === 'unknown')
    check('user_not_found nel formato vecchio degli errori (error_code) → deleted', await run('legacy-format') === 'deleted')
    check('risposta 403 non JSON (proxy, gateway) → unknown', await run('not-json') === 'unknown')
    check('configurazione senza fetch o senza chiave → unknown', await probe({ url: FAKE_URL, apiKey: FAKE_KEY }, { userId: 'p1', accessToken: jwt('p1', inOneHour()) }) === 'unknown'
      && await probe({ url: FAKE_URL, fetch: probeConfig.fetch }, { userId: 'p1', accessToken: jwt('p1', inOneHour()) }) === 'unknown')
  }

  // =====================================================================
  section('Avvio con la sessione di A (dispositivo B): verifica, nessun effetto')
  // =====================================================================
  cloud.current = cloud.session(A)
  const callsBeforeStart = cloud.getUserCalls.length
  let app = await openApp()
  let { S, sync, gate } = app
  check('ambito di A, motore acceso, nessuna schermata', S().scopeId === scopeFor(A) && cloud.engine.running === A && gate.getSessionGateState() === null)
  check('   Auth interrogato una volta con il token di A', cloud.getUserCalls.length === callsBeforeStart + 1 && claimsOf(cloud.getUserCalls.at(-1)).sub === A, cloud.getUserCalls.length - callsBeforeStart)
  await act(() => { S().addExpense({ amount: 42, categoryId: 'spesa', description: 'SEGRETO-A', date: S().today }); addGoal(S, 'OBIETTIVO-A') })
  map.set(voiceKey(scopeFor(A)), '{"version":1,"history":[{"message":"frase di A"}]}')
  const pendingA = S().sync.outbox.length
  check('   dati di A nel contenitore, modifiche in coda, a schermo', map.get(stateKey(scopeFor(A)))?.includes('SEGRETO-A') && pendingA >= 1 && shown() && screen().includes('OBIETTIVO-A') && errors.length === 0, errors[0]?.message)

  // =====================================================================
  section('Errore di rete / 5xx in primo piano: nessuna cancellazione, nessun blocco')
  // =====================================================================
  for (const mode of ['network', 'throw', 'server-error']) {
    cloud.mode = mode
    laterBy(6)
    const calls = cloud.getUserCalls.length
    await backToForeground()
    cloud.mode = 'normal'
    check(`${mode}: verifica tentata, dati di A intatti e a schermo`, cloud.getUserCalls.length === calls + 1 && S().scopeId === scopeFor(A) && has(S, 'SEGRETO-A') && gate.getSessionGateState() === null && map.get(stateKey(scopeFor(A))).includes('SEGRETO-A') && screen().includes('OBIETTIVO-A'))
  }
  {
    const calls = cloud.getUserCalls.length
    await backToForeground()
    check('   entro 5 minuti nessuna nuova verifica', cloud.getUserCalls.length === calls)
  }

  // =====================================================================
  section('Errore 401 / sessione revocata in primo piano (ambigui): nessuna cancellazione')
  // =====================================================================
  for (const mode of ['unauthorized', 'session-missing']) {
    cloud.mode = mode
    laterBy(6)
    await backToForeground()
    cloud.mode = 'normal'
    check(`${mode}: dati di A intatti`, S().scopeId === scopeFor(A) && has(S, 'SEGRETO-A') && map.get(stateKey(scopeFor(A))).includes('SEGRETO-A') && gate.getSessionGateState()?.status !== 'deleted')
  }

  // =====================================================================
  section('Sessione revocata dal server (cambio password, uscita altrove): dati nascosti, NON cancellati')
  // =====================================================================
  await cloud.serverEndsSession()
  let g = gate.getSessionGateState()
  check('schermata "sessione terminata" per A', g?.status === 'ended' && g.userId === A, JSON.stringify(g))
  check('   motore spento', cloud.engine.running === null)
  check('   Auth ha risposto che A esiste: niente cancellazione', S().scopeId === scopeFor(A) && map.get(stateKey(scopeFor(A))).includes('SEGRETO-A') && map.has(voiceKey(scopeFor(A))))
  check('   coda di A intatta (modifiche mai sincronizzate)', S().sync.outbox.length === pendingA)
  check('   marcatore sul dispositivo per il riavvio', map.get(SESSION_ENDED_KEY) === scopeFor(A))
  check('   a schermo nessun dato di A: solo la schermata "sessione terminata"', !shown() && !screen().includes('OBIETTIVO-A') && screen().includes('Sessione terminata') && screen().includes('Continua senza account'))
  check('   con l\'accesso per rientrare e l\'avviso sulle modifiche se si rimuove', screen().includes('autoComplete="current-password"') && screen().includes('Rimuovi i dati di questo account da questo dispositivo'))

  // =====================================================================
  section('Rientro con lo stesso account: tutto torna, coda compresa')
  // =====================================================================
  await cloud.login(A)
  check('schermata chiusa, marcatore tolto', gate.getSessionGateState() === null && !map.has(SESSION_ENDED_KEY))
  check('   dati e coda di A di nuovo lì, motore acceso', S().scopeId === scopeFor(A) && has(S, 'SEGRETO-A') && S().sync.outbox.length === pendingA && cloud.engine.running === A)
  check('   di nuovo a schermo', shown() && screen().includes('OBIETTIVO-A'))

  // =====================================================================
  section('Sessione finita, poi accede un account diverso: niente di A a schermo')
  // =====================================================================
  await cloud.serverEndsSession()
  await cloud.login(C)
  check('ambito di C con i suoi dati, nessuna schermata', S().scopeId === scopeFor(C) && has(S, 'DATI-DI-C') && !has(S, 'SEGRETO-A') && gate.getSessionGateState() === null)
  check('   a schermo niente di A', shown() && !screen().includes('OBIETTIVO-A'))
  check('   il contenitore di A resta com\'era (coda compresa)', map.get(stateKey(scopeFor(A))).includes('SEGRETO-A') && JSON.parse(map.get(stateKey(scopeFor(A)))).state.sync.outbox.length === pendingA)

  // =====================================================================
  section('Logout volontario: come sempre (guest, niente schermata, niente cancellato)')
  // =====================================================================
  check('signOut → nessun errore', await sync.signOut() === null)
  check('   ambito guest con i dati guest, nessuna schermata, nessun marcatore', S().scopeId === GUEST && has(S, 'DATI-GUEST') && gate.getSessionGateState() === null && !map.has(SESSION_ENDED_KEY))
  check('   contenitori di A e C intatti', map.get(stateKey(scopeFor(A))).includes('SEGRETO-A') && untouched())

  // =====================================================================
  section('A eliminato dall\'altro dispositivo, coda già sincronizzata: rimozione del solo contenitore di A')
  // =====================================================================
  await cloud.login(A)
  S().ackOps(S().sync.outbox) // tutto arrivato sul server prima dell'eliminazione
  map.set(`spendy-backup-auto-u-${A}-2026-10-02T10-00-00-000Z`, '{"backup":"di A"}')
  check('preparazione: A attivo, coda vuota', S().scopeId === scopeFor(A) && S().sync.outbox.length === 0 && keysOf(A).length >= 3)
  cloud.deleteOnServer(A)
  const startsBefore = cloud.engine.starts.length
  await cloud.serverEndsSession()
  g = gate.getSessionGateState()
  check('Auth conferma: schermata "account eliminato", dati rimossi', g?.status === 'deleted' && g.userId === A && g.removed === true && g.pending === 0, JSON.stringify(g))
  check('   nessuna chiave di A sul dispositivo (stato, voce, backup, marcatore)', keysOf(A).length === 0 && !map.has(SESSION_ENDED_KEY), keysOf(A).join(', '))
  check('   ambito guest: niente di A in memoria', S().scopeId === GUEST && !has(S, 'SEGRETO-A'))
  check('   guest, vecchio storage, account C e altre app intatti', untouched())
  check('   il motore non riparte per A (niente dati reinviati al server)', cloud.engine.running === null && cloud.engine.starts.length === startsBefore)
  check('   la schermata lo dice; niente di A a schermo', screen().includes('Account eliminato') && screen().includes('rimossi da questo dispositivo') && !screen().includes('OBIETTIVO-A'))
  sync.continueWithoutAccount()
  check('   "Chiudi": schermata chiusa, si resta guest', gate.getSessionGateState() === null && S().scopeId === GUEST)

  // =====================================================================
  section('Eliminato altrove con modifiche MAI sincronizzate: nessuna perdita silenziosa')
  // =====================================================================
  const H = 'utente-h-con-coda'
  cloud.users.add(H)
  await cloud.login(H)
  S().addExpense({ amount: 7, categoryId: 'spesa', description: 'NON-SINCRONIZZATA-H', date: S().today })
  cloud.deleteOnServer(H)
  await cloud.serverEndsSession()
  g = gate.getSessionGateState()
  check('schermata "account eliminato" con 1 modifica in sospeso, NON rimossa', g?.status === 'deleted' && g.removed === false && g.pending === 1, JSON.stringify(g))
  check('   contenitore di H conservato, ma nascosto (ambito guest)', map.get(stateKey(scopeFor(H)))?.includes('NON-SINCRONIZZATA-H') && S().scopeId === GUEST && !has(S, 'NON-SINCRONIZZATA-H'))
  check('   la schermata avvisa e offre la rimozione', screen().includes('1 modifica non è mai stata sincronizzata') && screen().includes('Rimuovi i dati di questo account da questo dispositivo'))
  check('rimozione esplicita: via solo H', sync.forgetGatedAccount() === true && keysOf(H).length === 0 && untouched() && gate.getSessionGateState() === null)

  // =====================================================================
  section('Rifiuto con token già scaduto: nessuna prova possibile → solo nascosti')
  // =====================================================================
  const J = 'utente-j-token-scaduto'
  cloud.users.add(J)
  await cloud.login(J, { exp: alreadyExpired() })
  S().addExpense({ amount: 3, categoryId: 'spesa', description: 'DATI-J', date: S().today })
  cloud.deleteOnServer(J)
  const callsJ = cloud.getUserCalls.length
  await cloud.serverEndsSession()
  check('schermata "sessione terminata" (non "eliminato"), Auth non interrogato', gate.getSessionGateState()?.status === 'ended' && cloud.getUserCalls.length === callsJ)
  check('   contenitore di J intatto', map.get(stateKey(scopeFor(J)))?.includes('DATI-J'))
  sync.continueWithoutAccount()
  check('"Continua senza account": guest, contenitore di J conservato, marcatore tolto', S().scopeId === GUEST && map.get(stateKey(scopeFor(J)))?.includes('DATI-J') && !map.has(SESSION_ENDED_KEY) && gate.getSessionGateState() === null)

  // =====================================================================
  section('Token il cui `sub` non è l\'account dell\'ambito: identità non dimostrata')
  // =====================================================================
  const D = 'utente-d-identita'
  cloud.users.add(D)
  await cloud.login(D, { sub: 'utente-inesistente' }) // token che non appartiene a D
  S().addExpense({ amount: 5, categoryId: 'spesa', description: 'DATI-D', date: S().today })
  S().ackOps(S().sync.outbox)
  const callsD = cloud.getUserCalls.length
  await cloud.serverEndsSession()
  check('nessuna cancellazione e nessuna domanda ad Auth', gate.getSessionGateState()?.status === 'ended' && map.get(stateKey(scopeFor(D)))?.includes('DATI-D') && cloud.getUserCalls.length === callsD)

  // =====================================================================
  section('Rimozione manuale da "sessione terminata": solo su richiesta, solo quell\'account')
  // =====================================================================
  check('"Rimuovi": via D, il resto intatto', sync.forgetGatedAccount() === true && keysOf(D).length === 0 && untouched() && map.get(stateKey(scopeFor(J)))?.includes('DATI-J'))
  check('   ambito guest, schermata chiusa', S().scopeId === GUEST && gate.getSessionGateState() === null)

  // =====================================================================
  section('Eliminato altrove mentre B era in background: verifica al ritorno in primo piano')
  // =====================================================================
  const L = 'utente-l-primo-piano'
  cloud.users.add(L)
  await cloud.login(L)
  S().addExpense({ amount: 9, categoryId: 'spesa', description: 'DATI-L', date: S().today })
  S().ackOps(S().sync.outbox)
  cloud.deleteOnServer(L)
  laterBy(6)
  cloud.signOutCalls.length = 0
  await backToForeground()
  g = gate.getSessionGateState()
  check('Auth conferma: account eliminato, dati rimossi', g?.status === 'deleted' && g.userId === L && g.removed === true && keysOf(L).length === 0, JSON.stringify(g))
  check('   sessione chiusa solo su questo dispositivo, senza schermata "terminata"', cloud.signOutCalls.length === 1 && cloud.signOutCalls[0]?.scope === 'local')
  check('   guest, gli altri intatti', S().scopeId === GUEST && untouched())
  sync.continueWithoutAccount()

  // =====================================================================
  section('Riavvio dopo "sessione terminata": i dati restano nascosti')
  // =====================================================================
  const M = 'utente-m-riavvio'
  cloud.users.add(M)
  await cloud.login(M)
  await act(() => { S().addExpense({ amount: 11, categoryId: 'spesa', description: 'DATI-M', date: S().today }); addGoal(S, 'OBIETTIVO-M') })
  await cloud.serverEndsSession()
  check('prima del riavvio: schermata e marcatore', gate.getSessionGateState()?.status === 'ended' && map.get(SESSION_ENDED_KEY) === scopeFor(M))
  app = await openApp()
  ;({ S, sync, gate } = app)
  check('dopo il riavvio (nessuna sessione): ancora "sessione terminata" per M', gate.getSessionGateState()?.status === 'ended' && gate.getSessionGateState().userId === M && S().scopeId === scopeFor(M))
  check('   a schermo niente di M', !shown() && !screen().includes('OBIETTIVO-M') && screen().includes('Sessione terminata'))
  check('   contenitore di M intatto', map.get(stateKey(scopeFor(M)))?.includes('DATI-M'))

  // =====================================================================
  section('Riavvio con la sessione salvata RIFIUTATA all\'avvio (dispositivo chiuso a lungo)')
  // =====================================================================
  const N = 'utente-n-chiuso-a-lungo'
  cloud.users.add(N)
  await cloud.login(N)
  await act(() => { S().addExpense({ amount: 13, categoryId: 'spesa', description: 'DATI-N', date: S().today }); addGoal(S, 'OBIETTIVO-N') })
  check('preparazione: N attivo, nessun marcatore', S().scopeId === scopeFor(N) && !map.has(SESSION_ENDED_KEY))
  cloud.deleteOnServer(N)
  // Inizializzazione del client: il rinnovo del token scaduto viene rifiutato,
  // la libreria toglie la sessione ed emette SIGNED_OUT, poi getSession → null.
  cloud.startup = async () => { cloud.current = null; await cloud.emit('SIGNED_OUT', null); return { data: { session: null }, error: null } }
  app = await openApp()
  ;({ S, sync, gate } = app)
  check('"sessione terminata" per N (nessuna prova di eliminazione: token scaduto)', gate.getSessionGateState()?.status === 'ended' && gate.getSessionGateState().userId === N)
  check('   contenitore di N intatto, a schermo niente di N', map.get(stateKey(scopeFor(N)))?.includes('DATI-N') && !shown() && !screen().includes('OBIETTIVO-N'))

  // =====================================================================
  section('Riavvio offline con token scaduto: nessun blocco (uso offline come sempre)')
  // =====================================================================
  const P = 'utente-p-offline'
  cloud.users.add(P)
  await cloud.login(P)
  await act(() => { S().addExpense({ amount: 17, categoryId: 'spesa', description: 'DATI-P', date: S().today }); addGoal(S, 'OBIETTIVO-P') })
  const pendingP = S().sync.outbox.length
  cloud.startup = async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } })
  setOnline(false)
  app = await openApp()
  ;({ S, sync, gate } = app)
  check('nessuna schermata, dati di P a schermo, coda intatta', gate.getSessionGateState() === null && S().scopeId === scopeFor(P) && has(S, 'DATI-P') && S().sync.outbox.length === pendingP && shown() && screen().includes('OBIETTIVO-P'))
  setOnline(true)

  // =====================================================================
  section('Riavvio senza sessione e senza prove: comportamento di prima')
  // =====================================================================
  // Nessuna sessione salvata e nessun rifiuto visto (per esempio dopo un logout
  // fallito a metà, vedi signOut.test): l'assenza di sessione non è una prova.
  cloud.current = null
  app = await openApp()
  ;({ S, sync, gate } = app)
  check('nessuna schermata, l\'ambito resta quello di P', gate.getSessionGateState() === null && S().scopeId === scopeFor(P) && has(S, 'DATI-P'))

  // =====================================================================
  section('Riavvio con la sessione di un account eliminato nel frattempo: verifica all\'avvio')
  // =====================================================================
  const Q = 'utente-q-avvio'
  cloud.users.add(Q)
  await cloud.login(Q)
  S().addExpense({ amount: 19, categoryId: 'spesa', description: 'DATI-Q', date: S().today })
  S().ackOps(S().sync.outbox)
  cloud.deleteOnServer(Q)
  cloud.current = cloud.session(Q) // token ancora valido salvato sul dispositivo
  app = await openApp()
  ;({ S, sync, gate } = app)
  g = gate.getSessionGateState()
  check('all\'avvio Auth conferma: dati di Q rimossi', g?.status === 'deleted' && g.userId === Q && g.removed === true && keysOf(Q).length === 0, JSON.stringify(g))
  check('   guest; contenitori degli altri account ancora lì', S().scopeId === GUEST && map.get(stateKey(scopeFor(P)))?.includes('DATI-P') && map.get(stateKey(scopeFor(N)))?.includes('DATI-N'))

  // =====================================================================
  section('Operazioni RIFIUTATE dal server: contano come non sincronizzate')
  // =====================================================================
  const R = 'utente-r-rifiutate'
  cloud.users.add(R)
  await cloud.login(R)
  S().addExpense({ amount: 999999, categoryId: 'spesa', description: 'RIFIUTATA-R', date: S().today })
  S().rejectOps([...S().sync.outbox], 'numeric field overflow')
  check('preparazione: coda vuota, 1 operazione rifiutata', S().sync.outbox.length === 0 && S().sync.rejected.length === 1)
  cloud.deleteOnServer(R)
  await cloud.serverEndsSession()
  g = gate.getSessionGateState()
  check('eliminazione provata: contenitore CONSERVATO per l\'operazione rifiutata', g?.status === 'deleted' && g.removed === false && g.pending === 1 && map.get(stateKey(scopeFor(R)))?.includes('RIFIUTATA-R'), JSON.stringify(g))
  check('   e compare tra i dati di account eliminati', sync.deletedAccountsOnDevice().some((x) => x.userId === R && x.unsynced === 1))
  sync.continueWithoutAccount()

  // =====================================================================
  section('Contenitore illeggibile di un account eliminato: niente rimozione automatica')
  // =====================================================================
  const Z = 'utente-z-illeggibile'
  map.set(stateKey(scopeFor(Z)), '{"state": illeggibile')
  S().retireAccountScope(Z, 'deleted')
  check('conteggio delle modifiche: non determinabile (null), non zero', S().unsyncedWritesFor(Z) === null)
  check('   in elenco con l\'avviso "non è possibile sapere"', sync.deletedAccountsOnDevice().some((x) => x.userId === Z && x.unsynced === null))
  check('   rimozione esplicita: via solo Z (R resta)', sync.forgetDeletedAccount(Z) === true && !map.has(stateKey(scopeFor(Z))) && map.has(stateKey(scopeFor(R))))
  check('   R rimosso esplicitamente: elenco vuoto', sync.forgetDeletedAccount(R) === true && sync.deletedAccountsOnDevice().length === 0)
  check('   un account NON eliminato non si rimuove da lì', sync.forgetDeletedAccount(P) === false && map.get(stateKey(scopeFor(P)))?.includes('DATI-P'))

  // =====================================================================
  section('Account guest: mai toccato')
  // =====================================================================
  check('dati guest e di C ancora lì; vecchio storage e chiavi di altre app identici all\'inizio', untouched())
  check('   il puntatore all\'ambito attivo è valido', [GUEST, ...[A, C, J, M, N, P].map(scopeFor)].includes(map.get(ACTIVE_SCOPE_KEY)))
  check('nessun errore di rendering in tutto il percorso', errors.length === 0, errors[0]?.message)
} finally {
  await closeApp()
  Date.now = realNow
  delete globalThis.__cloud
}

report('Account eliminato su un altro dispositivo: dati locali')
