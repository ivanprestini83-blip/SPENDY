// Fase 4A del multilingue: le frasi di Spendy (coach, battute di HumorLibrary,
// reazioni alle spese), il Radar, "Posso permettermelo?", le notifiche nuove,
// i badge della mascotte e le categorie predefinite in it / en / es / fr.
// `npm test`, senza rete.
//
// La regola di tutta la fase: cambia la LINGUA delle parole, mai quale
// livello del coach scatta, quale battuta/reazione viene scelta, quali schede
// mostra il Radar, quale verdetto dà "Posso permettermelo?" o quando nasce
// una notifica. I testi già salvati (notifiche, storico battute, descrizioni)
// non si riscrivono.

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import { MESSAGES, translate } from './translate.js'
import { humorLibrary } from '../utils/humorLibrary.js'
import * as reactionLibrary from '../data/spendyReactionLibrary.js'
import { getSpendyCoach } from '../utils/spendyCoach.js'
import { evaluateExpenseReaction } from '../utils/expenseReactionEngine.js'
import { buildRadar, pickQuietMessage, RADAR_STATUS } from '../utils/radarEngine.js'
import { evaluateAffordability } from '../utils/affordability.js'
import {
  budgetNotifications, goalNotifications, syncErrorNotifications, staleOutboxNotifications, aiNotification,
} from '../notifications/notificationRules.js'
import { CATEGORIES, INCOME_CATEGORIES, getCategory, getAllCategories, registerCustomCategories, setCategoryLanguageSource } from '../data/categories.js'
import { buildFinancialData, categoryComparison } from '../utils/budgetCalculations.js'
import { installFakeDom } from '../store/fakeDom.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const code = (path) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
const LANGS = ['it', 'en', 'es', 'fr']
const keysOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))
const lookup = (dictionary, key) => key.split('.').reduce((node, part) => node?.[part], dictionary)
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()
const flat = (node) => (Array.isArray(node) ? node : typeof node === 'object' && node ? Object.values(node).flatMap(flat) : typeof node === 'string' ? [node] : [])
const same = (values) => new Set(values.map((v) => JSON.stringify(v))).size === 1

const AREAS = ['coach', 'mascot', 'radarcard', 'affordability', 'notifications', 'categories']
const NEW_KEYS = keysOf(MESSAGES.it).filter((key) => AREAS.includes(key.split('.')[0]))
const ENGINE_FILES = [
  'src/utils/spendyCoach.js', 'src/utils/radarEngine.js', 'src/utils/affordability.js', 'src/notifications/notificationRules.js',
  'src/components/spendy/SpendyStateBadge.jsx', 'src/components/spendy/SpendyCoach.jsx',
]
// Pezzi italiani dei testi nuovi (per cercare quelli rimasti a schermo o nel codice).
const italianFragments = (keys, minLength) => keys.flatMap((key) => lookup(MESSAGES.it, key).split(/\{\w+\}/).map((p) => p.trim())).filter((p) => p.length >= minLength)
const leftoverItalian = (text, lang, keys = NEW_KEYS) => {
  const own = keys.map((key) => lookup(MESSAGES[lang], key)).join('\n')
  return [...new Set(italianFragments(keys, 8).filter((part) => !own.includes(part) && text.includes(part)))]
}

