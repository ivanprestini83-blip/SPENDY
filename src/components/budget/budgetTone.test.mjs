// Colore della card "Disponibile" in Home: dipende dalla PERCENTUALE di
// budget residuo del ciclo (utils/budgetTone.js), mai dall'importo in euro.
// `npm test`, senza rete.
//
// Si controllano le soglie (anche ai bordi), i casi limite (nessun budget,
// sforamento, decimali, valori mancanti) e la VERA BudgetCard.jsx caricata
// da Vite: classe del tono, chip con la percentuale, barra e testi nelle
// quattro lingue.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, section, report } from '../../sync/testkit.mjs'
import { budgetTone, BUDGET_TONE_THRESHOLDS, BUDGET_TONES } from '../../utils/budgetTone.js'
import { MESSAGES } from '../../i18n/translate.js'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const toneOf = (available, spent) => budgetTone({ available, spent }).tone

// =====================================================================
section('1. Soglie sulla percentuale residua')
// =====================================================================
check('soglie dichiarate: >50 verde, 25–50 giallo, 10–25 arancione, <10 rosso', BUDGET_TONE_THRESHOLDS.good === 50 && BUDGET_TONE_THRESHOLDS.caution === 25 && BUDGET_TONE_THRESHOLDS.warning === 10)
check('1.000 € di budget, ne restano 800 → verde (80%)', toneOf(800, 200) === 'good' && budgetTone({ available: 800, spent: 200 }).remainingPercent === 80)
check('1.000 € di budget, ne restano 50 → rosso (5%)', toneOf(50, 950) === 'danger')
check('stessi 50 € ma su un budget di 60 → verde: conta la percentuale, non l\'importo', toneOf(50, 10) === 'good')
check('bordi: 50,01% verde, 50% giallo', toneOf(500.1, 499.9) === 'good' && toneOf(500, 500) === 'caution')
check('bordi: 25% giallo, 24,99% arancione', toneOf(250, 750) === 'caution' && toneOf(249.9, 750.1) === 'warning')
check('bordi: 10% arancione, 9,99% rosso', toneOf(100, 900) === 'warning' && toneOf(99.9, 900.1) === 'danger')
check('budget finito (0 €) → esaurito', toneOf(0, 1000) === 'over' && budgetTone({ available: 0, spent: 1000 }).remainingPercent === 0)
check('budget superato → esaurito, percentuale 0 (mai negativa)', toneOf(-30.5, 1030.5) === 'over' && budgetTone({ available: -30.5, spent: 1030.5 }).remainingPercent === 0)

// =====================================================================
section('2. Casi limite: niente rosso "per default", niente NaN')
// =====================================================================
check('budget non configurato (0 e nessuna spesa) → neutro, senza percentuale', toneOf(0, 0) === 'neutral' && budgetTone({ available: 0, spent: 0 }).remainingPercent === null)
check('nessun budget ma spese registrate → neutro, non rosso', toneOf(-20, 20) === 'neutral')
check('valori mancanti o non numerici → neutro', [budgetTone(), budgetTone({}), budgetTone({ available: Number.NaN, spent: 10 }), budgetTone({ available: 10, spent: Infinity })].every((r) => r.tone === 'neutral' && r.remainingPercent === null))
check('ciclo appena iniziato (niente speso) → verde 100%', toneOf(2451, 0) === 'good' && budgetTone({ available: 2451, spent: 0 }).remainingPercent === 100)
{
  const r = budgetTone({ available: 878.07, spent: 1572.93 })
  check('importi decimali: 878,07 su 2.451,00 → 35,8% giallo', r.tone === 'caution' && Math.abs(r.remainingPercent - 35.8247) < 0.001, r.remainingPercent)
}
check('entrate extra contano nel budget del ciclo (disponibile + speso)', toneOf(600, 600) === 'caution' && toneOf(900, 100) === 'good')
check('ogni risultato è uno dei toni dichiarati', [[800, 200], [0, 0], [-1, 1], [5, 95], [30, 70], [-5, 105]].every(([a, s]) => BUDGET_TONES.includes(toneOf(a, s))))

// =====================================================================
section('3. Testi nuovi nelle quattro lingue')
// =====================================================================
for (const key of ['remaining', 'exhausted']) {
  const values = ['it', 'en', 'es', 'fr'].map((lang) => MESSAGES[lang].budget[key])
  check(`budget.${key}: presente in it/en/es/fr`, values.every((v) => typeof v === 'string' && v.trim()), values.join(' | '))
}
check('budget.remaining ha {percent} in ogni lingua', ['it', 'en', 'es', 'fr'].every((lang) => MESSAGES[lang].budget.remaining.includes('{percent}')))

