// Fase 3 del multilingue: la pagina Spese (con la modifica / eliminazione di
// una spesa che si apre da lì) in it / en / es / fr. `npm test`, senza rete.
//
// Monta l'App VERA (Vite, CSS escluso) sullo store vero e un DOM minimo
// (fakeDom.mjs), cambia lingua SENZA rimontare e guarda il testo che l'utente
// vedrebbe. Restano come sono (fasi successive): nomi delle categorie create dall'utente,
// descrizioni, importi, date e nomi dei mesi.

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
import { AMOUNT_LIMIT_MESSAGE } from '../utils/amounts.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const keysOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))
const lookup = (dictionary, key) => key.split('.').reduce((node, part) => node?.[part], dictionary)
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()

// Le chiavi della pagina Spese: le sue, più quelle che riusa dalla Home.
const PAGE_KEYS = keysOf(MESSAGES.it).filter((key) => /^expenses\.(page|edit|limit)/.test(key))
const SCREEN_KEYS = [...PAGE_KEYS, 'expenses.summary.today', 'expenses.summary.cycle', 'expenses.summary.of']
const COMPONENTS = ['src/pages/ExpensesPage.jsx', 'src/components/modals/EditExpenseModal.jsx', 'src/components/AmountLimitHint/AmountLimitHint.jsx']
const code = (path) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// =====================================================================
section('1. Dizionari: nessuna chiave mancante')
// =====================================================================
check(`chiavi nuove della pagina Spese: ${PAGE_KEYS.length}`, PAGE_KEYS.length === 18, PAGE_KEYS.join())
for (const lang of ['it', 'en', 'es', 'fr']) {
  const missing = SCREEN_KEYS.filter((key) => typeof lookup(MESSAGES[lang], key) !== 'string' || !lookup(MESSAGES[lang], key).trim())
  check(`${lang}: tutte presenti e non vuote`, missing.length === 0, missing.join(', '))
}
{
  const mismatched = SCREEN_KEYS.filter((key) => ['en', 'es', 'fr'].some((lang) => placeholders(lookup(MESSAGES[lang], key)) !== placeholders(lookup(MESSAGES.it, key))))
  check('stessi parametri in ogni lingua', mismatched.length === 0, mismatched.join(', '))
}
{
  const used = new Set(COMPONENTS.flatMap((path) => [...code(path).matchAll(/'(expenses\.[a-z.]+)'/g)].map((m) => m[1])))
  const unknown = [...used].filter((key) => typeof lookup(MESSAGES.it, key) !== 'string')
  check(`ogni chiave usata dai componenti esiste (${used.size} usate)`, unknown.length === 0, unknown.join(', '))
  const orphans = PAGE_KEYS.filter((key) => !used.has(key))
  check('ogni chiave nuova è usata', orphans.length === 0, orphans.join(', '))
}
check('l\'avviso sul limite in italiano è identico ad AMOUNT_LIMIT_MESSAGE', translate('it', 'expenses.limit') === AMOUNT_LIMIT_MESSAGE)
check('parametro {cycle}', translate('en', 'expenses.page.pastcycle', { cycle: '7 Set – 6 Ott' }) === 'Spending for the 7 Set – 6 Ott cycle' && translate('fr', 'expenses.page.pastcycle', { cycle: 'X' }) === 'Dépenses du cycle X')