// =====================================================================
section('1. Dizionari: nessuna chiave mancante, parametri identici')
// =====================================================================
check(`chiavi nuove della Fase 4A: ${NEW_KEYS.length}`, NEW_KEYS.length === 150, NEW_KEYS.length)
for (const lang of LANGS) {
  const missing = NEW_KEYS.filter((key) => typeof lookup(MESSAGES[lang], key) !== 'string' || !lookup(MESSAGES[lang], key).trim())
  check(`${lang}: tutte presenti e non vuote`, missing.length === 0, missing.join(', '))
}
{
  const mismatched = NEW_KEYS.filter((key) => LANGS.some((lang) => placeholders(lookup(MESSAGES[lang], key)) !== placeholders(lookup(MESSAGES.it, key))))
  check('stessi segnaposto ({amount}, {category}, {goal}…) in ogni lingua', mismatched.length === 0, mismatched.join(', '))
}
{
  // Chiavi usate: scritte per intero, relative (t('…') con il prefisso del file) o per famiglia.
  const used = new Set()
  const PREFIX = {
    'src/utils/spendyCoach.js': 'coach.insight.', 'src/utils/radarEngine.js': 'radarcard.',
    'src/utils/affordability.js': 'affordability.', 'src/notifications/notificationRules.js': 'notifications.',
  }
  // Il dettaglio di una scheda usa radarcard.importance (stesso paragrafo del consiglio).
  for (const path of [...ENGINE_FILES, 'src/components/modals/RadarDetailModal.jsx']) {
    const source = code(path)
    for (const m of source.matchAll(/'((?:coach|mascot|radarcard|affordability|notifications|categories)\.[a-z.]+)'/g)) used.add(m[1])
    if (PREFIX[path]) for (const m of source.matchAll(/\bt\('([a-z.]+)'/g)) used.add(PREFIX[path] + m[1])
    if (PREFIX[path]) for (const m of source.matchAll(/\)\('([a-z.]+)'\)/g)) used.add(PREFIX[path] + m[1])
    for (const m of source.matchAll(/\? '([a-z]+\.[a-z.]+)' : '([a-z]+\.[a-z.]+)'/g)) { used.add(PREFIX[path] + m[1]); used.add(PREFIX[path] + m[2]) }
  }
  for (const level of ['concerned', 'attentive']) for (const phase of ['early', 'middle', 'finaldays', 'lastday', 'neutral']) used.add(`coach.warning.${level}.${phase}`)
  for (const state of ['happy', 'attentive', 'concerned', 'ironic', 'advisor', 'celebrating']) used.add(`mascot.badge.${state}`)
  for (const key of ['one', 'two', 'three', 'four', 'five', 'six']) used.add(`radarcard.quiet.${key}`)
  for (const category of [...CATEGORIES, ...INCOME_CATEGORIES]) used.add(`categories.${category.id}`)
  for (const key of ['high', 'low', 'above', 'below', 'savings', 'unusual', 'frequency', 'positivestreak', 'negativestreak']) used.add(`coach.insight.${key}`)
  const orphans = NEW_KEYS.filter((key) => !used.has(key))
  const unknown = [...used].filter((key) => AREAS.includes(key.split('.')[0]) && typeof lookup(MESSAGES.it, key) !== 'string')
  check('ogni chiave nuova è usata dagli engine/componenti', orphans.length === 0, orphans.join(', '))
  check('ogni chiave usata esiste', unknown.length === 0, unknown.join(', '))
}

