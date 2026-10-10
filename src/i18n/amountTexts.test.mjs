// Fase 2A: gli importi scritti nelle FRASI (Coach, Posso permettermelo?,
// Radar, limite massimo, reazioni alle spese) nel formato della lingua.
// `npm test`, senza rete.
//
// Solo il modo di scrivere cambia: stessi numeri arrotondati all'euro, stessi
// verdetti, stati e motivi in ogni lingua; in italiano, sotto i 1000 €, il
// testo resta quello di prima ("200 €", "15 €", "1.000.000 €").

import { check, section, report } from '../sync/testkit.mjs'
import { translate, MESSAGES } from './translate.js'
import { formatCurrencyWhole } from '../utils/format.js'
import { evaluateAffordability } from '../utils/affordability.js'
import { getSpendyCoach } from '../utils/spendyCoach.js'
import { buildFinancialData } from '../utils/budgetCalculations.js'
import { buildRadar } from '../utils/radarEngine.js'
import { BEHAVIOR_ENGINE_CONFIG } from '../utils/behaviorEngine.js'
import { setCategoryLanguageSource } from '../data/categories.js'
import { REACTION_LIBRARY } from '../data/spendyReactionLibrary.js'
import { MAX_AMOUNT, AMOUNT_LIMIT_MESSAGE } from '../utils/amounts.js'

const LANGS = ['it', 'en', 'es', 'fr']
const NNBSP = '\u202f' // lo spazio stretto, nelle frasi scritte a mano (reazioni)
const NBSP = '\u00a0' // il separatore delle migliaia francese degli importi formattati
const same = (values) => new Set(values.map((v) => JSON.stringify(v))).size === 1
const withLanguage = (lang, fn) => { setCategoryLanguageSource(() => lang); try { return fn() } finally { setCategoryLanguageSource(() => 'it') } }
let seq = 0
const expense = (date, amount, categoryId) => ({ id: `e-${seq++}`, date, amount, categoryId, description: categoryId })
const TODAY = '2026-09-20'

// =====================================================================
section('formatCurrencyWhole: importi interi, senza decimali')
// =====================================================================
{
  const EXPECTED = {
    it: ['1.794 €', '15 €', '0 €', '1.000.000 €', '-13 €'],
    en: ['€1,794', '€15', '€0', '€1,000,000', '-€13'],
    es: ['1.794 €', '15 €', '0 €', '1.000.000 €', '-13 €'],
    fr: [`1${NBSP}794 €`, '15 €', '0 €', `1${NBSP}000${NBSP}000 €`, '-13 €'],
  }
  for (const lang of LANGS) {
    const got = [1794, 15, 0, 1000000, -12.6].map((value) => formatCurrencyWhole(value, lang))
    check(`${lang}: ${got.join(' | ')}`, got.join('|') === EXPECTED[lang].join('|'), EXPECTED[lang].join(' | '))
  }
  check('zero senza segno (-0, -0,4), valori non numerici come zero', [-0, -0.4, NaN, undefined].every((value) => formatCurrencyWhole(value, 'it') === '0 €'))
  check('italiano sotto i 1000: come il testo di prima ("{n} €")', [0, 7, 15, 200, 400, 999].every((value) => formatCurrencyWhole(value, 'it') === `${value} €`))
}

// =====================================================================
section('Dizionari: nessun "€" scritto accanto a un segnaposto')
// =====================================================================
{
  const flat = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]))
  for (const lang of LANGS) {
    const withEuro = flat(MESSAGES[lang]).filter(([, value]) => value.includes('€')).map(([key]) => key)
    check(`${lang}: "€" solo nei testi del nuovo ciclo che parlano di zero (budget.cycle.fresh.*)`, withEuro.every((key) => key.startsWith('budget.cycle.fresh.')), withEuro.join(', '))
  }
  const KEYS = ['coach.insight.high', 'coach.insight.low', 'coach.insight.savings', 'coach.drop.goal', 'affordability.over', 'affordability.ok.message', 'affordability.careful.message', 'affordability.most', 'radarcard.explanation.small', 'radarcard.explanation.smallcategory', 'expenses.limit']
  const lookup = (lang, key) => key.split('.').reduce((node, part) => node?.[part], MESSAGES[lang])
  check('le 11 frasi hanno gli stessi segnaposto in ogni lingua', KEYS.every((key) => same(LANGS.map((lang) => [...lookup(lang, key).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()))))
}

