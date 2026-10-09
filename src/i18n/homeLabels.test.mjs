// Home multilingua: le etichette dei periodi del ciclo e il testo alternativo
// dell'immagine di Spendy, nelle quattro lingue. `npm test`, senza rete.
//
// Componenti VERI (CycleStartCard, SpendyHero, SpendyCharacter) sullo store
// vero e un DOM minimo. Si controlla che:
//   - i periodi usino i mesi della lingua scelta (cicli di calendario e
//     personalizzati), con gli stessi confini in ogni lingua;
//   - l'italiano resti identico a prima;
//   - il testo alternativo descriva Spendy nella lingua scelta, mai con il
//     nome interno (inglese) dello stato;
//   - cambiare lingua non tocchi nessun dato.

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
  cacheDir: join(tmpdir(), 'spendy-home-labels-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})

const LANGS = ['it', 'en', 'es', 'fr']
const STATES = ['happy', 'attentive', 'concerned', 'ironic', 'advisor', 'celebrating']
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
const text = (node) => (typeof node?.data === 'string' ? node.data : (node?.childNodes ?? []).map(text).join(''))
const imgAlt = (container) => nodes(container).find((n) => n.localName === 'img')?.attributes?.get?.('alt')

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { CycleStartCard } = await server.ssrLoadModule('/src/components/budget/CycleStartCard.jsx')
  const { SpendyHero } = await server.ssrLoadModule('/src/components/spendy/SpendyHero.jsx')
  const { SpendyCharacter } = await server.ssrLoadModule('/src/components/spendy/SpendyCharacter.jsx')
  const { formatCycleLabel, getCycleRange, getPreviousCycleRange } = await server.ssrLoadModule('/src/utils/cycle.js')
  const { cycleLabelNames } = await server.ssrLoadModule('/src/i18n/cycleLabelNames.js')
  const { translate } = await server.ssrLoadModule('/src/i18n/translate.js')
  const S = useAppStore.getState
  const container = dom.createContainer()
  const caught = []
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const act = async (fn) => { flushSync(fn); for (let i = 0; i < 4; i += 1) await tick() }
  const DATA = ['monthlyBudget', 'cycleStartDay', 'expenses', 'incomes', 'goals', 'emergencyFundSaved', 'legacySalaryHistoryDone', 'confirmedCycleStart', 'sync']
  const dataOf = () => JSON.stringify(Object.fromEntries(DATA.map((field) => [field, S()[field]])))

  // Ospite con uno stipendio salvato e spese ad agosto, senza stipendio di
  // agosto né di ottobre: compaiono sia la domanda sullo stipendio dei cicli
  // del vecchio modello (agosto) sia quella sul nuovo ciclo (ottobre).
  const scenario = (cycleStartDay) => useAppStore.setState({
    today: '2026-10-20',
    cycleStartDay,
    monthlyBudget: 1800,
    legacySalaryHistoryDone: false,
    confirmedCycleStart: null,
    incomes: [],
    expenses: [{ id: 'e-ago', amount: 30, categoryId: 'bar', description: '', date: '2026-08-15', updatedAt: '2026-08-15T10:00:00.000Z' }],
  })

  // =====================================================================
  section('Cicli di calendario: "Ottobre 2026" / "October 2026" / "octubre de 2026" / "octobre 2026"')
  // =====================================================================
  {
    scenario(null)
    await act(() => root.render(h(CycleStartCard)))
    const before = dataOf()
    const EXPECTED = {
      it: { legacy: 'Agosto 2026', current: 'Ottobre 2026', previous: 'Settembre 2026' },
      en: { legacy: 'August 2026', current: 'October 2026', previous: 'September 2026' },
      es: { legacy: 'agosto de 2026', current: 'octubre de 2026', previous: 'septiembre de 2026' },
      fr: { legacy: 'août 2026', current: 'octobre 2026', previous: 'septembre 2026' },
    }
    for (const lang of LANGS) {
      await act(() => S().setLanguage(lang))
      const shown = text(container)
      const e = EXPECTED[lang]
      check(`${lang}: stipendio dei cicli precedenti → "${translate(lang, 'budget.cycle.legacy.field', { cycle: e.legacy })}"`,
        shown.includes(translate(lang, 'budget.cycle.legacy.field', { cycle: e.legacy })) && shown.includes(translate(lang, 'budget.cycle.legacy.explainone', { cycles: e.legacy })))
      check(`   ${lang}: nuovo ciclo → "${e.current}", precedente "${e.previous}"`,
        shown.includes(translate(lang, 'budget.cycle.fresh.current', { cycle: e.current })) && shown.includes(e.previous))
    }
    const october = getCycleRange('2026-10-20', 1)
    check('italiano identico a prima (stessa etichetta di formatCycleLabel senza nomi)', formatCycleLabel(october, 1, cycleLabelNames('it')) === formatCycleLabel(october, 1) && formatCycleLabel(october, 1) === 'Ottobre 2026')
    check('nessun dato toccato cambiando lingua', dataOf() === before)
  }

  // =====================================================================
  section('Cicli personalizzati (giorno 27): stessi confini, mesi tradotti')
  // =====================================================================
  {
    scenario(27)
    await act(() => S().setLanguage('it'))
    const current = getCycleRange('2026-10-20', 27)
    const previous = getPreviousCycleRange(current, 27)
    const EXPECTED = {
      it: ['27 Set – 26 Ott', '27 Ago – 26 Set'],
      en: ['27 Sep – 26 Oct', '27 Aug – 26 Sep'],
      es: ['27 sept – 26 oct', '27 ago – 26 sept'],
      fr: ['27 sept. – 26 oct.', '27 août – 26 sept.'],
    }
    for (const lang of LANGS) {
      await act(() => S().setLanguage(lang))
      const [cur, prev] = EXPECTED[lang]
      const shown = text(container)
      check(`${lang}: ciclo in corso "${cur}", precedente "${prev}"`, formatCycleLabel(current, 27, cycleLabelNames(lang)) === cur && formatCycleLabel(previous, 27, cycleLabelNames(lang)) === prev
        && shown.includes(translate(lang, 'budget.cycle.fresh.current', { cycle: cur })) && shown.includes(prev))
    }
    check('italiano identico a prima', formatCycleLabel(current, 27) === '27 Set – 26 Ott')
    await act(() => root.render(null))
  }

  // =====================================================================
  section('Testo alternativo di Spendy (SpendyHero e SpendyCharacter)')
  // =====================================================================
  for (const [name, render] of [['SpendyHero', (state) => h(SpendyHero, { state, message: 'Ciao' })], ['SpendyCharacter', (state) => h(SpendyCharacter, { state })]]) {
    for (const lang of LANGS) {
      await act(() => S().setLanguage(lang))
      const alts = []
      for (const state of STATES) {
        await act(() => root.render(render(state)))
        alts.push([state, imgAlt(container)])
      }
      check(`${name} ${lang}: un testo per ogni stato, nella lingua scelta`, alts.every(([state, alt]) => alt === translate(lang, `mascot.alt.${state}`, { name: 'Spendy' })), alts.map(([, alt]) => alt).join(' | '))
      check(`   ${lang}: mai il nome interno dello stato ("Spendy: advisor")`, alts.every(([state, alt]) => !alt.includes(`: ${state}`)) && new Set(alts.map(([, alt]) => alt)).size === STATES.length)
      await act(() => root.render(render('sconosciuto')))
      check(`   ${lang}: stato sconosciuto → testo di "happy" (come l'immagine)`, imgAlt(container) === translate(lang, 'mascot.alt.happy', { name: 'Spendy' }))
    }
  }
  check('italiano: "Spendy che dà un consiglio", inglese: "Spendy giving a tip"', translate('it', 'mascot.alt.advisor', { name: 'Spendy' }) === 'Spendy che dà un consiglio' && translate('en', 'mascot.alt.advisor', { name: 'Spendy' }) === 'Spendy giving a tip')
  check('nessun errore di rendering', caught.length === 0, caught[0]?.message)
  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Home multilingua: periodi e testo alternativo di Spendy')
