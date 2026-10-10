// Impostazioni → Stipendio di questo ciclo: la cifra segue la lingua SUBITO,
// anche cambiandola con le Impostazioni già aperte. `npm test`, senza rete.
//
// Prima la card leggeva la lingua solo dentro formatCurrency (registro non
// reattivo, i18n/currentLanguage.js): cambiando lingua nessuno la faceva
// ridisegnare e restava "1.794,00 €" in inglese finché non si riapriva.
//
// Componente VERO (CurrentSalaryCard) sullo store vero e un DOM minimo: si
// monta UNA volta e si cambia solo la lingua dello store, come fa la card
// "Lingua" accanto. Cambiare lingua non tocca nessun dato.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../../sync/testkit.mjs'
import { installFakeDom } from '../../store/fakeDom.mjs'

const dom = installFakeDom(new Map())
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true, writable: true })
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const server = await createServer({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-current-salary-language-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
const text = (node) => (typeof node?.data === 'string' ? node.data : (node?.childNodes ?? []).map(text).join(''))
const byClass = (container, name) => nodes(container).filter((n) => (n.attributes?.get?.('class') ?? '').split(' ').includes(name))

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { CurrentSalaryCard } = await server.ssrLoadModule('/src/components/settings/CurrentSalaryCard.jsx')
  const { formatCurrency } = await server.ssrLoadModule('/src/utils/format.js')
  const S = useAppStore.getState
  const container = dom.createContainer()
  const caught = []
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const act = async (fn) => { flushSync(fn); for (let i = 0; i < 4; i += 1) await tick() }
  const DATA = ['monthlyBudget', 'cycleStartDay', 'expenses', 'incomes', 'goals', 'emergencyFundSaved', 'sync']
  const dataOf = () => JSON.stringify(Object.fromEntries(DATA.map((field) => [field, S()[field]])))

  useAppStore.setState({
    today: '2026-10-20',
    cycleStartDay: 1,
    monthlyBudget: 1794,
    incomes: [{ id: 'stip-ott', amount: 1794, categoryId: 'stipendio', description: 'Stipendio', date: '2026-10-01', updatedAt: '2026-10-01T10:00:00.000Z' }],
  })
  await act(() => S().setLanguage('it'))
  await act(() => root.render(h(CurrentSalaryCard)))
  const before = dataOf()
  const amountNode = () => byClass(container, 'settings-screen__salary-amount')[0]
  const first = amountNode()

  // =====================================================================
  section('Cambio lingua con la card già aperta: la cifra si aggiorna subito')
  // =====================================================================
  const EXPECTED = { it: '1.794,00 €', en: '€1,794.00', es: '1.794,00 €', fr: '1\u00a0794,00 €' }
  check('italiano all\'apertura: "1.794,00 €"', text(amountNode()) === EXPECTED.it, text(amountNode()))
  for (const lang of ['en', 'es', 'fr', 'it']) {
    await act(() => S().setLanguage(lang))
    check(`${lang}: "${EXPECTED[lang]}" senza riaprire la card`, text(amountNode()) === EXPECTED[lang] && text(amountNode()) === formatCurrency(1794, lang), JSON.stringify(text(amountNode())))
  }
  check('stessa card (non smontata e rimontata): si è solo ridisegnata', amountNode() === first)
  check('nessun dato toccato cambiando lingua (stipendio 1794 com\'era)', dataOf() === before && S().incomes[0].amount === 1794)
  check('nessun errore di rendering', caught.length === 0, caught[0]?.message)
  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Stipendio in Impostazioni: la cifra segue la lingua')
