// Più schede dello stesso browser: DUE istanze indipendenti dell'app (due Vite,
// due store, due App montate, due client Auth) sullo STESSO localStorage.
//
// Il client Auth di ogni scheda è finto ma, come quello vero, inoltra alle
// altre schede SIGNED_IN / SIGNED_OUT (BroadcastChannel). La verifica
// "l'account esiste ancora?" va a un endpoint HTTP finto che risponde come
// Supabase Auth. La scheda 2 usa il motore di sincronizzazione VERO, con un
// remote di cui si possono trattenere pull e push: così si prova una risposta
// che arriva DOPO che l'ambito è stato invalidato (scrittura già in corso).
// L'evento `storage` tra schede non esiste nel DOM finto: si chiama a mano,
// e solo DOPO aver verificato che le scritture sono bloccate anche senza.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report, italianDevice } from './testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import { LEGAL_VERSIONS } from '../../supabase/functions/_shared/legalVersions.js'
import { stateKey, voiceKey, scopeFor, GUEST, LEGACY_STATE_KEY, RETIRED_SCOPES_KEY } from '../store/scope.js'

const A = 'utente-a-multischeda'
const C = 'utente-c-logout'
const E = 'utente-e-coda-in-altra-scheda'
const M = 'utente-m-rimosso-a-mano'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 20; i += 1) await tick() }

// --- dispositivo: guest e vecchio storage da non toccare mai -------------------
const map = italianDevice(new Map())
const containerOf = (description, userId = null) => JSON.stringify({
  state: {
    expenses: [{ id: `e-${description}`, amount: 10, categoryId: 'bar', description, date: '2026-10-01', updatedAt: '2026-10-01T10:00:00.000Z' }],
    sync: { userId, outbox: [], cursors: {} },
  },
  version: 0,
})
map.set(stateKey(GUEST), containerOf('DATI-GUEST'))
map.set(LEGACY_STATE_KEY, containerOf('VECCHIO-STORAGE'))
map.set('spendy-guest-claimed-by', 'qualcuno-prima') // il guest resta guest
map.set('chiave-di-un-altra-app', 'non toccare')
const dom = installFakeDom(map)
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const guestIntact = () => map.get(stateKey(GUEST))?.includes('DATI-GUEST') && map.get(LEGACY_STATE_KEY) === containerOf('VECCHIO-STORAGE') && map.get('chiave-di-un-altra-app') === 'non toccare'

// Listener di documento e finestra, scheda per scheda (il DOM finto li ignora).
let loadingTab = null
const listenersOf = new Map()
const record = (kind) => (type, fn) => { if (loadingTab) listenersOf.get(loadingTab).push({ kind, type, fn }) }
dom.document.addEventListener = record('document')
dom.document.removeEventListener = () => {}
globalThis.window.addEventListener = record('window')
globalThis.window.removeEventListener = () => {}
const storageEventTo = async (tab) => {
  for (const l of listenersOf.get(tab.name)) if (l.kind === 'window' && l.type === 'storage') l.fn({ key: RETIRED_SCOPES_KEY })
  await settle()
}

const setOnline = (value) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: value }, configurable: true, writable: true })
setOnline(true)

