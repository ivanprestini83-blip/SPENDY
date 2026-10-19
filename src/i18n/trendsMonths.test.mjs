// Andamento ("Trends") e Analisi: i mesi nella lingua scelta, anche a cavallo
// d'anno (ottobre → gennaio). `npm test`, senza rete.
//
// L'App VERA su un DOM minimo, montata una volta: dati in quattro cicli
// (ottobre, novembre, dicembre, gennaio), poi la lingua cambia SENZA
// rimontare e si leggono le etichette a schermo — barre del grafico, periodo
// in corso, selettori dei cicli, confronto tra periodi. Si controlla che:
//   - ogni mese abbreviato sia quello della lingua (Ott / Oct / oct. / oct);
//   - nessuna abbreviazione o nome di mese italiano resti nelle altre lingue;
//   - nessuna chiave di traduzione grezza ("andamento.title") compaia;
//   - con un ciclo personalizzato (dal 7) le date seguano la stessa regola;
//   - cambiare lingua non tocchi né i cicli né i dati.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'

const dom = installFakeDom(new Map())
// Il DOM minimo non conosce <select> (i selettori dei cicli): il minimo che
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
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-trends-months-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const act = async (fn) => { flushSync(fn); for (let i = 0; i < 8; i += 1) await tick() }
const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
const text = (node) => (typeof node?.data === 'string' ? node.data : (node?.childNodes ?? []).map(text).join(''))
const attr = (node, name) => node.attributes?.get?.(name)

