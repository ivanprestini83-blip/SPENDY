// Impostazioni, Stipendio di questo ciclo, Giorno di inizio ciclo, Spendy AI,
// Privacy, Backup, Eliminazione account, Centro notifiche, schermata d'errore e
// pagine legali in it / en / fr / es. `npm test`, senza rete.
//
// L'App VERA (Vite, CSS escluso) sullo store vero e un DOM minimo, montata una
// volta: si cambia lingua SENZA rimontare e si legge il testo che l'utente
// vedrebbe, dopo aver toccato i pulsanti (conferme, errori). Supabase non c'è:
// solo per la card "Elimina account" una sessione finta (stub qui sotto), così
// la card si vede; il server non viene mai chiamato.
//
// Si controlla che:
//   - le chiavi nuove esistano in tutte e quattro le lingue, con gli stessi
//     segnaposto, e non siano copie dell'italiano;
//   - a schermo ci siano i testi della lingua scelta e nessun pezzo
//     dell'italiano (di nessuna chiave del dizionario);
//   - conferme e messaggi d'errore seguano la lingua;
//   - i periodi del ciclo siano quelli della lingua, con le stesse date;
//   - i link legali aprano le pagine italiane pubblicate (le traduzioni attendono la revisione);
//   - cambiare lingua non tocchi nessun dato.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const LANGS = ['it', 'en', 'fr', 'es']
const keysOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))
const lookup = (dictionary, key) => key.split('.').reduce((node, part) => node?.[part], dictionary)
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()

// La card "Elimina account" con una sessione finta: la sua richiesta di
// eliminazione restituisce sempre l'errore "non riuscita" (nella lingua dell'app).
const DELETE_STUBS = {
  '../../lib/supabase.js': `
    export const supabase = { auth: {
      getSession: async () => ({ data: { session: { user: { email: 'utente@esempio.invalid' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } }`,
  '../../sync/spendySync.js': `
    import { DELETE_ACCOUNT_MESSAGES } from '/src/lib/accountDeletion.js'
    export const isSupabaseConfigured = true
    export const deleteAccount = async () => { globalThis.__deleteCalls = (globalThis.__deleteCalls ?? 0) + 1; return DELETE_ACCOUNT_MESSAGES.failed }`,
}

const dom = installFakeDom(new Map())
// Il DOM minimo non conosce <select> (il periodo di Andamento): il minimo che
// React usa per una select controllata, come in currencyScreens.test.
{
  const createElement = dom.document.createElement.bind(dom.document)
  const descendants = (node) => node.childNodes.flatMap((child) => [child, ...descendants(child)])
  dom.document.createElement = (tag, ...rest) => {
    const element = createElement(tag, ...rest)
    if (tag === 'select') {
      element.multiple = false
      Object.defineProperty(element, 'options', { get: () => descendants(element).filter((n) => n.localName === 'option') })
      Object.defineProperty(element, 'value', {
        get: () => (element.options.find((o) => o.selected) ?? element.options[0])?.value ?? '',
        set: (value) => { for (const option of element.options) option.selected = option.value === String(value) },
      })
    }
    if (tag === 'option') {
      element.selected = false
      element.defaultSelected = false
      Object.defineProperty(element, 'value', { get: () => element.getAttribute('value') ?? '', set: (value) => element.setAttribute('value', value) })
    }
    return element
  }
}
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true, writable: true })
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-settings-screens-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    {
      name: 'delete-account-stubs',
      enforce: 'pre',
      resolveId: (source, importer) => (importer?.split('?')[0].endsWith('/DeleteAccountCard.jsx') && source in DELETE_STUBS ? `\0stub:${source}` : null),
      load: (id) => (id.startsWith('\0stub:') ? DELETE_STUBS[id.slice(6)] : null),
    },
    reactPlugin(),
  ],
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const act = async (fn) => { flushSync(fn); for (let i = 0; i < 8; i += 1) await tick() }
const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
const text = (node) => (typeof node?.data === 'string' ? node.data : (node?.childNodes ?? []).map(text).join(''))
const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
const attr = (node, name) => node.attributes?.get?.(name)
const hasClass = (node, name) => (attr(node, 'class') ?? '').split(' ').includes(name)

