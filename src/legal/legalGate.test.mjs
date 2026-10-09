// Il cancello legale dopo l'accesso: spendySync vero, store vero, localStorage
// finto con più account; client Supabase finto (legal_acceptances letta come
// la vedrebbe la RLS, funzione accept-legal che risponde come quella vera).
// Motore di sync sostituito da una controfigura che conta gli avvii.
// In fondo, la schermata LegalGateScreen vera con hook minimi.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, section, report, ITALIAN_USE_LANGUAGE_FAKE, isUseLanguageImport } from '../sync/testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import { LEGAL_VERSIONS } from '../../supabase/functions/_shared/legalVersions.js'
import { stateKey, scopeFor, GUEST } from '../store/scope.js'

const A = 'utente-a-esistente'
const B = 'utente-b-nuovo-dispositivo'
const C = 'utente-c-db-giu'
const D = 'utente-d-appena-registrato'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick() }
const CURRENT = { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy }

const map = new Map()
installFakeDom(map)

const SYNC_STUBS = {
  '../lib/supabase.js': `
    export const isSupabaseConfigured = true
    export const supabase = globalThis.__gate.supabase`,
  './supabaseRemote.js': 'export const createSupabaseRemote = () => ({})',
  './syncEngine.js': `
    export const createSyncEngine = () => {
      const f = globalThis.__gate
      return {
        start: (userId) => { f.engineStarts.push(userId); f.running = userId; return Promise.resolve({ started: userId }) },
        stop: () => { f.engineStops += 1; f.running = null },
        syncNow: async () => ({}),
      }
    }`,
}
const SCREEN_FAKES = {
  react: `
    export const useState = (initial) => globalThis.__gateUi.useState(initial)
    export const useSyncExternalStore = (s, g) => g()`,
  '../../sync/spendySync.js': `
    export const acceptLegalDocuments = (...args) => globalThis.__gateUi.accept(...args)
    export const retryLegalCheck = (...args) => globalThis.__gateUi.retry(...args)
    export const signOut = (...args) => globalThis.__gateUi.signOut(...args)`,
  '../settings/SyncCard.css': 'export default {}',
  '../settings/PasswordRecoveryScreen.css': 'export default {}',
}
const isScreen = (id) => (id ?? '').split('?')[0].endsWith('/components/legal/LegalGateScreen.jsx')
const harness = {
  name: 'legal-gate-harness',
  enforce: 'pre',
  resolveId(source, importer) {
    const from = importer?.split('?')[0] ?? ''
    if (from.endsWith('/src/sync/spendySync.js') && source in SYNC_STUBS) return `\0gate-sync:${source}`
    if (source === '/__gate-fake/react') return '\0gate-ui:react'
    // La schermata e i suoi pezzi parlano italiano (dizionari veri).
    if (isUseLanguageImport(source, from)) return '\0gate-ui:useLanguage'
    if (isScreen(importer) && source in SCREEN_FAKES) return `\0gate-ui:${source}`
    return null
  },
  load(id) {
    if (id.startsWith('\0gate-sync:')) return SYNC_STUBS[id.slice('\0gate-sync:'.length)]
    if (id === '\0gate-ui:useLanguage') return ITALIAN_USE_LANGUAGE_FAKE
    if (id.startsWith('\0gate-ui:')) return SCREEN_FAKES[id.slice('\0gate-ui:'.length)]
    return null
  },
  transform(code, id) {
    return isScreen(id) ? code.replace("from 'react'", "from '/__gate-fake/react'") : null
  },
}

const setOnline = (value) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: value }, configurable: true, writable: true })

