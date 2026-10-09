// Fase 1 del multilingue: l'infrastruttura (lingue, dizionari, translate) e la
// lingua per account/dispositivo. `npm test`, senza rete.
//
// La lingua è una preferenza dell'esperienza: vale per il DISPOSITIVO
// ('spendy-language', i18n/languagePreference.js), non viaggia con il sync e
// cambiarla non tocca nessun dato. Inglese per i nuovi utenti, italiano per
// chi usava già SPENDY. La lingua dell'account (metadati di Supabase Auth) è
// provata in languageChoice.test.mjs.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, section, report, italianDevice } from '../sync/testkit.mjs'
import { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANGUAGE, LEGACY_LANGUAGE, isLanguage, normalizeLanguage, languageInfo } from './languages.js'
import { LANGUAGE_PREFERENCE_KEY, needsLanguageWelcome } from './languagePreference.js'
import { MESSAGES, translate } from './translate.js'
import { scopeFor, stateKey, GUEST, ACTIVE_SCOPE_KEY } from '../store/scope.js'

// --- dispositivi: store vero, localStorage per dispositivo ------------------

function installStorage(map) {
  const fake = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'window', { value: { localStorage: fake, addEventListener: () => {}, removeEventListener: () => {} }, configurable: true, writable: true })
}
let boots = 0
async function boot(map) {
  installStorage(map)
  const { useAppStore } = await import(`../store/useAppStore.js?i18n=${(boots += 1)}`)
  return useAppStore
}
const savedLanguage = (map, scope) => JSON.parse(map.get(stateKey(scope)) ?? '{}')?.state?.language
const devicePreference = (map) => JSON.parse(map.get(LANGUAGE_PREFERENCE_KEY) ?? 'null')
const storageOf = (map) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), key: (index) => [...map.keys()][index] ?? null, get length() { return map.size } })

// Tutto ciò che NON è la lingua: deve restare identico cambiando lingua.
const DATA_FIELDS = ['monthlyBudget', 'currency', 'cycleStartDay', 'amountHidden', 'spendyAIEnabled', 'legalAcceptedVersion', 'legacySalaryHistoryDone', 'confirmedCycleStart',
  'expenses', 'incomes', 'customCategories', 'goals', 'goalContributions', 'emergencyFundSaved', 'emergencyFundContributions', 'spendyJokeHistory', 'notifications', 'notificationKeys', 'sync']
const dataOf = (state) => JSON.stringify(Object.fromEntries(DATA_FIELDS.map((field) => [field, state[field]])))
const blobWithoutLanguage = (map, scope) => {
  const blob = JSON.parse(map.get(stateKey(scope)))
  const { language: _language, ...rest } = blob.state
  return JSON.stringify({ ...blob, state: rest })
}

// =====================================================================
section('Lingue e dizionari')
// =====================================================================
check('quattro lingue: it, en, es, fr', LANGUAGE_CODES.join() === 'it,en,es,fr' && Object.keys(MESSAGES).sort().join() === 'en,es,fr,it')
check('ognuna con nome nella propria lingua, bandiera e locale', LANGUAGES.map((l) => `${l.flag} ${l.name}`).join(' | ') === '🇮🇹 Italiano | 🇬🇧 English | 🇪🇸 Español | 🇫🇷 Français' && LANGUAGES.every((l) => /^[a-z]{2}-[A-Z]{2}$/.test(l.locale)))
check('B. lingue valide accettate', ['it', 'en', 'es', 'fr'].every((code) => isLanguage(code) && normalizeLanguage(code) === code))
check('C. valori non validi → en, la lingua dei nuovi utenti', [undefined, null, '', 'de', 'EN', 'italiano', 42, {}].every((value) => !isLanguage(value) && normalizeLanguage(value) === 'en') && DEFAULT_LANGUAGE === 'en')
check('   per i vecchi contenitori il ripiego è l\'italiano', LEGACY_LANGUAGE === 'it' && normalizeLanguage('de', LEGACY_LANGUAGE) === 'it' && normalizeLanguage('fr', LEGACY_LANGUAGE) === 'fr')
check('languageInfo: un codice non valido dà la lingua predefinita', languageInfo('xx').code === 'en' && languageInfo('fr').name === 'Français')

const keysOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))
const itKeys = keysOf(MESSAGES.it).sort().join()
check('ogni dizionario ha le stesse chiavi dell\'italiano', ['en', 'es', 'fr'].every((code) => keysOf(MESSAGES[code]).sort().join() === itKeys), itKeys)
check('le chiavi sono tecniche (a punti, minuscole), non testi italiani', keysOf(MESSAGES.it).every((key) => /^[a-z]+(\.[a-z]+)+$/.test(key)))

// =====================================================================
section('H. translate: fallback e parametri')
// =====================================================================
check('chiave nella lingua scelta', translate('en', 'settings.language.title') === 'Language' && translate('es', 'settings.language.title') === 'Idioma' && translate('fr', 'settings.language.title') === 'Langue' && translate('it', 'settings.language.title') === 'Lingua')
check('chiave inesistente → la chiave stessa, nessun crash', translate('en', 'non.esiste') === 'non.esiste' && translate('it', 'radar.title') === 'radar.title')
{
  // Chiave presente solo in italiano: si ricade sull'italiano.
  MESSAGES.it.settings.language.onlyItalian = 'Solo in italiano'
  check('chiave mancante in una lingua → testo italiano', translate('fr', 'settings.language.onlyItalian') === 'Solo in italiano')
  // Presente in inglese e in italiano ma non in francese: prima l'inglese.
  MESSAGES.en.settings.language.onlyItalian = 'English first'
  check('   se c\'è, prima l\'inglese (la lingua predefinita)', translate('fr', 'settings.language.onlyItalian') === 'English first')
  delete MESSAGES.en.settings.language.onlyItalian
  delete MESSAGES.it.settings.language.onlyItalian
}
check('lingua non valida → lingua predefinita (inglese)', translate('xx', 'settings.language.title') === 'Language' && translate(undefined, 'settings.language.title') === 'Language')
check('parametri: {language}', translate('en', 'settings.language.current', { language: 'English' }) === 'Current language: English' && translate('fr', 'settings.language.current', { language: 'Français' }) === 'Langue actuelle : Français')
check('parametro mancante: il segnaposto resta visibile', translate('it', 'settings.language.current') === 'Lingua attuale: {language}')
check('chiave non valida: stringa vuota, nessun crash', translate('it', undefined) === '' && translate('it', '') === '' && translate('it', 'settings') === 'settings')

// =====================================================================
section('A. Default, D. persistenza, F. cambio lingua')
// =====================================================================
{
  const map = new Map()
  const store = await boot(map)
  const S = store.getState
  check('A. nuovo dispositivo → en, in attesa della scelta (schermata di benvenuto)', S().language === 'en' && devicePreference(map) === null && needsLanguageWelcome(storageOf(map)))
  S().switchScope(scopeFor('utente-a'))
  check('   un account senza lingua sul dispositivo nuovo → en', S().language === 'en')
  const sequence = ['en', 'fr', 'es', 'it']
  const seen = sequence.map((code) => { S().setLanguage(code); return S().language })
  check('F. it → en → fr → es → it', seen.join() === sequence.join())
  S().setLanguage('en')
  check('   salvata subito sul dispositivo (scelta in Impostazioni)', devicePreference(map)?.language === 'en' && devicePreference(map)?.source === 'settings' && !needsLanguageWelcome(storageOf(map)))
  check('   e anche nel contenitore dell\'account (copia)', savedLanguage(map, scopeFor('utente-a')) === 'en')
  const reopened = await boot(map)
  check('D. setLanguage(\'en\') → riapertura → en', reopened.getState().scopeId === scopeFor('utente-a') && reopened.getState().language === 'en')
  S().setLanguage('de')
  check('C. setLanguage(\'de\') → en (la lingua predefinita)', S().language === 'en' && devicePreference(map)?.language === 'en')
}

