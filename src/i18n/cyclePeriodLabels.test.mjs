// Il periodo del ciclo ("7 oct. – 6 nov.") nella lingua scelta, su ogni
// schermata che lo mostra: Home (BudgetCard), Spese e Analisi. `npm test`,
// senza rete.
//
// Monta l'App VERA sullo store vero e un DOM minimo, con un ciclo che parte
// il 7 e oggi = 18 ottobre 2026 (ciclo 7 ott – 6 nov). Si controlla che:
//   - ogni schermata usi i mesi della lingua scelta (it, en, es, fr);
//   - il cambio di lingua valga subito, senza rimontare l'App;
//   - le date del ciclo (getCycleRange) e i dati restino identici.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'

const dom = installFakeDom(new Map())
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true, writable: true })
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const server = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-cycle-period-labels-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})

const TODAY = '2026-10-18'
const START_DAY = 7
const EXPECTED = {
  it: '7 Ott – 6 Nov',
  fr: '7 oct. – 6 nov.',
  en: '7 Oct – 6 Nov',
  es: '7 oct – 6 nov',
}
// L'ordine dei cambi: ogni lingua arriva da un'altra, senza reload.
const ORDER = ['it', 'fr', 'en', 'es', 'fr', 'it']
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const DATA_FIELDS = ['monthlyBudget', 'cycleStartDay', 'expenses', 'incomes', 'goals', 'emergencyFundSaved', 'confirmedCycleStart', 'legacySalaryHistoryDone']
const dataOf = (state) => JSON.stringify(Object.fromEntries(DATA_FIELDS.map((field) => [field, state[field]])))
const decode = (s) => s?.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").trim()

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { getCycleRange } = await server.ssrLoadModule('/src/utils/cycle.js')
  const S = useAppStore.getState
  const container = dom.createContainer()
  const caught = []
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const act = async (fn) => { flushSync(fn); for (let i = 0; i < 6; i += 1) await tick() }
  const html = () => dom.toHtml(container)

  S().switchScope('u:utente-periodo-ciclo')
  await act(() => root.render(h(App)))
  await act(() => {
    S().setCycleStartDay(START_DAY)
    useAppStore.setState({ today: TODAY })
    S().addSalary({ amount: 2000, date: '2026-10-07' })
    S().addExpense({ amount: 12.5, categoryId: 'bar', description: 'caffè', date: TODAY })
  })
  await act(() => useAppStore.setState({ today: TODAY }))

  const rangeBefore = JSON.stringify(getCycleRange(S().today, S().cycleStartDay))
  const dataBefore = dataOf(S())

  const SCREENS = [
    ['home', 'Home (BudgetCard)', /class="budget-card__period">([^<]+)<\/p>/],
    ['expenses', 'Spese', /class="expenses-page__cycle-label">([^<]+)<\/p>/],
    ['analytics', 'Analisi', /class="analytics-page__heading">([^<]+)<\/p>/],
  ]

  section('1. Il periodo del ciclo nella lingua scelta, cambiando lingua senza reload')
  check('l\'app si monta senza errori, oggi è il 18 ottobre con ciclo dal 7', caught.length === 0 && S().today === TODAY && S().cycleStartDay === START_DAY, caught[0]?.message)
  for (const lang of ORDER) {
    await act(() => S().setLanguage(lang))
    for (const [tab, name, pattern] of SCREENS) {
      await act(() => S().setActiveTab(tab))
      const shown = decode(html().match(pattern)?.[1])
      check(`${lang} · ${name}: "${shown}"`, shown === EXPECTED[lang], `atteso "${EXPECTED[lang]}"`)
    }
  }
  check('nessun errore durante i cambi di lingua', caught.length === 0, caught[0]?.message)

  section('2. Cambiare lingua non tocca date e dati')
  check('stesso ciclo in ogni lingua (getCycleRange)', JSON.stringify(getCycleRange(S().today, S().cycleStartDay)) === rangeBefore, rangeBefore)
  check('   il ciclo è 7 ottobre → 7 novembre (fine esclusa)', rangeBefore === JSON.stringify({ start: '2026-10-07', end: '2026-11-07' }), rangeBefore)
  check('spese, entrate, stipendi, budget e obiettivi invariati', dataOf(S()) === dataBefore)

  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Periodo del ciclo nelle quattro lingue')