function createFake() {
  const f = {
    current: null, listeners: [], engineStarts: [], engineStops: 0, running: null,
    rows: { [D]: { ...CURRENT } }, // D: riga creata dal trigger alla registrazione
    dbDown: new Set([C]),
    reads: [], invokes: [], invokeMode: 'ok', hold: false, release: null,
    signOutCalls: 0,
    emit: async (event, session) => { for (const cb of f.listeners) await cb(event, session) },
    login: async (id) => { f.current = { access_token: `tok-${id}`, refresh_token: `ref-${id}`, user: { id } }; await f.emit('SIGNED_IN', f.current) },
  }
  f.supabase = {
    from: (table) => ({
      select: () => ({
        eq: (_column, userId) => ({
          maybeSingle: async () => {
            f.reads.push({ table, userId })
            if (f.dbDown.has(userId)) return { data: null, error: { message: 'connection refused' } }
            return { data: f.rows[userId] ? { ...f.rows[userId] } : null, error: null }
          },
        }),
      }),
    }),
    functions: {
      async invoke(name, options) {
        const userId = f.current?.user?.id ?? null
        f.invokes.push({ name, options, userId })
        if (f.hold) await new Promise((resolve) => { f.release = resolve })
        if (f.invokeMode === 'server-error') return { data: null, error: { name: 'FunctionsHttpError', context: { status: 502 } } }
        if (f.invokeMode === 'offline') return { data: null, error: { name: 'FunctionsFetchError' } }
        f.rows[userId] = { terms_version: options.body.terms_version, privacy_version: options.body.privacy_version }
        return { data: { accepted: true, ...f.rows[userId], accepted_at: '2026-10-06T09:00:00.000Z' }, error: null }
      },
    },
    auth: {
      getSession: async () => ({ data: { session: f.current } }),
      onAuthStateChange: (cb) => { f.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } } },
      async signOut() { f.signOutCalls += 1; f.current = null; await f.emit('SIGNED_OUT', null); return { error: null } },
    },
  }
  return f
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-legal-gate-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [harness, react()],
})

