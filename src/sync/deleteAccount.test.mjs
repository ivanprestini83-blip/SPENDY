// Eliminazione account — il flusso nell'app: spendySync.deleteAccount vero,
// sopra lo store vero e un localStorage finto in cui convivono più account.
// Il client Supabase è finto (nessuna rete, nessun account reale): la Edge
// Function risponde come quella vera. Motore di sync e remoto sono controfigure,
// come nel test del logout.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { check, section, report } from './testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import {
  stateKey, voiceKey, scopeFor, GUEST, LEGACY_STATE_KEY, GUEST_CLAIM_KEY, MIGRATION_KEY, ACTIVE_SCOPE_KEY,
} from '../store/scope.js'

const A = 'utente-a-0001'
const B = 'utente-b-0002'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// --- il dispositivo: dati di B, del guest e del vecchio storage già presenti ---
const map = new Map()
const container = (description, userId = null) => JSON.stringify({
  state: {
    expenses: [{ id: `e-${description}`, amount: 10, categoryId: 'bar', description, date: '2026-10-01', updatedAt: '2026-10-01T10:00:00.000Z' }],
    sync: { userId, outbox: [], cursors: { expenses: '2026-10-01T10:00:00.000Z' } },
    spendyJokeHistory: [{ key: 'bar:frequency_up', text: description, shownAt: '2026-10-01' }],
  },
  version: 0,
})
const B_KEYS = {
  [stateKey(scopeFor(B))]: container('DATI-DI-B', B),
  [voiceKey(scopeFor(B))]: '{"version":1,"history":[{"message":"frase di B"}]}',
  [`spendy-backup-auto-u-${B}-2026-10-01T10-00-00-000Z`]: '{"backup":"di B"}',
}
const OTHER_KEYS = {
  [stateKey(GUEST)]: container('DATI-GUEST'),
  [LEGACY_STATE_KEY]: container('VECCHIO-STORAGE'),
  // A è stato il primo account del dispositivo, e i dati del vecchio storage
  // erano suoi: entrambe le chiavi globali nominano A.
  [GUEST_CLAIM_KEY]: A,
  [MIGRATION_KEY]: JSON.stringify({ at: '2026-09-20T10:00:00.000Z', status: 'migrated', scope: scopeFor(A) }),
  'chiave-di-un-altra-app': 'non toccare',
}
for (const [key, value] of Object.entries({ ...B_KEYS, ...OTHER_KEYS })) map.set(key, value)
installFakeDom(map)

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
  name: 'delete-account-stubs',
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
  cacheDir: join(tmpdir(), 'spendy-delete-account-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [stubPlugin],
})

const setOnline = (value) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: value }, configurable: true, writable: true })

// Client Supabase finto con la sessione di A; la funzione delete-account risponde
// come quella vera: { deleted: true } oppure un errore HTTP.
function createFake() {
  const session = { access_token: 'tok-a', refresh_token: 'ref-a', user: { id: A, email: 'a@esempio.invalid' } }
  const f = {
    session, current: session, listeners: [], signOutCalls: [], invokeCalls: [],
    engineStarts: 0, engineStops: 0, invokeMode: 'ok', release: null,
    emit: async (event, s) => { for (const cb of f.listeners) await cb(event, s) },
  }
  f.supabase = {
    auth: {
      getSession: async () => ({ data: { session: f.current } }),
      onAuthStateChange: (cb) => { f.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } } },
      async signOut(options) {
        f.signOutCalls.push(options)
        // l'utente non esiste più: il server risponde con un errore, ma il client toglie la sessione
        f.current = null
        await f.emit('SIGNED_OUT', null)
        return { error: { message: 'User not found', status: 403 } }
      },
    },
    functions: {
      async invoke(name, options) {
        f.invokeCalls.push({ name, options, token: f.current?.access_token ?? null })
        if (f.release) await new Promise((resolve) => { f.release = resolve })
        if (f.invokeMode === 'server-error') return { data: null, error: { name: 'FunctionsHttpError', context: { status: 502 } } }
        if (f.invokeMode === 'unauthenticated') return { data: null, error: { name: 'FunctionsHttpError', context: { status: 401 } } }
        return { data: { deleted: true }, error: null }
      },
    },
  }
  return f
}

const A_STATE = stateKey(scopeFor(A))
const A_VOICE = voiceKey(scopeFor(A))
const A_CORRUPT = `${A_STATE}:corrupt:2026-10-01T10-00-00-000Z`
const A_BACKUP = `spendy-backup-auto-u-${A}-2026-10-02T10-00-00-000Z`