const LANGS = ['it', 'en', 'fr', 'es']
// I mesi attesi, presi a mano (non dai dizionari): ottobre, novembre, dicembre, gennaio.
const SHORT = {
  it: ['Ott', 'Nov', 'Dic', 'Gen'],
  en: ['Oct', 'Nov', 'Dec', 'Jan'],
  fr: ['oct.', 'nov.', 'déc.', 'janv.'],
  es: ['oct', 'nov', 'dic', 'ene'],
}
const LONG_JANUARY = { it: 'Gennaio 2027', en: 'January 2027', fr: 'janvier 2027', es: 'enero de 2027' }
const CUSTOM_CURRENT = { it: '7 Gen – 6 Feb', en: '7 Jan – 6 Feb', fr: '7 janv. – 6 févr.', es: '7 ene – 6 feb' }
// Mesi italiani che non esistono identici nelle altre lingue (parole intere).
const ITALIAN_MONTHS = ['Gen', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Dic', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
// "Set" è anche il verbo inglese ("Set your monthly income"): in inglese non dice nulla.
const italianMonthsFor = (lang) => ITALIAN_MONTHS.filter((month) => !(lang === 'en' && month === 'Set'))
const wordIn = (shown, word) => new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u').test(shown)
// Una chiave grezza a schermo: due o più parole minuscole separate da punti ("andamento.chart.title").
const RAW_KEY = /(^|[^\p{L}.])(andamento|analytics|settings|common|months|expenses|budget|home|radar|goals|notificationcenter|crash)\.[a-z]+(\.[a-z]+)*/u
const DATA_FIELDS = ['monthlyBudget', 'cycleStartDay', 'expenses', 'incomes', 'goals', 'customCategories']

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { lastCycles } = await server.ssrLoadModule('/src/utils/cycle.js')
  const S = useAppStore.getState
  const container = dom.createContainer()
  const caught = []
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const screen = () => text(container) + ' ' + nodes(container).map((n) => attr(n, 'aria-label')).filter(Boolean).join(' ')
  // Nodo per nodo (il testo intero è unito senza spazi) più le etichette accessibili.
  const pieces = () => [...nodes(container).filter((n) => typeof n.data === 'string').map((n) => n.data), ...nodes(container).map((n) => attr(n, 'aria-label')).filter(Boolean)]
  const trendBars = () => nodes(container).filter((n) => (attr(n, 'class') ?? '').split(' ').some((c) => c === 'trend-chart__label')).map(text)
  const dataOf = () => JSON.stringify(Object.fromEntries(DATA_FIELDS.map((field) => [field, S()[field]])))

  S().switchScope('u:utente-andamento-mesi')
  await act(() => root.render(h(App)))
  // Calendario (ciclo dal 1): spese e stipendio da ottobre 2026 a gennaio 2027.
  await act(() => {
    S().setLanguage('it')
    S().setCycleStartDay(1)
    useAppStore.setState({ today: '2027-01-15' })
    for (const [month, amount] of [['2026-10', 120], ['2026-11', 90], ['2026-12', 150], ['2027-01', 60]]) {
      S().addSalary({ amount: 2000, date: `${month}-01`, keepLastSalary: true })
      S().addExpense({ amount, categoryId: 'spesa', description: 'mercato', date: `${month}-10` })
    }
  })
  await act(() => { useAppStore.setState({ today: '2027-01-15' }); S().openModal('andamento') })
  const cyclesBefore = JSON.stringify(lastCycles(S().today, 4, S().cycleStartDay))
  const dataBefore = dataOf()

  section('1. Andamento, ciclo di calendario: mesi nella lingua scelta, senza reload')
  check('Andamento si apre senza errori', caught.length === 0 && screen().length > 0, caught[0]?.message)
  for (const lang of ['it', 'en', 'fr', 'es', 'it']) {
    await act(() => S().setLanguage(lang))
    const bars = trendBars()
    const shown = screen()
    check(`${lang}: barre del grafico ${bars.join(' · ')}`, SHORT[lang].every((month) => bars.includes(month)), `attese ${SHORT[lang].join(' · ')}`)
    check(`   ${lang}: periodo in corso "${LONG_JANUARY[lang]}"`, shown.includes(LONG_JANUARY[lang]))
    if (lang !== 'it') {
      const italian = italianMonthsFor(lang).filter((month) => pieces().some((piece) => wordIn(piece, month)))
      check(`   ${lang}: nessun mese italiano a schermo`, italian.length === 0, italian.join(', '))
    }
    check(`   ${lang}: nessuna chiave di traduzione visibile`, !pieces().some((piece) => RAW_KEY.test(piece)), pieces().find((piece) => RAW_KEY.test(piece)))
  }

  section('2. Andamento, ciclo personalizzato (dal 7): date nella lingua scelta')
  await act(() => { S().setCycleStartDay(7); useAppStore.setState({ today: '2027-01-15' }) })
  for (const lang of LANGS) {
    await act(() => S().setLanguage(lang))
    const shown = screen()
    check(`${lang}: ciclo in corso "${CUSTOM_CURRENT[lang]}"`, shown.includes(CUSTOM_CURRENT[lang]))
    if (lang !== 'it') {
      const italian = italianMonthsFor(lang).filter((month) => pieces().some((piece) => wordIn(piece, month)))
      check(`   ${lang}: nessun mese italiano a schermo`, italian.length === 0, italian.join(', '))
    }
  }
  await act(() => S().setCycleStartDay(1))

  section('3. Analisi: periodo nella lingua scelta')
  await act(() => { S().closeModal(); S().setActiveTab('analytics') })
  for (const lang of LANGS) {
    await act(() => S().setLanguage(lang))
    const heading = text(nodes(container).find((n) => attr(n, 'class') === 'analytics-page__heading'))
    check(`${lang}: "${heading}"`, heading === LONG_JANUARY[lang])
  }

  section('4. Cambiare lingua non tocca cicli e dati')
  check('stessi cicli in ogni lingua', JSON.stringify(lastCycles(S().today, 4, S().cycleStartDay)) === cyclesBefore)
  check('spese, entrate, budget e obiettivi invariati', dataOf() === dataBefore)
  check('nessun errore durante i cambi di lingua', caught.length === 0, caught[0]?.message)

  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Andamento e Analisi: mesi nelle quattro lingue')
