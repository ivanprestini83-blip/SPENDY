// + → Guadagno → Stipendio: la precompilazione non è un inserimento.
//
// Stesso banco di prova di SyncCard (settings/syncCard.test.mjs): Vite carica
// il VERO QuickAddScreen.jsx; React e lo store sono sostituiti da moduli finti
// che registrano ogni azione chiamata. Il tocco e la conferma eseguono davvero
// gli onClick/onChange dei pulsanti e del campo.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { check, section, report } from '../../sync/testkit.mjs'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCREEN = '/src/components/modals/QuickAddScreen.jsx'

const FAKE_MODULES = {
  react: `
    export const useState = (initial) => globalThis.__qa.useState(initial)
    export const useRef = (initial) => globalThis.__qa.useRef(initial)`,
  '../../store/useAppStore.js': `
    export const useAppStore = (selector) => selector(globalThis.__qa.store)`,
  './QuickAddScreen.css': 'export default {}',
  // La lingua dallo stesso store finto, con il translate vero (dizionari veri).
  '../../i18n/useLanguage.js': `
    import { translate } from '/src/i18n/translate.js'
    export const useLanguage = () => {
      const language = globalThis.__qa.store.language
      return { language, t: (key, params) => translate(language, key, params) }
    }`,
  './AmountLimitHint.css': 'export default {}',
}

const harnessPlugin = {
  name: 'quick-add-harness',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '/__qa-fake/react') return '\0qa-fake:react'
    if (importer && (importer.includes('QuickAddScreen.jsx') || importer.includes('AmountLimitHint.jsx')) && source in FAKE_MODULES) return `\0qa-fake:${source}`
    return null
  },
  load(id) {
    return id.startsWith('\0qa-fake:') ? FAKE_MODULES[id.slice('\0qa-fake:'.length)] : null
  },
  transform(code, id) {
    if (!id.includes('QuickAddScreen.jsx')) return null
    const reactImport = "from 'react'"
    if (!code.includes(reactImport)) throw new Error("QuickAddScreen non importa più da 'react' come previsto: aggiornare questo test")
    return code.replace(reactImport, "from '/__qa-fake/react'")
  },
}

const ACTIONS = ['addExpense', 'addIncome', 'addSalary', 'setMonthlyBudget', 'addCustomCategory', 'deleteCustomCategory', 'togglePinCategory']

function createRuntime(storeState) {
  const slots = []
  let cursor = 0
  const calls = []
  const store = { customCategories: [], ...storeState }
  for (const name of ACTIONS) store[name] = (...args) => calls.push({ name, args })
  return {
    calls,
    store,
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    render(Component, props) {
      cursor = 0
      return Component(props)
    },
  }
}

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit))
  if (node && typeof node === 'object' && node.props) {
    visit(node)
    walk(node.props.children, visit)
  }
  return undefined
}
const textOf = (node) => {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && node.props) return textOf(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
const findAll = (tree, predicate) => {
  const found = []
  walk(tree, (node) => { if (predicate(node)) found.push(node) })
  return found
}
const button = (tree, label) => findAll(tree, (n) => n.type === 'button' && textOf(n).includes(label))[0]
const amountInput = (tree) => findAll(tree, (n) => n.type === 'input' && n.props.type === 'number')[0]

const TODAY = '2026-10-02'
const salaryRow = (date, amount, updatedAt = '2026-09-01T08:00:00.000Z') => ({ id: `i-${date}`, categoryId: 'stipendio', description: 'Stipendio', amount, date, updatedAt })

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-quickadd-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [harnessPlugin, react()],
})

async function openSalary(storeState) {
  const runtime = createRuntime({ today: TODAY, ...storeState })
  globalThis.__qa = runtime
  const props = { type: 'income', onClose: () => runtime.calls.push({ name: 'onClose', args: [] }) }
  const pick = runtime.render(QuickAddScreen, props)
  const tile = button(pick, 'Stipendio')
  tile.props.onClick()
  return { runtime, props, tree: runtime.render(QuickAddScreen, props) }
}