const TODAY = '2026-10-18'
const PERIOD = { it: '7 Ott – 6 Nov', en: '7 Oct – 6 Nov', fr: '7 oct. – 6 nov.', es: '7 oct – 6 nov' }
const DATA_FIELDS = ['monthlyBudget', 'cycleStartDay', 'amountHidden', 'expenses', 'incomes', 'customCategories', 'goals', 'goalContributions', 'emergencyFundContributions', 'confirmedCycleStart', 'legacySalaryHistoryDone']

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  // Le stesse istanze che usa l'App (caricate da Vite).
  const { MESSAGES, translate } = await server.ssrLoadModule('/src/i18n/translate.js')
  const { getCycleRange } = await server.ssrLoadModule('/src/utils/cycle.js')
  const { buildNotification, formatRelativeTime } = await server.ssrLoadModule('/src/notifications/notificationState.js')
  const { DELETE_ACCOUNT_MESSAGES } = await server.ssrLoadModule('/src/lib/accountDeletion.js')
  const { FIELD_LABELS, parseBackup } = await server.ssrLoadModule('/src/sync/backup.js')
  const { ErrorFallback } = await server.ssrLoadModule('/src/components/ErrorBoundary/ErrorBoundary.jsx')
  const { LegalConsentFields } = await server.ssrLoadModule('/src/components/settings/LegalConsentFields.jsx')
  const { LEGAL_DOCUMENTS } = await server.ssrLoadModule('/src/legal/legal.js')

  // Le chiavi di questa fase.
  const NEW_KEYS = keysOf(MESSAGES.it).filter((key) => /^(settings\.(screen|cycle|salary|ai|privacy|delete|backup)\.|notificationcenter\.|crash\.|auth\.outboxother$|legal\.consent\.italiannote$)/.test(key))
  // Uguali all'italiano per scelta: nomi propri, emoji, parole identiche nella lingua.
  const SAME_AS_ITALIAN = new Set([
    'settings.ai.title', 'notificationcenter.types.budget', 'notificationcenter.types.radar', 'notificationcenter.types.ai',
    'en:settings.privacy.title',
  ])
  const sameAllowed = (lang, key) => SAME_AS_ITALIAN.has(key) || SAME_AS_ITALIAN.has(`${lang}:${key}`)

  // =====================================================================
  section('1. Dizionari: chiavi presenti, stessi segnaposto, nessuna copia dell\'italiano')
  // =====================================================================
  check(`chiavi di questa fase: ${NEW_KEYS.length}`, NEW_KEYS.length >= 100, NEW_KEYS.length)
  for (const lang of ['en', 'fr', 'es']) {
    const missing = NEW_KEYS.filter((key) => typeof lookup(MESSAGES[lang], key) !== 'string' || !lookup(MESSAGES[lang], key).trim())
    check(`${lang}: tutte presenti e non vuote`, missing.length === 0, missing.join(', '))
    const mismatched = NEW_KEYS.filter((key) => placeholders(lookup(MESSAGES[lang], key) ?? '') !== placeholders(lookup(MESSAGES.it, key)))
    check(`${lang}: stessi segnaposto dell'italiano`, mismatched.length === 0, mismatched.join(', '))
    const copied = NEW_KEYS.filter((key) => lookup(MESSAGES[lang], key) === lookup(MESSAGES.it, key) && !sameAllowed(lang, key))
    check(`${lang}: nessun testo rimasto in italiano`, copied.length === 0, copied.join(', '))
  }
  {
    const allKeys = keysOf(MESSAGES.it)
    const holes = ['en', 'fr', 'es'].flatMap((lang) => allKeys.filter((key) => typeof lookup(MESSAGES[lang], key) !== 'string').map((key) => `${lang}:${key}`))
    check('tutto il dizionario: nessuna chiave che in un\'altra lingua ricadrebbe sull\'inglese o sull\'italiano', holes.length === 0, holes.slice(0, 10).join(', '))
  }
  check('la nota "traduzione in corso" non esiste più (l\'app è tradotta)', LANGS.every((lang) => lookup(MESSAGES[lang], 'settings.language.partial') === undefined))
  {
    // Nessun testo fisso nei componenti di questa fase (testo JSX e attributi letti dall'utente).
    const code = (path) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const COMPONENTS = [
      'src/components/modals/SettingsScreen.jsx', 'src/components/settings/CurrentSalaryCard.jsx', 'src/components/settings/SpendyAICard.jsx',
      'src/components/settings/PrivacyCard.jsx', 'src/components/settings/DeleteAccountCard.jsx', 'src/components/settings/BackupCard.jsx',
      'src/components/notifications/NotificationsScreen.jsx', 'src/components/ErrorBoundary/ErrorBoundary.jsx',
    ]
    for (const path of COMPONENTS) {
      const source = code(path)
      const jsxText = [...source.matchAll(/>([^<>{}]*)</g)].map((m) => m[1].trim()).filter((t) => /[A-Za-zÀ-ÿ]/.test(t) && !/[=;()]/.test(t))
      const attrs = [...source.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*[A-Za-z][^"]*)"/g)].map((m) => m[1])
      const literals = [...source.replace(/^.*console\.\w+\(.*$/gm, '').matchAll(/'([^'\n{}<>=]*[a-zà-ù] [a-zà-ù][^'\n{}<>=]*)'/g)].map((m) => m[1])
      check(`${path.split('/').pop()}: nessun testo fisso`, jsxText.length === 0 && attrs.length === 0 && literals.length === 0, [...jsxText, ...attrs, ...literals].join(' | '))
    }
  }

  // Pezzi italiani di TUTTO il dizionario (per cercarne a schermo nelle altre lingue).
  const fragments = (lang, min) => [...new Set(keysOf(MESSAGES.it).flatMap((key) => lookup(MESSAGES.it, key).split(/\{\w+\}/).map((p) => p.trim())).filter((p) => p.length >= min))]
    .filter((part) => !keysOf(MESSAGES[lang]).some((key) => lookup(MESSAGES[lang], key).includes(part)))
  const ITALIAN = Object.fromEntries(['en', 'fr', 'es'].map((lang) => [lang, fragments(lang, 10)]))
  // Testi scritti a mano prima di questa fase (devono sparire in ogni lingua diversa dall'italiano).
  const OLD_HARDCODED = ['Il ciclo attuale va dal', 'Stipendio di questo ciclo', 'Giorno di inizio ciclo', 'del mese', 'Consenti a Spendy', 'Esporta i miei dati',
    'Backup dei dati', 'Elimina account', 'Termini di utilizzo', 'Annulla', 'Salva', 'Modifica', 'Inserisci stipendio', 'Disattivata', 'Notifiche', 'Segna tutte come lette',
    // La descrizione che addSalary salva da sola (i dati restano così, lo schermo no).
    'Stipendio']

  // =====================================================================
  section('2. Impostazioni vere: it → en → fr → es → it, senza reload')
  // =====================================================================
  const S = useAppStore.getState
  const caught = []
  const container = dom.createContainer()
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const screen = () => text(container)
  const labels = () => nodes(container).map((n) => attr(n, 'aria-label')).filter(Boolean)
  const byClass = (name) => nodes(container).filter((n) => hasClass(n, name))
  const button = (label) => nodes(container).find((n) => n.localName === 'button' && text(n).trim() === label)
  const click = async (node) => act(() => propsOf(node).onClick({ preventDefault() {}, stopPropagation() {} }))
  const dataOf = () => JSON.stringify(Object.fromEntries(DATA_FIELDS.map((field) => [field, S()[field]])))

  S().switchScope('u:utente-impostazioni-i18n')
  await act(() => root.render(h(App)))
  await act(() => {
    S().setLanguage('it')
    S().setCycleStartDay(7)
    useAppStore.setState({ today: TODAY })
    S().addSalary({ amount: 2000, date: '2026-10-07' })
    S().addExpense({ amount: 12.5, categoryId: 'bar', description: 'caffè', date: TODAY })
  })
  await act(() => { useAppStore.setState({ today: TODAY }); S().openModal('settings') })
  const rangeBefore = JSON.stringify(getCycleRange(S().today, S().cycleStartDay))
  const dataBefore = dataOf()
  check('l\'app si monta e Impostazioni si apre senza errori', caught.length === 0 && byClass('settings-screen').length === 1, caught[0]?.message)
  check('   card Elimina account visibile (sessione finta)', byClass('delete-account').length === 1)

  for (const lang of ['it', 'en', 'fr', 'es', 'it']) {
    await act(() => S().setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    const shown = screen()
    const expected = [
      tr('settings.screen.title'), tr('settings.cycle.title'), tr('settings.cycle.current', { period: PERIOD[lang] }), tr('settings.cycle.ofmonth'), tr('common.save'),
      tr('settings.salary.title'), tr('settings.salary.hint', { period: PERIOD[lang] }), tr('common.edit'), tr('common.delete'),
      tr('settings.ai.title'), tr('settings.ai.hint'), tr('settings.ai.detail'), tr('settings.ai.link'), tr('settings.ai.off'),
      tr('settings.privacy.title'), tr('settings.privacy.exportlabel'), tr('settings.privacy.exporttext'), tr('settings.privacy.deletelabel'), tr('settings.privacy.deletetext'),
      tr('legal.consent.privacylink'), tr('legal.consent.termslink'),
      tr('settings.backup.title'), tr('settings.backup.hint'), tr('settings.backup.export'), tr('settings.backup.import'),
      tr('settings.delete.title'), tr('settings.delete.hint'), tr('settings.delete.start'),
    ]
    const missing = expected.filter((part) => !shown.includes(part))
    check(`${lang}: Impostazioni, Stipendio, Ciclo, Spendy AI, Privacy, Backup, Elimina account nella lingua scelta`, missing.length === 0, missing.join(' | '))
    check(`   ${lang}: periodo del ciclo "${PERIOD[lang]}" (Giorno di inizio ciclo e Stipendio)`, shown.split(PERIOD[lang]).length >= 3)
    check(`   ${lang}: pulsante indietro "${tr('common.close')}"`, labels().includes(tr('common.close')))
    // I documenti legali sono pubblicati solo in italiano: in ogni lingua i link portano lì, mai a un 404.
    const legalLinks = nodes(container).filter((n) => n.localName === 'a').map((n) => attr(n, 'href')).filter((href) => /\.html$/.test(href))
    check(`   ${lang}: Privacy Policy e Termini aprono le pagine italiane pubblicate`, legalLinks.includes('/privacy.html') && legalLinks.includes('/termini.html') && legalLinks.every((href) => existsSync(join(ROOT, 'public', href))), legalLinks.join(', '))
    if (lang !== 'it') {
      const leftovers = [...ITALIAN[lang].filter((part) => shown.includes(part)), ...OLD_HARDCODED.filter((part) => shown.includes(part) || labels().includes(part))]
      check(`   ${lang}: nessun testo italiano a schermo`, leftovers.length === 0, leftovers.join(' | '))
    }
  }

  // =====================================================================
  section('3. Conferme ed errori, nella lingua scelta')
  // =====================================================================
  for (const lang of ['en', 'fr', 'es', 'it']) {
    await act(() => S().setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    // Stipendio: primo tocco su Elimina → conferma; Modifica → editor; Annulla.
    await click(button(tr('common.delete')))
    check(`${lang}: stipendio, conferma "${tr('settings.salary.confirmdelete')}"`, screen().includes(tr('settings.salary.confirmdelete')))
    await click(button(tr('common.edit')))
    check(`   ${lang}: editor con importo, Salva e Annulla`, labels().includes(tr('settings.salary.amount')) && Boolean(button(tr('common.cancel'))) && screen().includes(tr('common.save')))
    await click(button(tr('common.cancel')))
    check(`   ${lang}: niente eliminato (lo stipendio c'è ancora)`, S().incomes.length === 1 && S().incomes[0].amount === 2000)

    // Elimina account: due conferme, la parola nella lingua scelta, errore tradotto.
    await click(button(tr('settings.delete.start')))
    check(`${lang}: elimina account, prima conferma`, screen().includes(tr('settings.delete.question', { email: 'utente@esempio.invalid' })) && screen().includes(tr('settings.delete.text')) && Boolean(button(tr('settings.delete.continue'))) && Boolean(button(tr('common.cancel'))))
    await click(button(tr('settings.delete.continue')))
    const word = tr('settings.delete.word')
    const finalText = tr('settings.delete.finaltext', { word })
    check(`   ${lang}: ultima conferma "${finalText}"`, screen().includes(tr('settings.delete.finaltitle')) && screen().includes(finalText) && byClass('delete-account').some((n) => nodes(n).some((c) => c.localName === 'strong' && text(c) === word)))
    const input = () => nodes(container).find((n) => attr(n, 'id') === 'delete-account-confirm')
    const finalButton = () => button(tr('settings.delete.final'))
    if (lang !== 'it') {
      await act(() => propsOf(input()).onChange({ target: { value: 'ELIMINA' } }))
      check(`   ${lang}: la parola italiana non basta`, propsOf(finalButton()).disabled === true)
    }
    await act(() => propsOf(input()).onChange({ target: { value: word } }))
    check(`   ${lang}: con "${word}" il pulsante si attiva`, propsOf(finalButton()).disabled === false)
    const callsBefore = globalThis.__deleteCalls ?? 0
    await click(finalButton())
    const alert = nodes(container).find((n) => attr(n, 'role') === 'alert' && hasClass(n, 'delete-account__error'))
    check(`   ${lang}: errore del server nella lingua scelta`, globalThis.__deleteCalls === callsBefore + 1 && text(alert) === tr('settings.delete.error.failed'), text(alert))
    const cancels = nodes(container).filter((n) => n.localName === 'button' && text(n).trim() === tr('common.cancel'))
    await click(cancels.at(-1))

    // Backup: un file non valido → errore tradotto, dati non toccati.
    const fileInput = byClass('backup-card__file')[0]
    await act(() => propsOf(fileInput).onChange({ target: { files: [{ name: 'rotto.json', text: async () => '{non json' }], value: '' } }))
    await act(() => {})
    check(`${lang}: backup, import non riuscito spiegato nella lingua scelta`, screen().includes(tr('settings.backup.failed')) && screen().includes(tr('settings.backup.error.invalidjson')) && screen().includes(tr('settings.backup.untouched')))
  }

  // =====================================================================
  section('4. Centro notifiche e schermata d\'errore')
  // =====================================================================
  await act(() => {
    S().closeModal()
    useAppStore.setState({ notifications: [buildNotification({ type: 'budget', eventKey: 'budget:prova', title: 'Budget', message: 'prova' })] })
    S().openModal('notifications')
  })
  for (const lang of ['en', 'fr', 'es', 'it']) {
    await act(() => S().setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    const shown = screen()
    check(`${lang}: centro notifiche (titolo, segna tutte, tipo, non letta, adesso)`,
      [tr('notificationcenter.screen.title'), tr('notificationcenter.screen.markall'), tr('notificationcenter.types.budget'), tr('notificationcenter.screen.unread').trim(), tr('notificationcenter.time.now')].every((part) => shown.includes(part))
      && labels().includes(tr('notificationcenter.screen.remove', { title: 'Budget' })) && labels().includes(tr('notificationcenter.screen.title')) && labels().includes(tr('common.close')))
  }
  await act(() => useAppStore.setState({ notifications: [] }))
  check('   lista vuota: "nessuna notifica" nella lingua scelta', screen().includes(translate('it', 'notificationcenter.screen.empty')))
  {
    const now = new Date('2026-10-18T12:00:00Z')
    const ago = (minutes) => new Date(now - minutes * 60000).toISOString()
    check('tempo relativo nelle quattro lingue', formatRelativeTime(ago(5), now, 'en') === '5 min ago' && formatRelativeTime(ago(180), now, 'fr') === 'il y a 3 h'
      && formatRelativeTime(ago(30 * 60), now, 'es') === 'ayer' && formatRelativeTime(ago(3 * 1440), now, 'it') === '3 giorni fa' && formatRelativeTime(ago(0), now) === 'adesso')
    check('   date più vecchie con il mese della lingua', formatRelativeTime(ago(20 * 1440), now, 'fr').includes('sept.') && formatRelativeTime(ago(20 * 1440), now, 'en').includes('Sept'))
  }
  for (const lang of ['en', 'fr', 'es', 'it']) {
    await act(() => S().setLanguage(lang))
    const tr = (key) => translate(lang, key)
    const fallback = dom.createContainer()
    const fallbackRoot = createRoot(fallback)
    await act(() => fallbackRoot.render(h('div', null, h(ErrorFallback, { variant: 'app' }), h(ErrorFallback, { variant: 'page', onRetry() {} }))))
    check(`${lang}: schermata d'errore (app e pagina)`, [tr('crash.title'), tr('crash.apptext'), tr('crash.reopen'), tr('crash.pagetext'), tr('crash.retry')].every((part) => text(fallback).includes(part)))
    await act(() => fallbackRoot.unmount())
  }

  // =====================================================================
  section('5. Messaggi scritti fuori da React, nella lingua dell\'app')
  // =====================================================================
  for (const lang of ['en', 'fr', 'es', 'it']) {
    await act(() => S().setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    check(`${lang}: errori dell'eliminazione account`, DELETE_ACCOUNT_MESSAGES.offline === tr('settings.delete.error.offline') && DELETE_ACCOUNT_MESSAGES.noSession === tr('settings.delete.error.nosession') && DELETE_ACCOUNT_MESSAGES.unauthenticated === tr('settings.delete.error.unauthenticated'))
    const empty = parseBackup(JSON.stringify({ expenses: [], monthlyBudget: 0 }))
    const repaired = parseBackup(JSON.stringify({ expenses: [{ id: 'e1', amount: 'x', date: '2026-10-01' }, { id: 'e2', amount: 5 }], monthlyBudget: 1000 }))
    check(`   ${lang}: backup vuoto, righe scartate e riparate`, empty.error === tr('settings.backup.error.empty')
      && repaired.warnings.includes(tr('settings.backup.warning.expense', { index: 1 })) && repaired.warnings.some((w) => w.startsWith(tr('settings.backup.warning.expensedate', { index: 2, date: '' }).trim())), repaired.warnings?.join(' | '))
    check(`   ${lang}: nomi delle sezioni del backup`, FIELD_LABELS.expenses === tr('settings.backup.fields.expenses') && FIELD_LABELS.emergencyFundContributions === tr('settings.backup.fields.emergencyfundcontributions'))
  }

  // =====================================================================
  section('6. Pagine legali: solo le pagine italiane pubblicate')
  // =====================================================================
  // In questo rilascio i documenti restano solo in italiano: le traduzioni di
  // cortesia e la sezione "non vendiamo i dati" attendono la revisione legale
  // (copie in legal-pending/). Ogni link, in ogni lingua, deve aprire un file
  // che esiste in public/.
  const LEGAL_FILES = ['privacy.html', 'termini.html', 'elimina-account.html']
  check('le tre pagine italiane esistono, con le versioni registrate', LEGAL_FILES.every((file) => existsSync(join(ROOT, 'public', file)))
    && read('public/privacy.html').includes(LEGAL_DOCUMENTS.privacy.version) && read('public/termini.html').includes(LEGAL_DOCUMENTS.terms.version))
  check('nessuna pagina legale tradotta in public/ (non ancora approvate)', readdirSync(join(ROOT, 'public')).filter((file) => /^(privacy|termini|elimina-account)\.[a-z]{2}\.html$/.test(file)).length === 0)
  for (const lang of LANGS) {
    await act(() => S().setLanguage(lang))
    const box = dom.createContainer()
    const boxRoot = createRoot(box)
    await act(() => boxRoot.render(h(LegalConsentFields, { termsAccepted: false, privacyAcknowledged: false, onTermsChange() {}, onPrivacyChange() {} })))
    const hrefs = nodes(box).filter((n) => n.localName === 'a').map((n) => attr(n, 'href'))
    const note = text(box).includes(translate(lang, 'legal.consent.italiannote'))
    check(`${lang}: consensi alla registrazione, link alle pagine italiane${lang === 'it' ? '' : ' e nota "documenti in italiano"'}`,
      hrefs.join() === '/termini.html,/privacy.html' && hrefs.every((href) => existsSync(join(ROOT, 'public', href))) && (lang === 'it' ? !note : note), hrefs.join())
    await act(() => boxRoot.unmount())
  }
  // Eliminazione account: la parola da scrivere è quella della lingua attiva. La
  // pagina pubblica (solo italiano) indica ELIMINA: vale per l'italiano.
  check('parola di conferma localizzata: ELIMINA / DELETE / SUPPRIMER / ELIMINAR', ['ELIMINA', 'DELETE', 'SUPPRIMER', 'ELIMINAR'].every((word, i) => translate(LANGS[i], 'settings.delete.word') === word))
  check('elimina-account.html (italiano) indica la parola dell\'app in italiano', read('public/elimina-account.html').includes(`<strong>${translate('it', 'settings.delete.word')}</strong>`))

  // =====================================================================
  section('6-bis. Build: niente bozze legali, materiali di Google Play o .DS_Store in dist/')
  // =====================================================================
  {
    const dist = join(ROOT, 'dist')
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    const newest = Math.max(...['public/privacy.html', 'public/termini.html', 'public/elimina-account.html'].map((file) => statSync(join(ROOT, file)).mtimeMs))
    const fresh = existsSync(join(dist, 'index.html')) && statSync(join(dist, 'index.html')).mtimeMs >= newest
    // store-assets/ resta solo in locale (mai in Git): se c'è, nessuno dei suoi file deve finire nella build.
    const storeAssets = existsSync(join(ROOT, 'store-assets')) ? walk(join(ROOT, 'store-assets')).map((p) => basename(p)).filter((n) => n !== '.DS_Store') : []
    check('vite.config.js toglie i .DS_Store dalla build (non da public/)', /dropDsStore\(\)/.test(read('vite.config.js')))
    if (fresh) {
      const built = walk(dist).map((p) => basename(p))
      check('build: nessun .DS_Store', !built.includes('.DS_Store'))
      check('build: solo le tre pagine legali italiane', built.filter((n) => /^(privacy|termini|elimina-account)(\.[a-z]{2})?\.html$/.test(n)).sort().join() === [...LEGAL_FILES].sort().join())
      check('build: nessuna immagine di store-assets/', storeAssets.every((n) => !built.includes(n)))
    } else {
      check('build non ancora rifatta: controllo su dist rinviato a `npm run build`', true)
    }
  }

  // =====================================================================
  section('7. Cambiare lingua non tocca date e dati')
  // =====================================================================
  check('stesso ciclo in ogni lingua (7 ottobre → 7 novembre, fine esclusa)', JSON.stringify(getCycleRange(S().today, S().cycleStartDay)) === rangeBefore && rangeBefore === JSON.stringify({ start: '2026-10-07', end: '2026-11-07' }))
  check('spese, entrate, stipendi, budget e obiettivi invariati', dataOf() === dataBefore)
  check('nessun errore durante i cambi di lingua', caught.length === 0, caught[0]?.message)

  // =====================================================================
  section('8. Tutte le altre schermate: nessun testo italiano nelle altre lingue')
  // =====================================================================
  // Solo lettura: si aprono le schermate (anche i moduli di modifica, senza
  // salvare) e si cerca a schermo qualunque pezzo del dizionario italiano.
  const expense = S().expenses[0]
  const salary = S().incomes[0]
  // Parole singole del dizionario italiano (4-12 lettere) che non compaiono in nessun testo della lingua scelta.
  const SHORT_ITALIAN = Object.fromEntries(['en', 'fr', 'es'].map((lang) => {
    const own = keysOf(MESSAGES[lang]).map((key) => lookup(MESSAGES[lang], key)).join('\n')
    const words = new Set(keysOf(MESSAGES.it).map((key) => lookup(MESSAGES.it, key).trim()).filter((v) => /^[A-Za-zÀ-ÿ]{4,12}$/.test(v)))
    return [lang, [...words].filter((word) => !new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u').test(own))]
  }))
  const SCREENS = [
    ['Home', () => { S().closeModal(); S().setActiveTab('home') }],
    ['Spese', () => { S().closeModal(); S().openExpenses('cycle') }],
    ['Entrate', () => { S().closeModal(); S().setActiveTab('incomes') }],
    ['Analisi', () => { S().closeModal(); S().setActiveTab('analytics') }],
    ['Obiettivi', () => { S().closeModal(); S().setActiveTab('goals') }],
    ['Spendy', () => { S().closeModal(); S().setActiveTab('spendy') }],
    ['Aggiungi', () => { S().setActiveTab('home'); S().openModal('addTransaction') }],
    ['Nuova spesa', () => S().openModal('quickAdd', { type: 'expense' })],
    ['Nuova entrata', () => S().openModal('quickAdd', { type: 'income' })],
    ['Modifica spesa', () => S().openModal('editExpense', expense)],
    ['Modifica entrata', () => S().openModal('editIncome', salary)],
    ['Nuovo obiettivo', () => S().openModal('newGoal')],
    ['Radar', () => S().openModal('radar')],
    ['Andamento', () => S().openModal('andamento')],
    ['Posso permettermelo?', () => S().openModal('affordability')],
    ['Fondo emergenza', () => S().openModal('emergencyFund')],
    ['Notifiche', () => S().openModal('notifications')],
    ['Impostazioni', () => S().openModal('settings')],
  ]
  for (const lang of ['en', 'fr', 'es']) {
    await act(() => S().setLanguage(lang))
    const found = []
    for (const [name, open] of SCREENS) {
      const before = caught.length
      await act(open)
      if (caught.length > before) found.push(`${name}: errore ${caught.at(-1)?.message}`)
      const shown = screen() + ' ' + labels().join(' ')
      const leftovers = [...ITALIAN[lang].filter((part) => shown.includes(part)), ...OLD_HARDCODED.filter((part) => new RegExp(`(^|[^\\p{L}])${part}([^\\p{L}]|$)`, 'u').test(shown))]
      if (leftovers.length) found.push(`${name}: ${leftovers.join(' / ')}`)
      // Parole italiane brevi (una sola parola del dizionario, che non esiste nella lingua scelta).
      // Nodo per nodo: il testo intero è unito senza spazi ("Lingua" + "La langue…").
      const pieces = [...nodes(container).filter((n) => typeof n.data === 'string').map((n) => n.data), ...labels()]
      const shortWords = SHORT_ITALIAN[lang].filter((word) => pieces.some((piece) => new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u').test(piece)))
      if (shortWords.length) found.push(`${name}: parole italiane ${shortWords.join(' / ')}`)
      // Una chiave di traduzione grezza a schermo ("settings.salary.title").
      const rawKey = pieces.map((piece) => piece.trim()).find((piece) => /^[a-z]+(\.[a-z]+)+$/.test(piece) && lookup(MESSAGES.it, piece) !== undefined) ?? shown.match(/(^|[^\p{L}.@/])([a-z]+\.[a-z]+(\.[a-z]+)*)(?=[^\p{L}.]|$)/u)?.[2]
      if (rawKey && lookup(MESSAGES.it, rawKey) !== undefined) found.push(`${name}: chiave grezza ${rawKey}`)
      // Mesi abbreviati con il punto ("nov.") seguiti da un altro punto.
      if (/[^.]\.\.(?!\.)/.test(shown)) found.push(`${name}: doppio punto "${shown.match(/.{20}[^.]\.\.(?!\.)/)?.[0]}"`)
    }
    check(`${lang}: ${SCREENS.length} schermate senza testo italiano`, found.length === 0, found.join(' | '))
  }
  await act(() => { S().closeModal(); S().setActiveTab('home') })
  check('   dopo aver aperto tutte le schermate: dati invariati, nessun errore', dataOf() === dataBefore && caught.length === 0, caught[0]?.message)

  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Impostazioni e pagine legali nelle quattro lingue')