// =====================================================================
section('4. BudgetCard (componente vero)')
// =====================================================================
const USE_LANGUAGE_FAKE = `
  import { translate } from '/src/i18n/translate.js'
  import { setCurrentLanguageSource } from '/src/i18n/currentLanguage.js'
  setCurrentLanguageSource(() => globalThis.__budgetToneTest.language)
  export const useLanguage = () => {
    const language = globalThis.__budgetToneTest.language
    return { language, currency: 'EUR', t: (key, params) => translate(language, key, params) }
  }`
globalThis.__budgetToneTest = { language: 'it' }
const harnessPlugin = {
  name: 'budget-tone-harness',
  enforce: 'pre',
  resolveId(source, importer) {
    if ((importer?.includes('BudgetCard.jsx') || importer?.includes('ExpenseSummaryCards.jsx')) && source === '../../i18n/useLanguage.js') return '\0budget-tone:useLanguage'
    return null
  },
  load(id) {
    return id === '\0budget-tone:useLanguage' ? USE_LANGUAGE_FAKE : null
  },
}
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-budget-tone-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [harnessPlugin, react()],
})
try {
  const { BudgetCard } = await server.ssrLoadModule('/src/components/budget/BudgetCard.jsx')
  const render = (available, spent, monthlyBudget = available + spent) => renderToStaticMarkup(h(BudgetCard, { available, spent, monthlyBudget, period: '7 ott – 6 nov', hidden: false, onToggleHidden: () => {} }))
  const cardClass = (html) => html.match(/<section class="budget-card budget-card--(\w+)"/)?.[1]
  const chip = (html) => html.match(/<span class="budget-card__left">([\s\S]*?)<\/span>/)?.[1] ?? null

  const cases = [
    ['verde', 800, 200, 'good', '80% residuo'],
    ['giallo', 400, 600, 'caution', '40% residuo'],
    ['arancione', 150, 850, 'warning', '15% residuo'],
    ['rosso', 50, 950, 'danger', '5% residuo'],
    ['esaurito', 0, 1000, 'over', 'Budget esaurito'],
    ['superato', -120.5, 1120.5, 'over', 'Budget esaurito'],
  ]
  for (const [name, available, spent, tone, text] of cases) {
    const html = render(available, spent)
    check(`${name}: card "${tone}" e chip "${text}"`, cardClass(html) === tone && chip(html) === text, `${cardClass(html)} | ${chip(html)}`)
  }
  {
    const html = render(0, 0, 0)
    check('budget non configurato: card neutra, nessun chip, nessun NaN/Infinity', cardClass(html) === 'neutral' && chip(html) === null && !/NaN|Infinity/.test(html))
  }
  {
    const html = render(878.07, 1572.93)
    check('decimali: chip "35% residuo" (per difetto, mai arrotondato verso il verde)', chip(html) === '35% residuo' && cardClass(html) === 'caution', chip(html))
  }
  {
    const html = render(400, 600)
    check('l\'arco è accessibile: progressbar 0–100 col valore della quota spesa (60%)', /<svg class="budget-card__arc"[^>]*role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="60"/.test(html))
    check('   l\'importo disponibile sta dentro l\'arco, con la quota spesa sotto', /budget-card__center[\s\S]*budget-card__amount[^>]*>€?\s?400,00/.test(html) && html.includes('<strong>60%</strong> speso'))
    {
      const over = render(-120.5, 1120.5)
      check('   sforato: arco pieno (valore 100, mai oltre)', /aria-valuenow="100"/.test(over))
      check('   budget non configurato: arco a 0, nessun NaN', /aria-valuenow="0"/.test(render(0, 0, 0)) && !/NaN/.test(render(0, 0, 0)))
    }
    check('il messaggio di stato resta quello di prima (soglie 70/95 sullo speso)', html.includes(MESSAGES.it.budget.status.ok))
  }
  for (const [lang, expected] of [['en', '80% left'], ['es', 'Queda el 80%'], ['fr', 'Reste 80 %']]) {
    globalThis.__budgetToneTest.language = lang
    check(`${lang}: chip tradotto ("${expected}")`, chip(render(800, 200)) === expected, chip(render(800, 200)))
  }
  globalThis.__budgetToneTest.language = 'it'

  // ---- Budget del mese e speso, ben visibili sotto l'arco
  {
    const { formatCurrency } = await server.ssrLoadModule('/src/utils/format.js')
    const stat = (html, kind) => (html.match(new RegExp(`budget-card__stat--${kind}[\\s\\S]*?<span class="budget-card__stat-value">([^<]*)<`))?.[1] ?? '')
    const withExtra = renderToStaticMarkup(h(BudgetCard, { available: 1200, spent: 1250, monthlyBudget: 2250, extraIncome: 200, period: 'ottobre 2026', hidden: false, onToggleHidden: () => {} }))
    check('budget del mese in vista: stipendio + extra (2.450,00) e "di cui 200,00 € extra"', withExtra.includes(MESSAGES.it.budget.income) && stat(withExtra, 'income') === formatCurrency(2450, 'it', 'EUR') && withExtra.includes(`di cui ${formatCurrency(200, 'it', 'EUR')} extra`), stat(withExtra, 'income'))
    check('   speso accanto (1.250,00)', withExtra.includes(MESSAGES.it.budget.spent) && stat(withExtra, 'spent') === formatCurrency(1250, 'it', 'EUR'))
    const plain = renderToStaticMarkup(h(BudgetCard, { available: 1864.16, spent: 585.84, monthlyBudget: 2450, period: 'ottobre 2026', hidden: false, onToggleHidden: () => {} }))
    check('   senza extra: solo lo stipendio del ciclo, nessuna nota', stat(plain, 'income') === formatCurrency(2450, 'it', 'EUR') && !plain.includes('budget-card__stat-note'))
    const noSalary = renderToStaticMarkup(h(BudgetCard, { available: 0, spent: 0, monthlyBudget: 0, period: 'ottobre 2026', hidden: false, onToggleHidden: () => {} }))
    check('   stipendio non ancora inserito: 0,00 e lo dice', stat(noSalary, 'income') === formatCurrency(0, 'it', 'EUR') && noSalary.includes(MESSAGES.it.budget.nosalary))
    check('   budget.income e budget.spent in it/en/es/fr', ['it', 'en', 'es', 'fr'].every((lang) => MESSAGES[lang].budget.income?.trim() && MESSAGES[lang].budget.spent?.trim()))
    const home = (await import('node:fs')).readFileSync(join(ROOT, 'src/pages/HomePage.jsx'), 'utf8')
    check('   la Home passa le entrate extra già calcolate da buildFinancialData', home.includes('extraIncome={financialData.extraIncomeThisMonth}'))
  }

  // ---- Spese di oggi e del ciclo (stesso banco di prova: lingua finta, dizionari veri)
  const { ExpenseSummaryCards } = await server.ssrLoadModule('/src/components/budget/ExpenseSummaryCards.jsx')
  const { formatCurrency } = await server.ssrLoadModule('/src/utils/format.js')
  {
    const html = renderToStaticMarkup(h(ExpenseSummaryCards, { today: { total: 56, count: 2 }, month: { total: 585.84 }, monthlyBudget: 2450 }))
    const buttons = html.match(/<button type="button" class="([^"]+)"/g) ?? []
    check('spese: "Spese di oggi" (1°) e "Spese di questo mese" (2°), niente entrate', buttons.length === 2 && buttons[0].includes('--today') && buttons[1].includes('--cycle') && !html.includes('income'), buttons.join(' | '))
    check('   oggi: importo e numero di transazioni; mese: importo e "su 2.450,00 €"', html.includes(MESSAGES.it.expenses.summary.today) && html.includes(formatCurrency(56, 'it', 'EUR')) && html.includes('2 transazioni') && html.includes(MESSAGES.it.expenses.summary.cycle) && html.includes(formatCurrency(585.84, 'it', 'EUR')) && html.includes(`su ${formatCurrency(2450, 'it', 'EUR')}`))
    check('   nessun NaN, anche senza budget', !/NaN|Infinity/.test(html) && !/NaN|Infinity/.test(renderToStaticMarkup(h(ExpenseSummaryCards, { today: { total: 0, count: 0 }, month: { total: 12 }, monthlyBudget: 0 }))))
  }
  check('budget.gauge in it/en/es/fr', ['it', 'en', 'es', 'fr'].every((lang) => typeof MESSAGES[lang].budget.gauge === 'string' && MESSAGES[lang].budget.gauge.trim()))
} finally {
  await server.close()
}

report('Colore del budget disponibile')