// =====================================================================
section('Utenti esistenti: la loro lingua resta, nessuna schermata di benvenuto')
// =====================================================================
{
  // Un dispositivo usato PRIMA della scelta della lingua: un contenitore con
  // dei dati e senza la chiave del dispositivo.
  const legacyDevice = async (language) => {
    const map = new Map()
    const store = await boot(map)
    store.getState().switchScope(scopeFor('utente-a'))
    store.setState({ today: '2026-10-20' })
    store.getState().addExpense({ amount: 12, categoryId: 'bar', description: 'caffè', date: '2026-10-20' })
    const blob = JSON.parse(map.get(stateKey(scopeFor('utente-a'))))
    if (language === undefined) delete blob.state.language
    else blob.state.language = language
    map.set(stateKey(scopeFor('utente-a')), JSON.stringify(blob))
    map.delete(LANGUAGE_PREFERENCE_KEY)
    return map
  }
  for (const [label, saved, expected] of [['salvato in italiano', 'it', 'it'], ['salvato in francese', 'fr', 'fr'], ['salvato prima della lingua (nessun valore)', undefined, 'it'], ['con un valore non valido', 'klingon', 'it']]) {
    const map = await legacyDevice(saved)
    const expensesBefore = JSON.parse(map.get(stateKey(scopeFor('utente-a')))).state.expenses
    const reopened = await boot(map)
    check(`contenitore ${label} → ${expected}`, reopened.getState().language === expected && reopened.getState().scopeId === scopeFor('utente-a'))
    check('   nessuna schermata di benvenuto: la lingua diventa quella del dispositivo (ereditata)', !needsLanguageWelcome(storageOf(map)) && devicePreference(map)?.language === expected && devicePreference(map)?.source === 'inherited' && devicePreference(map)?.chosenAt === null)
    check('   spese intatte', JSON.stringify(reopened.getState().expenses) === JSON.stringify(expensesBefore))
  }
  {
    // Ospite vuoto (chi ha solo aperto il sito, con la vecchia versione): è un nuovo utente.
    const map = new Map([[stateKey(GUEST), JSON.stringify({ state: { language: 'it', expenses: [], incomes: [] }, version: 0 })]])
    const store = await boot(map)
    check('contenitore ospite vuoto → nuovo utente: en e schermata di benvenuto', store.getState().language === 'en' && needsLanguageWelcome(storageOf(map)))
  }
  {
    // Un account già usato su questo dispositivo (ambito attivo di un account), anche senza dati.
    const map = new Map([[ACTIVE_SCOPE_KEY, scopeFor('utente-b')], [stateKey(scopeFor('utente-b')), JSON.stringify({ state: { language: 'es' }, version: 0 })]])
    const store = await boot(map)
    check('ambito attivo di un account → è un utente esistente: resta es, nessuna schermata', store.getState().language === 'es' && !needsLanguageWelcome(storageOf(map)))
  }
}

// =====================================================================
section('E. La lingua è del dispositivo: uscire o cambiare account non la cambia')
// =====================================================================
{
  const map = new Map()
  const store = await boot(map)
  const S = store.getState
  S().switchScope(scopeFor('account-a'))
  S().setLanguage('fr')
  S().switchScope(scopeFor('account-b'))
  check('B entra dopo A (fr): la lingua resta fr (quella dell\'account arriva dai metadati, vedi languageChoice.test)', S().language === 'fr')
  S().switchScope(GUEST)
  check('uscendo (ospite): resta fr, non torna all\'italiano', S().language === 'fr')
  S().switchScope(scopeFor('account-a'))
  check('A rientra: fr', S().language === 'fr')
  S().switchScope(GUEST)
  const reopened = await boot(map)
  check('riaprendo l\'app (ultimo ambito: ospite) resta fr', reopened.getState().scopeId === GUEST && reopened.getState().language === 'fr')
}

