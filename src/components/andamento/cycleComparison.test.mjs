// Andamento → "Confronta periodi": la nuova presentazione mostra ESATTAMENTE
// i valori già calcolati da compareCycles (andamentoEngine.js) e formattati da
// andamentoFormat.js. `npm test`, senza rete.
//
// Monta il VERO AndamentoScreen con lo store vero e il vero react-dom/client
// su un DOM minimo (store/fakeDom.mjs). I tocchi e le scelte nei selettori
// chiamano davvero gli onClick/onChange che React ha agganciato ai nodi.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../../sync/testkit.mjs'
import { installFakeDom } from '../../store/fakeDom.mjs'

const dom = installFakeDom(new Map())
// Il DOM minimo condiviso non conosce <select>: qui, solo per questo test, il
// minimo che React usa per una select controllata (options, value, selected).
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

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-cycle-comparison-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})

// --- visita del DOM minimo -------------------------------------------------------

const nodes = (node, out = []) => {
  out.push(node)
  for (const child of node.childNodes ?? []) nodes(child, out)
  return out
}
const text = (node) => (typeof node.data === 'string' ? node.data : (node.childNodes ?? []).map(text).join(''))
const cls = (node) => node.attributes?.get?.('class') ?? ''
const byClass = (root, name) => nodes(root).filter((n) => cls(n).split(' ').includes(name))
const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const act = async (fn) => { flushSync(fn); for (let i = 0; i < 4; i += 1) await tick() }

