// Colore della card "Disponibile" in Home e livello del budget in
// Andamento: UNA sola scala sulla PERCENTUALE di budget speso del ciclo
// (utils/budgetTone.js), mai sull'importo in euro. `npm test`, senza rete.
//
// Si controllano le soglie (anche ai bordi), i casi limite (nessun budget,
// sforamento, decimali, valori mancanti) e la VERA BudgetCard.jsx caricata
// da Vite: classe del tono, chip con la percentuale, arco e testi nelle
// quattro lingue.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, section, report } from '../../sync/testkit.mjs'
import { budgetTone, budgetLevel, spentPercentOf, BUDGET_LEVEL_THRESHOLDS, BUDGET_TONES, BUDGET_LEVELS } from '../../utils/budgetTone.js'
import { MESSAGES } from '../../i18n/translate.js'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const toneOf = (spent, monthlyBudget = 1000) => budgetTone({ spent, monthlyBudget }).tone

// =====================================================================
section('1. Soglie sulla percentuale spesa (una sola scala per Home e Andamento)')
// =====================================================================
check('soglie dichiarate: <60 verde, 60–75 giallo, 75–90 arancione, 90–100 rosso, ≥100 superato', BUDGET_LEVEL_THRESHOLDS.caution === 60 && BUDGET_LEVEL_THRESHOLDS.warning === 75 && BUDGET_LEVEL_THRESHOLDS.danger === 90 && BUDGET_LEVEL_THRESHOLDS.over === 100)
check('1.000 € di budget, spesi 200 → verde, resta l\'80%', toneOf(200) === 'good' && budgetTone({ spent: 200, monthlyBudget: 1000 }).remainingPercent === 80)
check('il caso segnalato: 64% speso → giallo (in Home e in Andamento)', toneOf(640) === 'caution' && budgetLevel(64) === 'caution')
check('1.000 € di budget, spesi 950 → rosso (5% residuo)', toneOf(950) === 'danger')
check('conta la percentuale, non l\'importo: 50 € spesi su 60 → arancione, su 1.000 → verde', toneOf(50, 60) === 'warning' && toneOf(50, 1000) === 'good')
check('bordi: 59,99% verde, 60% giallo', toneOf(599.9) === 'good' && toneOf(600) === 'caution')
check('bordi: 74,99% giallo, 75% arancione', toneOf(749.9) === 'caution' && toneOf(750) === 'warning')
check('bordi: 89,99% arancione, 90% rosso', toneOf(899.9) === 'warning' && toneOf(900) === 'danger')
check('budget finito (100%) → esaurito', toneOf(1000) === 'over' && budgetTone({ spent: 1000, monthlyBudget: 1000 }).remainingPercent === 0)
check('budget superato → esaurito, percentuale residua 0 (mai negativa)', toneOf(1030.5) === 'over' && budgetTone({ spent: 1030.5, monthlyBudget: 1000 }).remainingPercent === 0)
check('livelli della scala: ok/caution/warning/danger/over', [0, 59, 60, 75, 90, 100, 140].map(budgetLevel).join() === 'ok,ok,caution,warning,danger,over,over')

// =====================================================================
section('2. Casi limite: niente rosso "per default", niente NaN')
// =====================================================================
check('budget non configurato (stipendio 0) → neutro, senza percentuale', toneOf(0, 0) === 'neutral' && budgetTone({ spent: 0, monthlyBudget: 0 }).remainingPercent === null)
check('nessuno stipendio ma spese registrate → neutro, non rosso', toneOf(20, 0) === 'neutral')
check('valori mancanti o non numerici → neutro', [budgetTone(), budgetTone({}), budgetTone({ spent: Number.NaN, monthlyBudget: 10 }), budgetTone({ spent: 10, monthlyBudget: Infinity })].every((r) => r.tone === 'neutral' && r.remainingPercent === null) && budgetLevel(null) === 'neutral' && budgetLevel(Number.NaN) === 'neutral')
check('ciclo appena iniziato (niente speso) → verde 100%', toneOf(0, 2451) === 'good' && budgetTone({ spent: 0, monthlyBudget: 2451 }).remainingPercent === 100)
{
  const r = budgetTone({ spent: 1572.93, monthlyBudget: 2451 })
  check('importi decimali: 1.572,93 spesi su 2.451,00 → 64,2% giallo, 35,8% residuo', r.tone === 'caution' && Math.abs(r.remainingPercent - 35.8247) < 0.001, r.remainingPercent)
}
check('la base è la stessa di Andamento (speso ÷ stipendio del ciclo)', spentPercentOf({ spent: 500, monthlyBudget: 2000 }) === 25 && spentPercentOf({ spent: 5, monthlyBudget: 0 }) === null)
check('ogni risultato è uno dei toni e livelli dichiarati', [[200, 1000], [0, 0], [1, 0], [95, 100], [70, 100], [105, 100]].every(([sp, b]) => BUDGET_TONES.includes(toneOf(sp, b)) && BUDGET_LEVELS.includes(budgetTone({ spent: sp, monthlyBudget: b }).level)))

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
    check('decimali: 64,17% speso → chip "36% residuo", arco "64%": insieme fanno sempre 100', chip(html) === '36% residuo' && html.includes('<strong>64%</strong>') && cardClass(html) === 'caution', chip(html))
  }
  {
    const html = render(400, 600)
    check('l\'arco è accessibile: progressbar 0–100 col valore della quota spesa (60%)', /<svg class="budget-card__arc"[^>]*role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="60"/.test(html))
    check('   importo disponibile accanto all\'arco, quota spesa dentro l\'arco', /budget-card__main[\s\S]*budget-card__amount[^>]*>400,00\s?€<\/p><div class="budget-card__gauge">/.test(html) && /budget-card__gauge[\s\S]*<strong>60%<\/strong> speso/.test(html))
    check('   periodo sotto l\'etichetta "Disponibile"', /budget-card__heading"><p class="budget-card__label">[^<]+<\/p><p class="budget-card__period">7 ott – 6 nov<\/p>/.test(html))
    {
      const over = render(-120.5, 1120.5)
      check('   sforato: arco pieno (valore 100, mai oltre)', /aria-valuenow="100"/.test(over))
      check('   budget non configurato: arco a 0, nessun NaN', /aria-valuenow="0"/.test(render(0, 0, 0)) && !/NaN/.test(render(0, 0, 0)))
    }
    check('il messaggio di stato segue lo stesso livello: al 60% "Attenzione, ti stai avvicinando al limite."', html.includes(MESSAGES.it.budget.status.near))
    check('   sotto il 60% "Sei in linea", oltre il 100% "Hai superato"', render(800, 200).includes(MESSAGES.it.budget.status.ok) && render(-120.5, 1120.5).includes(MESSAGES.it.budget.status.over))
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
