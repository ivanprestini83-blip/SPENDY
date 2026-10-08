// Fase 4B-1 del multilingue: Analisi, Andamento e Confronta periodi in
// it / en / es / fr. `npm test`, senza rete.
//
// Monta i VERI AnalyticsPage e AndamentoScreen (Vite, CSS escluso) sullo store
// vero e un DOM minimo, cambia lingua SENZA rimontare e guarda il testo che
// l'utente vedrebbe. Importi, percentuali, date e nomi dei mesi arrivano già
// formattati e restano identici in ogni lingua (fase date/numeri a parte).

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
const code = (path) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const LANGS = ['it', 'en', 'es', 'fr']
const keysOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))
const lookup = (dictionary, key) => key.split('.').reduce((node, part) => node?.[part], dictionary)
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()
const same = (values) => new Set(values.map((v) => JSON.stringify(v))).size === 1

const AREAS = ['common', 'analytics', 'andamento']
const NEW_KEYS = keysOf(MESSAGES.it).filter((key) => AREAS.includes(key.split('.')[0]))
const SCREEN_KEYS = NEW_KEYS.filter((key) => !key.startsWith('common.') || key === 'common.close')
const FILES = [
  'src/pages/AnalyticsPage.jsx', 'src/components/modals/CategoryDetailModal.jsx', 'src/components/modals/Modal.jsx',
  'src/components/andamento/AndamentoScreen.jsx', 'src/components/andamento/CycleSummary.jsx', 'src/components/andamento/CycleTrendChart.jsx',
  'src/components/andamento/CycleComparison.jsx', 'src/components/andamento/CategoryComparison.jsx', 'src/components/andamento/andamentoFormat.js',
]

// =====================================================================
section('1. Dizionari: nessuna chiave mancante, stessi segnaposto')
// =====================================================================
check(`chiavi nuove: ${NEW_KEYS.length} (common ${NEW_KEYS.filter((k) => k.startsWith('common.')).length}, analytics ${NEW_KEYS.filter((k) => k.startsWith('analytics.')).length}, andamento ${NEW_KEYS.filter((k) => k.startsWith('andamento.')).length})`, NEW_KEYS.length === 86)
for (const lang of LANGS) {
  const missing = NEW_KEYS.filter((key) => typeof lookup(MESSAGES[lang], key) !== 'string' || !lookup(MESSAGES[lang], key).trim())
  check(`${lang}: tutte presenti e non vuote`, missing.length === 0, missing.join(', '))
}
{
  const mismatched = NEW_KEYS.filter((key) => LANGS.some((lang) => placeholders(lookup(MESSAGES[lang], key)) !== placeholders(lookup(MESSAGES.it, key))))
  check('stessi segnaposto in ogni lingua', mismatched.length === 0, mismatched.join(', '))
  check('common: Chiudi, Salva, Annulla, Modifica, Elimina, Conferma, Torna indietro', ['close', 'save', 'cancel', 'edit', 'delete', 'confirm', 'back'].every((k) => typeof lookup(MESSAGES.it, `common.${k}`) === 'string')
    && translate('it', 'common.close') === 'Chiudi' && translate('en', 'common.close') === 'Close')
}
{
  const used = new Set(FILES.flatMap((path) => [...code(path).matchAll(/'((?:analytics|andamento|common)\.[a-z.]+)'/g)].map((m) => m[1])))
  // Famiglie costruite con un nome variabile: le frasi sotto i grafici e la seconda riga della conclusione.
  for (const metric of ['spent', 'income', 'savings', 'budget']) for (const dir of ['down', 'up', 'same']) used.add(`andamento.sentence.${metric}.${dir}`)
  for (const ref of ['diff', 'same']) for (const which of ['previous', 'other']) used.add(`andamento.verdict.${ref}${which}`)
  const orphans = NEW_KEYS.filter((key) => !key.startsWith('common.') && !used.has(key))
  const unknown = [...used].filter((key) => typeof lookup(MESSAGES.it, key) !== 'string')
  check('ogni chiave analytics/andamento è usata dai componenti', orphans.length === 0, orphans.join(', '))
  check('ogni chiave usata esiste', unknown.length === 0, unknown.join(', '))
}