// =====================================================================
section('2. Nessuna frase italiana rimasta scritta negli engine della Fase 4A')
// =====================================================================
for (const path of ENGINE_FILES) {
  const source = code(path)
  const fragments = italianFragments(NEW_KEYS.filter((key) => !key.startsWith('categories.')), 10).filter((part) => source.includes(part))
  const sentences = [...source.matchAll(/['`]([A-ZÀ-Ý][a-zà-ù’']+(?: [a-zà-ù’']+){2,}[^'`]*)['`]/g)].map((m) => m[1])
  check(`${path.split('/').pop()}: nessun testo italiano fisso`, fragments.length === 0 && sentences.length === 0, [...fragments, ...sentences].join(' | '))
}
check('reazioni: l\'italiano è identico (stesse esportazioni, 97 frasi)', reactionLibrary.REACTION_LIBRARY.it.SPESA_100 === reactionLibrary.SPESA_100
  && reactionLibrary.REACTION_LIBRARY.it.RARE_SPECIALI === reactionLibrary.RARE_SPECIALI && reactionLibrary.REACTION_LIBRARY.it.VACATION_ONLY_PHRASE === reactionLibrary.VACATION_ONLY_PHRASE
  && flat(reactionLibrary.REACTION_LIBRARY.it).length === 97)
{
  const it = reactionLibrary.REACTION_LIBRARY.it
  for (const lang of ['en', 'es', 'fr']) {
    const L = reactionLibrary.REACTION_LIBRARY[lang]
    const groups = Object.keys(it).filter((group) => Array.isArray(it[group]) ? L[group]?.length !== it[group].length : typeof L[group] !== 'string')
    const copies = flat(L).filter((text) => flat(it).includes(text) && !['No.', 'Houston, abbiamo un problema.'].includes(text))
    check(`reazioni ${lang}: 97 frasi, stessi gruppi e stesse dimensioni, nessuna frase lasciata in italiano`, groups.length === 0 && flat(L).length === 97 && copies.length === 0, [...groups, ...copies].join(' | '))
    check(`   ${lang}: la frase "vacanza" è nella stessa posizione`, L.OBIETTIVO_DANNEGGIATO.indexOf(L.VACATION_ONLY_PHRASE) === it.OBIETTIVO_DANNEGGIATO.indexOf(it.VACATION_ONLY_PHRASE))
  }
}
check('HumorLibrary non modificata: 307/306/307/307 frasi', flat(humorLibrary.it).length === 307 && flat(humorLibrary.en).length === 306 && flat(humorLibrary.fr).length === 307 && flat(humorLibrary.es).length === 307)
check('Spendy AI: con una lingua diversa dall\'italiano la chiamata non parte (useSpendyVoice)',
  /const italian = useAppStore\(\(state\) => normalizeLanguage\(state\.language\) === 'it'\)/.test(read('src/ai/useSpendyVoice.js'))
  && /const aiEnabled = aiChosen && italian/.test(read('src/ai/useSpendyVoice.js'))
  && !read('supabase/functions/_shared/spendyAIRules.js').includes('i18n'))

// =====================================================================
section('3. Coach: battute di HumorLibrary nella lingua scelta')
// =====================================================================
const TODAY = '2026-09-20'
let seq = 0
const expense = (date, amount, categoryId, id = `e-${seq++}`) => ({ id, date, amount, categoryId, description: categoryId })
const history = [expense('2026-06-10', 50, 'ristoranti'), expense('2026-07-10', 60, 'ristoranti'), expense('2026-08-10', 55, 'ristoranti')]
const spike = [...history, expense('2026-09-10', 220, 'ristoranti')]
const withLanguage = (lang, fn) => { setCategoryLanguageSource(() => lang); try { return fn() } finally { setCategoryLanguageSource(() => 'it') } }
const coachFor = (lang, { expenses = spike, monthlyBudget = 2000, goals = [], jokeHistory = [] } = {}) => withLanguage(lang, () => {
  const financialData = buildFinancialData({ today: TODAY, monthlyBudget, expenses, incomes: [], goals, cycleStartDay: 1 })
  return getSpendyCoach(financialData, { expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals, jokeHistory, financialData, lang })
})
{
  const results = Object.fromEntries(LANGS.map((lang) => [lang, coachFor(lang)]))
  check('stesso livello del coach in ogni lingua (stato, motivo, priorità, insight)', same(LANGS.map((l) => [results[l].state, results[l].reason, results[l].priority, results[l].insight?.type, results[l].insight?.categoryId])),
    LANGS.map((l) => `${l}:${results[l].reason}`).join(' '))
  check('   è davvero una battuta di HumorLibrary (livello 6)', results.it.priority === 6 && flat(humorLibrary.it).includes(results.it.message), results.it.message)
  for (const lang of ['en', 'es', 'fr']) {
    check(`${lang}: la battuta viene da humorLibrary.${lang}`, flat(humorLibrary[lang]).includes(results[lang].message) && !flat(humorLibrary.it).includes(results[lang].message), results[lang].message)
    check(`   ${lang}: la riga secondaria è tradotta, senza segnaposto`, typeof results[lang].secondaryInsightText === 'string' && !/\{\w+\}/.test(results[lang].secondaryInsightText)
      && leftoverItalian(results[lang].secondaryInsightText, lang).length === 0 && results[lang].secondaryInsightText.startsWith(withLanguage(lang, () => getCategory('ristoranti').label)), results[lang].secondaryInsightText)
  }
  check('lingua assente o sconosciuta → italiano', flat(humorLibrary.it).includes(coachFor('xx').message))
}

// =====================================================================
section('4. Coach: le frasi fisse, stesse soglie')
// =====================================================================
{
  const cases = [
    ['nessun guadagno impostato', { monthlyBudget: 0 }, null, () => 'coach.waiting', {}],
    ['obiettivo raggiunto', { monthlyBudget: 1000, goals: [{ id: 'g', label: 'Lisbona', saved: 10, target: 10 }] }, null, () => 'coach.goalreached', { goal: 'Lisbona' }],
    ['budget oltre l\'85% a metà ciclo', { monthlyBudget: 1000, spentRatio: 90, cycle: { phase: 'mid' } }, null, () => 'coach.warning.concerned.middle', {}],
    ['budget oltre l\'85% all\'ultimo giorno', { monthlyBudget: 1000, spentRatio: 90, cycle: { phase: 'last_day' } }, null, () => 'coach.warning.concerned.lastday', {}],
    ['budget oltre il 70% negli ultimi giorni', { monthlyBudget: 1000, spentRatio: 75, cycle: { phase: 'final_days' } }, null, () => 'coach.warning.attentive.finaldays', {}],
    ['budget oltre il 70% a inizio ciclo', { monthlyBudget: 1000, spentRatio: 75, cycle: { phase: 'start' } }, null, () => 'coach.warning.attentive.early', {}],
    ['budget oltre il 70% senza fase', { monthlyBudget: 1000, spentRatio: 75 }, null, () => 'coach.warning.attentive.neutral', {}],
    ['sotto budget', { monthlyBudget: 1000, spentRatio: 10 }, null, () => 'coach.ontrack', {}],
  ]
  for (const [name, financialData, , keyOf, params] of cases) {
    const results = LANGS.map((lang) => getSpendyCoach(financialData, { lang }))
    check(`${name}: stesso stato/motivo, testo nella lingua scelta`, same(results.map((r) => [r.state, r.reason, r.priority]))
      && results.every((r, i) => r.message === translate(LANGS[i], keyOf(), params)), results.map((r) => r.message).join(' | '))
  }
  const drop = (lang) => withLanguage(lang, () => getSpendyCoach({
    monthlyBudget: 1000, spentRatio: 10, goals: [{ id: 'g', label: 'Auto', saved: 100, target: 500 }],
    topDecreasingCategory: { categoryId: 'bar', category: getCategory('bar'), changePercent: -40, changeAmount: -30 },
  }, { lang }))
  const drops = LANGS.map(drop)
  check('spese ridotte: stesso consiglio, {category} {percent} {amount} {goal} sostituiti', same(drops.map((r) => [r.state, r.reason]))
    && drops.every((r, i) => r.message === translate(LANGS[i], 'coach.drop.goal', { category: withLanguage(LANGS[i], () => getCategory('bar').label), percent: 40, amount: 30, goal: 'Auto' })),
  drops.map((r) => r.message).join(' | '))
  check('   in inglese: "You cut your Café spending by 40%. You could move 30 € to "Auto"."', drops[1].message === 'You cut your Café spending by 40%. You could move 30 € to "Auto".')
  check('   in italiano identico a prima', drops[0].message === 'Hai ridotto le spese Bar del 40%. Potresti spostare 30 € verso "Auto".')
}

// =====================================================================
section('5. Reazioni alle spese: stessa scelta, nella lingua scelta')
// =====================================================================
{
  const pool = (lang, group) => reactionLibrary.REACTION_LIBRARY[lang][group]
  const react = (lang, { expenses, monthlyBudget = 2000, goals = [], available = 1000, rng, jokeHistory = [] }) => evaluateExpenseReaction({
    today: TODAY, expenses, monthlyBudget, cycleStartDay: 1, goals, financialData: { available }, jokeHistory, rng, lang,
  })
  const scenarios = [
    ['spesa oltre 100 € (SPESA_100 + SPESA_INUTILE)', { expenses: [expense(TODAY, 150, 'casa')], rng: () => 0.5 }, (lang) => [...pool(lang, 'SPESA_100'), ...pool(lang, 'SPESA_INUTILE')][10]],
    ['spesa enorme 1.000 €', { expenses: [expense(TODAY, 1200, 'casa')], rng: () => 0.5 }, (lang) => pool(lang, 'SPESA_ENORME_1000')[3]],
    ['frase rara (probabilità bassa)', { expenses: [expense(TODAY, 1200, 'casa')], rng: () => 0.01 }, (lang) => pool(lang, 'RARE_SPECIALI')[0]],
    ['budget superato', { expenses: [], monthlyBudget: 100, available: -10, rng: () => 0.5 }, (lang) => pool(lang, 'BUDGET_SUPERATO')[4]],
    ['obiettivo danneggiato (non vacanza: la frase vacanza esclusa)', { expenses: [expense(TODAY, 150, 'casa')], goals: [{ id: 'g', label: 'Auto', saved: 0, target: 1000 }], rng: () => 0.5 },
      (lang) => pool(lang, 'OBIETTIVO_DANNEGGIATO').filter((t) => t !== pool(lang, 'VACATION_ONLY_PHRASE'))[2]],
    ['obiettivo danneggiato (vacanza)', { expenses: [expense(TODAY, 150, 'casa')], goals: [{ id: 'g', label: 'Vacanza al mare', saved: 0, target: 1000 }], rng: () => 0.5 },
      (lang) => pool(lang, 'OBIETTIVO_DANNEGGIATO')[3]],
  ]
  for (const [name, args, expected] of scenarios) {
    const results = LANGS.map((lang) => react(lang, args))
    check(`${name}: stessa reazione (stato, motivo) e stessa frase tradotta`, same(results.map((r) => [r.state, r.reason, r.insight.type]))
      && results.every((r, i) => r.message === expected(LANGS[i])), results.map((r) => r.message).join(' | '))
  }
  // Lo storico anti-ripetizione funziona anche in inglese (stesso testo, stessa lingua).
  const enPool = [...pool('en', 'SPESA_100'), ...pool('en', 'SPESA_INUTILE')]
  const repeat = react('en', { expenses: [expense(TODAY, 150, 'casa')], rng: () => 0.5, jokeHistory: [{ key: 'general:expense_over_100', text: enPool[10], shownAt: TODAY }] })
  check('en: una frase appena mostrata non si ripete (storico in inglese)', repeat.message !== enPool[10] && enPool.includes(repeat.message), repeat.message)
  // Senza rng iniettato (come nell'app): una sola reazione per evento, tradotta al cambio lingua.
  const event = [expense(TODAY, 175, 'casa', 'evento-cambio-lingua')]
  const first = react('it', { expenses: event })
  const itPool = [...pool('it', 'SPESA_100'), ...pool('it', 'SPESA_INUTILE')]
  const index = itPool.indexOf(first.message)
  const translated = LANGS.map((lang) => react(lang, { expenses: event }))
  check('stesso evento dopo un cambio lingua: la STESSA reazione, tradotta (nessuna nuova estrazione)', index >= 0
    && translated.every((r, i) => r.message === [...pool(LANGS[i], 'SPESA_100'), ...pool(LANGS[i], 'SPESA_INUTILE')][index]), translated.map((r) => r.message).join(' | '))
  check('   e tornando all\'italiano, la frase di prima', react('it', { expenses: event }).message === first.message)
}

// =====================================================================
section('6. Radar: stesse schede, testi nella lingua scelta')
// =====================================================================
{
  const smalls = Array.from({ length: 10 }, (_, i) => expense(`2026-09-${String(i + 2).padStart(2, '0')}`, 7, 'bar'))
  const scenarios = [
    ['categoria in aumento + obiettivo', { expenses: spike, monthlyBudget: 1000, goals: [{ id: 'g-1', label: 'Vacanze', emoji: '🎯', saved: 720, target: 1000 }] }],
    ['tante piccole spese', { expenses: [...history, ...smalls], monthlyBudget: 1000 }],
    ['budget quasi esaurito', { expenses: [...history, expense('2026-09-12', 860, 'spesa')], monthlyBudget: 1000 }],
    ['budget superato', { expenses: [...history, expense('2026-09-12', 1300, 'spesa')], monthlyBudget: 1000 }],
  ]
  const TEXT_FIELDS = (card) => [card.title, card.metric?.label, card.comparison?.text, card.comparison?.baselineText, card.explanation, card.advice, card.actionLabel].filter((v) => typeof v === 'string')
  for (const [name, { expenses, monthlyBudget, goals = [] }] of scenarios) {
    const radars = LANGS.map((lang) => withLanguage(lang, () => {
      const financialData = buildFinancialData({ today: TODAY, monthlyBudget, expenses, incomes: [], goals, cycleStartDay: 1 })
      return buildRadar({ expenses, goals, today: TODAY, monthlyBudget, cycleStartDay: 1, financialData, jokeHistory: [], rng: () => 0, lang })
    }))
    // Il valore principale a volte contiene una parola ("10 acquisti"): si confrontano i numeri.
    const numbers = (value) => String(value ?? '').match(/[\d.,]+/g)?.join(' ') ?? ''
    const shape = (radar) => radar.cards.map((c) => [c.id, c.type, c.tone, c.priority, numbers(c.metric?.value), c.comparison?.direction, c.action])
    check(`${name}: stesse schede, stesso ordine, stessi valori e azioni in ogni lingua (${radars[0].cards.length})`, radars[0].cards.length > 0 && same(radars.map(shape))
      && radars.every((r) => r.cards.every((c, i) => c.action === radars[0].cards[i].action)), radars.map((r) => r.cards.map((c) => c.type).join(',')).join(' | '))
    radars.forEach((radar, i) => {
      const lang = LANGS[i]
      const texts = radar.cards.flatMap(TEXT_FIELDS)
      check(`   ${lang}: testi tradotti, etichette delle azioni, nessun segnaposto`, texts.every((t) => !/\{\w+\}/.test(t))
        && radar.cards.every((c) => c.actionLabel === translate(lang, c.action.labelKey))
        && (lang === 'it' || leftoverItalian(texts.join('\n'), lang).length === 0),
      lang === 'it' ? '' : leftoverItalian(texts.join('\n'), lang).join(' | '))
    })
  }
  const en = withLanguage('en', () => {
    const financialData = buildFinancialData({ today: TODAY, monthlyBudget: 1000, expenses: spike, incomes: [], goals: [], cycleStartDay: 1 })
    return buildRadar({ expenses: spike, goals: [], today: TODAY, monthlyBudget: 1000, cycleStartDay: 1, financialData, jokeHistory: [], rng: () => 0, lang: 'en' })
  })
  const restaurant = en.cards.find((c) => c.insight?.categoryId === 'ristoranti')
  check('en: titolo della scheda = categoria tradotta in maiuscolo ("RESTAURANT"), confronto in inglese', restaurant?.title === 'RESTAURANT' && /vs your average$/.test(restaurant.comparison.text), `${restaurant?.title} / ${restaurant?.comparison?.text}`)
  const quiet = (lang) => [0, 1, 2, 3, 4, 5].map((i) => pickQuietMessage(() => i / 6 + 0.01, lang))
  check('frasi "tutto tranquillo": le 6 frasi, nella lingua scelta', LANGS.every((lang) => quiet(lang).join('|') === ['one', 'two', 'three', 'four', 'five', 'six'].map((k) => translate(lang, `radarcard.quiet.${k}`)).join('|'))
    && quiet('it')[0] === 'Ho controllato tutto. Per ora non vedo niente di preoccupante.')
  const learning = buildRadar({ expenses: [], today: TODAY, lang: 'fr' })
  check('Radar "sto imparando": nessun testo dall\'engine, stato invariato', learning.status === RADAR_STATUS.LEARNING && learning.cards.length === 0)
}

// =====================================================================
section('7. Posso permettermelo? — stessi verdetti, nella lingua scelta')
// =====================================================================
{
  const goals = [{ id: 'g', label: 'Lisbona', saved: 100, target: 1000 }]
  const cases = [
    ['nessun importo', { amount: NaN, availableBudget: 500, goals: [] }, 'yellow', (t) => [t('noamount.title'), t('noamount.message')]],
    ['sforerebbe il budget', { amount: 700, availableBudget: 500, goals }, 'red', (t) => [t('wait'), `${t('over', { amount: 200 })} ${t('goalhint', { goal: 'Lisbona' })}`]],
    ['spesa gestibile', { amount: 100, availableBudget: 500, goals }, 'green', (t) => [t('ok.title'), t('ok.message', { amount: 400 })]],
    ['attenzione', { amount: 300, availableBudget: 500, goals }, 'yellow', (t) => [t('careful.title'), `${t('careful.message', { amount: 200 })} ${t('goalhint', { goal: 'Lisbona' })}`]],
    ['quasi tutto il budget', { amount: 450, availableBudget: 500, goals: [] }, 'red', (t) => [t('wait'), t('most', { amount: 500 })]],
  ]
  for (const [name, input, level, expected] of cases) {
    const results = LANGS.map((lang) => evaluateAffordability({ ...input, lang }))
    check(`${name}: stesso verdetto (${level}), testi nella lingua scelta`, results.every((r) => r.level === level)
      && results.every((r, i) => {
        const [title, message] = expected((key, params) => translate(LANGS[i], `affordability.${key}`, params))
        return r.title === title && r.message === message
      }), results.map((r) => `${r.title} — ${r.message}`).join(' | '))
  }
  check('italiano identico a prima', evaluateAffordability({ amount: 700, availableBudget: 500, goals }).message === 'Con questa spesa sforeresti il budget di 200 €. Occhio anche a "Lisbona": ci stai ancora lavorando.')
  check('senza lingua → italiano', evaluateAffordability({ amount: 100, availableBudget: 500, goals: [] }).title === 'Puoi permettertelo')
}

// =====================================================================
section('8. Notifiche nuove nella lingua scelta (regole)')
// =====================================================================
{
  const salary = { id: 'i-1', categoryId: 'stipendio', amount: 1000, date: '2026-09-01', description: 'Stipendio' }
  const base = (lang, expenses, goals = []) => ({ today: TODAY, cycleStartDay: 1, incomes: [salary], expenses, goals, language: lang })
  for (const lang of LANGS) {
    const tr = (key, params) => translate(lang, `notifications.${key}`, params)
    const near = budgetNotifications(base(lang, [expense(TODAY, 500, 'spesa')]), base(lang, [expense(TODAY, 500, 'spesa'), expense(TODAY, 420, 'casa')]))
    const over = budgetNotifications(base(lang, [expense(TODAY, 500, 'spesa')]), base(lang, [expense(TODAY, 500, 'spesa'), expense(TODAY, 600, 'casa')]))
    const goal = goalNotifications(base(lang, [], [{ id: 'g', label: '', saved: 40, target: 100 }]), base(lang, [], [{ id: 'g', label: '', saved: 55, target: 100 }]))
    const syncError = syncErrorNotifications({ sync: { status: 'idle' } }, { scopeId: 'u:x', sync: { userId: 'x', status: 'error' }, language: lang })
    const stale = staleOutboxNotifications({ scopeId: 'u:x', sync: { userId: 'x', outbox: [{ updatedAt: '2026-09-01T10:00:00.000Z' }] }, language: lang }, new Date('2026-09-20T10:00:00.000Z'))
    const ai = aiNotification({ result: { ok: true, response: { shouldShow: true, message: 'Ciao' } }, meta: { eventKey: 'x', importance: 100 }, today: TODAY, lang })
    check(`${lang}: budget 90% / superato, obiettivo 50%, sync, AI — testi ed etichette nella lingua scelta`,
      near[0]?.message === tr('budget.near') && near[0].title === tr('budget.title') && near[0].action.label === tr('action.home')
      && over[0]?.message === tr('budget.over')
      && goal[0]?.title === tr('goal.fallback') && goal[0].message === tr('goal.half') && goal[0].action.label === translate(lang, 'radarcard.action.goals')
      && syncError[0]?.message === tr('sync.error') && syncError[0].action.label === tr('action.settings')
      && stale[0]?.message === tr('sync.stale')
      && ai?.action.label === tr('action.spendy') && ai.message === 'Ciao',
    [near[0]?.message, goal[0]?.message, syncError[0]?.message].join(' | '))
    check(`   ${lang}: stessi eventi e stesse chiavi (eventKey) di prima`, near[0]?.eventKey === 'budget:near:2026-09-01' && over[0]?.eventKey === 'budget:over:2026-09-01' && goal[0]?.eventKey === 'goal:g:50')
  }
  check('stato senza lingua → italiano, testo identico a prima', budgetNotifications({ ...base(undefined, [expense(TODAY, 500, 'spesa')]) }, { ...base(undefined, [expense(TODAY, 500, 'spesa'), expense(TODAY, 600, 'casa')]) })[0]?.message === 'Budget mensile superato.')
}

// =====================================================================
section('9. Categorie predefinite')
// =====================================================================
const IDS = ['casa', 'carburante', 'spesa', 'ristoranti', 'bar', 'farmacia', 'salute', 'trasporti', 'shopping', 'tecnologia', 'abbonamenti', 'svago', 'viaggi', 'sport', 'abbigliamento', 'istruzione', 'animali', 'altro']
const INCOME_IDS = ['stipendio', 'extra', 'investimenti', 'regalo', 'rimborso']
const ITALIAN = ['Casa', 'Carburante', 'Spesa', 'Ristorante', 'Bar', 'Farmacia', 'Salute', 'Trasporti', 'Shopping', 'Tecnologia', 'Bollette', 'Svago', 'Viaggi', 'Sport', 'Abbigliamento', 'Istruzione', 'Animali', 'Altro', 'Stipendio', 'Extra', 'Investimenti', 'Regalo', 'Rimborso']
{
  const all = [...CATEGORIES, ...INCOME_CATEGORIES]
  check('23 categorie, stessi id e stesso ordine di prima', CATEGORIES.map((c) => c.id).join() === IDS.join() && INCOME_CATEGORIES.map((c) => c.id).join() === INCOME_IDS.join())
  check('italiano (default): nomi identici a prima', all.map((c) => c.label).join() === ITALIAN.join())
  check('   e l\'oggetto serializzato è identico a prima', JSON.stringify(CATEGORIES[0]) === '{"id":"casa","label":"Casa","emoji":"🏠","subcategories":[]}')
  for (const lang of ['en', 'es', 'fr']) {
    const labels = withLanguage(lang, () => all.map((c) => c.label))
    check(`${lang}: ogni nome è quello del dizionario`, labels.every((label, i) => label === translate(lang, `categories.${all[i].id}`)), labels.join(', '))
  }
  check('esempi: en Restaurant / es Alimentos / fr Logement', withLanguage('en', () => getCategory('ristoranti').label) === 'Restaurant'
    && withLanguage('es', () => getCategory('spesa').label) === 'Alimentos' && withLanguage('fr', () => getCategory('casa').label) === 'Logement')
  registerCustomCategories([{ id: 'c-palestra', label: 'Palestra', emoji: '🏋️', type: 'expense' }])
  check('categoria creata dall\'utente: invariata in ogni lingua', LANGS.every((lang) => withLanguage(lang, () => getCategory('c-palestra').label) === 'Palestra')
    && withLanguage('en', () => getAllCategories().find((c) => c.id === 'c-palestra').label) === 'Palestra')
  check('id sconosciuto → "altro", nella lingua scelta', withLanguage('es', () => getCategory('zzz').id === 'altro' && getCategory('zzz').label === 'Otros'))
  registerCustomCategories([])
  const expenses = [...spike, expense('2026-09-12', 30, 'bar'), expense('2026-08-12', 25, 'bar')]
  const totals = (lang) => withLanguage(lang, () => JSON.stringify(categoryComparison(expenses, TODAY, 1).map((row) => [row.categoryId, row.current, row.previous, row.changePercent])))
  check('totali e confronti per categoria identici in ogni lingua (contano gli id)', same(LANGS.map(totals)))
}

// =====================================================================
section('10. L\'app vera: Home, Spese, notifiche e AI cambiando lingua senza reload')
// =====================================================================
const dom = installFakeDom(new Map())
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-i18n-spendy-test-vite'),
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
const text = (node) => (typeof node?.data === 'string' ? node.data : (node?.childNodes ?? []).map(text).join(''))
const cls = (node) => node.attributes?.get?.('class') ?? ''
const DATA_FIELDS = ['monthlyBudget', 'cycleStartDay', 'expenses', 'incomes', 'customCategories', 'goals', 'emergencyFundSaved', 'spendyAIEnabled']
const dataOf = (state) => JSON.stringify(Object.fromEntries(DATA_FIELDS.map((field) => [field, state[field]])))

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const LIB = (await server.ssrLoadModule('/src/data/spendyReactionLibrary.js')).REACTION_LIBRARY
  const S = useAppStore.getState
  const caught = []
  const container = dom.createContainer()
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const hero = () => text(nodes(container).find((n) => cls(n) === 'spendy-hero__message'))

  S().switchScope('u:utente-fase-4a')
  await act(() => root.render(h(App)))
  const today = S().today
  const [y, m] = today.split('-').map(Number)
  const cycleStart = `${y}-${String(m).padStart(2, '0')}-01`
  await act(() => {
    S().addSalary({ amount: 2000, date: cycleStart })
    S().addExpense({ amount: 150, categoryId: 'casa', description: 'affitto box', date: today })
  })
  // Nell'app la scelta è casuale: di solito il gruppo "oltre 100 €", a volte
  // (8%) una frase rara. Si cerca dove sta la frase italiana mostrata.
  const GROUPS = { over100: (lang) => [...LIB[lang].SPESA_100, ...LIB[lang].SPESA_INUTILE], rare: (lang) => LIB[lang].RARE_SPECIALI }
  const itMessage = hero()
  const [group, index] = Object.entries(GROUPS).map(([name, pool]) => [name, pool('it').indexOf(itMessage)]).find(([, i]) => i >= 0) ?? [null, -1]
  check('Home: Spendy reagisce alla spesa di oggi (oltre 100 €) in italiano', index >= 0, itMessage)
  const before = dataOf(S())
  for (const lang of ['en', 'es', 'fr', 'it']) {
    await act(() => S().setLanguage(lang))
    check(`${lang}: la stessa reazione, tradotta, subito (senza reload)`, group !== null && hero() === GROUPS[group](lang)[index], hero())
  }
  // Spese: il nome della categoria predefinita segue la lingua; i dati no.
  await act(() => S().setLanguage('fr'))
  await act(() => S().openExpenses('today'))
  const meta = () => nodes(container).filter((n) => cls(n) === 'expenses-page__item-meta').map(text).join(' | ')
  check('Spese in francese: categoria "Logement", descrizione e importo invariati', meta().startsWith('Logement') && text(container).includes('affitto box') && text(container).includes('150,00 €'), meta())
  await act(() => S().setLanguage('it'))
  check('   in italiano: di nuovo "Casa"', meta().startsWith('Casa'), meta())
  check('la spesa salvata ha solo l\'id della categoria (nessun nome tradotto nei dati)', S().expenses.every((e) => !('label' in e) && e.categoryId === 'casa'))
  // Notifiche nuove: nella lingua del momento in cui nascono; quelle salvate restano com'erano.
  await act(() => S().setLanguage('en'))
  await act(() => S().addExpense({ amount: 1700, categoryId: 'spesa', description: 'spesa grande', date: today }))
  const newest = S().notifications.find((n) => n.type === 'budget')
  check('nuova notifica (budget) creata mentre l\'app è in inglese: in inglese', newest?.message === 'Heads up: you’ve used 90% of your budget.' || newest?.message === 'Monthly budget exceeded.', newest?.message)
  const saved = JSON.stringify(S().notifications)
  for (const lang of ['fr', 'es', 'it']) await act(() => S().setLanguage(lang))
  check('   cambiando lingua le notifiche salvate NON vengono riscritte', JSON.stringify(S().notifications) === saved)
  // Spendy AI: preferenza attiva, app in inglese → frase locale tradotta, nessuna chiamata; la preferenza resta.
  await act(() => { useAppStore.setState({ spendyAIEnabled: true }); S().setLanguage('en'); S().setActiveTab('home') })
  check('AI attiva + inglese: Spendy usa la frase locale in inglese, la preferenza resta salvata', LIB.en.SPESA_100.concat(LIB.en.SPESA_INUTILE, LIB.en.BUDGET_SUPERATO, LIB.en.SPESA_ENORME_1000, LIB.en.SPESA_ENORME_500, LIB.en.RARE_SPECIALI).includes(hero()) && S().spendyAIEnabled === true, hero())
  // Impostazioni → Spendy AI: in inglese la scheda dice chiaramente che l'AI parla solo italiano.
  await act(() => S().openModal('settings'))
  const aiNote = () => text(container).includes(translate('en', 'settings.ai.italianonly'))
  check('Impostazioni (inglese, AI attiva): nota "Spendy AI only speaks Italian"', aiNote())
  await act(() => S().setLanguage('it'))
  check('   in italiano nessuna nota (l\'AI funziona come prima)', !text(container).includes(translate('it', 'settings.ai.italianonly')))
  await act(() => S().closeModal())
  await act(() => { useAppStore.setState({ spendyAIEnabled: false }); S().setLanguage('it') })
  // Posso permettermelo? (schermata vera): il verdetto nella lingua scelta al momento della domanda.
  const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
  for (const lang of ['es', 'it']) {
    await act(() => { S().setLanguage(lang); S().openModal('affordability') })
    const screen = () => nodes(container).find((n) => cls(n) === 'affordability-screen')
    const amountInput = nodes(screen()).find((n) => n.localName === 'input')
    await act(() => propsOf(amountInput).onChange({ target: { value: '999999' } }))
    await act(() => propsOf(nodes(screen()).find((n) => cls(n) === 'affordability-screen__cta')).onClick({}))
    const title = text(nodes(screen()).find((n) => cls(n) === 'affordability-screen__result-title'))
    check(`Posso permettermelo? in ${lang}: verdetto "${translate(lang, 'affordability.wait')}"`, title === translate(lang, 'affordability.wait'), title)
    await act(() => S().closeModal())
  }
  check('dati invariati da tutti i cambi di lingua (a parte le spese aggiunte dal test)', JSON.stringify(JSON.parse(dataOf(S())).incomes) === JSON.stringify(JSON.parse(before).incomes))
  check('nessun errore di rendering', caught.length === 0, caught[0]?.message)
  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Multilingue — Fase 4A (frasi di Spendy, Radar, notifiche, categorie)')
