// Fase 3D: la valuta dell'account in tutte le schermate, subito.
// `npm test`, senza rete e senza AI.
//
// L'App vera (Vite + React) su un DOM minimo, montata UNA volta: si cambia
// solo `currency` nello store (come fa "Conferma" in Impostazioni) e ogni
// schermata deve riscrivere i suoi importi con il nuovo simbolo, senza
// reload, senza smontare niente, senza toccare un solo dato. Poi lo stesso
// cambiando la lingua a valuta ferma.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'

const dom = installFakeDom(new Map())
// Il DOM minimo condiviso non conosce <select> (il periodo di Andamento): il
// minimo che React usa per una select controllata, come in cycleComparison.test.
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
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-currency-screens-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const act = async (fn) => { flushSync(fn); for (let i = 0; i < 6; i += 1) await tick() }
const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
const hasClass = (node, name) => (node.attributes?.get?.('class') ?? '').split(' ').includes(name)

const SYMBOLS = { EUR: '€', USD: '$', GBP: '£' }
// Ogni importo con un simbolo, prima o dopo le cifre ("1.234,56 €", "$1,234.56", "-£12.50").
const MONEY = /[€$£]\s?\d[\d.,  ]*|\d[\d.,  ]*\s?[€$£]/g
const DATA_FIELDS = ['monthlyBudget', 'cycleStartDay', 'amountHidden', 'expenses', 'incomes', 'customCategories', 'goals', 'goalContributions', 'emergencyFundSaved', 'emergencyFundContributions', 'confirmedCycleStart']

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { formatCurrency, formatCurrencyWhole } = await server.ssrLoadModule('/src/utils/format.js')
  const S = useAppStore.getState
  const caught = []
  const container = dom.createContainer()
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const html = () => dom.toHtml(container)
  const tokens = () => html().match(MONEY) ?? []
  const symbolsShown = () => [...new Set(tokens().map((token) => token.match(/[€$£]/)[0]))]
  const dataOf = () => JSON.stringify(Object.fromEntries(DATA_FIELDS.map((field) => [field, S()[field]])))

  S().switchScope('u:utente-valuta')
  await act(() => root.render(h(App)))
  await act(() => S().setLanguage('it'))
  const today = S().today
  await act(() => {
    S().addSalary({ amount: 2000, date: today })
    S().addExpense({ amount: 1234.56, categoryId: 'casa', description: 'affitto', date: today })
    S().addExpense({ amount: 45.5, categoryId: 'spesa', description: '', date: today })
    S().addGoal({ emoji: '✈️', label: 'Lisbona', target: 2500, etaMonths: 8 })
  })
  await act(() => {
    S().contributeToGoal(S().goals[0].id, 300.5)
    S().contributeToEmergencyFund(1000)
    useAppStore.setState((state) => ({ sync: { ...state.sync, lastSyncAt: new Date().toISOString() } }))
  })
  check('l\'app si monta senza errori, valuta iniziale EUR', caught.length === 0 && S().currency === 'EUR', caught[0]?.message)
  const before = dataOf()
  const amountsBefore = JSON.stringify({ expenses: S().expenses.map((e) => e.amount), incomes: S().incomes.map((i) => i.amount), goals: S().goalContributions.map((c) => c.amount), fund: S().emergencyFundContributions.map((c) => c.amount) })

  // Le schermate: una scheda, oppure una schermata sopra la Home.
  const SCREENS = [
    ['Home', () => { S().closeModal(); S().setActiveTab('home') }, (lang, code) => [formatCurrency(2000, lang, code), formatCurrency(1280.06, lang, code)]],
    ['Spese', () => { S().closeModal(); S().openExpenses('cycle') }, (lang, code) => [formatCurrency(1234.56, lang, code), formatCurrency(45.5, lang, code)]],
    ['Entrate', () => { S().closeModal(); S().setActiveTab('incomes') }, (lang, code) => [formatCurrency(2000, lang, code)]],
    ['Analisi', () => { S().closeModal(); S().setActiveTab('analytics') }, (lang, code) => [formatCurrency(1280.06, lang, code), formatCurrency(1234.56, lang, code)]],
    ['Obiettivi', () => { S().closeModal(); S().setActiveTab('goals') }, (lang, code) => [formatCurrency(300.5, lang, code), formatCurrency(2500, lang, code)]],
    ['Andamento (grafici e confronti)', () => { S().setActiveTab('home'); S().openModal('andamento') }, (lang, code) => [formatCurrency(1280.06, lang, code), formatCurrency(2000, lang, code)]],
    ['Radar', () => { S().setActiveTab('home'); S().openModal('radar') }, () => []], // importi solo se il motore ne mostra: controllati i simboli
    ['Fondo emergenza', () => { S().setActiveTab('home'); S().openModal('emergencyFund') }, (lang, code) => [formatCurrency(1000, lang, code)]],
    ['Impostazioni (stipendio)', () => { S().setActiveTab('home'); S().openModal('settings') }, (lang, code) => [formatCurrency(2000, lang, code)]],
  ]

  // =====================================================================
  section('Cambio valuta EUR → USD → GBP → EUR, schermata per schermata, senza reload')
  // =====================================================================
  for (const [name, open, expected] of SCREENS) {
    await act(() => S().setCurrency('EUR'))
    await act(open)
    const results = []
    for (const code of ['USD', 'GBP', 'EUR']) {
      await act(() => S().setCurrency(code))
      const shown = html()
      const missing = expected('it', code).filter((amount) => !shown.includes(amount))
      results.push([code, tokens().length, symbolsShown(), missing])
    }
    check(`${name}: dopo ogni cambio solo il simbolo giusto, e gli importi attesi`, results.every(([code, count, symbols, missing]) => symbols.every((symbol) => symbol === SYMBOLS[code]) && missing.length === 0 && (name === 'Radar' || count > 0)),
      JSON.stringify(results))
  }

  // =====================================================================
  section('Posso permettermelo? Il verdetto già a schermo segue la valuta')
  // =====================================================================
  {
    await act(() => { S().setCurrency('EUR'); S().setActiveTab('home'); S().openModal('affordability') })
    const input = nodes(nodes(container).find((n) => hasClass(n, 'affordability-screen__amount-input'))).find((n) => n.localName === 'input')
    await act(() => propsOf(input).onChange({ target: { value: '100' } }))
    const ask = nodes(container).find((n) => hasClass(n, 'affordability-screen__cta'))
    await act(() => propsOf(ask).onClick({}))
    const message = () => nodes(container).find((n) => hasClass(n, 'affordability-screen__result-message'))
    const remaining = 2000 - 1280.06 - 100
    check('verdetto in EUR: "Ti restano 620 € …"', message() && html().includes(formatCurrencyWhole(remaining, 'it', 'EUR')), html().match(/affordability-screen__result-message">([^<]*)/)?.[1])
    await act(() => S().setCurrency('USD'))
    check('   passando a USD con la schermata aperta: "Ti restano 620 $ …", subito', html().includes(formatCurrencyWhole(remaining, 'it', 'USD')) && symbolsShown().every((symbol) => symbol === '$'), html().match(/affordability-screen__result-message">([^<]*)/)?.[1])
    await act(() => S().setCurrency('GBP'))
    check('   e a GBP: "620 £", stesso verdetto', html().includes(formatCurrencyWhole(remaining, 'it', 'GBP')) && symbolsShown().every((symbol) => symbol === '£'))
    check('   il campo importo mostra "£"', nodes(container).some((n) => n.localName === 'span' && nodes(n).length === 2 && nodes(n)[1].data === '£'))
    await act(() => S().closeModal())
  }

  // =====================================================================
  section('Lingua e valuta indipendenti')
  // =====================================================================
  {
    await act(() => { S().setCurrency('USD'); S().setActiveTab('home') })
    const cases = [['en', '$2,000.00'], ['fr', '2 000,00 $'], ['es', '2.000,00 $'], ['it', '2.000,00 $']]
    for (const [lang, amount] of cases) {
      await act(() => S().setLanguage(lang))
      check(`${lang} + USD: "${amount}", la valuta non cambia con la lingua`, S().currency === 'USD' && html().includes(amount) && symbolsShown().every((symbol) => symbol === '$'))
    }
    await act(() => S().setCurrency('GBP'))
    check('it + GBP: la lingua non cambia con la valuta', S().language === 'it' && html().includes('2.000,00 £'))
  }

  // =====================================================================
  section('Persistenza: dopo la reidratazione dello store resta la valuta scelta')
  // =====================================================================
  {
    await act(() => S().setCurrency('USD'))
    await act(async () => { await useAppStore.persist.rehydrate() })
    for (let i = 0; i < 6; i += 1) await tick()
    check('dopo la reidratazione: USD, e la Home in $', S().currency === 'USD' && html().includes('2.000,00 $') && symbolsShown().every((symbol) => symbol === '$'))
    await act(() => { S().setActiveTab('goals') })
    await act(() => { S().setActiveTab('home') })
    check('   cambiando schermata: ancora $', symbolsShown().every((symbol) => symbol === '$') && tokens().length > 0)
  }

  // =====================================================================
  section('Nessun dato toccato')
  // =====================================================================
  const amountsAfter = JSON.stringify({ expenses: S().expenses.map((e) => e.amount), incomes: S().incomes.map((i) => i.amount), goals: S().goalContributions.map((c) => c.amount), fund: S().emergencyFundContributions.map((c) => c.amount) })
  check('importi salvati identici dopo tutti i cambi (2000, 1234.56, 45.5, 300.5, 1000)', amountsAfter === amountsBefore && amountsBefore.includes('1234.56') && amountsBefore.includes('300.5'))
  check('spese, entrate, obiettivi, fondo, budget e ciclo identici', dataOf() === before)
  check('nessun errore di rendering', caught.length === 0, caught[0]?.message)
  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Valuta in tutte le schermate (Fase 3D)')
