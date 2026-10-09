// Fase 2 del multilingue: la Home (e la cornice che la circonda: intestazione
// e barra in basso) in it / en / es / fr. `npm test`, senza rete.
//
// Monta l'App VERA (Vite, CSS escluso) sullo store vero e un DOM minimo
// (fakeDom.mjs), cambia lingua SENZA rimontare e guarda il testo che l'utente
// vedrebbe. Fuori da questa fase (restano come sono, vedi il report): le frasi
// di Spendy (coach, HumorLibrary, AI), il contenuto delle schede del Radar,
// i nomi dati dall'utente, il formato di importi e date.

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import { MESSAGES, translate } from './translate.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

const AREAS = ['home', 'budget', 'expenses', 'goals', 'radar']
const keysOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))
const HOME_KEYS = keysOf(MESSAGES.it).filter((key) => AREAS.includes(key.split('.')[0]))
const lookup = (dictionary, key) => key.split('.').reduce((node, part) => node?.[part], dictionary)
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()

// I componenti della Home tradotti in questa fase.
const COMPONENTS = [
  'src/pages/HomePage.jsx',
  'src/components/Header/Header.jsx',
  'src/components/BottomNavigation/BottomNavigation.jsx',
  'src/components/spendy/SpendyHero.jsx',
  'src/components/budget/BudgetCard.jsx',
  'src/components/budget/CycleStartCard.jsx',
  'src/components/budget/ExpenseSummaryCards.jsx',
  'src/components/radar/RadarPreview.jsx',
  'src/components/goals/GoalCard.jsx',
  'src/components/affordability/AffordabilityCTA.jsx',
]
// Le chiavi `expenses.*` della pagina Spese (Fase 3) sono usate qui.
const USES = ['src/notifications/notificationState.js', 'src/data/mockData.js', ...COMPONENTS,
  'src/pages/ExpensesPage.jsx', 'src/components/modals/EditExpenseModal.jsx', 'src/components/AmountLimitHint/AmountLimitHint.jsx']
// Il sorgente senza commenti: un testo citato in un commento non è a schermo.
const code = (path) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// =====================================================================
section('1. Dizionari: nessuna chiave mancante')
// =====================================================================
check(`chiavi della Home: ${HOME_KEYS.length}, nelle aree home/budget/expenses/goals/radar`, HOME_KEYS.length > 40 && HOME_KEYS.every((key) => AREAS.includes(key.split('.')[0])))
for (const code of ['it', 'en', 'es', 'fr']) {
  const missing = HOME_KEYS.filter((key) => typeof lookup(MESSAGES[code], key) !== 'string' || !lookup(MESSAGES[code], key).trim())
  check(`${code}: tutte presenti e non vuote`, missing.length === 0, missing.join(', '))
}
{
  const mismatched = HOME_KEYS.filter((key) => ['en', 'es', 'fr'].some((code) => placeholders(lookup(MESSAGES[code], key)) !== placeholders(lookup(MESSAGES.it, key))))
  check('stessi parametri ({count}, {amount}…) in ogni lingua', mismatched.length === 0, mismatched.join(', '))
}
{
  const used = new Set(USES.flatMap((path) => [...code(path).matchAll(/'((?:home|budget|expenses|goals|radar)\.[a-z.]+)'/g)].map((m) => m[1])))
  const unknown = [...used].filter((key) => typeof lookup(MESSAGES.it, key) !== 'string')
  check(`ogni chiave usata dai componenti esiste (${used.size} usate)`, used.size > 0 && unknown.length === 0, unknown.join(', '))
  const orphans = HOME_KEYS.filter((key) => !used.has(key))
  check('nessuna chiave del dizionario rimasta inutilizzata', orphans.length === 0, orphans.join(', '))
}