try {
  const f = createFake()
  globalThis.__gate = f
  setOnline(true)

  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const sync = await server.ssrLoadModule('/src/sync/spendySync.js')
  const gate = await server.ssrLoadModule('/src/legal/legalGate.js')
  const S = useAppStore.getState
  const G = () => gate.getLegalGateState()
  const seen = []
  gate.subscribeLegalGate(() => seen.push(G()?.status ?? null))
  const accepted = { termsAccepted: true, privacyAcknowledged: true }
  const KEY = gate.currentLegalVersionKey()

  sync.bootstrapSync()
  await settle()

  // =====================================================================
  section('Account esistente senza legal_acceptances: schermata, niente sync')
  // =====================================================================
  await f.login(A)
  await settle()
  check('legal_acceptances letta per A, con la sessione di A', f.reads.some((r) => r.table === 'legal_acceptances' && r.userId === A))
  check('schermata obbligatoria per A', G()?.status === 'required' && G()?.userId === A, JSON.stringify(G()))
  check('il sync di A NON è partito', f.engineStarts.length === 0 && f.running === null)
  check('ambito di A (i suoi dati locali restano suoi), nessuna versione salvata', S().scopeId === scopeFor(A) && S().legalAcceptedVersion === null)
  const readsBefore = f.reads.length
  await f.emit('TOKEN_REFRESHED', f.current)
  await settle()
  check('altri eventi della stessa sessione: nessun sync, nessuna nuova verifica', f.engineStarts.length === 0 && f.reads.length === readsBefore && G()?.status === 'required')

  // =====================================================================
  section('Conferma: due spunte, errore del server, doppio tocco')
  // =====================================================================
  let result = await sync.acceptLegalDocuments({ termsAccepted: true, privacyAcknowledged: false })
  check('senza entrambe le spunte: rifiutata, nessuna richiesta', result === gate.LEGAL_GATE_MESSAGES.required && f.invokes.length === 0)

  f.invokeMode = 'server-error'
  result = await sync.acceptLegalDocuments(accepted)
  check('errore del server: messaggio, la schermata resta', result === gate.LEGAL_GATE_MESSAGES.failed && G()?.status === 'required' && G()?.error === gate.LEGAL_GATE_MESSAGES.failed)
  check('   niente sync, niente salvato in locale', f.engineStarts.length === 0 && S().legalAcceptedVersion === null)

  f.invokeMode = 'offline'
  result = await sync.acceptLegalDocuments(accepted)
  check('richiesta senza rete: messaggio offline, la schermata resta', result === gate.LEGAL_GATE_MESSAGES.offline && G()?.status === 'required' && f.engineStarts.length === 0)

  setOnline(false)
  const invokesOffline = f.invokes.length
  result = await sync.acceptLegalDocuments(accepted)
  check('dispositivo offline: nessuna richiesta partita', result === gate.LEGAL_GATE_MESSAGES.offline && f.invokes.length === invokesOffline)
  setOnline(true)

  f.invokeMode = 'ok'
  f.invokes.length = 0
  f.hold = true
  const first = sync.acceptLegalDocuments(accepted)
  const second = sync.acceptLegalDocuments(accepted)
  await settle()
  check('doppio tocco: la stessa operazione', first === second)
  check('   una sola richiesta ad accept-legal, con le versioni correnti', f.invokes.length === 1 && f.invokes[0].name === 'accept-legal'
    && f.invokes[0].options.body.terms_version === LEGAL_VERSIONS.terms && f.invokes[0].options.body.privacy_version === LEGAL_VERSIONS.privacy)
  check('   durante l\'invio: "submitting", ancora niente sync', G()?.status === 'submitting' && f.engineStarts.length === 0)
  f.release()
  f.hold = false
  result = await first
  check('confermata dal server: nessun errore', result === null)
  check('   schermata chiusa', G() === null)
  check('   sync di A avviato, una volta', f.engineStarts.length === 1 && f.engineStarts[0] === A)
  check('   versioni salvate nel contenitore di A', S().legalAcceptedVersion === KEY && map.get(stateKey(scopeFor(A))).includes(KEY))
  check('   registrata lato server per A', f.rows[A]?.terms_version === LEGAL_VERSIONS.terms)

  // =====================================================================
  section('Riapertura: già confermato su questo dispositivo')
  // =====================================================================
  await f.emit('SIGNED_OUT', null) // sessione chiusa (non un logout dell'utente)
  await f.login(A)
  await settle()
  check('A si apre subito, senza schermata', G() === null && f.engineStarts.length === 2)
  check('   e il server viene ricontrollato in background', f.reads.filter((r) => r.userId === A).length >= 2)

  setOnline(false)
  await f.emit('SIGNED_OUT', null)
  await f.login(A)
  await settle()
  check('offline, già confermato: A si apre (uso offline)', G() === null && f.engineStarts.length === 3)
  setOnline(true)

  delete f.rows[A] // la riga non c'è più sul server
  await f.emit('SIGNED_OUT', null)
  await f.login(A)
  await settle()
  check('riga sparita sul server: la schermata torna e il sync si ferma', G()?.status === 'required' && f.running === null)
  check('   la versione locale viene dimenticata', S().legalAcceptedVersion === null)
  await sync.acceptLegalDocuments(accepted)
  check('   riaccettando, tutto riparte', G() === null && f.running === A && S().legalAcceptedVersion === KEY)

  // =====================================================================
  section('Offline senza conferma locale, database giù, Riprova')
  // =====================================================================
  setOnline(false)
  const startsBeforeB = f.engineStarts.length
  await f.login(B)
  await settle()
  check('B offline senza conferma: schermata "serve la connessione", niente sync', G()?.status === 'unavailable' && G()?.message === gate.LEGAL_GATE_MESSAGES.offline && f.engineStarts.length === startsBeforeB)
  await sync.retryLegalCheck()
  check('   Riprova ancora offline: invariato', G()?.status === 'unavailable' && f.engineStarts.length === startsBeforeB)
  setOnline(true)
  f.rows[B] = { ...CURRENT }
  await sync.retryLegalCheck()
  await settle()
  check('   tornata la rete, B ha già accettato: si apre, senza la schermata dei documenti', G() === null && f.running === B && S().legalAcceptedVersion === KEY)
  check('   A conserva la sua conferma nel suo contenitore', JSON.parse(map.get(stateKey(scopeFor(A)))).state.legalAcceptedVersion === KEY)

  await f.login(C)
  await settle()
  check('C con database giù: "non è stato possibile verificare", niente sync', G()?.status === 'unavailable' && G()?.message === gate.LEGAL_GATE_MESSAGES.unavailable && f.running === null)
  check('   e nessuna conferma salvata', S().legalAcceptedVersion === null)

  // =====================================================================
  section('Nuovo utente con la riga creata alla registrazione')
  // =====================================================================
  seen.length = 0
  await f.login(D)
  await settle()
  check('D: nessuna schermata dei documenti', !seen.includes('required') && G() === null)
  check('   sync avviato e conferma salvata', f.running === D && S().legalAcceptedVersion === KEY)

  // =====================================================================
  section('Isolamento tra account e uscita')
  // =====================================================================
  delete f.rows[A]
  f.rows[B] = undefined
  await f.login(B)
  await settle()
  check('B (riga non più valida) vede la schermata', G()?.status === 'required' && G()?.userId === B)
  check('   la conferma di A non vale per B', S().scopeId === scopeFor(B) && S().legalAcceptedVersion === null)
  const out = await sync.signOut()
  check('"Esci dall\'account": nessun errore, schermata chiusa, uso senza account', out === null && G() === null && S().scopeId === GUEST)
  check('   nessun sync rimasto acceso', f.running === null)

  // =====================================================================
  section('Eliminazione: la conferma locale sparisce con l\'account')
  // =====================================================================
  check('premessa: il contenitore di A contiene la conferma', map.get(stateKey(scopeFor(A))).includes(KEY))
  S().forgetAccountData(A)
  check('dopo la pulizia dell\'account A non resta nessuna sua conferma', !map.has(stateKey(scopeFor(A))) && ![...map.values()].some((v) => String(v).includes(A)))

  // =====================================================================
  section('Schermata LegalGateScreen')
  // =====================================================================
  {
    const slots = []
    let cursor = 0
    const ui = {
      accepts: [], retries: 0, signOuts: 0,
      useState(initial) {
        const index = cursor++
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
        return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
      },
      accept: async (acceptance) => { ui.accepts.push(acceptance); return null },
      retry: async () => { ui.retries += 1 },
      signOut: async () => { ui.signOuts += 1; return null },
    }
    globalThis.__gateUi = ui
    const { LegalGateScreen } = await server.ssrLoadModule('/src/components/legal/LegalGateScreen.jsx')
    const expand = (node) => {
      if (Array.isArray(node)) return node.map(expand)
      if (!node || typeof node !== 'object' || !node.props) return node
      if (typeof node.type === 'function' && node.type.name === 'LegalConsentFields') return expand(node.type(node.props))
      return { ...node, props: { ...node.props, children: expand(node.props.children) } }
    }
    const render = () => { cursor = 0; return expand(LegalGateScreen()) }
    const walk = (node, visit) => {
      if (Array.isArray(node)) return node.forEach((child) => walk(child, visit))
      if (node && typeof node === 'object' && node.props) { visit(node); walk(node.props.children, visit) }
      return undefined
    }
    const textOf = (node) => {
      if (Array.isArray(node)) return node.map(textOf).join('')
      if (node && typeof node === 'object' && node.props) return textOf(node.props.children)
      return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
    }
    const findAll = (tree, predicate) => { const found = []; walk(tree, (n) => { if (predicate(n)) found.push(n) }); return found }
    const button = (tree, label) => findAll(tree, (n) => n.type === 'button' && textOf(n).includes(label))[0]
    const boxes = (tree) => findAll(tree, (n) => n.type === 'input' && n.props.type === 'checkbox')

    gate.setLegalGateState(null)
    check('nessun cancello: la schermata non c\'è', render() === null)

    gate.setLegalGateState({ status: 'required', userId: A })
    let tree = render()
    check('obbligatoria: dialog a tutto schermo, senza "Chiudi"', tree.props.role === 'dialog' && tree.props['aria-modal'] === 'true' && !button(tree, 'Chiudi') && !button(tree, 'Non ora'))
    check('   due caselle, non preselezionate', boxes(tree).length === 2 && boxes(tree).every((b) => b.props.checked === false))
    const links = findAll(tree, (n) => n.type === 'a').map((a) => a.props.href)
    check('   link a Termini, Privacy ed Elimina account', links.includes('/termini.html') && links.includes('/privacy.html') && links.includes('/elimina-account.html'))
    check('   "Accetto e continuo" disabilitato senza spunte', button(tree, 'Accetto e continuo')?.props.disabled === true)
    boxes(tree)[0].props.onChange({ target: { checked: true } })
    tree = render()
    check('   solo Termini: ancora disabilitato', button(tree, 'Accetto e continuo')?.props.disabled === true)
    boxes(tree)[1].props.onChange({ target: { checked: true } })
    tree = render()
    check('   entrambe: abilitato', button(tree, 'Accetto e continuo')?.props.disabled === false)
    await button(tree, 'Accetto e continuo').props.onClick()
    check('   il tocco conferma con le due scelte', ui.accepts.length === 1 && ui.accepts[0].termsAccepted === true && ui.accepts[0].privacyAcknowledged === true)

    gate.setLegalGateState({ status: 'submitting', userId: A })
    tree = render()
    check('in invio: pulsante disabilitato, caselle bloccate', button(tree, 'Conferma in corso')?.props.disabled === true && boxes(tree).every((b) => b.props.disabled === true))
    await button(tree, 'Conferma in corso').props.onClick()
    check('   un tocco in più non manda una seconda conferma', ui.accepts.length === 1)

    gate.setLegalGateState({ status: 'required', userId: A, error: gate.LEGAL_GATE_MESSAGES.failed })
    tree = render()
    check('errore: messaggio visibile, la schermata resta', textOf(tree).includes(gate.LEGAL_GATE_MESSAGES.failed))
    await button(tree, 'Esci dall').props.onClick()
    check('"Esci dall\'account" chiama il logout', ui.signOuts === 1)

    gate.setLegalGateState({ status: 'unavailable', userId: B, message: gate.LEGAL_GATE_MESSAGES.offline })
    tree = render()
    check('verifica impossibile: messaggio, "Riprova" ed "Esci dall\'account", nessuna conferma possibile',
      textOf(tree).includes(gate.LEGAL_GATE_MESSAGES.offline) && Boolean(button(tree, 'Riprova')) && Boolean(button(tree, 'Esci dall')) && !button(tree, 'Accetto'))
    button(tree, 'Riprova').props.onClick()
    check('   "Riprova" ripete la verifica', ui.retries === 1)

    gate.setLegalGateState({ status: 'checking', userId: B })
    tree = render()
    check('verifica in corso: solo il messaggio, nessuna azione', textOf(tree).includes('Verifica dei documenti') && findAll(tree, (n) => n.type === 'button').length === 0)
    gate.setLegalGateState({ status: 'required', userId: A })
    check('la schermata si disegna davvero (react-dom/server)', renderToStaticMarkup(render()).includes('Accetto e continuo'))
    gate.setLegalGateState(null)
  }
} finally {
  await server.close()
  delete globalThis.__gate
  delete globalThis.__gateUi
}

report('Conferma documenti dopo l\'accesso')