let QuickAddScreen
try {
  ;({ QuickAddScreen } = await server.ssrLoadModule(SCREEN))

  // =====================================================================
  section('1. Precompilazione: solo testo nel campo')
  // =====================================================================
  {
    const { runtime, tree } = await openSalary({ monthlyBudget: 1700, incomes: [salaryRow('2026-08-01', 1650), salaryRow('2026-09-01', 1700)] })
    check('aprendo Stipendio il campo propone l\'ultimo stipendio (1700, quello di settembre)', amountInput(tree)?.props.value === '1700')
    check('   nessuna azione dello store chiamata: niente entrata, niente impostazioni', runtime.calls.length === 0, JSON.stringify(runtime.calls))
    check('   le entrate dello store sono le stesse di prima', runtime.store.incomes.length === 2)
    // Tornare indietro senza confermare: si torna alla griglia, ancora niente.
    findAll(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Torna indietro')[0].props.onClick()
    const grid = runtime.render(QuickAddScreen, { type: 'income', onClose: () => {} })
    check('tornare indietro senza confermare non crea nulla', Boolean(button(grid, 'Stipendio')) && !amountInput(grid) && runtime.calls.length === 0)
  }
  {
    const { runtime, tree } = await openSalary({ monthlyBudget: 1700, incomes: [] })
    check('senza stipendi registrati propone il vecchio stipendio (monthlyBudget), sempre senza inserirlo', amountInput(tree)?.props.value === '1700' && runtime.calls.length === 0)
  }
  {
    const { runtime, tree } = await openSalary({ monthlyBudget: 0, incomes: [] })
    check('primo stipendio in assoluto: campo vuoto', amountInput(tree)?.props.value === '' && runtime.calls.length === 0)
  }

  {
    // "Inserisci un altro importo" della scheda di passaggio: si apre già su Stipendio.
    const runtime = createRuntime({ today: TODAY, monthlyBudget: 1700, incomes: [] })
    globalThis.__qa = runtime
    const props = { type: 'income', initialCategoryId: 'stipendio', onClose: () => {} }
    const tree = runtime.render(QuickAddScreen, props)
    check('aperta con initialCategoryId "stipendio": subito sull\'importo, con 1700 proposto', amountInput(tree)?.props.value === '1700' && !button(tree, 'Extra'))
    check('   ancora nessuna azione chiamata', runtime.calls.length === 0)
    amountInput(tree).props.onChange({ target: { value: '1480' } })
    button(runtime.render(QuickAddScreen, props), 'Conferma').props.onClick()
    check('   l\'importo scelto passa da addSalary, una volta', runtime.calls.length === 1 && runtime.calls[0].name === 'addSalary' && runtime.calls[0].args[0].amount === 1480)
  }

  // =====================================================================
  section('2. Conferma: un solo stipendio, datato, con addSalary')
  // =====================================================================
  {
    const { runtime, props, tree } = await openSalary({ monthlyBudget: 1700, incomes: [salaryRow('2026-09-01', 1700)] })
    amountInput(tree).props.onChange({ target: { value: '1550' } })
    const edited = runtime.render(QuickAddScreen, props)
    button(edited, 'Conferma').props.onClick()
    const salaries = runtime.calls.filter((c) => c.name === 'addSalary')
    check('premendo Conferma: addSalary una volta', salaries.length === 1, JSON.stringify(runtime.calls))
    check('   con l\'importo scritto, la data di oggi e la descrizione', salaries[0]?.args[0].amount === 1550 && salaries[0]?.args[0].date === TODAY && salaries[0]?.args[0].description === 'Stipendio')
    check('   e nient\'altro: né addIncome né setMonthlyBudget', !runtime.calls.some((c) => c.name === 'addIncome' || c.name === 'setMonthlyBudget'))
  }
  {
    const { runtime, tree } = await openSalary({ monthlyBudget: 1700, incomes: [salaryRow('2026-09-01', 1700)] })
    button(tree, 'Conferma').props.onClick()
    check('confermare l\'importo proposto lo inserisce (solo ora): addSalary 1700', runtime.calls.filter((c) => c.name === 'addSalary').length === 1 && runtime.calls[0].args[0].amount === 1700)
  }
  {
    const runtime = createRuntime({ today: TODAY, monthlyBudget: 1700, incomes: [] })
    globalThis.__qa = runtime
    const props = { type: 'income', onClose: () => {} }
    button(runtime.render(QuickAddScreen, props), 'Extra').props.onClick()
    const tree = runtime.render(QuickAddScreen, props)
    check('un\'entrata Extra non viene precompilata con lo stipendio', amountInput(tree)?.props.value === '')
    amountInput(tree).props.onChange({ target: { value: '80' } })
    button(runtime.render(QuickAddScreen, props), 'Conferma').props.onClick()
    check('   e passa da addIncome come prima, non da addSalary', runtime.calls.length === 1 && runtime.calls[0].name === 'addIncome' && runtime.calls[0].args[0].categoryId === 'extra')
  }
} finally {
  await server.close()
}

report('Stipendio: precompilazione e conferma')