// =====================================================================
section('2. Nessun testo italiano fisso rimasto nell\'area 4B-1')
// =====================================================================
for (const path of FILES) {
  const source = code(path)
  const jsxText = path.endsWith('.jsx') ? [...source.matchAll(/>([^<>{}]*)</g)].map((m) => m[1].trim()).filter((t) => /[A-Za-zÀ-ÿ]{3,}/.test(t) && !/[=;()&|]/.test(t)) : []
  const attrs = [...source.matchAll(/(?:aria-label|title|placeholder|alt|centerLabel)="([^"]*[A-Za-zÀ-ÿ][^"]*)"/g)].map((m) => m[1])
  // Un pezzo di frase conta solo dove sarebbe testo: dopo un apice o un tag (non dentro un nome come buildAndamento).
  const asText = (p) => [`'${p}`, `"${p}`, `\`${p}`, `>${p}`, `> ${p}`, `} ${p}`].some((needle) => source.includes(needle))
  const fragments = SCREEN_KEYS.flatMap((key) => lookup(MESSAGES.it, key).split(/\{\w+\}/).map((p) => p.trim())).filter((p) => p.length >= 7 && asText(p))
  check(`${path.split('/').pop()}: nessun testo fisso`, jsxText.length === 0 && attrs.length === 0 && fragments.length === 0, [...jsxText, ...attrs, ...fragments].join(' | '))
}
check('logica invariata: andamentoEngine, budgetCalculations e cycle.js non usano l\'i18n', ['src/utils/andamentoEngine.js', 'src/utils/budgetCalculations.js', 'src/utils/cycle.js', 'src/utils/categoryDetail.js'].every((p) => !read(p).includes('i18n')))

// =====================================================================
section('3. Montaggio: Analisi e Andamento veri')
// =====================================================================
const dom = installFakeDom(new Map())
// Il DOM minimo non conosce <select>: il minimo che React usa (come in cycleComparison.test).
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
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-i18n-andamento-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})
const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
const text = (node) => (typeof node?.data === 'string' ? node.data : (node?.childNodes ?? []).map(text).join(''))
const cls = (node) => node.attributes?.get?.('class') ?? ''
const byClass = (root, name) => nodes(root).filter((n) => cls(n).split(' ').includes(name))
const one = (root, name) => byClass(root, name)[0]
const aria = (node) => node?.attributes?.get?.('aria-label') ?? ''
const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const act = async (fn) => { flushSync(fn); for (let i = 0; i < 5; i += 1) await tick() }