// =====================================================================
section('Spendy Coach: gli stessi numeri arrotondati, nel formato della lingua')
// =====================================================================
{
  const coachFor = (lang, expenses, goals = []) => withLanguage(lang, () => {
    const financialData = buildFinancialData({ today: TODAY, monthlyBudget: 6000, expenses, incomes: [], goals, cycleStartDay: 1 })
    return getSpendyCoach(financialData, { expenses, today: TODAY, monthlyBudget: 6000, cycleStartDay: 1, goals, jokeHistory: [], financialData, lang })
  })
  // Una categoria in forte aumento, con importi oltre i 1000 €.
  const history = [expense('2026-06-10', 1000, 'casa'), expense('2026-07-10', 1050, 'casa'), expense('2026-08-10', 1100, 'casa')]
  const spike = [...history, expense('2026-09-10', 2400, 'casa')]
  const coaches = LANGS.map((lang) => coachFor(lang, spike))
  check('stesso stato e stesso motivo in ogni lingua', same(coaches.map((c) => [c.state, c.reason])))
  const insightTexts = coaches.map((c) => c.secondaryInsightText ?? '')
  const hasAmounts = insightTexts.every((text, i) => text.includes(formatCurrencyWhole(2400, LANGS[i])) && text.includes(formatCurrencyWhole(1050, LANGS[i])))
  check(`frase dell'insight: "2.400 €" / "€2,400" / "2.400 €" / "2 400 €" (${insightTexts[1]})`, hasAmounts, insightTexts.join(' | '))
  check('   in inglese nessun "€" dopo un numero', !/\d €/.test(insightTexts[1]))
  // Una categoria in calo con un obiettivo (stesso scenario di spendy.test, con un importo oltre i 1000 €).
  const drops = LANGS.map((lang) => withLanguage(lang, () => getSpendyCoach({
    monthlyBudget: 6000, spentRatio: 10, goals: [{ id: 'g', label: 'Auto', saved: 100, target: 5000 }],
    topDecreasingCategory: { categoryId: 'casa', category: { id: 'casa', label: 'Casa', emoji: '🏠' }, changePercent: -40, changeAmount: -1250.4 },
  }, { lang })))
  check(`calo con obiettivo: stesso stato e motivo, "${drops.map((c, i) => formatCurrencyWhole(1250, LANGS[i])).join('" / "')}" nel consiglio`,
    same(drops.map((c) => [c.state, c.reason])) && drops.every((c, i) => c.message.includes(formatCurrencyWhole(1250, LANGS[i])) && c.message.includes('"Auto"')), drops.map((c) => c.message).join(' | '))
}

// =====================================================================
section('Posso permettermelo?: stesso verdetto, importi nella lingua')
// =====================================================================
{
  const goals = [{ id: 'g', label: 'Lisbona', emoji: '✈️', saved: 100, target: 1200 }]
  const CASES = [
    ['sforerebbe il budget', { amount: 3500, availableBudget: 1706 }, 'red', 1794],
    ['spesa gestibile', { amount: 100, availableBudget: 1894 }, 'green', 1794],
    ['attenzione', { amount: 1100, availableBudget: 2894 }, 'yellow', 1794],
    ['quasi tutto il budget', { amount: 1704, availableBudget: 1794.4 }, 'red', 1794],
  ]
  for (const [name, input, level, shown] of CASES) {
    const results = LANGS.map((lang) => evaluateAffordability({ ...input, goals, lang }))
    check(`${name}: stesso verdetto (${level}), "${results.map((r, i) => formatCurrencyWhole(shown, LANGS[i])).join('" / "')}" nel testo`,
      results.every((r) => r.level === level) && results.every((r, i) => r.message.includes(formatCurrencyWhole(shown, LANGS[i]))), results.map((r) => r.message).join(' | '))
  }
  check('italiano sotto i 1000 identico a prima: "Ti restano 400 € in questo ciclo"', evaluateAffordability({ amount: 100, availableBudget: 500, goals: [], lang: 'it' }).message === 'Ti restano 400 € in questo ciclo: una spesa gestibile.')
  check('inglese: "You’d still have €400 this cycle"', evaluateAffordability({ amount: 100, availableBudget: 500, goals: [], lang: 'en' }).message === 'You’d still have €400 this cycle: totally manageable.')
}