// =====================================================================
section('G. Cambiare lingua non tocca nessun dato')
// =====================================================================
{
  const map = new Map()
  const store = await boot(map)
  const S = store.getState
  S().switchScope(scopeFor('utente-dati'))
  store.setState({ today: '2026-10-20' })
  S().addSalary({ amount: 2451, date: '2026-10-07' })
  S().addSalary({ amount: 2537, date: '2026-09-07' })
  S().addExpense({ amount: 120, categoryId: 'ristoranti', description: 'Ristorante', date: '2026-10-08' })
  S().addExpense({ amount: 40, categoryId: 'spesa', description: '', date: '2026-09-15' })
  S().addIncome({ amount: 80, categoryId: 'extra', description: 'Extra', date: '2026-10-09' })
  S().addCustomCategory({ label: 'Palestra', emoji: '🏋️', type: 'expense' })
  S().addGoal({ emoji: '✈️', label: 'Lisbona', target: 1200, etaMonths: 8 })
  S().contributeToGoal(S().goals[0].id, 150)
  S().contributeToEmergencyFund(300)
  S().addNotification(scopeFor('utente-dati'), { type: 'budget', eventKey: 'budget:near:2026-10-07', title: 'Budget', message: 'Attenzione: hai utilizzato il 90% del budget.' })
  S().confirmCycleStart('2026-10-07')
  store.setState((state) => ({ sync: { ...state.sync, cursors: { expenses: '2026-10-08T10:00:00.000Z' }, lastSyncAt: '2026-10-08T10:00:00.000Z' } }))
  const before = dataOf(S())
  const blobBefore = blobWithoutLanguage(map, scopeFor('utente-dati'))
  const outboxBefore = S().sync.outbox.length
  for (const code of ['en', 'fr', 'es', 'it', 'en']) S().setLanguage(code)
  check('spese, entrate, stipendio, categorie, obiettivi, fondo, notifiche, sync: identici', dataOf(S()) === before)
  check('   nessuna operazione nuova in coda di sync (la lingua non viaggia)', S().sync.outbox.length === outboxBefore && !S().sync.outbox.some((op) => op.row && 'language' in op.row))
  check('   il salvataggio locale è identico, a parte la lingua', blobWithoutLanguage(map, scopeFor('utente-dati')) === blobBefore && savedLanguage(map, scopeFor('utente-dati')) === 'en')
  check('   descrizioni non riscritte ("Ristorante" resta "Ristorante", la vuota resta vuota)', S().expenses.some((e) => e.description === 'Ristorante') && S().expenses.some((e) => e.description === ''))
  const reopened = await boot(map)
  check('   e dopo la riapertura: stessi dati, lingua en', dataOf(reopened.getState()) === before && reopened.getState().language === 'en')
}

// =====================================================================
section('<html lang> segue la lingua scelta')
// =====================================================================
{
  const { startDocumentLanguage } = await import('./documentLanguage.js')
  // Dispositivo di un utente italiano.
  const map = italianDevice(new Map())
  const store = await boot(map)
  const S = store.getState
  S().switchScope(scopeFor('utente-lang'))
  store.setState({ today: '2026-10-20' })
  S().addExpense({ amount: 12, categoryId: 'bar', description: 'caffè', date: '2026-10-20' })
  S().addSalary({ amount: 2451, date: '2026-10-07' })
  const doc = { documentElement: { lang: '' } }
  const stop = startDocumentLanguage(store, { doc })
  check('1. lingua iniziale it → lang="it" (subito, al caricamento)', doc.documentElement.lang === 'it')
  const before = dataOf(S())
  S().setLanguage('en')
  check('2. cambio a en → lang="en"', doc.documentElement.lang === 'en')
  S().setLanguage('es')
  check('3. cambio a es → lang="es"', doc.documentElement.lang === 'es')
  S().setLanguage('fr')
  check('4. cambio a fr → lang="fr"', doc.documentElement.lang === 'fr')
  check('5. nessun altro dato dello store modificato', dataOf(S()) === before)
  S().setLanguage('de')
  check('   valore non valido → lang="en" (la lingua predefinita)', doc.documentElement.lang === 'en')
  S().setLanguage('fr')
  S().switchScope(scopeFor('altro-account'))
  check('   cambio di account: la lingua è del dispositivo → resta lang="fr"', doc.documentElement.lang === 'fr')
  S().switchScope(scopeFor('utente-lang'))
  check('   ritorno all\'account in francese → lang="fr"', doc.documentElement.lang === 'fr')
  const reopened = await boot(map)
  const doc2 = { documentElement: { lang: 'it' } }
  const stop2 = startDocumentLanguage(reopened, { doc: doc2 })
  check('   riaprendo l\'app con la lingua salvata (fr): lang="fr" dal caricamento', doc2.documentElement.lang === 'fr')
  stop2()
  stop()
  S().setLanguage('en')
  check('   fermato: nessun altro aggiornamento', doc.documentElement.lang === 'fr')
  check('   senza document (test, server): nessun errore', (() => { try { startDocumentLanguage(store, { doc: null })(); return true } catch { return false } })())
  const app = (await import('node:fs')).readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  check('   avviato dall\'app (App.jsx)', app.includes("useEffect(() => startDocumentLanguage(useAppStore), [])"))
}