const near = (a, b) => Math.abs(a - b) < 1e-9

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { AndamentoScreen } = await server.ssrLoadModule('/src/components/andamento/AndamentoScreen.jsx')
  const { buildAndamento, compareCycles } = await server.ssrLoadModule('/src/utils/andamentoEngine.js')
  const fmt = await server.ssrLoadModule('/src/components/andamento/andamentoFormat.js')
  const { formatCurrency } = await server.ssrLoadModule('/src/utils/format.js')

  // Ciclo A (7/9–6/10): stipendio 2537, spese 2117,23. Ciclo B (7/10–6/11, in corso): stipendio 2451, spese 17.
  const expense = (id, categoryId, amount, date) => ({ id, categoryId, amount, date, description: 'x', updatedAt: '2026-10-20T08:00:00.000Z' })
  const salary = (id, amount, date) => ({ id, categoryId: 'stipendio', amount, date, description: 'Stipendio', updatedAt: '2026-10-20T08:00:00.000Z' })
  const state = {
    today: '2026-10-20',
    cycleStartDay: 7,
    incomes: [salary('i-a', 2537, '2026-09-07'), salary('i-b', 2451, '2026-10-07')],
    expenses: [
      expense('e1', 'casa', 900, '2026-09-10'), expense('e2', 'spesa', 558, '2026-09-15'), expense('e3', 'shopping', 300, '2026-09-18'),
      expense('e4', 'trasporti', 196, '2026-09-22'), expense('e5', 'bar', 163.23, '2026-09-28'), expense('e6', 'ristoranti', 17, '2026-10-12'),
    ],
  }
  useAppStore.setState(state)

  // I valori attesi vengono dalla logica esistente, non dal componente.
  const andamento = buildAndamento({ ...state })
  const [A, B] = andamento.cycles
  const cmp = compareCycles(A, B)

  const container = dom.createContainer()
  const root = createRoot(container, { onRecoverableError: () => {} })
  await act(() => root.render(h(AndamentoScreen, { onClose: () => {} })))
  const tab = nodes(container).find((n) => n.localName === 'button' && text(n) === 'Confronta periodi')
  await act(() => propsOf(tab).onClick({}))
  const screen = () => text(container)

  // =====================================================================
  section('1. Periodi: selettori e stato del ciclo')
  // =====================================================================
  const selects = () => nodes(container).filter((n) => n.localName === 'select')
  check('due selettori, sul ciclo precedente e su quello in corso', selects().length === 2 && selects()[0].value === A.key && selects()[1].value === B.key, `${selects()[0]?.value} ${selects()[1]?.value}`)
  const statuses = byClass(container, 'cycle-comparison__status').map(text)
  check('il precedente è "✓ Completo", quello in corso "● In corso"', statuses.join('|') === '✓ Completo|● In corso', statuses.join('|'))
  const roles = () => byClass(container, 'cycle-comparison__picker-label').map(text)
  check('sopra i selettori: "Periodo precedente" e "Periodo attuale" (al posto di "Confronta" / "con")', roles().join('|') === 'Periodo precedente|Periodo attuale' && !/Confronta|^con$/.test(roles().join('|')), roles().join('|'))

  // =====================================================================
  section('2. La conclusione (stessa regola: il segno della differenza di spesa)')
  // =====================================================================
  const verdict = byClass(container, 'cycle-comparison__verdict')[0]
  check('spesa diminuita → "💚 Ottimo!" con tono positivo', text(verdict).includes('💚 Ottimo!') && cls(verdict).includes('cycle-comparison__verdict--good'))
  check(`"Hai speso ${formatCurrency(Math.abs(cmp.spent.diff))} in meno" (valore calcolato: ${cmp.spent.diff})`, text(byClass(container, 'cycle-comparison__verdict-text')[0]) === `Hai speso ${formatCurrency(Math.abs(cmp.spent.diff))} in meno` && near(cmp.spent.diff, -2100.23))
  check('"rispetto al ciclo precedente (7 Set – 6 Ott)"', text(byClass(container, 'cycle-comparison__verdict-ref')[0]) === 'rispetto al ciclo precedente (7 Set – 6 Ott)')
  check('nota sul ciclo in corso', screen().includes('Il ciclo attuale è ancora in corso: i numeri possono cambiare.'))

  // =====================================================================
  section('3. Le quattro metriche: stessi valori di prima')
  // =====================================================================
  const cards = byClass(container, 'cycle-comparison__metric')
  check('quattro card, in una griglia', cards.length === 4 && byClass(container, 'cycle-comparison__metrics').length === 1)
  const card = (label) => cards.find((c) => text(byClass(c, 'cycle-comparison__metric-label')[0]) === label)
  const values = (c) => text(byClass(c, 'cycle-comparison__values')[0])
  const change = (c) => text(byClass(c, 'cycle-comparison__change')[0])
  const signedMoney = (v) => (v < 0 ? `-${formatCurrency(Math.abs(v))}` : formatCurrency(v))

  const spent = fmt.describeChange(cmp.spent, { newLabel: 'Nuova spesa' })
  check(`Spese: ${values(card('Spese'))} · ${change(card('Spese'))}`, values(card('Spese')) === `${formatCurrency(A.spent)}→${formatCurrency(B.spent)}` && change(card('Spese')) === `${spent.arrow} ${spent.text}`)
  check('   cioè 2117,23 € → 17,00 €, ▼ -2100,23 € · -99,2%', values(card('Spese')) === '2117,23 €→17,00 €' && change(card('Spese')) === '▼ -2100,23 € · -99,2%')

  const income = fmt.describeChange(cmp.income, { higherIsBetter: true, newLabel: 'Nuove entrate', goneLabel: 'Nessuna entrata' })
  check(`Entrate: ${values(card('Entrate'))} · ${change(card('Entrate'))}`, values(card('Entrate')) === `${formatCurrency(A.income)}→${formatCurrency(B.income)}` && change(card('Entrate')) === `${income.arrow} ${income.text}`)
  check('   cioè 2537,00 € → 2451,00 €, ▼ -86,00 € · -3,4%', values(card('Entrate')) === '2537,00 €→2451,00 €' && change(card('Entrate')) === '▼ -86,00 € · -3,4%')

  const savings = fmt.describeDiff(cmp.savings.diff, { higherIsBetter: true })
  check(`Risparmio: ${values(card('Risparmio'))} · ${change(card('Risparmio'))}`, values(card('Risparmio')) === `${signedMoney(A.savings)}→${signedMoney(B.savings)}` && change(card('Risparmio')) === `${savings.arrow} ${savings.text}`)
  check('   cioè 419,77 € → 2434,00 €, ▲ +2014,23 €', values(card('Risparmio')) === '419,77 €→2434,00 €' && change(card('Risparmio')) === '▲ +2014,23 €')

  const points = Math.round(cmp.budgetUsed.diffPoints)
  check(`Budget utilizzato: ${values(card('Budget utilizzato'))} · ${change(card('Budget utilizzato'))}`, values(card('Budget utilizzato')) === `${fmt.formatPercent(A.budgetUsed)}→${fmt.formatPercent(B.budgetUsed)}`
    && change(card('Budget utilizzato')) === `▼ -${Math.abs(points)} punti`)
  check('   le card hanno il tono della variazione (mint = meglio, coral = peggio)', cls(byClass(card('Spese'), 'cycle-comparison__change')[0]).includes('--good') && cls(byClass(card('Entrate'), 'cycle-comparison__change')[0]).includes('--bad'))

  // =====================================================================
  section('4. Cosa ha fatto la differenza')
  // =====================================================================
  check('titolo "🔍 Cosa ha fatto la differenza"', screen().includes('🔍 Cosa ha fatto la differenza'))
  const rows = () => byClass(container, 'category-comparison__row')
  check(`prime 5 categorie su ${cmp.categories.length}, nello stesso ordine del calcolo`, rows().length === 5
    && rows().map((r) => text(byClass(r, 'category-comparison__label')[0])).join() === cmp.categories.slice(0, 5).map((c) => c.category.label).join())
  const first = rows()[0]
  check(`la prima: ${text(byClass(first, 'category-comparison__label')[0])}, ${text(byClass(first, 'category-comparison__values')[0])}, ${text(byClass(first, 'category-comparison__change')[0])}`,
    text(byClass(first, 'category-comparison__values')[0]).startsWith(`${formatCurrency(cmp.categories[0].before)} → ${formatCurrency(cmp.categories[0].after)}`)
    && text(byClass(first, 'category-comparison__change')[0]) === `▼ ${fmt.formatSignedCurrency(cmp.categories[0].diff)}`)
  const widths = rows().map((r) => byClass(r, 'category-comparison__bar-fill')[0]?.style.width ?? '')
  const expectedWidths = cmp.categories.slice(0, 5).map((c) => `${Math.max(Math.abs(c.diff) / Math.abs(cmp.categories[0].diff), c.diff === 0 ? 0 : 0.04) * 100}%`)
  check('ogni riga ha la sua barra, proporzionale alla variazione (la più grande al 100%)', widths.length === 5 && widths[0] === '100%' && widths.join() === expectedWidths.join(), widths.join(' | '))
  const toggle = nodes(container).find((n) => n.localName === 'button' && text(n).startsWith('Mostra tutte'))
  check(`"Mostra tutte (${cmp.categories.length})" presente`, Boolean(toggle) && text(toggle) === `Mostra tutte (${cmp.categories.length})`)
  await act(() => propsOf(toggle).onClick({}))
  check('   premuto: tutte le categorie, con "Mostra meno"', rows().length === cmp.categories.length && screen().includes('Mostra meno'))
  check('   compresa quella nuova del ciclo in corso (Ristorante, +17,00 €, Nuova)', rows().some((r) => text(r).includes('Ristorante') && text(r).includes('+17,00 €') && text(r).includes('Nuova')))

  // =====================================================================
  section('5. I selettori funzionano ancora')
  // =====================================================================
  await act(() => propsOf(selects()[1]).onChange({ target: { value: A.key } }))
  check('stesso periodo su entrambi: l\'avviso al posto del confronto', screen().includes('Scegli due periodi diversi per vedere cosa è cambiato.') && byClass(container, 'cycle-comparison__metric').length === 0)
  await act(() => propsOf(selects()[0]).onChange({ target: { value: B.key } }))
  check('ordine invertito (B, poi A): il più vecchio resta il riferimento, stessi numeri', text(byClass(container, 'cycle-comparison__verdict-text')[0]) === `Hai speso ${formatCurrency(Math.abs(cmp.spent.diff))} in meno`
    && values(byClass(container, 'cycle-comparison__metric')[0]) === '2117,23 €→17,00 €')
  check('   e i badge seguono i periodi scelti', byClass(container, 'cycle-comparison__status').map(text).join('|') === '● In corso|✓ Completo')
  check('   come le etichette: il primo selettore ora è il "Periodo attuale", il secondo il "Periodo precedente"', roles().join('|') === 'Periodo attuale|Periodo precedente', roles().join('|'))

  // =====================================================================
  section('6. Responsive e nessun cambio di logica')
  // =====================================================================
  const css = readFileSync(new URL('./CycleComparison.css', import.meta.url), 'utf8')
  check('griglia 2 × 2 (anche su smartphone)', /\.cycle-comparison__metrics\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(css))
  check('ritocchi sotto 360 px e sopra 600 px', css.includes('@media (max-width: 359px)') && css.includes('@media (min-width: 600px)'))
  check('selettori alti almeno 44 px (tocco comodo)', /\.cycle-comparison__picker select\s*\{[^}]*min-height:\s*44px/.test(css))
  const component = readFileSync(new URL('./CycleComparison.jsx', import.meta.url), 'utf8')
  check('il componente usa compareCycles e i formattatori esistenti, senza calcoli propri', component.includes('compareCycles(before, after)') && component.includes('describeChange(comparison.spent') && component.includes('describeDiff(comparison.savings.diff'))

  // =====================================================================
  section('7. Riquadri cliccabili: un grafico a linea alla volta')
  // =====================================================================
  // Si riparte da A (precedente) e B (attuale).
  await act(() => propsOf(selects()[0]).onChange({ target: { value: A.key } }))
  await act(() => propsOf(selects()[1]).onChange({ target: { value: B.key } }))
  const metricButtons = () => nodes(container).filter((n) => n.localName === 'button' && cls(n).split(' ').includes('cycle-comparison__metric'))
  const buttonOf = (label) => metricButtons().find((b) => text(byClass(b, 'cycle-comparison__metric-label')[0]) === label)
  const charts = () => byClass(container, 'metric-chart')
  const chartText = () => text(charts()[0] ?? { childNodes: [] })
  const chartValues = () => byClass(charts()[0], 'metric-chart__value').map(text)
  const chartLabels = () => byClass(charts()[0], 'metric-chart__label').map(text)
  const tap = (label) => act(() => propsOf(buttonOf(label)).onClick({}))
  const snapshot = () => JSON.stringify({ e: useAppStore.getState().expenses, i: useAppStore.getState().incomes, o: useAppStore.getState().sync.outbox, m: useAppStore.getState().monthlyBudget })
  const dataBefore = snapshot()

  check('1. i quattro riquadri sono pulsanti, chiusi, con un chevron', metricButtons().length === 4
    && metricButtons().every((b) => b.attributes.get('aria-expanded') === 'false' && byClass(b, 'cycle-comparison__chevron').length === 1) && charts().length === 0)

  await tap('Spese')
  check('2. tocco su "Spese": compare il grafico "Andamento delle spese"', charts().length === 1 && text(byClass(charts()[0], 'metric-chart__title')[0]) === 'Andamento delle spese'
    && buttonOf('Spese').attributes.get('aria-expanded') === 'true' && cls(buttonOf('Spese')).includes('cycle-comparison__metric--open'))
  check('   collegato al riquadro (aria-controls → id del grafico)', buttonOf('Spese').attributes.get('aria-controls') === charts()[0].attributes.get('id'))
  check('3. due punti con i valori del motore: 2117,23 € (7 Set) → 17,00 € (7 Ott)', chartValues().join('|') === `${formatCurrency(A.spent)}|${formatCurrency(B.spent)}`
    && chartValues().join('|') === '2117,23 €|17,00 €' && chartLabels().join('|') === `${A.shortLabel}|${B.shortLabel}`)
  check('   periodi "7 Set – 6 Ott → 7 Ott – 6 Nov" e una linea che li unisce', text(byClass(charts()[0], 'metric-chart__periods')[0]) === `${A.label} → ${B.label}` && byClass(charts()[0], 'metric-chart__line').length === 1)
  check('   sotto: la stessa variazione del riquadro (▼ -2100,23 € · -99,2%) e la frase', text(byClass(charts()[0], 'metric-chart__summary')[0]) === `${spent.arrow} ${spent.text}`
    && chartText().includes('Hai speso meno rispetto al periodo precedente.'))
  check('   il grafico sta sotto la prima riga (dopo Spese ed Entrate)', byClass(container, 'cycle-comparison__metrics')[0].childNodes.map((n) => (cls(n).includes('metric-chart') ? 'grafico' : text(byClass(n, 'cycle-comparison__metric-label')[0]))).join('|') === 'Spese|Entrate|grafico|Risparmio|Budget utilizzato')

  await tap('Spese')
  check('4. secondo tocco su "Spese": il grafico si chiude', charts().length === 0 && buttonOf('Spese').attributes.get('aria-expanded') === 'false')

  await tap('Spese')
  await tap('Entrate')
  check('5. "Spese" aperto, poi "Entrate": resta un solo grafico, quello delle entrate', charts().length === 1 && text(byClass(charts()[0], 'metric-chart__title')[0]) === 'Andamento delle entrate'
    && buttonOf('Spese').attributes.get('aria-expanded') === 'false' && buttonOf('Entrate').attributes.get('aria-expanded') === 'true')
  check('6. entrate: 2537,00 € → 2451,00 €, ▼ -86,00 € · -3,4%', chartValues().join('|') === '2537,00 €|2451,00 €' && text(byClass(charts()[0], 'metric-chart__summary')[0]) === `${income.arrow} ${income.text}`
    && chartText().includes('Le entrate sono diminuite.'))

  await tap('Risparmio')
  check('7. risparmio: 419,77 € → 2434,00 €, ▲ +2014,23 €', charts().length === 1 && chartValues().join('|') === '419,77 €|2434,00 €'
    && text(byClass(charts()[0], 'metric-chart__summary')[0]) === `${savings.arrow} ${savings.text}` && chartText().includes('Hai messo da parte di più.'))
  check('   sotto la seconda riga (dopo Risparmio e Budget)', byClass(container, 'cycle-comparison__metrics')[0].childNodes.map((n) => (cls(n).includes('metric-chart') ? 'grafico' : text(byClass(n, 'cycle-comparison__metric-label')[0]))).join('|') === 'Spese|Entrate|Risparmio|Budget utilizzato|grafico')

  await tap('Budget utilizzato')
  const budgetSummary = text(byClass(charts()[0], 'metric-chart__summary')[0])
  check(`8. budget: ${fmt.formatPercent(A.budgetUsed)} → ${fmt.formatPercent(B.budgetUsed)}, valori in %`, chartValues().join('|') === `${fmt.formatPercent(A.budgetUsed)}|${fmt.formatPercent(B.budgetUsed)}` && chartValues().every((v) => v.endsWith('%')))
  check(`9. budget in punti percentuali: "${budgetSummary}" (non una percentuale)`, budgetSummary === `▼ -${Math.abs(points)} punti percentuali` && !budgetSummary.includes('·') && !/\d%/.test(budgetSummary))

  check('15. nessun dato modificato dai tocchi (spese, entrate, coda, stipendio)', snapshot() === dataBefore)

  // =====================================================================
  section('8. Cambio periodo con un grafico aperto')
  // =====================================================================
  await tap('Spese')
  await act(() => propsOf(selects()[0]).onChange({ target: { value: B.key } }))
  await act(() => propsOf(selects()[1]).onChange({ target: { value: A.key } }))
  check('12-13. periodi invertiti: il grafico resta aperto e segue i periodi (il più vecchio a sinistra)', charts().length === 1
    && chartValues().join('|') === '2117,23 €|17,00 €' && chartLabels().join('|') === `${A.shortLabel}|${B.shortLabel}`)
  check('14. coerente con il riquadro dopo il cambio', values(buttonOf('Spese')) === '2117,23 €→17,00 €' && text(byClass(charts()[0], 'metric-chart__summary')[0]) === change(buttonOf('Spese')))
  await act(() => propsOf(selects()[1]).onChange({ target: { value: B.key } }))
  check('   stesso periodo su entrambi: l\'avviso, nessun grafico', screen().includes('Scegli due periodi diversi') && charts().length === 0)
  await act(() => propsOf(selects()[0]).onChange({ target: { value: A.key } }))
  check('   tornati a A → B: il grafico aperto ricompare con i valori giusti', charts().length === 1 && chartValues().join('|') === '2117,23 €|17,00 €')

  // =====================================================================
  section('9. Periodo senza entrate né stipendio')
  // =====================================================================
  await act(() => useAppStore.setState({ incomes: [salary('i-a', 2537, '2026-09-07')] })) // B senza stipendio
  const noIncome = buildAndamento({ ...state, incomes: [salary('i-a', 2537, '2026-09-07')] })
  check('premessa: per il motore B non ha entrate né budget', noIncome.cycles[1].income === 0 && noIncome.cycles[1].budgetUsed === null)
  if (buttonOf('Spese').attributes.get('aria-expanded') === 'true') await tap('Spese')
  check('riquadro chiuso "Entrate": 2537,00 € → — (nessuna entrata registrata, non "0,00 €")', values(buttonOf('Entrate')) === '2537,00 €→—'
    && !values(buttonOf('Entrate')).includes('0,00 €') && buttonOf('Entrate').attributes.get('aria-label').includes('7 Ott —'))
  check('   la variazione resta quella del motore ("Nessuna entrata")', change(buttonOf('Entrate')).includes('Nessuna entrata'))
  await tap('Entrate')
  check('11. entrate di B assenti: punto vuoto "—", nessuna linea, mai "0,00 €"', chartValues().join('|') === '2537,00 €|—'
    && byClass(charts()[0], 'metric-chart__dot--missing').length === 1 && byClass(charts()[0], 'metric-chart__line').length === 0 && !chartText().includes('0,00 €'))
  check('   "Nessuna entrata registrata" per 7 Ott – 6 Nov', chartText().includes(`${B.label}: Nessuna entrata registrata`))
  await tap('Budget utilizzato')
  check('10. budget senza stipendio in B: "Budget non confrontabile", con la spiegazione, nessun valore', chartText().includes('Budget non confrontabile')
    && chartText().includes(`${B.label} non ha uno stipendio registrato`) && nodes(charts()[0]).every((n) => n.localName !== 'svg'))
  await act(() => useAppStore.setState({ incomes: state.incomes }))
  check('tornate le entrate di B: il riquadro torna a 2537,00 € → 2451,00 €', values(buttonOf('Entrate')) === '2537,00 €→2451,00 €')

  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Confronta periodi (schermata)')