// --- JWT e Supabase Auth finto (HTTP) ----------------------------------------
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (sub, exp = Math.floor(Date.now() / 1000) + 3600) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp })}.firma-finta`
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
const FAKE_URL = 'https://progetto-finto.supabase.invalid'
const FAKE_KEY = 'chiave-pubblica-finta'
const server = { users: new Set([A, C, E, M, 'utente-b']), userCalls: 0, hold: null }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  if (!url.startsWith(`${FAKE_URL}/auth/v1/user`)) throw new Error(`richiesta inattesa: ${url}`)
  server.userCalls += 1
  if (server.hold) await server.hold
  const claims = claimsOf(String(init.headers?.Authorization ?? '').replace(/^Bearer /, ''))
  if (!server.users.has(claims.sub)) return json(403, { code: 'user_not_found', message: 'User from sub claim in JWT does not exist' })
  return json(200, { id: claims.sub })
}

const clients = []
function makeClient(name) {
  const c = {
    name, current: null, listeners: [], signOutCalls: [],
    emit: async (event, session) => { for (const cb of [...c.listeners]) await cb(event, session) },
    // Come BroadcastChannel: l'evento arriva anche alle altre schede.
    broadcast: async (event, session) => { for (const other of clients) if (other !== c) { other.current = session; await other.emit(event, session) } },
    login: async (id) => { c.current = { access_token: jwt(id), refresh_token: `ref-${id}`, user: { id } }; await c.emit('SIGNED_IN', c.current); await settle() },
    serverEndsSession: async () => { c.current = null; await c.emit('SIGNED_OUT', null); await settle() },
  }
  c.supabase = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy }, error: null }) }) }) }),
    auth: {
      getSession: async () => ({ data: { session: c.current }, error: null }),
      onAuthStateChange: (cb) => {
        c.listeners.push(cb)
        return { data: { subscription: { unsubscribe() { c.listeners = c.listeners.filter((other) => other !== cb) } } } }
      },
      getUser: async () => { throw new Error('la verifica non deve usare getUser') },
      async signOut(options) {
        c.signOutCalls.push(options)
        c.current = null
        await c.emit('SIGNED_OUT', null)
        await c.broadcast('SIGNED_OUT', null)
        return { error: null }
      },
    },
  }
  clients.push(c)
  return c
}

// Remote del motore di sync: pull e push si possono trattenere.
function makeRemote() {
  const r = {
    pullGate: null, upsertGate: null, rejectFk: false, pullRows: {}, upserts: [],
    async pull(table) {
      if (r.pullGate) await r.pullGate.promise
      const rows = r.pullRows[table] ?? []
      r.pullRows[table] = []
      return { rows, error: null }
    },
    async upsert(table, rows) {
      if (r.upsertGate) await r.upsertGate.promise
      r.upserts.push({ table, rows })
      // Account eliminato: la riga punta a un utente che non c'è più (FK).
      if (r.rejectFk) return { error: `${table}: insert or update violates foreign key constraint`, code: '23503' }
      return { error: null, code: null }
    },
  }
  return r
}
const gate = () => { let release; const promise = new Promise((resolve) => { release = resolve }); return { promise, release } }

// --- una scheda ---------------------------------------------------------------
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const act = async (fn) => { flushSync(fn); await settle() }
async function openTab(name, client, remote, { realEngine = false } = {}) {
  globalThis.__tab = { client, remote }
  const stubs = {
    '../lib/supabase.js': `
      export const isSupabaseConfigured = true
      export const supabaseUrl = '${FAKE_URL}'
      export const supabaseAnonKey = '${FAKE_KEY}'
      export const supabase = globalThis.__tab.client.supabase`,
    './supabaseRemote.js': 'const remote = globalThis.__tab.remote\nexport const createSupabaseRemote = () => remote',
    ...(realEngine ? {} : { './syncEngine.js': 'export const createSyncEngine = () => ({ start: async () => ({}), stop() {}, syncNow: async () => ({}) })' }),
  }
  const vite = await createServer({
    root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
    cacheDir: join(tmpdir(), `spendy-multitab-test-vite-${name}`),
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: `tab-${name}`,
      enforce: 'pre',
      resolveId(source, importer) {
        if (source.endsWith('/lib/supabase.js') && stubs['../lib/supabase.js']) return `\0${name}:../lib/supabase.js`
        if (importer?.split('?')[0].endsWith('/src/sync/spendySync.js') && source in stubs) return `\0${name}:${source}`
        return null
      },
      load(id) {
        if (id.startsWith(`\0${name}:`)) return stubs[id.slice(name.length + 2)]
        if (id.split('?')[0].endsWith('.css')) return 'export default {}'
        return null
      },
    }, react()],
  })
  const { useAppStore } = await vite.ssrLoadModule('/src/store/useAppStore.js')
  const sync = await vite.ssrLoadModule('/src/sync/spendySync.js')
  const sessionGate = await vite.ssrLoadModule('/src/sync/sessionGate.js')
  const voice = await vite.ssrLoadModule('/src/ai/spendyVoiceCache.js')
  const mappers = await vite.ssrLoadModule('/src/sync/mappers.js')
  const { default: App } = await vite.ssrLoadModule('/src/App.jsx')
  listenersOf.set(name, [])
  loadingTab = name
  const container = dom.createContainer()
  const errors = []
  const root = createRoot(container, { onCaughtError: (e) => errors.push(e), onUncaughtError: (e) => errors.push(e), onRecoverableError: () => {} })
  await act(() => root.render(h(App)))
  loadingTab = null
  return {
    name, client, remote, vite, root, errors, sync, sessionGate, voice, mappers,
    S: useAppStore.getState,
    screen: () => dom.toHtml(container),
    close: async () => { await act(() => root.unmount()); await vite.close() },
  }
}

const has = (tab, text) => tab.S().expenses.some((e) => e.description === text)
const container = (id) => map.get(stateKey(scopeFor(id)))
const retired = () => map.get(RETIRED_SCOPES_KEY) ?? ''

let tab1 = null
let tab2 = null
try {
  const client1 = makeClient('scheda-1')
  const client2 = makeClient('scheda-2')
  const remote1 = makeRemote()
  const remote2 = makeRemote()
  remote2.pullGate = gate() // il primo pull della scheda 2 resta in volo
  tab1 = await openTab('scheda-1', client1, remote1)
  tab2 = await openTab('scheda-2', client2, remote2, { realEngine: true })

  // =====================================================================
  section('Due schede aperte su A (scheda 2: motore vero, pull ancora in volo)')
  // =====================================================================
  await client1.login(A)
  await act(() => tab1.S().addExpense({ amount: 42, categoryId: 'spesa', description: 'SEGRETO-A', date: tab1.S().today }))
  tab1.S().ackOps(tab1.S().sync.outbox)
  await client2.login(A)
  check('entrambe le schede su A; contenitore con i dati di A, nessuna modifica in sospeso',
    tab1.S().scopeId === scopeFor(A) && tab2.S().scopeId === scopeFor(A) && container(A)?.includes('SEGRETO-A') && JSON.parse(container(A)).state.sync.outbox.length === 0)
  check('   nessun dato di A nell\'elenco degli ambiti invalidati (solo impronte)', !retired().includes(A))

  // =====================================================================
  section('A eliminato altrove: la scheda 1 lo prova e rimuove il contenitore')
  // =====================================================================
  server.users.delete(A)
  await client1.serverEndsSession()
  check('scheda 1: "Account eliminato", contenitore di A rimosso', tab1.sessionGate.getSessionGateState()?.status === 'deleted' && container(A) === undefined)
  check('   ambito di A invalidato nello storage condiviso (senza id in chiaro)', retired().length > 0 && !retired().includes(A) && !retired().includes(scopeFor(A)))

  // =====================================================================
  section('Scheda 2 ancora su A, prima di ricevere qualsiasi evento: nessuna scrittura arriva')
  // =====================================================================
  await act(() => tab2.S().addExpense({ amount: 1, categoryId: 'spesa', description: 'SCRITTA-DOPO', date: tab2.S().today }))
  check('una nuova spesa nella scheda 2 NON ricrea il contenitore di A', container(A) === undefined)
  tab2.voice.saveVoiceCache({ version: 2, history: [] }, globalThis.localStorage, scopeFor(A))
  check('   la memoria di Spendy AI di A non viene ricreata', !map.has(voiceKey(scopeFor(A))))
  // Il pull partito PRIMA dell'invalidazione arriva adesso (scrittura già in corso).
  const lateRow = { ...tab2.mappers.toRemoteRow('expenses', { id: 'tardiva-1', amount: 5, categoryId: 'bar', description: 'RIGA-TARDIVA', date: '2026-10-05', updatedAt: '2026-10-05T10:00:00.000Z' }, A), updated_at: '2026-10-05T10:00:01.000Z' }
  remote2.pullRows.expenses = [lateRow]
  remote2.pullGate.release()
  remote2.pullGate = null
  await settle()
  check('   il pull tardivo è stato applicato in memoria…', has(tab2, 'RIGA-TARDIVA'))
  check('   …ma niente è stato scritto: il contenitore di A non esiste', container(A) === undefined)
  check('   e nessuna chiave del dispositivo nomina A', [...map.entries()].every(([k, v]) => !k.includes(A) && !String(v).includes(A)))

  // =====================================================================
  section('Scheda 2 riceve l\'evento storage: esce da A')
  // =====================================================================
  await storageEventTo(tab2)
  check('scheda 2: ambito guest, "Account eliminato", niente di A a schermo',
    tab2.S().scopeId === GUEST && tab2.sessionGate.getSessionGateState()?.status === 'deleted' && !tab2.screen().includes('SEGRETO-A') && !tab2.screen().includes('RIGA-TARDIVA'))
  // La spesa fatta nella scheda 2 DOPO l'eliminazione non è mai stata
  // sincronizzata: non si perde in silenzio. Si salva una volta, bloccata, e
  // la decisione passa all'utente (Impostazioni).
  const gA = tab2.sessionGate.getSessionGateState()
  check('   la modifica mai sincronizzata della scheda 2 è conservata, non cancellata', gA?.pending === 1 && gA.removed === false && container(A)?.includes('SCRITTA-DOPO'), JSON.stringify(gA))
  check('   il contenitore resta bloccato: la scheda 2 (ora guest) non scrive più lì', tab2.S().retiredReasonFor(A) === 'deleted')
  check('   guest e vecchio storage intatti', guestIntact())
  tab1.sync.continueWithoutAccount()
  tab2.sync.continueWithoutAccount()

  // =====================================================================
  section('Modifica salvata dalla scheda 2, che la scheda 1 non ha in memoria: nessuna perdita')
  // =====================================================================
  await client1.login(E)
  await client2.login(E)
  remote2.upsertGate = gate() // il push della scheda 2 resterà in volo
  await act(() => tab2.S().addExpense({ amount: 7, categoryId: 'spesa', description: 'SOLO-SCHEDA-2', date: tab2.S().today }))
  const pushInFlight = tab2.sync.syncNow()
  await settle()
  check('preparazione: la scheda 1 non ha la modifica in memoria, il contenitore sì',
    tab1.S().sync.outbox.length === 0 && JSON.parse(container(E)).state.sync.outbox.length === 1 && remote2.upserts.length === 0)
  server.users.delete(E)
  await client1.serverEndsSession()
  // La scheda 1, chiudendo la sessione, ha salvato il suo stato (senza la
  // modifica della scheda 2) sopra il contenitore: per lei non c'era niente in
  // sospeso, e lo ha rimosso. È il caso da non perdere.
  const g1 = tab1.sessionGate.getSessionGateState()
  check('scheda 1: eliminazione provata (per lei nessuna modifica in sospeso)', g1?.status === 'deleted' && tab1.S().retiredReasonFor(E) === 'deleted', JSON.stringify(g1))
  // Il push partito prima arriva adesso: il server lo rifiuta (l'utente non c'è più).
  remote2.rejectFk = true
  remote2.upsertGate.release()
  remote2.upsertGate = null
  await pushInFlight
  await settle()
  check('   push tardivo rifiutato: la modifica resta tra quelle non sincronizzate (in memoria)', tab2.S().sync.outbox.length + tab2.S().sync.rejected.length === 1)
  check('   e non viene scritta nel contenitore normale di E', container(E) === undefined || !JSON.parse(container(E)).state.sync.rejected?.length)
  await storageEventTo(tab2)
  const g2 = tab2.sessionGate.getSessionGateState()
  check('scheda 2: esce da E con "Account eliminato" e 1 modifica in sospeso, NON rimossa', tab2.S().scopeId === GUEST && g2?.status === 'deleted' && g2.pending === 1 && g2.removed === false, JSON.stringify(g2))
  check('   la modifica è salva nel contenitore di E (bloccato)', container(E)?.includes('SOLO-SCHEDA-2') && tab2.S().retiredReasonFor(E) === 'deleted')
  remote2.rejectFk = false

  // =====================================================================
  section('Chiudi, accesso con un altro account, riavvio: la scelta resta in Impostazioni (M1)')
  // =====================================================================
  tab1.sync.continueWithoutAccount()
  await client1.login('utente-b')
  check('scheda 1 su B: niente di E, nessuna schermata', tab1.S().scopeId === scopeFor('utente-b') && !has(tab1, 'SOLO-SCHEDA-2') && tab1.sessionGate.getSessionGateState() === null)
  check('   A ed E sono tra gli account eliminati con dati sul dispositivo', tab1.sync.deletedAccountsOnDevice().some((x) => x.userId === E && x.unsynced === 1) && tab1.sync.deletedAccountsOnDevice().some((x) => x.userId === A))
  await tab1.close()
  tab1 = await openTab('scheda-1b', client1, remote1)
  await act(() => tab1.S().openModal('settings'))
  check('dopo il riavvio, in Impostazioni: "Dati di account eliminati" con l\'avviso', tab1.screen().includes('Dati di account eliminati') && tab1.screen().includes('1 modifica non è mai stata sincronizzata') && tab1.screen().includes('Scarica una copia'))
  check('   la copia scaricabile contiene la modifica', tab1.S().accountContainerState(E)?.expenses?.some((e) => e.description === 'SOLO-SCHEDA-2'))
  check('rimozione esplicita: via solo E (A resta in elenco)', tab1.sync.forgetDeletedAccount(E) === true && container(E) === undefined && tab1.sync.deletedAccountsOnDevice().map((x) => x.userId).join() === A)
  check('   poi anche A: elenco vuoto', tab1.sync.forgetDeletedAccount(A) === true && container(A) === undefined && tab1.sync.deletedAccountsOnDevice().length === 0)
  await act(() => tab2.S().addExpense({ amount: 1, categoryId: 'spesa', description: 'ANCORA-GUEST', date: tab2.S().today }))
  check('   e l\'ambito di E resta bloccato anche dopo (la scheda 2 è guest e scrive nel guest)', container(E) === undefined && map.get(stateKey(GUEST)).includes('ANCORA-GUEST'))
  await act(() => tab1.S().closeModal())
  await client1.serverEndsSession() // B esce (sessione finita): non c'entra con E

  // =====================================================================
  section('Rimozione SCELTA dall\'utente mentre l\'altra scheda ha ancora modifiche in memoria')
  // =====================================================================
  tab1.sync.continueWithoutAccount()
  const F = 'utente-f-rimozione-scelta'
  server.users.add(F)
  await client1.login(F)
  await client2.login(F)
  remote2.upsertGate = gate() // i push della scheda 2 restano in volo: le sue modifiche restano non sincronizzate
  await act(() => tab1.S().addExpense({ amount: 6, categoryId: 'spesa', description: 'F-SCHEDA-1', date: tab1.S().today }))
  await act(() => tab2.S().addExpense({ amount: 8, categoryId: 'spesa', description: 'F-SCHEDA-2', date: tab2.S().today }))
  server.users.delete(F)
  await client1.serverEndsSession()
  check('scheda 1: eliminazione provata, contenitore conservato (modifiche in sospeso)', tab1.sessionGate.getSessionGateState()?.removed === false && container(F) !== undefined)
  tab1.sync.continueWithoutAccount()
  check('l\'utente sceglie di rimuoverlo (Impostazioni)', tab1.sync.forgetDeletedAccount(F) === true && container(F) === undefined)
  await storageEventTo(tab2)
  check('   la scheda 2, con modifiche ancora in memoria, NON lo ricrea: la scelta dell\'utente vale', container(F) === undefined && tab2.S().scopeId === GUEST)
  tab2.sync.continueWithoutAccount()

  // =====================================================================
  section('Logout VOLONTARIO nella scheda 1: la scheda 2 nasconde, non cancella, non invalida')
  // =====================================================================
  tab1.sync.continueWithoutAccount()
  await client1.login(C)
  await act(() => tab1.S().addExpense({ amount: 3, categoryId: 'spesa', description: 'DATI-DI-C', date: tab1.S().today }))
  await client2.login(C)
  check('preparazione: entrambe su C', tab1.S().scopeId === scopeFor(C) && tab2.S().scopeId === scopeFor(C))
  check('scheda 1: logout senza errori', await tab1.sync.signOut() === null)
  await settle()
  check('scheda 1: guest, nessuna schermata', tab1.S().scopeId === GUEST && tab1.sessionGate.getSessionGateState() === null)
  check('scheda 2: "Sessione terminata" (non "eliminato"), dati di C nascosti', tab2.sessionGate.getSessionGateState()?.status === 'ended' && !tab2.screen().includes('DATI-DI-C'))
  check('   C non è invalidato, il suo contenitore c\'è ancora', tab2.S().retiredReasonFor(C) === null && container(C)?.includes('DATI-DI-C'))
  await client2.login(C)
  check('   C rientra nella scheda 2: tutto torna', tab2.sessionGate.getSessionGateState() === null && has(tab2, 'DATI-DI-C'))

  // =====================================================================
  section('Rimozione A MANO in una scheda mentre l\'altra è ancora sull\'account')
  // =====================================================================
  await client1.login(M)
  await act(() => tab1.S().addExpense({ amount: 4, categoryId: 'spesa', description: 'DATI-M', date: tab1.S().today }))
  await client2.login(M)
  await client1.serverEndsSession()
  await client2.serverEndsSession()
  check('entrambe "Sessione terminata" su M', tab1.sessionGate.getSessionGateState()?.status === 'ended' && tab2.sessionGate.getSessionGateState()?.status === 'ended')
  check('scheda 1: "Rimuovi" → contenitore di M rimosso, M bloccato come "rimosso"', tab1.sync.forgetGatedAccount() === true && container(M) === undefined && tab1.S().retiredReasonFor(M) === 'removed')
  await act(() => tab2.S().addExpense({ amount: 1, categoryId: 'spesa', description: 'DOPO-RIMOZIONE', date: tab2.S().today }))
  check('   la scheda 2 (ancora su M) non lo ricrea', container(M) === undefined)
  await storageEventTo(tab2)
  check('   e all\'evento storage esce a guest', tab2.S().scopeId === GUEST)
  await client1.login(M)
  check('M rientra con una sessione vera: di nuovo utilizzabile', tab1.S().retiredReasonFor(M) === null && tab1.S().scopeId === scopeFor(M))
  await act(() => tab1.S().addExpense({ amount: 2, categoryId: 'spesa', description: 'M-DI-NUOVO', date: tab1.S().today }))
  check('   e le sue scritture tornano a salvarsi', container(M)?.includes('M-DI-NUOVO'))

  // =====================================================================
  section('Verifica in volo mentre entra un altro account (L1/L2)')
  // =====================================================================
  const X = 'utente-x-eliminato'
  const Y = 'utente-y-nuovo'
  server.users.add(X)
  server.users.add(Y)
  await client1.login(X)
  server.users.delete(X)
  const held = gate()
  server.hold = held.promise
  await client1.serverEndsSession() // parte la verifica con il token di X, trattenuta
  check('preparazione: "Sessione terminata" per X, verifica in volo', tab1.sessionGate.getSessionGateState()?.status === 'ended' && tab1.sessionGate.getSessionGateState()?.userId === X)
  await client1.login(Y)
  client1.signOutCalls.length = 0
  held.release()
  server.hold = null
  await settle()
  check('L1: nessuna schermata "Account eliminato" per chi ora è Y', tab1.sessionGate.getSessionGateState() === null && tab1.S().scopeId === scopeFor(Y))
  check('L2: la sessione di Y non è stata toccata', client1.signOutCalls.length === 0 && client1.current?.user?.id === Y)
  check('   i dati di X sono comunque stati ripuliti e bloccati', container(X) === undefined && tab1.S().retiredReasonFor(X) === 'deleted')

  // =====================================================================
  section('Guest e altre app')
  // =====================================================================
  check('dati guest, vecchio storage e chiavi di altre app intatti', guestIntact())
  check('dopo le rimozioni esplicite nessuna chiave o valore nomina A, E, F o X', [...map.entries()].every(([k, v]) => [A, E, 'utente-f-rimozione-scelta', 'utente-x-eliminato'].every((id) => !k.includes(id) && !String(v).includes(id))))
  check('nessun errore di rendering nelle due schede', tab1.errors.length === 0 && tab2.errors.length === 0, (tab1.errors[0] ?? tab2.errors[0])?.message)
} finally {
  if (tab1) await tab1.close()
  if (tab2) await tab2.close()
}

report('Più schede sullo stesso storage')