// Pezzi di frasi italiane (dei testi di questa fase) rimasti a schermo in un'altra lingua.
const leftover = (screenText, lang) => {
  const own = SCREEN_KEYS.map((key) => lookup(MESSAGES[lang], key)).join('\n')
  return [...new Set(SCREEN_KEYS.flatMap((key) => lookup(MESSAGES.it, key).split(/\{\w+\}/).map((p) => p.trim()))
    .filter((p) => p.length >= 6 && !own.includes(p) && screenText.includes(p)))]
}

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { AndamentoScreen } = await server.ssrLoadModule('/src/components/andamento/AndamentoScreen.jsx')
  const { AnalyticsPage } = await server.ssrLoadModule('/src/pages/AnalyticsPage.jsx')
  const { buildAndamento, compareCycles } = await server.ssrLoadModule('/src/utils/andamentoEngine.js')
  const fmt = await server.ssrLoadModule('/src/components/andamento/andamentoFormat.js')
  const { formatCurrency } = await server.ssrLoadModule('/src/utils/format.js')
  const S = useAppStore.getState
  const setLanguage = (lang) => S().setLanguage(lang)

  const at = '2026-10-20T08:00:00.000Z'
  const expense = (id, categoryId, amount, date) => ({ id, categoryId, amount, date, description: 'x', updatedAt: at })
  const income = (id, categoryId, amount, date) => ({ id, categoryId, amount, date, description: categoryId, updatedAt: at })
  // Tre cicli (giorno 7): A 7/8–6/9 con UNA spesa, B 7/9–6/10 con 7 categorie, C (in corso) con extra.
  const MAIN = {
    today: '2026-10-20',
    cycleStartDay: 7,
    incomes: [income('i-a', 'stipendio', 2400, '2026-08-07'), income('i-b', 'stipendio', 2537, '2026-09-07'), income('i-c', 'stipendio', 2451, '2026-10-07'), income('i-x', 'extra', 120, '2026-10-15')],
    expenses: [
      expense('a1', 'casa', 800, '2026-08-10'),
      expense('b1', 'casa', 900, '2026-09-10'), expense('b2', 'spesa', 558, '2026-09-15'), expense('b3', 'shopping', 300, '2026-09-18'),
      expense('b4', 'trasporti', 196, '2026-09-22'), expense('b5', 'bar', 163.23, '2026-09-28'), expense('b6', 'ristoranti', 80, '2026-09-30'), expense('b7', 'farmacia', 20, '2026-10-02'),
      expense('c1', 'ristoranti', 17, '2026-10-12'), expense('c2', 'spesa', 40, '2026-10-14'),
    ],
  }
  const load = (state) => useAppStore.setState({ goals: [], customCategories: [], ...state })
  load(MAIN)
  const andamento = buildAndamento({ ...MAIN })
  const [A, B, C] = andamento.cycles
  const cmpBC = compareCycles(B, C)
  const cmpAC = compareCycles(A, C)

  // =====================================================================
  section('4. Andamento — "Come sto andando" nelle quattro lingue')
  // =====================================================================
  const container = dom.createContainer()
  const root = createRoot(container, { onRecoverableError: () => {} })
  await act(() => root.render(h(AndamentoScreen, { onClose: () => {} })))
  const tabs = () => byClass(container, 'andamento-screen__tab')
  const html = () => dom.toHtml(container)
  const overviewTexts = {}
  for (const lang of [...LANGS, 'it']) {
    await act(() => setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    const summary = text(one(container, 'cycle-summary'))
    check(`${lang}: titolo, schede, legenda e riepilogo del ciclo in corso`, S().language === lang
      && text(one(container, 'andamento-screen__title')).includes(tr('andamento.title'))
      && text(tabs()[0]) === tr('andamento.tab.overview') && text(tabs()[1]) === tr('andamento.tab.compare')
      && aria(one(container, 'andamento-screen__tabs')) === tr('andamento.view') && aria(one(container, 'andamento-screen__back')) === tr('common.close')
      && text(one(container, 'trend-chart__title')) === tr('andamento.trend.title') && text(one(container, 'trend-chart__legend')).includes(tr('andamento.metric.income'))
      && summary.includes(tr('andamento.status.current')) && summary.includes(tr('andamento.metric.savings')) && summary.includes(tr('andamento.metric.budget'))
      && summary.includes(tr('andamento.summary.extra', { amount: formatCurrency(120) })) && summary.includes(tr('andamento.expensesmany', { count: 2 }))
      && summary.includes(tr('andamento.summary.where')))
    check(`   ${lang}: aria del grafico per ciclo, con importi invariati`, aria(byClass(container, 'trend-chart__column').at(-1)) === tr('andamento.trend.bar', { cycle: C.label, spent: formatCurrency(C.spent), income: formatCurrency(C.income) }))
    overviewTexts[lang] = byClass(container, 'cycle-summary__metric-value').map(text).join('|')
    if (lang !== 'it') check(`   ${lang}: nessun testo italiano rimasto`, leftover(text(container) + html(), lang).length === 0, leftover(text(container) + html(), lang).join(' | '))
  }
  check('importi e percentuali del riepilogo identici in ogni lingua', same(Object.values(overviewTexts)), JSON.stringify(overviewTexts))
  // Il ciclo B: 7 categorie → "+ altre 2 categorie (le trovi in Analisi)", con il nome tradotto della scheda.
  await act(() => propsOf(byClass(container, 'trend-chart__column').at(-2)).onClick({}))
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    const more = text(one(container, 'cycle-summary__more'))
    check(`${lang}: "${more}"`, more === translate(lang, 'andamento.summary.moremany', { count: 2, tab: translate(lang, 'home.nav.analytics') }) && text(one(container, 'cycle-summary')).includes(translate(lang, 'andamento.expensesmany', { count: 7 })))
  }
  check('   italiano identico a prima: "+ altre 2 categorie (le trovi in Analisi)"', translate('it', 'andamento.summary.moremany', { count: 2, tab: translate('it', 'home.nav.analytics') }) === '+ altre 2 categorie (le trovi in Analisi)')
  // Il ciclo A: una sola spesa → singolare.
  await act(() => propsOf(byClass(container, 'trend-chart__column').at(-3)).onClick({}))
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    check(`${lang}: una sola spesa → "${translate(lang, 'andamento.expensesone', { count: 1 })}"`, text(one(container, 'cycle-summary')).includes(translate(lang, 'andamento.expensesone', { count: 1 })))
  }
  check('plurali: one/many in ogni lingua', LANGS.every((l) => translate(l, 'andamento.expensesone', { count: 1 }) !== translate(l, 'andamento.expensesmany', { count: 1 }))
    && translate('it', 'andamento.summary.moreone', { tab: 'Analisi' }) === "+ un'altra categoria (la trovi in Analisi)")

  // =====================================================================
  section('5. Confronta periodi — conclusione, riquadri, grafici, categorie')
  // =====================================================================
  await act(() => setLanguage('it'))
  await act(() => propsOf(tabs()[1]).onClick({}))
  const values = () => byClass(container, 'cycle-comparison__value').map(text).join('|')
  const shown = {}
  for (const lang of [...LANGS, 'it']) {
    await act(() => setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    check(`${lang}: selettori "${tr('andamento.compare.before')}" / "${tr('andamento.compare.after')}", stato del ciclo`, byClass(container, 'cycle-comparison__picker-label').map(text).join('|') === `${tr('andamento.compare.before')}|${tr('andamento.compare.after')}`
      && byClass(container, 'cycle-comparison__status').map(text).join('|') === `✓ ${tr('andamento.status.done')}|● ${tr('andamento.status.current')}`
      && aria(one(container, 'cycle-comparison__pickers')) === tr('andamento.compare.pickers'))
    check(`   ${lang}: conclusione in frasi intere ("${text(one(container, 'cycle-comparison__verdict-text'))}" / "${text(one(container, 'cycle-comparison__verdict-ref'))}")`,
      text(one(container, 'cycle-comparison__verdict-title')).endsWith(tr('andamento.verdict.good'))
      && text(one(container, 'cycle-comparison__verdict-text')) === tr('andamento.verdict.less', { amount: formatCurrency(Math.abs(cmpBC.spent.diff)) })
      && text(one(container, 'cycle-comparison__verdict-ref')) === `${tr('andamento.verdict.diffprevious')} (${B.label})`
      && text(one(container, 'cycle-comparison__note')) === tr('andamento.compare.currentnote') && aria(one(container, 'cycle-comparison__verdict')) === tr('andamento.compare.conclusion'))
    check(`   ${lang}: riquadri Spese / Entrate / Risparmio / Budget utilizzato`, byClass(container, 'cycle-comparison__metric-label').map(text).join('|') === ['spent', 'income', 'savings', 'budget'].map((m) => tr(`andamento.metric.${m}`)).join('|')
      && aria(one(container, 'cycle-comparison__metrics')) === tr('andamento.compare.numbers', { before: B.label, after: C.label })
      && text(one(container, 'cycle-comparison__section-title')).endsWith(tr('andamento.compare.difference')))
    shown[lang] = values()
    if (lang !== 'it') check(`   ${lang}: nessun testo italiano rimasto`, leftover(text(container) + html(), lang).length === 0, leftover(text(container) + html(), lang).join(' | '))
  }
  check('valori dei riquadri identici in ogni lingua (calcoli invariati)', same(Object.values(shown)) && shown.it.includes(formatCurrency(B.spent)) && shown.it.includes(formatCurrency(C.spent)), JSON.stringify(shown))
  // Grafici: spese (frase), budget (punti percentuali), entrate.
  const card = (i) => byClass(container, 'cycle-comparison__metric')[i]
  const chart = () => one(container, 'metric-chart')
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    await act(() => propsOf(card(0)).onClick({}))
    const spentOk = text(one(chart(), 'metric-chart__title')) === tr('andamento.chart.spent') && text(one(chart(), 'metric-chart__sentence')) === tr('andamento.sentence.spent.down')
    await act(() => propsOf(card(3)).onClick({}))
    const points = Math.round(cmpBC.budgetUsed.diffPoints)
    const budgetSummary = `${points > 0 ? '▲' : '▼'} ${tr('andamento.change.percentpoints', { points: `${points > 0 ? '+' : '-'}${Math.abs(points)}` })}`
    const budgetOk = text(one(chart(), 'metric-chart__title')) === tr('andamento.chart.budget') && text(one(chart(), 'metric-chart__summary')) === budgetSummary
      && text(byClass(card(3), 'cycle-comparison__change')[0]).includes(tr('andamento.change.points', { points: `${points > 0 ? '+' : '-'}${Math.abs(points)}` }))
    await act(() => propsOf(card(3)).onClick({}))
    check(`${lang}: grafici delle spese e del budget ("${budgetSummary}")`, spentOk && budgetOk)
  }
  check('   italiano identico a prima ("punti percentuali", frase delle spese)', translate('it', 'andamento.sentence.spent.down') === 'Hai speso meno rispetto al periodo precedente.' && translate('it', 'andamento.change.percentpoints', { points: '-3' }) === '-3 punti percentuali')
  // Categorie: 7 righe → "Mostra tutte (7)" / "Mostra meno".
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    const toggle = () => one(container, 'category-comparison__toggle')
    const all = text(toggle())
    await act(() => propsOf(toggle()).onClick({}))
    const less = text(toggle())
    await act(() => propsOf(toggle()).onClick({}))
    check(`${lang}: "${all}" / "${less}"`, all === translate(lang, 'andamento.categories.showall', { count: cmpBC.categories.length }) && less === translate(lang, 'andamento.categories.showless'))
  }
  // Periodi non consecutivi (A e C): seconda riga "rispetto a {ciclo}".
  const selects = () => nodes(container).filter((n) => n.localName === 'select')
  await act(() => propsOf(selects()[0]).onChange({ target: { value: A.key } }))
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    check(`${lang}: periodi non consecutivi → "${text(one(container, 'cycle-comparison__verdict-ref'))}"`, text(one(container, 'cycle-comparison__verdict-ref')) === translate(lang, 'andamento.verdict.diffother', { cycle: A.label })
      && text(one(container, 'cycle-comparison__verdict-text')) === translate(lang, `andamento.verdict.${cmpAC.spent.diff < 0 ? 'less' : 'more'}`, { amount: formatCurrency(Math.abs(cmpAC.spent.diff)) }))
  }
  // Stesso periodo su entrambi i selettori.
  await act(() => propsOf(selects()[0]).onChange({ target: { value: C.key } }))
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    check(`${lang}: stesso periodo → "${translate(lang, 'andamento.compare.samecycle')}"`, text(one(container, 'cycle-comparison__notice')) === translate(lang, 'andamento.compare.samecycle'))
  }

  // =====================================================================
  section('6. Stati vuoti e frasi particolari')
  // =====================================================================
  const scenario = async (state, view) => {
    await act(() => root.unmount())
    load(state)
    const next = createRoot(container, { onRecoverableError: () => {} })
    await act(() => next.render(h(AndamentoScreen, { onClose: () => {} })))
    if (view === 'compare') await act(() => propsOf(tabs()[1]).onClick({}))
    return next
  }
  // Un solo periodo.
  let r = await scenario({ today: '2026-10-20', cycleStartDay: 7, incomes: [], expenses: [expense('s1', 'bar', 5, '2026-10-12')] }, 'compare')
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    const cur = buildAndamento({ today: '2026-10-20', cycleStartDay: 7, incomes: [], expenses: [expense('s1', 'bar', 5, '2026-10-12')] }).current
    check(`${lang}: un solo periodo → titolo e frase intera con {cycle}`, text(one(container, 'andamento-screen__empty-title')) === translate(lang, 'andamento.single.title')
      && text(one(container, 'andamento-screen__empty-text')) === translate(lang, 'andamento.single.text', { cycle: cur.label }))
  }
  await act(() => propsOf(tabs()[0]).onClick({}))
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    check(`${lang}: primo ciclo con dati → "${translate(lang, 'andamento.trend.first').slice(0, 40)}…"`, text(one(container, 'trend-chart__note')) === translate(lang, 'andamento.trend.first'))
  }
  // Nessuno stipendio in due periodi, spese in entrambi: budget non confrontabile (due periodi), entrate assenti.
  const NOSALARY = { today: '2026-10-20', cycleStartDay: 7, incomes: [], expenses: [expense('n1', 'bar', 30, '2026-09-12'), expense('n2', 'bar', 20, '2026-10-12')] }
  r = await scenario(NOSALARY, 'compare')
  const [N1, N2] = buildAndamento(NOSALARY).cycles
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    await act(() => propsOf(card(3)).onClick({}))
    const unavailable = one(container, 'metric-chart--unavailable')
    const budgetOk = text(one(unavailable, 'metric-chart__summary')) === tr('andamento.chart.budgetna')
      && text(one(unavailable, 'metric-chart__sentence')) === tr('andamento.chart.nosalarytwo', { first: N1.label, second: N2.label })
      && text(byClass(card(3), 'cycle-comparison__change')[0]).includes(tr('andamento.change.notcomparable'))
    await act(() => propsOf(card(1)).onClick({}))
    const notes = byClass(chart(), 'metric-chart__note').map(text).join('|')
    await act(() => propsOf(card(1)).onClick({}))
    check(`${lang}: budget non confrontabile (due periodi, frase intera) e note "nessuna entrata"`, budgetOk && notes === [N1, N2].map((c) => tr('andamento.chart.noincome', { cycle: c.label })).join('|'), notes)
  }
  check('   italiano identico a prima (due periodi)', translate('it', 'andamento.chart.nosalarytwo', { first: 'A', second: 'B' }) === 'Il budget utilizzato si misura sullo stipendio del periodo, e A e B non hanno uno stipendio registrato.')
  // Stipendio solo nel periodo più recente: un periodo senza stipendio.
  const ONESALARY = { ...NOSALARY, incomes: [income('o1', 'stipendio', 2000, '2026-10-07')] }
  r = await scenario(ONESALARY, 'compare')
  const [O1] = buildAndamento(ONESALARY).cycles
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    await act(() => propsOf(card(3)).onClick({}))
    const sentence = text(one(one(container, 'metric-chart--unavailable'), 'metric-chart__sentence'))
    await act(() => propsOf(card(3)).onClick({}))
    check(`${lang}: un periodo senza stipendio → frase al singolare`, sentence === translate(lang, 'andamento.chart.nosalaryone', { cycle: O1.label }), sentence)
  }
  // Solo entrate, nessuna spesa: categorie vuote, riepilogo vuoto, conclusione "uguale".
  const NOEXP = { today: '2026-10-20', cycleStartDay: 7, incomes: [income('x1', 'stipendio', 2000, '2026-09-07'), income('x2', 'stipendio', 2000, '2026-10-07')], expenses: [] }
  r = await scenario(NOEXP, 'compare')
  const [X1] = buildAndamento(NOEXP).cycles
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    check(`${lang}: nessuna spesa → categorie vuote, "${tr('andamento.verdict.flat')}", "${tr('andamento.verdict.same')}" / "${tr('andamento.verdict.sameprevious')}"`, text(one(container, 'category-comparison__empty')) === tr('andamento.categories.empty')
      && text(one(container, 'cycle-comparison__verdict-title')).endsWith(tr('andamento.verdict.flat')) && text(one(container, 'cycle-comparison__verdict-text')) === tr('andamento.verdict.same')
      && text(one(container, 'cycle-comparison__verdict-ref')) === `${tr('andamento.verdict.sameprevious')} (${X1.label})`
      && byClass(container, 'cycle-comparison__change').map(text).some((c) => c.includes(tr('andamento.change.unchanged'))))
  }
  await act(() => propsOf(tabs()[0]).onClick({}))
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    check(`${lang}: riepilogo senza spese → "${translate(lang, 'andamento.noexpenses')}"`, text(one(container, 'cycle-summary__empty')) === translate(lang, 'andamento.noexpenses'))
  }
  check('describeChange / describeDiff: senza lingua l\'italiano di prima, con lingua il testo tradotto', fmt.describeChange({ kind: 'same', diff: 0, percent: 0 }).text === 'Invariato'
    && fmt.describeChange({ kind: 'new', diff: 10, percent: null }).detail === 'Nuova' && fmt.describeChange({ kind: 'gone', diff: -10, percent: null }).detail === 'Azzerata'
    && fmt.describeDiff(0).text === 'Invariato' && fmt.describeDiff(0, { lang: 'fr' }).text === 'Inchangé'
    && fmt.describeChange({ kind: 'new', diff: 10, percent: null }, { lang: 'en' }).detail === 'New')
  await act(() => r.unmount())

  // =====================================================================
  section('7. Analisi (pagina) e dettaglio categoria')
  // =====================================================================
  load(MAIN)
  const page = dom.createContainer()
  const pageRoot = createRoot(page, { onRecoverableError: () => {} })
  await act(() => pageRoot.render(h(AnalyticsPage)))
  const totals = {}
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    const tr = (key) => translate(lang, key)
    const navs = byClass(page, 'analytics-page__period-nav')
    check(`${lang}: link Andamento, frecce, centro della ciambella`, text(one(page, 'analytics-page__trend-title')) === tr('andamento.title') && text(one(page, 'analytics-page__trend-subtitle')) === tr('analytics.trendsubtitle')
      && aria(navs[0]) === tr('analytics.prev') && aria(navs[1]) === tr('analytics.next') && text(one(page, 'donut-chart__center-label')) === tr('analytics.total'))
    totals[lang] = byClass(page, 'analytics-page__legend-amount').map(text).join('|')
  }
  check('importi della legenda identici in ogni lingua', same(Object.values(totals)) && totals.it.includes(formatCurrency(17)))
  // Dettaglio di una categoria con una sola spesa (ristoranti, ciclo in corso).
  const row = byClass(page, 'analytics-page__legend-row--button').find((n) => text(n).includes(formatCurrency(17)))
  await act(() => propsOf(row).onClick({}))
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    check(`${lang}: dettaglio categoria → "${translate(lang, 'andamento.expensesone', { count: 1 })}", Chiudi tradotto`, text(one(page, 'category-detail__meta')).endsWith(translate(lang, 'andamento.expensesone', { count: 1 }))
      && aria(one(page, 'modal-sheet__close')) === translate(lang, 'common.close'))
  }
  await act(() => propsOf(one(page, 'modal-sheet__close')).onClick({}))
  // Periodo vuoto: due cicli indietro non ci sono spese oltre A → torna indietro fino a un ciclo vuoto.
  for (let i = 0; i < 3; i += 1) await act(() => propsOf(byClass(page, 'analytics-page__period-nav')[0]).onClick({}))
  for (const lang of LANGS) {
    await act(() => setLanguage(lang))
    check(`${lang}: periodo senza spese → "${translate(lang, 'analytics.empty')}"`, text(one(page, 'analytics-page__empty')) === translate(lang, 'analytics.empty'))
  }
  await act(() => setLanguage('de'))
  check('lingua non valida → italiano', text(one(page, 'analytics-page__empty')) === 'Nessuna spesa registrata in questo periodo.')
  await act(() => pageRoot.unmount())
} finally {
  await server.close()
}

report('Multilingue — Fase 4B-1 (Analisi, Andamento, Confronta periodi)')