// =====================================================================
section('2. Nessun testo statico rimasto nei componenti della Home')
// =====================================================================
{
  // Testo JSX tra tag, e attributi letti dall'utente o dal lettore di schermo.
  const ALLOWED_TEXT = new Set(['SPEND', 'Y']) // il logo
  for (const path of COMPONENTS) {
    const source = code(path)
    const jsxText = [...source.matchAll(/>([^<>{}]*)</g)].map((m) => m[1].trim()).filter((text) => /[A-Za-zÀ-ÿ]/.test(text) && !ALLOWED_TEXT.has(text) && !/[=;()]/.test(text))
    const attrs = [...source.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map((m) => m[1])
    check(`${path.split('/').pop()}: nessun testo fisso`, jsxText.length === 0 && attrs.length === 0, [...jsxText, ...attrs].join(' | '))
  }
  // Nessuna frase italiana della Home è rimasta scritta nei componenti.
  const fragments = HOME_KEYS.flatMap((key) => lookup(MESSAGES.it, key).split(/\{\w+\}/).map((part) => part.trim())).filter((part) => part.length >= 8)
  const leftovers = COMPONENTS.flatMap((path) => fragments.filter((part) => code(path).includes(part)).map((part) => `${path.split('/').pop()}: "${part}"`))
  check('nessuna frase dei dizionari è ancora scritta a mano nei componenti', leftovers.length === 0, leftovers.join(' | '))
  const nav = (await import('../data/mockData.js')).mockNavItems
  check('barra in basso: ogni voce ha la sua chiave, tranne "Spendy" (nome della mascotte)', nav.every((item) => (item.id === 'spendy' ? !item.labelKey && item.label === 'Spendy' : lookup(MESSAGES.it, item.labelKey) === item.label)))
}

// =====================================================================
section('3. Parametri e plurali')
// =====================================================================
check('{count} sostituito, singolare e plurale', translate('it', 'expenses.summary.countone', { count: 1 }) === '1 transazione' && translate('it', 'expenses.summary.countmany', { count: 0 }) === '0 transazioni' && translate('en', 'expenses.summary.countone', { count: 1 }) === '1 transaction' && translate('fr', 'expenses.summary.countmany', { count: 3 }) === '3 transactions')
check('{amount} passa così com\'è (importo già formattato)', translate('en', 'budget.monthly', { amount: '2451,00 €' }) === 'Monthly budget 2451,00 €' && translate('es', 'expenses.summary.of', { amount: '0,00 €' }) === 'de 0,00 €')
check('{spent} e {budget}', translate('fr', 'budget.spentof', { spent: '12,50 €', budget: '2451,00 €' }) === '12,50 € dépensés sur 2451,00 €')
check('{seen}/{needed}', translate('es', 'radar.preview.learning', { seen: 1, needed: 3 }) === '🔍 Todavía estoy aprendiendo tus hábitos (1/3 ciclos).')
check('{name}: il nome della mascotte resta "Spendy"', translate('en', 'home.affordability.subtitle', { name: 'Spendy' }) === 'Ask Spendy before you buy something.')
check('campanella: stessa funzione, ora nella lingua scelta (senza lingua → italiano)', translate('en', 'home.header.notifications.unread', { count: 3 }) === 'Notifications, 3 unread')

// =====================================================================
section('4. La Home vera in it → en → es → fr → it, senza reload')
// =====================================================================
const dom = installFakeDom(new Map())
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-i18n-home-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const act = async (fn) => { flushSync(fn); for (let i = 0; i < 6; i += 1) await tick() }

// Tutto ciò che non è la lingua: identico in ogni lingua.
const DATA_FIELDS = ['monthlyBudget', 'cycleStartDay', 'amountHidden', 'expenses', 'incomes', 'customCategories', 'goals', 'goalContributions', 'emergencyFundSaved', 'confirmedCycleStart', 'legacySalaryHistoryDone', 'sync']
const dataOf = (state) => JSON.stringify(Object.fromEntries(DATA_FIELDS.map((field) => [field, state[field]])))

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  // La stessa istanza dei dizionari che usa l'App (caricata da Vite).
  const LIVE = (await server.ssrLoadModule('/src/i18n/translate.js')).MESSAGES
  const S = useAppStore.getState
  const caught = []
  const container = dom.createContainer()
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const html = () => dom.toHtml(container)
  // Ciò che decidono i motori (frase di Spendy, schede del Radar) non fa parte
  // di questa fase: fuori dal confronto.
  const uiHtml = () => html()
    .replace(/<p class="spendy-hero__message">[\s\S]*?<\/p>/g, '')
    .replace(/<p class="spendy-hero__secondary">[\s\S]*?<\/p>/g, '')
    .replace(/<span class="radar-preview__tile-(?:title|value|label)">[\s\S]*?<\/span>/g, '')
  const money = () => (html().match(/-?[\d.]+,\d{2} €/g) ?? []).join(' | ')

  S().switchScope('u:utente-home-i18n')
  await act(() => root.render(h(App)))
  // Dati costruiti sul giorno vero dell'app (l'App lo riallinea al montaggio):
  // stipendio nel ciclo precedente, nessuno in quello in corso → compare la
  // scheda "nuovo ciclo" e la BudgetCard dice che lo stipendio manca.
  const today = S().today
  const [y, m, d] = today.split('-').map(Number)
  const prev = new Date(y, m - 2, Math.min(d, 28))
  const prevDate = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
  await act(() => {
    S().addSalary({ amount: 2537, date: prevDate })
    S().addExpense({ amount: 12.5, categoryId: 'bar', description: 'caffè', date: today })
    S().addGoal({ emoji: '✈️', label: 'Lisbona', target: 1200, etaMonths: 8 })
    S().addGoal({ emoji: '🚗', label: 'Auto', target: 5000, etaMonths: 20 })
    S().addGoal({ emoji: '💻', label: 'PC', target: 900, etaMonths: 3 })
  })
  // Un account già sincronizzato almeno una volta (senza, la scheda aspetta il cloud).
  await act(() => useAppStore.setState((state) => ({ sync: { ...state.sync, lastSyncAt: new Date().toISOString() } })))
  check('l\'app si monta sulla Home senza errori', caught.length === 0 && S().activeTab === 'home' && html().includes('radar-preview'), caught[0]?.message)
  check('   la scheda del nuovo ciclo è a schermo (anche lei va tradotta)', html().includes('cycle-start'))

  const dataBefore = dataOf(S())
  const moneyIt = money()
  const cycleLabel = html().match(/· ([^<]+)<\/p>/)?.[1]
  const shown = { it: [], en: [], es: [], fr: [] }

  // Le chiavi sempre visibili con questi dati, con i parametri veri.
  const visible = (code) => {
    const tr = (key, params) => translate(code, key, params)
    return [
      `aria-label="${tr('home.header.settings')}"`,
      `aria-label="${tr('home.header.notifications.none')}"`,
      `aria-label="${tr('home.hero.label', { name: 'Spendy' })}"`,
      `>${tr('home.hero.cta')}<`,
      tr('budget.available'),
      `aria-label="${tr('budget.hide')}"`,
      tr('budget.nosalary'),
      tr('budget.spentof', { spent: '12,50 €', budget: '0,00 €' }),
      tr('expenses.summary.today'),
      tr('expenses.summary.countone', { count: 1 }),
      tr('expenses.summary.cycle'),
      tr('expenses.summary.of', { amount: '0,00 €' }),
      tr('radar.preview.title'),
      tr('home.emergency'),
      tr('goals.eta', { months: 8 }),
      tr('home.goals.moremany', { count: 2 }),
      tr('home.affordability.title'),
      tr('home.affordability.subtitle', { name: 'Spendy' }),
      tr('budget.cycle.label'),
      tr('budget.cycle.fresh.title'),
      tr('budget.cycle.fresh.addsalary'),
      tr('budget.cycle.fresh.startzero'),
      `>${tr('home.nav.home')}<`,
      `>${tr('home.nav.analytics')}<`,
      `aria-label="${tr('home.nav.add')}"`,
      `>${tr('home.nav.goals')}<`,
    ]
  }
  const SAMPLES = {
    it: ['Disponibile', 'Spese di oggi', '1 transazione', 'Fondo emergenza', 'e altri 2 obiettivi →', 'Posso permettermelo?', 'aria-label="Impostazioni"', 'Il mio Radar'],
    en: ['Available', 'Spent today', '1 transaction', 'Emergency fund', 'and 2 more goals →', 'Can I afford it?', 'aria-label="Settings"', 'My Radar', 'A new cycle has started'],
    es: ['Disponible', 'Gastos de hoy', '1 movimiento', 'Fondo de emergencia', 'y 2 objetivos más →', '¿Me lo puedo permitir?', 'aria-label="Ajustes"', 'Mi Radar', '>Inicio<'],
    fr: ['Disponible', 'Dépenses du jour', '1 transaction', 'Fonds d’urgence', 'et 2 autres objectifs →', 'Puis-je me le permettre\u00a0?', 'aria-label="Paramètres"', 'Mon Radar', '>Accueil<'],
  }

  for (const code of ['it', 'en', 'es', 'fr', 'it']) {
    await act(() => S().setLanguage(code))
    const screen = uiHtml()
    const missing = visible(code).filter((text) => !screen.includes(text))
    check(`${code}: ogni testo della Home è nella lingua scelta (subito, senza reload)`, S().language === code && missing.length === 0, missing.join(' | '))
    check(`   ${code}: esempi letti a schermo`, SAMPLES[code].every((text) => screen.includes(text)), SAMPLES[code].filter((text) => !screen.includes(text)).join(' | '))
    if (code !== 'it') {
      // Nessun pezzo di frase italiana (che in questa lingua è diverso) a schermo.
      const italian = HOME_KEYS.flatMap((key) => {
        const own = lookup(MESSAGES[code], key)
        return lookup(MESSAGES.it, key).split(/\{\w+\}/).map((part) => part.trim()).filter((part) => part.length >= 5 && !own.includes(part))
      })
      const left = [...new Set(italian.filter((part) => screen.includes(part)))]
      check(`   ${code}: nessun testo italiano rimasto`, left.length === 0, left.join(' | '))
    }
    check(`   ${code}: nessun segnaposto {…} non sostituito`, !/\{\w+\}/.test(html()))
    check(`   ${code}: importi identici a quelli in italiano (${moneyIt})`, money() === moneyIt)
    check(`   ${code}: nomi e date restano quelli dei dati (Lisbona, ${cycleLabel})`, html().includes('Lisbona') && html().includes(cycleLabel))
    check(`   ${code}: nessun errore di rendering`, caught.length === 0, caught[0]?.message)
    shown[code].push(screen)
  }
  check('nessun dato toccato da tutti i cambi di lingua', dataOf(S()) === dataBefore)
  check('it → … → it: la Home torna identica a com\'era', shown.it[0] === shown.it[1])

  // =====================================================================
  section('5. Testi che dipendono dallo stato, nella lingua scelta')
  // =====================================================================
  await act(() => S().setLanguage('en'))
  await act(() => S().toggleAmountHidden())
  check('importo nascosto: "Show amount"', html().includes('aria-label="Show amount"'))
  await act(() => S().toggleAmountHidden())
  await act(() => S().addSalary({ amount: 2451, date: today }))
  check('stipendio del ciclo inserito: "Monthly budget 2451,00 €"', html().includes('Monthly budget 2451,00 €') && html().includes('of 2451,00 €'))
  await act(() => S().deleteGoal(S().goals.find((goal) => goal.label === 'PC').id))
  check('due obiettivi: "and one more goal →"', html().includes('and one more goal →'))
  await act(() => S().setLanguage('es'))
  check('   in spagnolo: "y otro objetivo más →", "Presupuesto mensual 2451,00 €"', html().includes('y otro objetivo más →') && html().includes('Presupuesto mensual 2451,00 €'))
  await act(() => S().setLanguage('fr'))
  check('   in francese: "Budget mensuel 2451,00 €", "Vous respectez votre budget !"', html().includes('Budget mensuel 2451,00 €') && html().includes('Vous respectez votre budget\u00a0!'))

  // =====================================================================
  section('6. Fallback: una traduzione mancante mostra l\'italiano')
  // =====================================================================
  {
    const saved = LIVE.en.budget.available
    delete LIVE.en.budget.available
    await act(() => S().setLanguage('en'))
    check('chiave tolta dall\'inglese → "Disponibile", il resto in inglese', html().includes('>Disponibile<') && html().includes('Spent today'))
    LIVE.en.budget.available = saved
    await act(() => S().setLanguage('it'))
    await act(() => S().setLanguage('en'))
    check('   rimessa → "Available"', html().includes('>Available<'))
    await act(() => S().setLanguage('de'))
    // Un codice non valido diventa la lingua predefinita (inglese), non più l'italiano.
    check('lingua non valida → tutta la Home nella lingua predefinita (inglese)', S().language === 'en' && html().includes(translate('en', 'expenses.summary.today')) && html().includes(`aria-label="${translate('en', 'home.header.settings')}"`))
  }
  check('nessun errore di rendering in tutto il percorso', caught.length === 0, caught[0]?.message)
  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Multilingue — Fase 2 (Home)')
