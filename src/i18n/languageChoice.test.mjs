// La scelta della lingua alla prima apertura e la lingua che segue l'utente.
// `npm test`, senza rete.
//
// Store, spendySync, schermata di benvenuto e App VERI; Supabase finto (in
// memoria: utenti, sessione e user_metadata), sync dei dati finto. Ogni
// "dispositivo" ha il suo localStorage e le sue istanze dei moduli.
//
// Regole provate (i18n/languagePreference.js):
//   - nuovo dispositivo: inglese e schermata di benvenuto; utenti esistenti:
//     la loro lingua, nessuna schermata;
//   - la lingua è del dispositivo: uscire o cambiare account non la cambia;
//   - dopo l'accesso vale la lingua dell'account (user_metadata), tranne una
//     scelta più recente fatta in Impostazioni su questo dispositivo;
//   - la lingua non passa MAI dalla riga delle impostazioni (profiles): budget,
//     ciclo e valuta non vengono riscritti, nessun dato finanziario cambia;
//   - errori di rete sul salvataggio della lingua non bloccano accesso, sync
//     o documenti.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import { LEGAL_VERSIONS } from '../../supabase/functions/_shared/legalVersions.js'
import { LANGUAGE_PREFERENCE_KEY, reconcileLanguage } from './languagePreference.js'
import { scopeFor, stateKey } from '../store/scope.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const setOnline = (value) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: value, userAgent: 'node' }, configurable: true, writable: true })
setOnline(true)

// --- Supabase finto: account, sessione, metadati -----------------------------
const ACCEPTANCE = { termsAccepted: true, privacyAcknowledged: true }
function createCloud() {
  const cloud = { users: {}, listeners: [], session: null, updateCalls: [], signUpCalls: [], updateFails: false }
  const userOf = (id) => ({ id, email: cloud.users[id].email, user_metadata: { ...cloud.users[id].meta } })
  const emit = (event) => cloud.listeners.slice().forEach((listener) => listener(event, cloud.session))
  cloud.addUser = (id, email, meta = {}) => { cloud.users[id] = { email, meta: { ...meta } } }
  cloud.supabase = {
    auth: {
      getSession: async () => ({ data: { session: cloud.session } }),
      onAuthStateChange: (listener) => {
        cloud.listeners.push(listener)
        return { data: { subscription: { unsubscribe: () => { cloud.listeners = cloud.listeners.filter((l) => l !== listener) } } } }
      },
      signInWithPassword: async ({ email }) => {
        const id = Object.keys(cloud.users).find((key) => cloud.users[key].email === email)
        if (!id) return { error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } }
        cloud.session = { user: userOf(id), access_token: `t-${id}`, refresh_token: `r-${id}` }
        emit('SIGNED_IN')
        return { error: null }
      },
      signUp: async ({ email, options }) => {
        cloud.signUpCalls.push({ email, data: options?.data })
        if (cloud.signUpError) return { error: cloud.signUpError }
        cloud.addUser(`u-${email}`, email, options?.data ?? {})
        return { error: null }
      },
      signOut: async () => { cloud.session = null; emit('SIGNED_OUT'); return { error: null } },
      setSession: async () => ({ data: { session: cloud.session }, error: null }),
      updateUser: async ({ data }) => {
        cloud.updateCalls.push(data)
        if (cloud.updateFails) throw Object.assign(new TypeError('Failed to fetch'), { name: 'AuthRetryableFetchError' })
        const id = cloud.session.user.id
        cloud.users[id].meta = { ...cloud.users[id].meta, ...data }
        cloud.session = { ...cloud.session, user: userOf(id) }
        emit('USER_UPDATED')
        return { data: { user: cloud.session.user }, error: null }
      },
    },
    // Termini e Privacy già accettati nella versione corrente: il cancello legale si apre.
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy }, error: null }) }) }) }),
  }
  return cloud
}
let cloud = createCloud()

// --- moduli finti per spendySync: Supabase e motore del sync ----------------
const SYNC_STUBS = {
  '../lib/supabase.js': 'export const isSupabaseConfigured = true\nexport const supabase = globalThis.__langCloud.supabase',
  './supabaseRemote.js': 'export const createSupabaseRemote = () => ({})',
  './syncEngine.js': `
    export const createSyncEngine = () => ({
      start: (userId) => { globalThis.__langEngine.starts.push(userId); return Promise.resolve({ started: userId }) },
      stop: () => { globalThis.__langEngine.stops += 1 },
      syncNow: async () => ({}),
    })`,
}
const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-language-choice-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    {
      name: 'language-cloud', enforce: 'pre',
      resolveId: (source, importer) => ((importer ?? '').split('?')[0].endsWith('/src/sync/spendySync.js') && source in SYNC_STUBS ? `\0lang-sync:${source}` : null),
      load: (id) => (id.startsWith('\0lang-sync:') ? SYNC_STUBS[id.slice('\0lang-sync:'.length)] : null),
    },
    reactPlugin(),
  ],
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick() }

