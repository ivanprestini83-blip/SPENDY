// Logout da questo dispositivo: cosa succede quando Supabase non riesce a
// chiudere la sessione (senza rete).
//
// Il client Supabase vero, in quel caso, CANCELLA la sessione locale, emette
// SIGNED_OUT e SOLO DOPO restituisce l'errore. Il client qui è finto ma si
// comporta esattamente così; spendySync.js è quello vero (caricato da Vite),
// sopra lo store vero. Motore di sincronizzazione e remoto sono sostituiti
// con controfigure: qui interessa lo scope, non il protocollo.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { check, section, report } from './testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import { LEGAL_VERSIONS } from '../../supabase/functions/_shared/legalVersions.js'

// localStorage finto: senza, i dati di A non sopravvivrebbero al cambio di ambito.
installFakeDom(new Map())

const A = 'utente-a-0001'
const scopeFor = (id) => `u:${id}`
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const STUBS = {
  '../lib/supabase.js': `
    export const isSupabaseConfigured = true
    export const supabase = globalThis.__fake.supabase`,
  './supabaseRemote.js': 'export const createSupabaseRemote = () => ({})',
  './syncEngine.js': `
    export const createSyncEngine = () => ({
      start: () => { globalThis.__fake.engineStarts += 1; return {} },
      stop: () => { globalThis.__fake.engineStops += 1 },
      syncNow: async () => ({}),
    })`,
}
const stubPlugin = {
  name: 'signout-stubs',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer && importer.split('?')[0].endsWith('/src/sync/spendySync.js') && source in STUBS) return `\0stub:${source}`
    return null
  },
  load: (id) => (id.startsWith('\0stub:') ? STUBS[id.slice(6)] : null),
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-signout-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [stubPlugin],
})

const setOnline = (value) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: value }, configurable: true, writable: true })

// Un client Supabase finto con la sessione di A e il comportamento reale in caso di errore.
function createFake() {
  const session = { access_token: 'tok-a', refresh_token: 'ref-a', user: { id: A } }
  const f = {
    session, current: session, listeners: [], signOutCalls: [], setSessionCalls: 0,
    engineStarts: 0, engineStops: 0,
    signOutMode: 'ok', restoreMode: 'ok',
    emit: async (event, s) => { for (const cb of f.listeners) await cb(event, s) },
  }
  f.supabase = {
    // Account che ha già accettato Termini e Privacy correnti (legal_acceptances):
    // il sync parte come prima del cancello legale (vedi legalGate.test).
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy }, error: null }) }) }) }),
    auth: {
      getSession: async () => ({ data: { session: f.current } }),
      onAuthStateChange: (cb) => { f.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } } },
      async signOut(options) {
        f.signOutCalls.push(options)
        if (f.signOutMode === 'ok') { f.current = null; await f.emit('SIGNED_OUT', null); return { error: null } }
        // senza rete: la libreria toglie la sessione locale, avvisa, e poi restituisce l'errore
        f.current = null
        await f.emit('SIGNED_OUT', null)
        return { error: { message: 'Failed to fetch', name: 'AuthRetryableFetchError', status: 0 } }
      },
      async setSession(s) {
        f.setSessionCalls += 1
        if (f.restoreMode === 'fail') return { data: { user: null, session: null }, error: { message: 'Failed to fetch' } }
        f.current = { ...session, ...s }
        await f.emit('SIGNED_IN', f.current)
        return { data: { user: session.user, session: f.current }, error: null }
      },
    },
  }
  return f
}

try {
  const fake = createFake()
  globalThis.__fake = fake
  setOnline(true)

  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const sync = await server.ssrLoadModule('/src/sync/spendySync.js')
  const S = useAppStore.getState

  // Avvio come fa App.jsx: c'è già una sessione di A.
  sync.bootstrapSync()
  await tick(); await tick()
  check('avvio: ambito di A e motore acceso', S().scopeId === scopeFor(A) && fake.engineStarts === 1)
  S().addExpense({ amount: 123.45, categoryId: 'spesa', description: 'SEGRETO-A', date: S().today })
  const hasA = () => S().expenses.some((e) => e.description === 'SEGRETO-A')
  const stillAccountA = () => S().scopeId === scopeFor(A) && hasA()

  // =====================================================================
  section('Senza rete (Wi-Fi spento): errore, niente cambio, nessuna chiamata')
  // =====================================================================
  setOnline(false)
  let result = await sync.signOut()
  check('restituisce l\'errore offline', result === sync.SIGNOUT_OFFLINE_MESSAGE, result)
  check('lo scope resta quello di A', S().scopeId === scopeFor(A), S().scopeId)
  check('i dati di A sono ancora a schermo (non è tornato guest)', hasA())
  check('Supabase non è stato nemmeno chiamato: la sessione è intatta', fake.signOutCalls.length === 0 && fake.current !== null)
  check('il motore non è stato spento', fake.engineStops === 0 && fake.engineStarts === 1)

  // =====================================================================
  section('Online ma la chiusura fallisce a metà (la libreria toglie la sessione e poi dà errore)')
  // =====================================================================
  setOnline(true)
  fake.signOutMode = 'network-error'
  result = await sync.signOut()
  check('restituisce l\'errore (visibile: la card non viene smontata)', result === sync.SIGNOUT_FAILED_MESSAGE, result)
  check('lo scope resta quello di A, con i suoi dati (NON guest)', stillAccountA(), S().scopeId)
  check('chiusura richiesta solo per questo dispositivo: signOut({ scope: \'local\' })', fake.signOutCalls.length === 1 && fake.signOutCalls[0]?.scope === 'local', JSON.stringify(fake.signOutCalls))
  check('la sessione è stata ripristinata con i token salvati', fake.setSessionCalls === 1 && fake.current?.refresh_token === 'ref-a')
  check('il motore di A è di nuovo acceso', fake.engineStarts === 2)

  // =====================================================================
  section('Come sopra, ma nemmeno il ripristino riesce (rete ancora assente)')
  // =====================================================================
  fake.restoreMode = 'fail'
  fake.setSessionCalls = 0
  result = await sync.signOut()
  check('errore con indicazione di rientrare con lo stesso account', result === sync.SIGNOUT_RELOGIN_MESSAGE, result)
  check('lo scope resta quello di A: dati intatti, niente guest', stillAccountA(), S().scopeId)
  check('il ripristino è stato tentato', fake.setSessionCalls === 1)

  // =====================================================================
  section('Sessione scaduta o SIGNED_OUT non voluto: nessun cambio di scope')
  // =====================================================================
  await fake.emit('SIGNED_OUT', null)
  check('SIGNED_OUT fuori da un logout dell\'utente non cambia ambito', stillAccountA())

  // =====================================================================
  section('Torna la rete: il logout normale funziona')
  // =====================================================================
  fake.restoreMode = 'ok'
  fake.signOutMode = 'ok'
  await fake.emit('SIGNED_IN', fake.session) // rientro con la sessione di A
  fake.current = fake.session
  fake.signOutCalls.length = 0
  result = await sync.signOut()
  check('nessun errore', result === null, String(result))
  check('lo scope è guest', S().scopeId === 'guest', S().scopeId)
  check('stato vuoto: niente di A', !hasA() && S().expenses.length === 0)
  check('chiusura solo locale anche qui', fake.signOutCalls[0]?.scope === 'local')

  // A ritrova i suoi dati rientrando
  await fake.emit('SIGNED_IN', fake.session)
  await tick()
  check('A rientra e ritrova i propri dati', S().scopeId === scopeFor(A) && hasA())
} finally {
  await server.close()
  delete globalThis.__fake
}

report('Logout senza rete')