// =====================================================================
section('I. Il selettore in Impostazioni (componente vero, store vero)')
// =====================================================================
{
  const { installFakeDom } = await import('../store/fakeDom.mjs')
  // Dispositivo di un utente italiano.
  const dom = installFakeDom(italianDevice(new Map()))
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const { createElement: h } = await import('react')
  const { createServer } = await import('vite')
  const { default: reactPlugin } = await import('@vitejs/plugin-react')
  const server = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    cacheDir: join(tmpdir(), 'spendy-i18n-test-vite'),
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
      reactPlugin(),
    ],
  })
  const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
  const text = (node) => (typeof node.data === 'string' ? node.data : (node.childNodes ?? []).map(text).join(''))
  const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const act = async (fn) => { flushSync(fn); for (let i = 0; i < 4; i += 1) await tick() }
  try {
    const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
    const { LanguageCard } = await server.ssrLoadModule('/src/components/settings/LanguageCard.jsx')
    const hook = await server.ssrLoadModule('/src/i18n/useLanguage.js')
    useAppStore.getState().switchScope(scopeFor('utente-ui'))
    const dataBefore = dataOf(useAppStore.getState())
    const container = dom.createContainer()
    const root = createRoot(container, { onRecoverableError: () => {} })
    await act(() => root.render(h(LanguageCard)))
    const options = () => nodes(container).filter((n) => n.attributes?.get?.('role') === 'radio')
    const checked = () => options().filter((n) => n.attributes.get('aria-checked') === 'true').map(text)
    check('quattro opzioni con bandiera e nome', options().map(text).join(' | ') === '🇮🇹Italiano | 🇬🇧English | 🇪🇸Español | 🇫🇷Français')
    check('la lingua corrente (it) è quella selezionata', checked().join() === '🇮🇹Italiano' && text(container).includes('Lingua attuale: Italiano'))
    check('   titolo in italiano, nessuna nota "traduzione in corso"', text(container).startsWith('Lingua') && !text(container).includes('in corso'))
    await act(() => propsOf(options()[1]).onClick({}))
    check('tocco su English: salvata subito e il selettore la mostra', useAppStore.getState().language === 'en' && checked().join() === '🇬🇧English')
    check('   il selettore stesso è già in inglese, senza reload', text(container).startsWith('Language') && text(container).includes('Current language: English') && text(container).includes('still in Italian'))
    check('   getCurrentLanguage / t fuori da React leggono la stessa fonte', hook.getCurrentLanguage() === 'en' && hook.t('settings.language.title') === 'Language')
    for (const [index, title] of [[3, 'Langue'], [2, 'Idioma'], [0, 'Lingua']]) {
      await act(() => propsOf(options()[index]).onClick({}))
      check(`   → ${LANGUAGES[index].name}: selezionata e titolo "${title}"`, checked().join() === `${LANGUAGES[index].flag}${LANGUAGES[index].name}` && text(container).startsWith(title))
    }
    check('nessun dato toccato dai tocchi sul selettore', dataOf(useAppStore.getState()) === dataBefore)
    await act(() => root.unmount())
  } finally {
    await server.close()
  }
}

report('Multilingue — Fase 1 (fondamenta)')