// Un dispositivo: il suo storage e istanze nuove di store, sync e componenti.
async function device(map = new Map()) {
  const dom = installFakeDom(map)
  setOnline(true)
  globalThis.__langCloud = cloud
  globalThis.__langEngine = { starts: [], stops: 0 }
  server.moduleGraph.invalidateAll()
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const sync = await server.ssrLoadModule('/src/sync/spendySync.js')
  const pref = await server.ssrLoadModule('/src/i18n/languagePreference.js')
  await server.ssrLoadModule('/src/i18n/useLanguage.js') // registra la lingua dei messaggi fuori da React
  return { map, dom, store: useAppStore, S: useAppStore.getState, sync, pref, engine: globalThis.__langEngine }
}
const preferenceIn = (map) => JSON.parse(map.get(LANGUAGE_PREFERENCE_KEY) ?? 'null')

// I dati finanziari e la coda di sync: non devono cambiare per una lingua.
const FINANCIAL = ['monthlyBudget', 'currency', 'cycleStartDay', 'expenses', 'incomes', 'customCategories', 'goals', 'goalContributions', 'emergencyFundSaved', 'emergencyFundContributions']
const financialOf = (state) => JSON.stringify(Object.fromEntries(FINANCIAL.map((field) => [field, state[field]])))
const outboxOf = (state) => JSON.stringify(state.sync.outbox)
const onlyLanguageKeys = (calls) => calls.every((data) => Object.keys(data).sort().join() === 'language,language_updated_at')

async function signInAs(d, email) {
  const error = await d.sync.signIn(email, 'password1')
  await settle()
  return error
}
async function signOut(d) {
  const error = await d.sync.signOut()
  await settle()
  return error
}