// =====================================================================
section('2. Nessun testo statico rimasto')
// =====================================================================
{
  // `€` accanto al campo importo è il simbolo della valuta: resta com'è.
  const ALLOWED_TEXT = new Set(['€', '←', '→', '✕'])
  for (const path of COMPONENTS) {
    const source = code(path)
    const jsxText = [...source.matchAll(/>([^<>{}]*)</g)].map((m) => m[1].trim()).filter((text) => /[A-Za-zÀ-ÿ]/.test(text) && !ALLOWED_TEXT.has(text) && !/[=;()]/.test(text) && !/^[\w.]+\.[\w.]+$/.test(text))
    const attrs = [...source.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map((m) => m[1])
    const quoted = [...source.matchAll(/'([A-ZÀ-Ý][a-zà-ÿ]+(?: [a-zà-ÿ]+)+[.!?]?)'/g)].map((m) => m[1])
    check(`${path.split('/').pop()}: nessun testo fisso`, jsxText.length === 0 && attrs.length === 0 && quoted.length === 0, [...jsxText, ...attrs, ...quoted].join(' | '))
  }
  const fragments = SCREEN_KEYS.flatMap((key) => lookup(MESSAGES.it, key).split(/\{\w+\}/).map((part) => part.trim())).filter((part) => part.length >= 6)
  const leftovers = COMPONENTS.flatMap((path) => fragments.filter((part) => code(path).includes(`'${part}`) || code(path).includes(`>${part}`) || code(path).includes(` ${part}\n`)).map((part) => `${path.split('/').pop()}: "${part}"`))
  check('nessuna frase dei dizionari scritta a mano nei componenti', leftovers.length === 0, leftovers.join(' | '))
  check('expensesForPeriod, todayWatcher e cycle.js non usano l\'i18n (logica invariata)', ['src/utils/budgetCalculations.js', 'src/store/todayWatcher.js', 'src/utils/cycle.js'].every((path) => !read(path).includes('i18n')))
}

// =====================================================================
section('3. La pagina Spese vera in it → en → es → fr → it, senza reload')
// =====================================================================
const dom = installFakeDom(new Map())
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-i18n-expenses-test-vite'),
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
const text = (node) => (typeof node.data === 'string' ? node.data : (node.childNodes ?? []).map(text).join(''))
const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
const cls = (node) => node.attributes?.get?.('class') ?? ''

const DATA_FIELDS = ['monthlyBudget', 'cycleStartDay', 'amountHidden', 'expenses', 'incomes', 'customCategories', 'goals', 'emergencyFundSaved', 'confirmedCycleStart', 'sync']
const dataOf = (state) => JSON.stringify(Object.fromEntries(DATA_FIELDS.map((field) => [field, state[field]])))
const pad = (n) => String(n).padStart(2, '0')
const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { expensesForPeriod } = await server.ssrLoadModule('/src/utils/budgetCalculations.js')
  const LIVE = (await server.ssrLoadModule('/src/i18n/translate.js')).MESSAGES
  const S = useAppStore.getState
  const caught = []
  const container = dom.createContainer()
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const html = () => dom.toHtml(container)
  const page = () => nodes(container).find((n) => cls(n) === 'expenses-page')
  const button = (label) => nodes(container).find((n) => n.localName === 'button' && (text(n).trim() === label || n.attributes?.get?.('aria-label') === label))
  const items = () => nodes(container).filter((n) => cls(n) === 'expenses-page__item-desc').map(text).sort().join()
  const summary = () => text(nodes(container).find((n) => cls(n) === 'expenses-page__summary'))

  S().switchScope('u:utente-spese-i18n')
  await act(() => root.render(h(App)))
  const today = S().today
  const [y, m, d] = today.split('-').map(Number)
  const day = Math.min(d, 28)
  const prevStart = ymd(new Date(y, m - 2, day))
  const curStart = ymd(new Date(y, m - 1, day))
  await act(() => {
    S().addSalary({ amount: 2451, date: curStart })
    S().addSalary({ amount: 2537, date: prevStart })
    S().addExpense({ amount: 12.5, categoryId: 'bar', description: 'oggi-caffè', date: today })
    S().addExpense({ amount: 48.9, categoryId: 'spesa', description: 'oggi-spesa', date: today })
    S().addExpense({ amount: 30, categoryId: 'carburante', description: 'inizio-ciclo', date: curStart })
    S().addExpense({ amount: 134, categoryId: 'casa', description: 'ciclo-prima', date: prevStart })
  })
  const dataBefore = dataOf(S())
  const expected = {
    today: expensesForPeriod(S().expenses, { view: 'today', today }),
    cycle: expensesForPeriod(S().expenses, { view: 'cycle', today, cycleStartDay: S().cycleStartDay }),
    prev: expensesForPeriod(S().expenses, { view: 'cycle', today, cycleStartDay: S().cycleStartDay, cycleOffset: 1 }),
  }
  const descs = (period) => period.items.map((e) => e.description).sort().join()
  const totals = {}
  const shown = []

  for (const lang of ['it', 'en', 'es', 'fr', 'it']) {
    await act(() => S().setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    // Oggi (dal riquadro della Home: si torna sulla Home e si tocca "Spese di oggi").
    await act(() => S().setActiveTab('home'))
    await act(() => S().openExpenses('today'))
    check(`${lang}: Oggi — titolo, schede, link e pulsante nella lingua scelta`, S().language === lang && summary().startsWith(tr('expenses.summary.today'))
      && Boolean(button(tr('expenses.page.today'))) && Boolean(button(tr('expenses.page.cycle')))
      && html().includes(`aria-label="${tr('expenses.page.periods')}"`) && text(page()).includes(tr('expenses.page.incomes')) && Boolean(button(tr('expenses.page.add'))))
    check(`   ${lang}: Oggi mostra le stesse spese (${descs(expected.today)})`, items() === descs(expected.today) && button(tr('expenses.page.today')).attributes.get('aria-selected') === 'true')
    // Ciclo in corso.
    await act(() => propsOf(button(tr('expenses.page.cycle'))).onClick({}))
    check(`   ${lang}: Ciclo — "${tr('expenses.summary.cycle')}", "${tr('expenses.summary.of', { amount: '2451,00 €' })}"`, summary().startsWith(tr('expenses.summary.cycle')) && summary().includes(tr('expenses.summary.of', { amount: '2451,00 €' })) && items() === descs(expected.cycle))
    check(`   ${lang}: frecce con aria-label tradotte, "successivo" spento sul ciclo in corso`, Boolean(button(tr('expenses.page.prev'))) && button(tr('expenses.page.next')).attributes.has('disabled'))
    // Ciclo precedente.
    await act(() => propsOf(button(tr('expenses.page.prev'))).onClick({}))
    const cycleLabel = text(nodes(container).find((n) => cls(n) === 'expenses-page__cycle-label'))
    check(`   ${lang}: ← "${tr('expenses.page.pastcycle', { cycle: cycleLabel })}" con le sue spese`, summary().startsWith(tr('expenses.page.pastcycle', { cycle: cycleLabel })) && items() === descs(expected.prev) && button(tr('expenses.page.prev')).attributes.has('disabled'))
    totals[lang] = summary().match(/-?[\d.]+,\d{2} €/)?.[0]
    await act(() => propsOf(button(tr('expenses.page.next'))).onClick({}))
    check(`   ${lang}: → di nuovo il ciclo in corso`, items() === descs(expected.cycle) && button(tr('expenses.page.next')).attributes.has('disabled'))
    if (lang !== 'it') {
      const italian = SCREEN_KEYS.flatMap((key) => {
        const own = lookup(MESSAGES[lang], key)
        return lookup(MESSAGES.it, key).split(/\{\w+\}/).map((part) => part.trim()).filter((part) => part.length >= 4 && !own.includes(part))
      })
      const left = [...new Set(italian.filter((part) => text(page()).includes(part) || html().includes(`"${part}"`)))]
      check(`   ${lang}: nessun testo italiano rimasto nella pagina`, left.length === 0, left.join(' | '))
    }
    check(`   ${lang}: nessun segnaposto {…} non sostituito`, !/\{\w+\}/.test(html()))
    // Fase 4A: il nome di una categoria PREDEFINITA segue la lingua (nei dati c'è solo l'id).
    check(`   ${lang}: importi e descrizioni restano quelli dei dati, la categoria predefinita è "${tr('categories.carburante')}"`, text(page()).includes('30,00 €') && text(page()).includes('inizio-ciclo') && text(page()).includes(tr('categories.carburante')))
    shown.push(html())
  }
  check('totale del ciclo precedente identico in ogni lingua', new Set(Object.values(totals)).size === 1 && totals.it === '134,00 €', JSON.stringify(totals))
  check('it → … → it: la pagina torna identica', shown[0] === shown[4])
  check('nessun dato toccato da tutti i cambi di lingua e dalla navigazione', dataOf(S()) === dataBefore)

  // =====================================================================
  section('4. Modifica / eliminazione di una spesa, nella lingua scelta')
  // =====================================================================
  for (const lang of ['en', 'es', 'fr', 'it']) {
    await act(() => S().setLanguage(lang))
    const tr = (key) => translate(lang, key)
    const row = nodes(container).find((n) => cls(n) === 'expenses-page__item' && text(n).includes('inizio-ciclo'))
    await act(() => propsOf(row).onClick({}))
    const modal = () => nodes(container).find((n) => cls(n) === 'edit-expense')
    check(`${lang}: "${tr('expenses.edit.title')}", campi e pulsanti tradotti`, Boolean(modal()) && text(modal()).includes(tr('expenses.edit.title')) && text(modal()).includes(tr('expenses.edit.amount')) && text(modal()).includes(tr('expenses.edit.date'))
      && Boolean(button(tr('expenses.edit.save'))) && Boolean(button(tr('expenses.edit.delete'))) && Boolean(button(tr('expenses.edit.close'))))
    await act(() => propsOf(button(tr('expenses.edit.delete'))).onClick({}))
    check(`   ${lang}: primo tocco su elimina → "${tr('expenses.edit.confirm')}", niente cancellato`, Boolean(button(tr('expenses.edit.confirm'))) && dataOf(S()) === dataBefore)
    const input = nodes(modal()).find((n) => n.localName === 'input') // il primo campo: l'importo
    await act(() => propsOf(input).onChange({ target: { value: '2000000' } }))
    check(`   ${lang}: importo oltre il limite → "${tr('expenses.limit')}", Salva spento`, text(modal()).includes(tr('expenses.limit')) && button(tr('expenses.edit.save')).attributes.has('disabled'))
    await act(() => propsOf(button(tr('expenses.edit.close'))).onClick({}))
    check(`   ${lang}: chiusa senza salvare: nessun dato toccato`, !modal() && dataOf(S()) === dataBefore)
  }

  // =====================================================================
  section('5. Fallback e stati vuoti')
  // =====================================================================
  {
    const saved = LIVE.en.expenses.page.add
    delete LIVE.en.expenses.page.add
    await act(() => S().setLanguage('en'))
    check('chiave tolta dall\'inglese → "+ Aggiungi spesa", il resto in inglese', Boolean(button('+ Aggiungi spesa')) && Boolean(button('Previous cycle')))
    LIVE.en.expenses.page.add = saved
    await act(() => S().setLanguage('it'))
    await act(() => S().setLanguage('en'))
    check('   rimessa → "+ Add expense"', Boolean(button('+ Add expense')))
    await act(() => S().setLanguage('de'))
    check('lingua non valida → tutta la pagina in italiano', S().language === 'it' && Boolean(button('+ Aggiungi spesa')) && Boolean(button('Ciclo precedente')))
  }
  await act(() => S().switchScope('u:utente-spese-vuoto'))
  for (const lang of ['it', 'en', 'es', 'fr']) {
    await act(() => S().setLanguage(lang))
    await act(() => S().setActiveTab('home'))
    await act(() => S().openExpenses('today'))
    const emptyToday = text(page()).includes(translate(lang, 'expenses.page.emptytoday'))
    await act(() => propsOf(button(translate(lang, 'expenses.page.cycle'))).onClick({}))
    check(`${lang}: stati vuoti "${translate(lang, 'expenses.page.emptytoday')}" / "${translate(lang, 'expenses.page.emptycycle')}"`, emptyToday && text(page()).includes(translate(lang, 'expenses.page.emptycycle')))
  }
  check('nessun errore di rendering in tutto il percorso', caught.length === 0, caught[0]?.message)
  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Multilingue — Fase 3 (Spese)')