try {
  const fake = createFake()
  globalThis.__fake = fake
  setOnline(true)

  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const sync = await server.ssrLoadModule('/src/sync/spendySync.js')
  const { DELETE_ACCOUNT_MESSAGES } = await server.ssrLoadModule('/src/lib/accountDeletion.js')
  const { requestAndStoreVoice } = await server.ssrLoadModule('/src/ai/spendyVoiceRequest.js')
  const { emptyVoiceCache, saveVoiceCache, loadVoiceCache } = await server.ssrLoadModule('/src/ai/spendyVoiceCache.js')
  const S = useAppStore.getState

  sync.bootstrapSync()
  await tick(); await tick()
  check('avvio: ambito di A, motore acceso', S().scopeId === scopeFor(A) && fake.engineStarts === 1)
  S().addExpense({ amount: 42, categoryId: 'spesa', description: 'SEGRETO-A', date: S().today })
  S().recordSpendyJoke({ key: 'spesa:recurring_high', text: 'battuta di A', shownAt: S().today })
  map.set(A_VOICE, '{"version":1,"history":[{"message":"frase di A"}]}')
  map.set(A_CORRUPT, 'copia corrotta di A')
  map.set(A_BACKUP, '{"backup":"di A"}')
  const hasA = () => S().expenses.some((e) => e.description === 'SEGRETO-A')
  check('premessa: i dati di A sono salvati nel suo contenitore', map.has(A_STATE) && map.get(A_STATE).includes('SEGRETO-A'))

  const aIntact = () => S().scopeId === scopeFor(A) && hasA() && map.has(A_STATE) && map.has(A_VOICE) && map.has(A_CORRUPT) && map.has(A_BACKUP)

  // =====================================================================
  section('9. Errore del server: nessuna falsa cancellazione locale')
  // =====================================================================
  fake.invokeMode = 'server-error'
  let result = await sync.deleteAccount()
  check('restituisce l\'errore', result === DELETE_ACCOUNT_MESSAGES.failed, String(result))
  check('   ambito, dati a schermo e dati salvati di A intatti', aIntact())
  check('   sessione intatta, nessun logout', fake.current !== null && fake.signOutCalls.length === 0)
  check('   motore non spento', fake.engineStops === 0)

  fake.invokeMode = 'unauthenticated'
  result = await sync.deleteAccount()
  check('sessione rifiutata dal server: errore, niente toccato', result === DELETE_ACCOUNT_MESSAGES.unauthenticated && aIntact() && fake.signOutCalls.length === 0)

  setOnline(false)
  const callsBefore = fake.invokeCalls.length
  result = await sync.deleteAccount()
  check('offline: errore, nessuna richiesta, niente toccato', result === DELETE_ACCOUNT_MESSAGES.offline && fake.invokeCalls.length === callsBefore && aIntact())
  setOnline(true)

  // =====================================================================
  section('10. Doppio click: una sola richiesta')
  // =====================================================================
  fake.invokeMode = 'ok'
  fake.invokeCalls.length = 0
  // Una frase di Spendy AI per A è già partita (come fa useSpendyVoice) e
  // risponderà solo DOPO l'eliminazione dell'account.
  let answerAI
  const lateAI = { generate: () => new Promise((resolve) => { answerAI = resolve }) }
  const aiInFlight = requestAndStoreVoice({
    ai: lateAI, context: {}, cache: emptyVoiceCache(), today: S().today, scope: scopeFor(A),
    meta: { fingerprint: 'f-tardiva', eventKey: 'evento-tardivo', importance: 90, facts: '{}' },
  })
  map.delete(A_VOICE)
  map.set(A_VOICE, '{"version":1,"history":[{"message":"frase di A"}]}')

  fake.release = true // la risposta del server resta in sospeso finché il test non la libera
  const first = sync.deleteAccount()
  const second = sync.deleteAccount()
  await tick(); await tick()
  check('il secondo tocco riceve la stessa operazione', first === second)
  check('   una sola chiamata alla funzione', fake.invokeCalls.length === 1, String(fake.invokeCalls.length))
  check('   mentre il server risponde, nulla è ancora cancellato', aIntact() && fake.current !== null)
  fake.release()
  fake.release = null
  result = await first

  // =====================================================================
  section('1 + 11. Riuscita: account eliminato, sessione chiusa')
  // =====================================================================
  check('nessun errore', result === null, String(result))
  check('la richiesta è partita con la sessione di A e senza nessun id', fake.invokeCalls[0]?.name === 'delete-account' && fake.invokeCalls[0]?.token === 'tok-a' && JSON.stringify(fake.invokeCalls[0]?.options?.body) === '{}')
  check('sessione chiusa solo su questo dispositivo', fake.signOutCalls.length === 1 && fake.signOutCalls[0]?.scope === 'local' && fake.current === null)
  check('motore spento', fake.engineStops >= 1)
  check('ambito guest: l\'app torna all\'accesso', S().scopeId === GUEST && map.get(ACTIVE_SCOPE_KEY) === GUEST)
  check('a schermo niente di A', !hasA() && !JSON.stringify(S().spendyJokeHistory).includes('battuta di A'))

  // =====================================================================
  section('7. Dati locali di A: rimossi')
  // =====================================================================
  check('contenitore di A (spese, entrate, obiettivi, categorie, fondo, battute, coda, cursori)', !map.has(A_STATE))
  check('memoria di Spendy AI di A', !map.has(A_VOICE))
  check('copia corrotta del contenitore di A', !map.has(A_CORRUPT))
  check('backup automatico di A', !map.has(A_BACKUP))
  check('marcatore del primo account (era A): rimosso', !map.has(GUEST_CLAIM_KEY))
  const marker = JSON.parse(map.get(MIGRATION_KEY) ?? 'null')
  check('marcatore della migrazione: resta (niente nuova migrazione) ma non nomina più A',
    marker?.status === 'migrated' && marker?.at === '2026-09-20T10:00:00.000Z' && !('scope' in marker))
  const mentions = [...map.entries()].filter(([k, v]) => k.includes(A) || String(v).includes(A) || String(v).includes('SEGRETO-A'))
  check('nessuna chiave né valore nel localStorage identifica più A', mentions.length === 0, mentions.map(([k]) => k).join(','))

  // =====================================================================
  section('Spendy AI in corso durante l\'eliminazione')
  // =====================================================================
  answerAI({ ok: true, response: { shouldShow: true, message: 'frase tardiva per A', state: 'happy', tone: 'friendly', layout: null, animation: 'gentle', priority: 50 } })
  const late = await aiInFlight
  check('la risposta AI arriva dopo l\'eliminazione', late.result?.ok === true)
  check('   ma NON ricrea la memoria di Spendy AI di A', !map.has(A_VOICE))
  check('   e nessuna chiave dell\'account eliminato ricompare', ![...map.entries()].some(([k, v]) => k.includes(A) || String(v).includes('frase tardiva')))
  check('   la notifica di quella risposta viene scartata (A non è più l\'ambito attivo)',
    S().addNotification(scopeFor(A), { id: 'n-tardiva', kind: 'ai', title: 'tardiva', body: 'frase tardiva per A', createdAt: S().today }) === false
    && ![...map.values()].some((v) => String(v).includes('frase tardiva')))
  check('   salvataggi diretti nella cache AI di A: rifiutati', saveVoiceCache(emptyVoiceCache(), globalThis.localStorage, scopeFor(A)) === false && !map.has(A_VOICE))
  check('   la cache AI degli altri funziona come prima',
    saveVoiceCache({ ...emptyVoiceCache(), lastShown: { message: 'guest ok', day: S().today } }, globalThis.localStorage, GUEST) === true
    && loadVoiceCache(globalThis.localStorage, GUEST).lastShown?.message === 'guest ok')

  // =====================================================================
  section('8. Dati locali degli altri: intatti')
  // =====================================================================
  for (const [key, value] of Object.entries(B_KEYS)) check(`   B: ${key.split(':').slice(0, 2).join(':').slice(0, 40)}…`, map.get(key) === value)
  check('   guest intatto', map.get(stateKey(GUEST)) === OTHER_KEYS[stateKey(GUEST)] || JSON.parse(map.get(stateKey(GUEST))).state.expenses.some((e) => e.description === 'DATI-GUEST'))
  check('   vecchio spendy-storage intatto', map.get(LEGACY_STATE_KEY) === OTHER_KEYS[LEGACY_STATE_KEY])
  check('   chiavi di altre app intatte', map.get('chiave-di-un-altra-app') === 'non toccare')

  // Il guest continua a lavorare: nessuna scrittura ricrea i dati di A.
  S().addExpense({ amount: 1, categoryId: 'bar', description: 'DOPO', date: S().today })
  await tick()
  check('dopo, il guest scrive nel suo contenitore e A non ricompare', !map.has(A_STATE) && map.get(stateKey(GUEST)).includes('DOPO'))

  // Un nuovo accesso di B ritrova i suoi dati.
  fake.current = { access_token: 'tok-b', refresh_token: 'ref-b', user: { id: B } }
  await fake.emit('SIGNED_IN', fake.current)
  await tick()
  check('B entra e ritrova i propri dati', S().scopeId === scopeFor(B) && S().expenses.some((e) => e.description === 'DATI-DI-B'))

  // =====================================================================
  section('La pulizia locale non può toccare l\'ambito attivo')
  // =====================================================================
  const removed = S().forgetAccountData(B)
  check('forgetAccountData sull\'account attivo: rifiutato, niente rimosso', removed.length === 0 && map.has(stateKey(scopeFor(B))) && S().expenses.some((e) => e.description === 'DATI-DI-B'))
  check('id non valido: niente rimosso', S().forgetAccountData('').length === 0 && S().forgetAccountData(null).length === 0)
  const C = 'utente-c-0003'
  check('premessa: ora il marcatore del primo account è B', map.get(GUEST_CLAIM_KEY) === B)
  S().forgetAccountData(C)
  check('pulizia di un altro account: il marcatore di B resta', map.get(GUEST_CLAIM_KEY) === B)
  check('   e il marcatore della migrazione resta com\'era', JSON.stringify(JSON.parse(map.get(MIGRATION_KEY))) === JSON.stringify(marker))
  check('   la cache AI di B si salva normalmente', saveVoiceCache(emptyVoiceCache(), globalThis.localStorage, scopeFor(B)) === true)
} finally {
  await server.close()
  delete globalThis.__fake
}

report('Eliminazione account (app)')