try {
  // =====================================================================
  section('1–3. Prima apertura: inglese, schermata di benvenuto, quattro lingue')
  // =====================================================================
  {
    const d = await device()
    check('1. nuovo dispositivo: serve la schermata di benvenuto', d.pref.needsLanguageWelcome() === true && preferenceIn(d.map) === null)
    check('2. lingua predefinita: inglese', d.S().language === 'en')

    const { createRoot } = await import('react-dom/client')
    const { flushSync } = await import('react-dom')
    const { default: App } = await server.ssrLoadModule('/src/App.jsx')
    const container = d.dom.createContainer()
    const caught = []
    const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
    const act = async (fn) => { flushSync(fn); await settle() }
    const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
    const text = (node) => (typeof node?.data === 'string' ? node.data : (node?.childNodes ?? []).map(text).join(''))
    const cls = (node) => node.attributes?.get?.('class') ?? ''
    const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
    const welcome = () => nodes(container).find((n) => cls(n) === 'language-welcome')
    const options = () => nodes(container).filter((n) => cls(n).includes('language-card__option') && n.attributes?.get?.('role') === 'radio')
    const selected = () => options().filter((n) => n.attributes.get('aria-checked') === 'true').map(text).join()
    const continueButton = () => nodes(container).find((n) => cls(n).includes('language-welcome__continue'))

    await act(() => root.render(h(App)))
    check('   l\'app si apre con la schermata di benvenuto davanti', Boolean(welcome()) && text(welcome()).includes('Welcome to SPENDY'))
    check('   English, Italiano, Español, Français (in quest\'ordine), English selezionata', options().map(text).join(' | ') === '🇬🇧English | 🇮🇹Italiano | 🇪🇸Español | 🇫🇷Français' && selected() === '🇬🇧English')
    const before = financialOf(d.S())
    for (const [index, code, title] of [[1, 'it', 'Benvenuto in SPENDY'], [2, 'es', 'Bienvenido a SPENDY'], [3, 'fr', 'Bienvenue sur SPENDY'], [0, 'en', 'Welcome to SPENDY']]) {
      await act(() => propsOf(options()[index]).onClick({}))
      check(`3. tocco su ${code}: la schermata cambia subito lingua ("${title}")`, d.S().language === code && text(welcome()).includes(title) && selected().includes(['English', 'Italiano', 'Español', 'Français'][index]))
      check('   ancora nessuna scelta salvata (solo anteprima)', preferenceIn(d.map) === null && d.pref.needsLanguageWelcome())
    }
    await act(() => propsOf(options()[2]).onClick({}))
    await act(() => propsOf(continueButton()).onClick({}))
    check('"Continuar": scelta salvata sul dispositivo (benvenuto), la schermata sparisce', preferenceIn(d.map)?.language === 'es' && preferenceIn(d.map)?.source === 'welcome' && !welcome())
    check('   l\'app ora è in spagnolo', d.S().language === 'es' && d.dom.document.documentElement.lang === 'es')
    check('13. nessun dato toccato', financialOf(d.S()) === before && d.S().sync.outbox.length === 0)
    check('   nessun errore di rendering', caught.length === 0, caught[0]?.message)
    await act(() => root.unmount())

    // =====================================================================
    section('4–5. Persistenza: ricaricamento, chiusura e riapertura')
    // =====================================================================
    const reloaded = await device(d.map)
    check('4. ricaricando: spagnolo, nessuna schermata di benvenuto', reloaded.S().language === 'es' && !reloaded.pref.needsLanguageWelcome())
    const reopened = await device(new Map(d.map))
    check('5. chiusa e riaperta (stesso storage): spagnolo', reopened.S().language === 'es' && !reopened.pref.needsLanguageWelcome())
  }

  // =====================================================================
  section('9. Da ospite a registrato: la lingua scelta passa all\'account')
  // =====================================================================
  {
    cloud = createCloud()
    const d = await device()
    const stop = d.sync.bootstrapSync()
    d.S().setLanguage('fr', { source: 'welcome' })
    const chosenAt = preferenceIn(d.map).chosenAt
    d.S().addExpense({ amount: 12, categoryId: 'bar', description: 'café', date: d.S().today })
    const guestExpenses = JSON.stringify(d.S().expenses)
    const error = await d.sync.signUp('nuovo@esempio.invalid', 'password1', ACCEPTANCE)
    const sent = cloud.signUpCalls[0]?.data ?? {}
    check('registrazione: lingua e ora della scelta nei metadati, con i documenti', error === null && sent.language === 'fr' && sent.language_updated_at === chosenAt && sent.terms_version === LEGAL_VERSIONS.terms)
    await signInAs(d, 'nuovo@esempio.invalid')
    check('primo accesso: dati dell\'ospite adottati, lingua ancora fr', d.S().scopeId === scopeFor('u-nuovo@esempio.invalid') && JSON.stringify(d.S().expenses) === guestExpenses && d.S().language === 'fr')
    check('   nessun salvataggio inutile della lingua (l\'account ha già fr)', cloud.updateCalls.length === 0)
    check('   il sync dei dati è partito', d.engine.starts.includes('u-nuovo@esempio.invalid'))
    const err = await signOut(d)
    check('6. uscendo (ospite): resta fr, non torna all\'italiano né all\'inglese', err === null && d.S().scopeId === 'guest' && d.S().language === 'fr')
    stop()
  }

  // =====================================================================
  section('6–7. Logout, nuovo accesso e due account con lingue diverse')
  // =====================================================================
  {
    cloud = createCloud()
    cloud.addUser('user-a', 'a@esempio.invalid', { language: 'it', language_updated_at: '2026-01-10T10:00:00.000Z' })
    cloud.addUser('user-b', 'b@esempio.invalid', { language: 'fr', language_updated_at: '2026-02-10T10:00:00.000Z' })
    const d = await device()
    const stop = d.sync.bootstrapSync()
    d.S().setLanguage('en', { source: 'welcome' })
    await signInAs(d, 'a@esempio.invalid')
    check('accesso con A: la lingua del suo account (it)', d.S().language === 'it' && preferenceIn(d.map)?.source === 'account')
    await signOut(d)
    check('6. logout: resta it', d.S().language === 'it')
    await signInAs(d, 'b@esempio.invalid')
    check('7. accesso con B: fr', d.S().language === 'fr')
    await signOut(d)
    await signInAs(d, 'a@esempio.invalid')
    check('   di nuovo A: it', d.S().language === 'it')
    check('   nessun account riscritto (ognuno aveva già la sua lingua)', cloud.updateCalls.length === 0 && cloud.users['user-a'].meta.language === 'it' && cloud.users['user-b'].meta.language === 'fr')
    stop()
  }

  // =====================================================================
  section('8. Secondo dispositivo: la lingua dell\'account si ritrova')
  // =====================================================================
  {
    cloud = createCloud()
    cloud.addUser('user-a', 'a@esempio.invalid', { language: 'es', language_updated_at: '2026-03-01T09:00:00.000Z' })
    const phone = await device()
    const stop = phone.sync.bootstrapSync()
    // Sul nuovo dispositivo si conferma il benvenuto in inglese senza pensarci.
    phone.S().setLanguage('en', { source: 'welcome' })
    await signInAs(phone, 'a@esempio.invalid')
    check('dopo l\'accesso: es, quella dell\'account (il benvenuto non la scavalca)', phone.S().language === 'es' && cloud.updateCalls.length === 0)
    stop()
  }

  // =====================================================================
  section('12. Cambio dalle Impostazioni: dispositivo e account; rete assente')
  // =====================================================================
  {
    cloud = createCloud()
    cloud.addUser('user-a', 'a@esempio.invalid', { language: 'it', language_updated_at: '2026-01-10T10:00:00.000Z' })
    const d = await device()
    const stop = d.sync.bootstrapSync()
    d.S().setLanguage('it', { source: 'welcome' })
    await signInAs(d, 'a@esempio.invalid')
    // Dati finanziari dell'account, con una modifica ancora in coda.
    d.store.setState({ today: '2026-10-20' })
    d.S().addSalary({ amount: 2000, date: '2026-10-01' })
    d.S().addExpense({ amount: 45.5, categoryId: 'spesa', description: 'mercato', date: '2026-10-12' })
    d.S().setCycleStartDay(1)
    const financial = financialOf(d.S())
    const outbox = outboxOf(d.S())

    const { LanguageCard } = await server.ssrLoadModule('/src/components/settings/LanguageCard.jsx')
    const { createRoot } = await import('react-dom/client')
    const { flushSync } = await import('react-dom')
    const container = d.dom.createContainer()
    const root = createRoot(container, { onRecoverableError: () => {} })
    const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
    const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
    flushSync(() => root.render(h(LanguageCard)))
    const option = (code) => nodes(container).find((n) => n.attributes?.get?.('role') === 'radio' && n.attributes.get('lang') === code)
    flushSync(() => propsOf(option('es')).onClick({}))
    await settle()
    check('Impostazioni → Español: subito, sul dispositivo come scelta esplicita', d.S().language === 'es' && preferenceIn(d.map)?.source === 'settings')
    check('   e nell\'account (solo user_metadata: language, language_updated_at)', cloud.users['user-a'].meta.language === 'es' && onlyLanguageKeys(cloud.updateCalls))
    check('13–14. dati finanziari e coda di sync identici: nessuna riga delle impostazioni (profiles) accodata', financialOf(d.S()) === financial && outboxOf(d.S()) === outbox)

    // Rete assente al momento del cambio: la lingua cambia lo stesso, l'account no.
    cloud.updateFails = true
    flushSync(() => propsOf(option('fr')).onClick({}))
    await settle()
    check('senza rete: lingua fr sul dispositivo, nessun errore, account ancora es', d.S().language === 'fr' && cloud.users['user-a'].meta.language === 'es')
    // Esce e rientra mentre il salvataggio della lingua continua a fallire.
    await signOut(d)
    const starts = d.engine.starts.length
    const loginError = await signInAs(d, 'a@esempio.invalid')
    check('   l\'accesso funziona anche se il salvataggio della lingua fallisce', loginError === null && d.S().scopeId === scopeFor('user-a') && d.engine.starts.length === starts + 1)
    check('   la scelta più recente (fr, Impostazioni) non viene sostituita dalla vecchia dell\'account', d.S().language === 'fr')
    cloud.updateFails = false
    await signOut(d)
    await signInAs(d, 'a@esempio.invalid')
    check('   tornata la rete: al prossimo accesso fr arriva nell\'account', cloud.users['user-a'].meta.language === 'fr' && onlyLanguageKeys(cloud.updateCalls))
    check('   dati finanziari ancora identici', financialOf(d.S()) === financial && outboxOf(d.S()) === outbox)
    flushSync(() => root.unmount())
    stop()
  }

  // =====================================================================
  section('10–11. Account esistenti: italiano conservato, lingua salvata se manca')
  // =====================================================================
  {
    cloud = createCloud()
    cloud.addUser('user-old', 'old@esempio.invalid', {})
    cloud.addUser('user-it', 'it@esempio.invalid', { language: 'it' })
    // Un dispositivo usato prima della scelta della lingua: l'account era
    // entrato, il contenitore ha dei dati e nessuna lingua.
    const legacy = new Map()
    legacy.set('spendy-active-scope', scopeFor('user-old'))
    legacy.set(stateKey(scopeFor('user-old')), JSON.stringify({ state: { monthlyBudget: 1800, expenses: [{ id: 'e1', amount: 30, categoryId: 'bar', date: '2026-10-02', description: '' }], incomes: [] }, version: 0 }))
    const d = await device(legacy)
    check('nessuna schermata di benvenuto, italiano', !d.pref.needsLanguageWelcome() && d.S().language === 'it' && preferenceIn(d.map)?.source === 'inherited')
    const financial = financialOf(d.S())
    const stop = d.sync.bootstrapSync()
    await settle()
    // La sessione salvata sul dispositivo: l'account entra da solo.
    cloud.session = { user: { id: 'user-old', email: 'old@esempio.invalid', user_metadata: {} }, access_token: 't', refresh_token: 'r' }
    cloud.listeners.forEach((listener) => listener('INITIAL_SESSION', cloud.session))
    await settle()
    check('11. account senza lingua: resta it e gliela si salva (ora: null, ereditata)', d.S().language === 'it' && cloud.users['user-old'].meta.language === 'it' && cloud.users['user-old'].meta.language_updated_at === null)
    check('   dati finanziari intatti', financialOf(d.S()) === financial)
    await signOut(d)
    await signInAs(d, 'it@esempio.invalid')
    check('10. account con lingua italiana: it, nessuna riscrittura', d.S().language === 'it' && cloud.users['user-it'].meta.language === 'it' && cloud.updateCalls.length === 1)
    stop()
  }

  // =====================================================================
  section('La regola, da sola (languagePreference.reconcileLanguage)')
  // =====================================================================
  {
    const T1 = '2026-01-01T00:00:00.000Z'
    const T2 = '2026-06-01T00:00:00.000Z'
    const r = reconcileLanguage
    check('account con lingua, dispositivo dal benvenuto → vale l\'account', JSON.stringify(r({ language: 'en', chosenAt: T2, source: 'welcome' }, { language: 'it', updatedAt: T1 })) === JSON.stringify({ apply: { language: 'it', chosenAt: T1, source: 'account' }, push: null }))
    check('scelta in Impostazioni più recente → si salva nell\'account', JSON.stringify(r({ language: 'fr', chosenAt: T2, source: 'settings' }, { language: 'it', updatedAt: T1 })) === JSON.stringify({ apply: null, push: { language: 'fr', language_updated_at: T2 } }))
    check('scelta in Impostazioni più vecchia → vale l\'account', r({ language: 'fr', chosenAt: T1, source: 'settings' }, { language: 'it', updatedAt: T2 }).apply?.language === 'it')
    check('stessa lingua → niente da fare', JSON.stringify(r({ language: 'it', chosenAt: null, source: 'inherited' }, { language: 'it', updatedAt: null })) === JSON.stringify({ apply: null, push: null }))
    check('account senza lingua → gli si salva quella del dispositivo', JSON.stringify(r({ language: 'es', chosenAt: null, source: 'inherited' }, null)) === JSON.stringify({ apply: null, push: { language: 'es', language_updated_at: null } }))
  }

  // =====================================================================
  section('Errori di accesso tradotti (mai il testo tecnico di Supabase)')
  // =====================================================================
  {
    cloud = createCloud()
    const d = await device()
    d.S().setLanguage('es', { source: 'welcome' })
    const wrong = await d.sync.signIn('nessuno@esempio.invalid', 'password1')
    check('credenziali errate → messaggio nella lingua scelta', wrong === 'Correo o contraseña incorrectos.')
    cloud.signUpError = { code: 'email_address_not_authorized', message: 'Email address "x" not authorized', status: 400 }
    const rejected = await d.sync.signUp('x@esempio.invalid', 'password1', ACCEPTANCE)
    check('email non accettata dal server di invio → messaggio chiaro, senza dettagli tecnici', rejected.startsWith('No hemos podido enviar el correo') && !rejected.includes('not authorized'))
    cloud.signUpError = null
    check('consensi mancanti → messaggio nella lingua scelta', (await d.sync.signUp('y@esempio.invalid', 'password1', {})).startsWith('Para crear una cuenta'))
  }
} finally {
  await server.close()
}

report('Scelta della lingua alla prima apertura')
