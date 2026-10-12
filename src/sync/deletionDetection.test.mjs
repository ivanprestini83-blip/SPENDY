// Rilevamento di un account eliminato ALTROVE, mentre l'app resta aperta, e
// avviso persistente. spendySync, store e App veri (montata come in
// produzione, anche in React StrictMode); client Auth finto, verifica via un
// endpoint HTTP finto che risponde come Supabase Auth (GET /auth/v1/user) e
// che può trattenere le risposte e contare le richieste in volo.
//
// Il DOM finto non genera eventi: focus, pageshow, visibilitychange e il
// timer dei 5 minuti vengono intercettati e attivati dal test.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { StrictMode, createElement as h } from 'react'
import { check, section, report, italianDevice } from './testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import { LEGAL_VERSIONS } from '../../supabase/functions/_shared/legalVersions.js'
import { stateKey, scopeFor, GUEST } from '../store/scope.js'
import { DELETED_NOTICE_KEY } from './sessionGate.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 25; i += 1) await tick() }
const CURRENT_KEY = `terms:${LEGAL_VERSIONS.terms}|privacy:${LEGAL_VERSIONS.privacy}`

const map = italianDevice(new Map())
map.set(stateKey(GUEST), JSON.stringify({ state: { expenses: [{ id: 'g1', amount: 1, categoryId: 'bar', description: 'DATI-GUEST', date: '2026-10-01', updatedAt: '2026-10-01T10:00:00.000Z' }], sync: { userId: null, outbox: [], cursors: {} } }, version: 0 }))
map.set('spendy-guest-claimed-by', 'qualcuno-prima')
const dom = installFakeDom(map)
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

// --- eventi e timer, istanza per istanza --------------------------------------
let listeners = []
let intervals = []
dom.document.addEventListener = (type, fn) => listeners.push({ target: 'document', type, fn })
dom.document.removeEventListener = (type, fn) => { listeners = listeners.filter((l) => !(l.target === 'document' && l.type === type && l.fn === fn)) }
globalThis.window.addEventListener = (type, fn) => listeners.push({ target: 'window', type, fn })
globalThis.window.removeEventListener = (type, fn) => { listeners = listeners.filter((l) => !(l.target === 'window' && l.type === type && l.fn === fn)) }
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
globalThis.setInterval = (fn, ms, ...rest) => {
  if (ms !== 5 * 60 * 1000) return realSetInterval(fn, ms, ...rest)
  const entry = { fn, cleared: false }
  intervals.push(entry)
  return entry
}
globalThis.clearInterval = (id) => { if (id && typeof id === 'object' && 'cleared' in id) id.cleared = true; else realClearInterval(id) }
const fire = async (target, type) => {
  for (const l of listeners.filter((x) => x.target === target && x.type === type)) l.fn({ type })
  await settle()
}
const fireInterval = async () => {
  for (const entry of intervals.filter((e) => !e.cleared)) entry.fn()
  await settle()
}
const setVisibility = (state) => { dom.document.visibilityState = state }
setVisibility('visible')

const realNow = Date.now
let shift = 0
Date.now = () => realNow() + shift
const later = (seconds) => { shift += seconds * 1000 }
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })

// --- Supabase Auth finto via HTTP ---------------------------------------------
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(realNow() / 1000) + 24 * 3600 })}.firma-finta`
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
const FAKE_URL = 'https://progetto-finto.supabase.invalid'
const FAKE_KEY = 'chiave-pubblica-finta'
const auth = { users: new Set(), mode: 'normal', hold: null, requests: 0, inFlight: 0, maxInFlight: 0 }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  if (!url.startsWith(`${FAKE_URL}/auth/v1/user`)) throw new Error(`richiesta inattesa: ${url}`)
  auth.requests += 1
  auth.inFlight += 1
  auth.maxInFlight = Math.max(auth.maxInFlight, auth.inFlight)
  try {
    if (auth.hold) await auth.hold
    const sub = claimsOf(String(init.headers?.Authorization ?? '').replace(/^Bearer /, '')).sub
    if (auth.mode === 'network') throw new TypeError('Failed to fetch')
    if (auth.mode === 'server-error') return json(503, { code: 'unexpected_failure', message: 'Service Unavailable' })
    if (auth.mode === 'unauthorized') return json(401, { code: 'no_authorization', message: 'invalid' })
    if (auth.mode === 'bad-jwt') return json(403, { code: 'bad_jwt', message: 'invalid JWT' })
    if (auth.mode === 'session-missing') return json(403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' })
    if (!auth.users.has(sub)) return json(403, { code: 'user_not_found', message: 'User from sub claim in JWT does not exist' })
    return json(200, { id: sub })
  } finally {
    auth.inFlight -= 1
  }
}

// --- client Auth finto ----------------------------------------------------------
const cloud = {
  current: null, listeners: [], legal: new Set(), signOutCalls: 0, signOutHold: null,
  emit: async (event, session) => { for (const cb of [...cloud.listeners]) await cb(event, session) },
  session: (id) => ({ access_token: jwt(id), refresh_token: `ref-${id}`, user: { id } }),
  login: async (id) => { cloud.current = cloud.session(id); await cloud.emit('SIGNED_IN', cloud.current); await settle() },
}
cloud.supabase = {
  from: () => ({ select: () => ({ eq: (_c, userId) => ({ maybeSingle: async () => ({ data: cloud.legal.has(userId) ? { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy } : null, error: null }) }) }) }),
  functions: { invoke: async () => ({ data: { accepted: true }, error: null }) },
  auth: {
    getSession: async () => ({ data: { session: cloud.current }, error: null }),
    onAuthStateChange: (cb) => {
      cloud.listeners.push(cb)
      return { data: { subscription: { unsubscribe() { cloud.listeners = cloud.listeners.filter((x) => x !== cb) } } } }
    },
    async signOut() {
      cloud.signOutCalls += 1
      if (cloud.signOutHold) await cloud.signOutHold // chiusura della sessione lenta (rete)
      cloud.current = null
      await cloud.emit('SIGNED_OUT', null)
      return { error: null }
    },
    updateUser: async () => ({ data: {}, error: null }),
  },
}
globalThis.__det = cloud

const STUBS = {
  './supabaseRemote.js': 'export const createSupabaseRemote = () => ({})',
  './syncEngine.js': 'export const createSyncEngine = () => ({ start: async () => ({}), stop() {}, syncNow: async () => ({}) })',
}
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
let server = null
let root = null
let container = null
const errors = []
const act = async (fn) => { flushSync(fn); await settle() }
const screen = () => dom.toHtml(container)
async function openApp({ strict = false } = {}) {
  if (root) await act(() => root.unmount())
  if (server) await server.close()
  cloud.listeners.length = 0
  listeners = []
  intervals = []
  server = await createServer({
    root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
    cacheDir: join(tmpdir(), 'spendy-deletion-detection-test-vite'),
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: 'detection-stubs',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source.endsWith('/lib/supabase.js')) return '\0det:lib'
        if (importer?.split('?')[0].endsWith('/src/sync/spendySync.js') && source in STUBS) return `\0det:${source}`
        return null
      },
      load(id) {
        if (id === '\0det:lib') return `export const isSupabaseConfigured = true\nexport const supabaseUrl = '${FAKE_URL}'\nexport const supabaseAnonKey = '${FAKE_KEY}'\nexport const supabase = globalThis.__det.supabase`
        if (id.startsWith('\0det:')) return STUBS[id.slice(5)]
        if (id.split('?')[0].endsWith('.css')) return 'export default {}'
        return null
      },
    }, react()],
  })
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const sync = await server.ssrLoadModule('/src/sync/spendySync.js')
  const gate = await server.ssrLoadModule('/src/sync/sessionGate.js')
  const legal = await server.ssrLoadModule('/src/legal/legalGate.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const legalStates = []
  legal.subscribeLegalGate(() => legalStates.push(legal.getLegalGateState()?.status ?? null))
  container = dom.createContainer()
  root = createRoot(container, { onCaughtError: (e) => errors.push(e), onUncaughtError: (e) => errors.push(e), onRecoverableError: () => {} })
  await act(() => root.render(strict ? h(StrictMode, null, h(App)) : h(App)))
  await settle()
  return { S: useAppStore.getState, set: useAppStore.setState, sync, gate, legalStates }
}

// Un account con un obiettivo (visibile in Home) e la coda già sincronizzata.
const prepare = async (app, id, { synced = true } = {}) => {
  auth.users.add(id)
  cloud.legal.add(id)
  await cloud.login(id)
  await act(() => app.S().addGoal({ emoji: '🎯', label: `OBIETTIVO-${id}`, target: 1000, etaMonths: 5 }))
  if (synced) app.S().ackOps(app.S().sync.outbox)
}
const noticeRaw = () => map.get(DELETED_NOTICE_KEY)
const deletedShown = () => screen().includes('Account eliminato')

try {
  let app = await openApp()

  // =====================================================================
  section('Il solo cambio di finestra (focus) rileva l\'eliminazione')
  // =====================================================================
  await prepare(app, 'det-focus')
  check('preparazione: account a schermo', screen().includes('OBIETTIVO-det-focus'))
  auth.users.delete('det-focus')
  later(40)
  let before = auth.requests
  await fire('window', 'focus')
  check('focus → una verifica, "Account eliminato" a schermo', auth.requests === before + 1 && deletedShown())
  check('   dati rimossi e Home guest, niente dell\'account', !map.has(stateKey(scopeFor('det-focus'))) && app.S().scopeId === GUEST && !screen().includes('OBIETTIVO-det-focus'))
  check('   avviso salvato SENZA identificativi', typeof noticeRaw() === 'string' && !noticeRaw().includes('det-focus') && JSON.parse(noticeRaw()).removed === true)
  const noticeAfterFocus = noticeRaw()

  // =====================================================================
  section('Avviso persistente: sopravvive al refresh, si chiude, non torna')
  // =====================================================================
  app = await openApp()
  check('dopo il refresh: ancora "Account eliminato", sopra la Home guest', deletedShown() && app.S().scopeId === GUEST && app.gate.getSessionGateState()?.status === 'deleted')
  check('   l\'avviso ripreso non offre rimozioni (non sa di quale account si tratta)', !screen().includes('Rimuovi i dati di questo account'))
  check('   stesso contenuto salvato', noticeRaw() === noticeAfterFocus)
  await act(() => app.sync.continueWithoutAccount())
  check('"Chiudi": avviso tolto, si usa SPENDY come guest', !map.has(DELETED_NOTICE_KEY) && !deletedShown() && screen().includes('app-shell') && app.S().scopeId === GUEST)
  app = await openApp()
  check('   nuovo refresh: l\'avviso non si ripresenta', !deletedShown() && app.gate.getSessionGateState() === null)

  // =====================================================================
  section('pageshow e visibilitychange')
  // =====================================================================
  await prepare(app, 'det-pageshow')
  auth.users.delete('det-pageshow')
  later(40)
  await fire('window', 'pageshow')
  check('pageshow → rilevato', deletedShown() && !map.has(stateKey(scopeFor('det-pageshow'))))
  await act(() => app.sync.continueWithoutAccount())
  await prepare(app, 'det-visible')
  auth.users.delete('det-visible')
  later(40)
  setVisibility('hidden')
  before = auth.requests
  await fire('document', 'visibilitychange')
  check('visibilitychange con la pagina NASCOSTA → nessuna richiesta', auth.requests === before && !deletedShown())
  setVisibility('visible')
  await fire('document', 'visibilitychange')
  check('visibilitychange con la pagina visibile → rilevato', deletedShown() && !map.has(stateKey(scopeFor('det-visible'))))
  await act(() => app.sync.continueWithoutAccount())

  // =====================================================================
  section('Verifica periodica (5 minuti) e limite di frequenza')
  // =====================================================================
  await prepare(app, 'det-timer')
  check('un solo timer di 5 minuti attivo', intervals.filter((e) => !e.cleared).length === 1)
  later(40)
  before = auth.requests
  await fire('window', 'focus')
  await fire('window', 'focus')
  await fire('window', 'pageshow')
  check('tre eventi ravvicinati → una sola richiesta', auth.requests === before + 1)
  later(31)
  await fire('window', 'focus')
  check('   dopo 30 secondi se ne può fare un\'altra', auth.requests === before + 2)
  auth.users.delete('det-timer')
  later(5 * 60)
  setVisibility('hidden')
  before = auth.requests
  await fireInterval()
  check('timer con la pagina nascosta → nessuna richiesta', auth.requests === before && !deletedShown())
  setVisibility('visible')
  await fireInterval()
  check('timer con la pagina visibile → rilevato', deletedShown() && !map.has(stateKey(scopeFor('det-timer'))))
  await act(() => app.sync.continueWithoutAccount())

  // =====================================================================
  section('Richieste concorrenti: mai due verifiche insieme')
  // =====================================================================
  await prepare(app, 'det-concorrenti')
  auth.users.delete('det-concorrenti')
  later(40)
  let release
  auth.hold = new Promise((resolve) => { release = resolve })
  auth.maxInFlight = 0
  before = auth.requests
  for (const [target, type] of [['window', 'focus'], ['window', 'pageshow'], ['document', 'visibilitychange']]) {
    for (const l of listeners.filter((x) => x.target === target && x.type === type)) l.fn({ type })
  }
  for (const entry of intervals.filter((e) => !e.cleared)) entry.fn()
  await settle()
  check('focus + pageshow + visibilitychange + timer → una sola richiesta in volo', auth.requests === before + 1 && auth.maxInFlight === 1)
  auth.hold = null
  release()
  await settle()
  check('   una sola pulizia, avviso a schermo', deletedShown() && !map.has(stateKey(scopeFor('det-concorrenti'))))
  await act(() => app.sync.continueWithoutAccount())

  // =====================================================================
  section('Errori di rete e risposte ambigue: nessuna prova, niente toccato')
  // =====================================================================
  await prepare(app, 'det-ambiguo')
  for (const mode of ['network', 'server-error', 'unauthorized', 'bad-jwt', 'session-missing']) {
    auth.mode = mode
    later(40)
    before = auth.requests
    await fire('window', 'focus')
    auth.mode = 'normal'
    check(`${mode}: richiesta fatta, nessun avviso, dati e account intatti`,
      auth.requests === before + 1 && !deletedShown() && !map.has(DELETED_NOTICE_KEY) && app.S().scopeId === scopeFor('det-ambiguo') && map.get(stateKey(scopeFor('det-ambiguo')))?.includes('OBIETTIVO-det-ambiguo') && app.S().retiredReasonFor('det-ambiguo') === null)
  }

  // =====================================================================
  section('Dati non sincronizzati: conservati e spiegati, anche dopo il refresh')
  // =====================================================================
  await prepare(app, 'det-coda', { synced: false })
  auth.users.delete('det-coda')
  later(40)
  await fire('window', 'focus')
  const gq = app.gate.getSessionGateState()
  check('rilevato: contenitore conservato, avviso con le modifiche in sospeso', gq?.status === 'deleted' && gq.removed === false && gq.pending >= 1 && map.has(stateKey(scopeFor('det-coda'))))
  check('   niente dell\'account nella Home guest', app.S().scopeId === GUEST && !screen().includes('OBIETTIVO-det-coda'))
  app = await openApp()
  check('dopo il refresh: avviso con le modifiche e il rimando alle Impostazioni', deletedShown() && screen().includes('non è mai stata sincronizzata') && screen().includes('Impostazioni'))
  await act(() => app.sync.continueWithoutAccount())
  check('   chiuso: la scelta resta in Impostazioni', app.sync.deletedAccountsOnDevice().some((x) => x.userId === 'det-coda') && !map.has(DELETED_NOTICE_KEY))
  app.sync.forgetDeletedAccount('det-coda')

  // =====================================================================
  section('Errore durante la pulizia: l\'esito verificato non si perde')
  // =====================================================================
  await prepare(app, 'det-guasto')
  const realSwitch = app.S().switchScope
  app.set({ switchScope: () => { throw new Error('guasto simulato') } })
  auth.users.delete('det-guasto')
  later(40)
  const warn = console.warn
  const warnings = []
  console.warn = (msg) => warnings.push(String(msg))
  await fire('window', 'focus')
  console.warn = warn
  check('avviso a schermo e salvato, ambito invalidato', deletedShown() && map.has(DELETED_NOTICE_KEY) && app.S().retiredReasonFor('det-guasto') === 'deleted')
  check('   la schermata dell\'account NON è disegnata (dati non visibili)', !screen().includes('app-shell') && !screen().includes('OBIETTIVO-det-guasto'))
  check('   passaggio fallito segnalato senza dati personali', warnings.some((w) => w.includes('"guest"')) && warnings.every((w) => !w.includes('det-guasto')))
  app.set({ switchScope: realSwitch })
  await act(() => app.sync.continueWithoutAccount())
  check('"Chiudi" porta comunque al guest', app.S().scopeId === GUEST && screen().includes('app-shell') && !screen().includes('OBIETTIVO-det-guasto'))
  app = await openApp()
  check('dopo il refresh nessun dato dell\'account (ambito invalidato)', app.S().scopeId === GUEST && !screen().includes('OBIETTIVO-det-guasto'))
  app.sync.forgetDeletedAccount('det-guasto')

  // =====================================================================
  section('Pulizia interrotta a metà (refresh mentre si chiude la sessione)')
  // =====================================================================
  await prepare(app, 'det-interrotto')
  auth.users.delete('det-interrotto')
  later(40)
  let releaseSignOut
  cloud.signOutHold = new Promise((resolve) => { releaseSignOut = resolve })
  await fire('window', 'focus')
  check('mentre la sessione si sta ancora chiudendo: avviso GIÀ a schermo e salvato', cloud.signOutCalls >= 1 && deletedShown() && map.has(DELETED_NOTICE_KEY))
  check('   e i dati dell\'account già nascosti', !screen().includes('OBIETTIVO-det-interrotto'))
  app = await openApp() // refresh prima che la pulizia finisca
  cloud.signOutHold = null
  releaseSignOut()
  await settle()
  check('dopo il refresh: avviso ancora presente, guest, niente dell\'account', deletedShown() && app.S().scopeId === GUEST && !screen().includes('OBIETTIVO-det-interrotto'))
  await act(() => app.sync.continueWithoutAccount())
  app.sync.forgetDeletedAccount('det-interrotto')
  cloud.current = null

  // =====================================================================
  section('Cambio account mentre la verifica è in volo')
  // =====================================================================
  await prepare(app, 'det-vecchio')
  auth.users.delete('det-vecchio')
  later(40)
  auth.hold = new Promise((resolve) => { release = resolve })
  await fire('window', 'focus')
  auth.users.add('det-nuovo')
  cloud.legal.add('det-nuovo')
  cloud.signOutCalls = 0
  await cloud.login('det-nuovo')
  auth.hold = null
  release()
  await settle()
  check('nessun avviso per chi ora è dentro un altro account', !deletedShown() && !map.has(DELETED_NOTICE_KEY) && app.S().scopeId === scopeFor('det-nuovo'))
  check('   sessione del nuovo account intatta', cloud.signOutCalls === 0 && cloud.current?.user?.id === 'det-nuovo')
  check('   dati del vecchio account comunque rimossi', !map.has(stateKey(scopeFor('det-vecchio'))) && app.S().retiredReasonFor('det-vecchio') === 'deleted')
  await cloud.emit('SIGNED_OUT', null)
  cloud.current = null
  await act(() => app.sync.continueWithoutAccount())

  // =====================================================================
  section('StrictMode e Termini: account eliminato con la riga dei Termini sparita')
  // =====================================================================
  for (const [label, withLocalAcceptance] of [['accettazione già salvata (controllo in background)', true], ['nessuna accettazione locale (controllo all\'apertura)', false]]) {
    const id = withLocalAcceptance ? 'det-termini-a' : 'det-termini-b'
    map.set(stateKey(scopeFor(id)), JSON.stringify({ state: { goals: [{ id: 'g', emoji: '🎯', label: `OBIETTIVO-${id}`, target: 1000, saved: 0, etaMonths: 5 }], sync: { userId: id, outbox: [], cursors: {} }, legalAcceptedVersion: withLocalAcceptance ? CURRENT_KEY : null }, version: 0 }))
    map.set('spendy-active-scope', scopeFor(id))
    cloud.current = cloud.session(id) // sessione salvata, token ancora valido
    auth.users.delete(id) // eliminato altrove
    cloud.legal.delete(id) // la riga dei Termini sparisce con l'account
    auth.maxInFlight = 0
    before = auth.requests
    app = await openApp({ strict: true })
    check(`${label}: mai la schermata "accetta i Termini"`, !app.legalStates.includes('required'), app.legalStates.join(','))
    check('   "Account eliminato", dati rimossi, guest', deletedShown() && !map.has(stateKey(scopeFor(id))) && app.S().scopeId === GUEST)
    check('   doppio avvio di StrictMode: mai due verifiche insieme', auth.maxInFlight === 1 && auth.requests - before <= 2, `${auth.requests - before} richieste`)
    await act(() => app.sync.continueWithoutAccount())
  }
  {
    // Controllo: account che ESISTE ma con Termini nuovi da accettare → la schermata c'è.
    const id = 'det-termini-nuovi'
    auth.users.add(id)
    map.set(stateKey(scopeFor(id)), JSON.stringify({ state: { sync: { userId: id, outbox: [], cursors: {} }, legalAcceptedVersion: null }, version: 0 }))
    map.set('spendy-active-scope', scopeFor(id))
    cloud.current = cloud.session(id)
    app = await openApp({ strict: true })
    check('account esistente senza Termini correnti: la schermata dei Termini compare (nessuna regressione)', app.gate.getSessionGateState() === null && app.legalStates.at(-1) === 'required' && !deletedShown())
  }

  // =====================================================================
  section('Pulizia: timer e listener tolti allo smontaggio')
  // =====================================================================
  await act(() => root.unmount())
  root = null
  check('nessun timer di 5 minuti attivo', intervals.every((e) => e.cleared))
  check('nessun listener focus/pageshow/visibilitychange rimasto', !listeners.some((l) => ['focus', 'pageshow', 'visibilitychange'].includes(l.type)))
  check('guest intatto', map.get(stateKey(GUEST))?.includes('DATI-GUEST'))
  check('nessun errore di rendering', errors.length === 0, errors[0]?.message)
} finally {
  if (root) await act(() => root.unmount())
  if (server) await server.close()
  Date.now = realNow
  globalThis.setInterval = realSetInterval
  globalThis.clearInterval = realClearInterval
}

report('Rilevamento dell\'eliminazione e avviso persistente')