// =====================================================================
section('Radar: la soglia delle piccole spese viene dal motore')
// =====================================================================
{
  const history = [expense('2026-06-10', 50, 'ristoranti'), expense('2026-07-10', 60, 'ristoranti'), expense('2026-08-10', 55, 'ristoranti')]
  const smalls = Array.from({ length: 10 }, (_, i) => expense(`2026-09-${String(i + 2).padStart(2, '0')}`, 7, 'bar'))
  const expenses = [...history, ...smalls]
  const cards = LANGS.map((lang) => withLanguage(lang, () => {
    const financialData = buildFinancialData({ today: TODAY, monthlyBudget: 1000, expenses, incomes: [], goals: [], cycleStartDay: 1 })
    return buildRadar({ expenses, goals: [], today: TODAY, monthlyBudget: 1000, cycleStartDay: 1, financialData, jokeHistory: [], rng: () => 0, lang })
      .cards.find((card) => card.type === 'small_expenses_add_up')
  }))
  const limit = BEHAVIOR_ENGINE_CONFIG.smallExpenseMaxAmount
  check(`soglia del motore: ${limit} €`, limit === 15)
  check('la scheda c\'è in ogni lingua', cards.every(Boolean))
  check('"sotto i 15 €" / "under €15" / "de menos de 15 €" / "de moins de 15 €"', cards.every((card, i) => card.explanation.includes(formatCurrencyWhole(limit, LANGS[i])))
    && cards[0].explanation.includes('sotto i 15 €') && cards[1].explanation.includes('under €15'), cards.map((card) => card.explanation).join(' | '))
}

// =====================================================================
section('Limite massimo e reazioni alle spese')
// =====================================================================
{
  const limitIn = (lang) => translate(lang, 'expenses.limit', { amount: formatCurrencyWhole(MAX_AMOUNT, lang) })
  check('limite: in italiano identico ad AMOUNT_LIMIT_MESSAGE', limitIn('it') === AMOUNT_LIMIT_MESSAGE && AMOUNT_LIMIT_MESSAGE === 'Importo massimo: 1.000.000 €')
  check('   "Maximum amount: €1,000,000" / "Importe máximo: 1.000.000 €" / "Montant maximum : 1 000 000 €"', limitIn('en') === 'Maximum amount: €1,000,000'
    && limitIn('es') === 'Importe máximo: 1.000.000 €' && limitIn('fr') === `Montant maximum : 1${NBSP}000${NBSP}000 €`)
  const phrases = (lang) => Object.values(REACTION_LIBRARY[lang]).flat()
  check('stesso numero di frasi in ogni lingua (97)', LANGS.every((lang) => phrases(lang).length === 97))
  check('inglese: il simbolo prima della cifra ("€100", "€500", "€1,000"), mai "100 €"', !phrases('en').some((p) => /\d\s?€/.test(p)) && ['€100', '€500', '€1,000'].every((amount) => phrases('en').some((p) => p.includes(amount))))
  check('francese: "1 000 €", mai "1.000 €"', !phrases('fr').some((p) => p.includes('1.000')) && phrases('fr').some((p) => p.includes(`1${NNBSP}000 €`)))
  check('italiano e spagnolo invariati ("100 €", "500 €", "1.000 €")', ['it', 'es'].every((lang) => ['100 €', '500 €', '1.000 €'].every((amount) => phrases(lang).some((p) => p.includes(amount)))))
}

report('Importi nelle frasi (Fase 2A)')
