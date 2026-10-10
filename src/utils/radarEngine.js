import { BEHAVIOR_ENGINE_CONFIG, BEHAVIOR_TYPES, analyzeBehavior } from './behaviorEngine.js'
import { rankInsightsByImportance, computeImportance } from './importantEventSelector.js'
import { translate } from '../i18n/translate.js'
import { normalizeLanguage } from '../i18n/languages.js'
import { generateJokeCandidates } from './humorEngine.js'
import { pickBestJoke } from './jokeEvaluator.js'
import { getInsightTopicKey } from './spendyCoach.js'
import { formatCurrency, formatCurrencyWhole } from './format.js'
import { lastCycles, isWithinRange } from './cycle.js'

// RADAR SPENDY — "quali sono le cose più importanti che Spendy ha
// notato nei miei soldi?"
//
//   BehaviorEngine (cosa è successo)
//        ↓
//   importantEventSelector (quanto conta, 0-100)
//        ↓
//   questo modulo: deduplica, taglia, racconta, propone un'azione
//        ↓
//   RadarScreen (solo rendering)
//
// Non ricalcola NIENTE: non riapre le spese per dedurre variazioni, non
// rifa' la matematica del budget, non decide da solo cosa sia
// importante. Prende gli insight che BehaviorEngine già produce, li
// ordina con il punteggio che importantEventSelector già calcola, e si
// limita a fare le due cose che prima non faceva nessuno: trasformarli
// in schede leggibili e collegarli a un'azione che nell'app esiste
// davvero.
//
// Differenza con la Home: la Home mostra UN solo messaggio, quello scelto
// da getSpendyCoach. Il Radar mostra la classifica — "cos'altro ho
// notato" — ed è per questo che deduplica per argomento invece di
// mostrare quattro schede sulla stessa categoria.

export const RADAR_STATUS = {
  ACTIVE: 'active', // ci sono segnalazioni
  QUIET: 'quiet', // dati sufficienti, ma niente di rilevante
  LEARNING: 'learning', // troppo pochi dati per confrontare qualcosa
}

export const RADAR_CARD_LIMIT = 5

// Quante schede al massimo: oltre questa soglia il Radar smetterebbe di
// essere una classifica e diventerebbe l'elenco delle spese, che è
// esattamente ciò che non deve essere.
const TONES = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  POSITIVE: 'positive',
  GOAL: 'goal',
  NEUTRAL: 'neutral',
}

const TONE_BY_TYPE = {
  [BEHAVIOR_TYPES.BUDGET_EXCEEDED]: TONES.CRITICAL,
  [BEHAVIOR_TYPES.NEGATIVE_STREAK]: TONES.CRITICAL,
  [BEHAVIOR_TYPES.BUDGET_HIGH]: TONES.WARNING,
  [BEHAVIOR_TYPES.BUDGET_RISING]: TONES.WARNING,
  [BEHAVIOR_TYPES.CATEGORY_SPIKE]: TONES.WARNING,
  [BEHAVIOR_TYPES.RECURRING_HIGH]: TONES.WARNING,
  [BEHAVIOR_TYPES.CATEGORY_TREND_UP]: TONES.WARNING,
  [BEHAVIOR_TYPES.AMOUNT_ABOVE_AVERAGE]: TONES.WARNING,
  [BEHAVIOR_TYPES.UNUSUAL_FREQUENCY]: TONES.WARNING,
  [BEHAVIOR_TYPES.SMALL_EXPENSES_ADD_UP]: TONES.WARNING,
  [BEHAVIOR_TYPES.CATEGORY_DROP]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.RECURRING_LOW]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.CATEGORY_TREND_DOWN]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.AMOUNT_BELOW_AVERAGE]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.SAVINGS_VS_USUAL]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.BUDGET_RESPECTED]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.POSITIVE_STREAK]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.GOAL_PROGRESS]: TONES.GOAL,
  [BEHAVIOR_TYPES.UNUSUAL_PURCHASE]: TONES.NEUTRAL,
}

// Lo stato "budget rispettato" NON diventa una scheda del Radar, pur
// restando un insight valido per tutto il resto dell'app: è una
// condizione permanente ("sei sotto il 50%"), non qualcosa che Spendy ha
// NOTATO, ed è già il messaggio che la Home mostra da sola. Tenerlo qui
// riempirebbe il Radar di una scheda sempre presente e sempre uguale —
// proprio la duplicazione della Home che il Radar deve evitare.
const EXCLUDED_FROM_RADAR = new Set([BEHAVIOR_TYPES.BUDGET_RESPECTED])

// Gli insight che NON hanno bisogno di storico per essere veri: sono
// fatti del ciclo corrente (quanto budget resta, quanto ho messo da parte
// per un obiettivo, quante piccole spese ho fatto), non confronti con un
// passato che ancora non esiste. Solo questi possono comparire finché
// Spendy non ha abbastanza cicli alle spalle — tutto il resto sarebbe un
// trend dedotto dal nulla.
const NO_HISTORY_NEEDED = new Set([
  BEHAVIOR_TYPES.BUDGET_EXCEEDED,
  BEHAVIOR_TYPES.BUDGET_HIGH,
  BEHAVIOR_TYPES.BUDGET_RISING,
  BEHAVIOR_TYPES.GOAL_PROGRESS,
  BEHAVIOR_TYPES.SMALL_EXPENSES_ADD_UP,
])

// importantEventSelector assegna un punteggio 0-100 generico, pensato per
// la Home ("qual è la cosa più interessante"), e resta la base anche
// qui — compresa la parte che pesa QUANTO è grande la variazione.
// Il Radar pero' ha una gerarchia sua, dichiarata nel brief: un budget
// sforato viene prima di tutto, anche di uno sforamento piccolo; il
// budget quasi esaurito e un obiettivo vicino vengono prima di una
// variazione di categoria. Questi ritocchi sono esattamente quella
// gerarchia, applicati SOLO al Radar: importantEventSelector non viene
// toccato, quindi la scelta della Home resta identica a prima.
const RADAR_PRIORITY_BOOST = {
  [BEHAVIOR_TYPES.BUDGET_EXCEEDED]: 25,
  [BEHAVIOR_TYPES.BUDGET_HIGH]: 22,
  [BEHAVIOR_TYPES.BUDGET_RISING]: 12,
  [BEHAVIOR_TYPES.GOAL_PROGRESS]: 10,
  [BEHAVIOR_TYPES.NEGATIVE_STREAK]: 8,
}

export function radarPriority(insight) {
  const boost = RADAR_PRIORITY_BOOST[insight.type] ?? 0
  return Math.min(100, computeImportance(insight) + boost)
}

const TONE_DOT = {
  [TONES.CRITICAL]: '🔴',
  [TONES.WARNING]: '🟠',
  [TONES.POSITIVE]: '🟢',
  [TONES.GOAL]: '🎯',
  [TONES.NEUTRAL]: '🔵',
}

// Le uniche destinazioni che l'app offre davvero. Nessuna scheda può
// proporre un'azione che non sia in questa lista: un pulsante che non
// porta da nessuna parte è peggio di nessun pulsante.
//   tab    → setActiveTab(target)
//   modal  → openModal(target)
//   detail → apre il dettaglio della scheda stessa
export const RADAR_ACTIONS = {
  EXPENSES: { id: 'expenses', labelKey: 'radarcard.action.expenses', kind: 'tab', target: 'expenses' },
  ANALYTICS: { id: 'analytics', labelKey: 'radarcard.action.analytics', kind: 'tab', target: 'analytics' },
  CATEGORY: { id: 'category', labelKey: 'radarcard.action.category', kind: 'tab', target: 'analytics' },
  GOALS: { id: 'goals', labelKey: 'radarcard.action.goals', kind: 'tab', target: 'goals' },
  BUDGET: { id: 'budget', labelKey: 'radarcard.action.budget', kind: 'modal', target: 'settings' },
  AFFORDABILITY: { id: 'affordability', labelKey: 'radarcard.action.affordability', kind: 'modal', target: 'affordability' },
  DETAIL: { id: 'detail', labelKey: 'radarcard.action.detail', kind: 'detail', target: null },
}

// L'etichetta di un'azione nella lingua scelta. Le azioni restano gli oggetti
// qui sopra (le schede le confrontano per identità); il testo è a parte.
export const radarActionLabel = (action, lang) => (action ? translate(lang, action.labelKey) : null)

const round = (value) => Math.round(value)
const percentText = (value) => `${value > 0 ? '+' : ''}${round(value)}%`

// --- Narrazione ----------------------------------------------------------
//
// Una funzione per famiglia di insight: titolo, dato principale,
// confronto, spiegazione, consiglio, azione. Tutti i numeri vengono
// dall'insight (o dai suoi `facts`), mai ricalcolati qui. I testi sono nei
// dizionari (radarcard.*), nella lingua di `ctx.lang`; importi e
// percentuali arrivano già formattati, come prima.

const textIn = (ctx) => (key, params) => translate(ctx?.lang, `radarcard.${key}`, params)
// Gli importi nella stessa lingua dei testi (separatori e posizione del simbolo).
const moneyIn = (ctx) => (value) => formatCurrency(value, normalizeLanguage(ctx?.lang))

// Il nome della categoria in minuscolo, come nelle frasi di sempre.
const categoryName = (insight, t) => insight.category?.label?.toLowerCase() ?? t('thiscategory')

function categoryTitle(insight, t) {
  return (insight.category?.label ?? t('title.spending')).toUpperCase()
}

function narrateCategoryHigh(insight, ctx) {
  const t = textIn(ctx)
  const money = moneyIn(ctx)
  return {
    title: categoryTitle(insight, t),
    metric: { value: money(insight.current), label: t('metric.thiscycle') },
    comparison: {
      text: t('comparison.vsaverage', { percent: percentText(insight.changePercent) }),
      direction: 'up',
      baselineText: t('baseline.average', { amount: money(insight.baseline) }),
    },
    explanation: t('explanation.high', { baseline: money(insight.baseline), category: categoryName(insight, t), current: money(insight.current) }),
    advice: t('advice.high'),
    action: RADAR_ACTIONS.CATEGORY,
  }
}

function narrateCategoryLow(insight, ctx) {
  const t = textIn(ctx)
  const money = moneyIn(ctx)
  return {
    title: categoryTitle(insight, t),
    metric: { value: money(insight.current), label: t('metric.thiscycle') },
    comparison: {
      text: t('comparison.vsaverage', { percent: percentText(insight.changePercent) }),
      direction: 'down',
      baselineText: t('baseline.average', { amount: money(insight.baseline) }),
    },
    explanation: t('explanation.low', { baseline: money(insight.baseline), current: money(insight.current), diff: money(Math.abs(insight.changeAmount)) }),
    advice: t('advice.low'),
    action: RADAR_ACTIONS.GOALS,
  }
}

function narrateAmountAboveAverage(insight, ctx) {
  const t = textIn(ctx)
  const money = moneyIn(ctx)
  return {
    title: categoryTitle(insight, t),
    metric: { value: money(insight.current), label: t('metric.single') },
    comparison: {
      text: t('comparison.vstypical', { percent: percentText(insight.changePercent) }),
      direction: 'up',
      baselineText: t('baseline.pertime', { category: categoryName(insight, t), amount: money(insight.baseline) }),
    },
    explanation: t('explanation.above', { current: money(insight.current), baseline: money(insight.baseline) }),
    advice: null,
    action: RADAR_ACTIONS.EXPENSES,
  }
}

function narrateSmallExpenses(insight, ctx) {
  const t = textIn(ctx)
  const money = moneyIn(ctx)
  // "sotto i 15 €": la soglia è quella del motore (BEHAVIOR_ENGINE_CONFIG), scritta nella lingua.
  const smallLimit = formatCurrencyWhole(BEHAVIOR_ENGINE_CONFIG.smallExpenseMaxAmount, normalizeLanguage(ctx?.lang))
  const { count, total, average, categoryLabel } = insight.facts
  return {
    title: t('title.small'),
    metric: { value: t('metric.purchases', { count }), label: money(total) },
    comparison: {
      text: t('comparison.average', { amount: money(average) }),
      direction: 'up',
      baselineText: categoryLabel ? t('baseline.mostly', { category: categoryLabel.toLowerCase() }) : null,
    },
    explanation: categoryLabel
      ? t('explanation.smallcategory', { count, total: money(total), limit: smallLimit, category: categoryLabel.toLowerCase() })
      : t('explanation.small', { count, total: money(total), limit: smallLimit }),
    advice: t('advice.small'),
    action: RADAR_ACTIONS.EXPENSES,
  }
}

function narrateFrequency(insight, ctx) {
  const t = textIn(ctx)
  const up = insight.changeAmount > 0
  return {
    title: categoryTitle(insight, t),
    metric: { value: t('metric.purchases', { count: round(insight.current) }), label: t('metric.thiscycle') },
    comparison: {
      text: t('comparison.vsusual', { change: `${up ? '+' : ''}${round(insight.changeAmount)}` }),
      direction: up ? 'up' : 'down',
      baselineText: t('baseline.usually', { count: round(insight.baseline) }),
    },
    explanation: t('explanation.frequency', { current: round(insight.current), baseline: round(insight.baseline) }),
    advice: null,
    action: RADAR_ACTIONS.EXPENSES,
  }
}

function narrateUnusualPurchase(insight, ctx) {
  const t = textIn(ctx)
  const money = moneyIn(ctx)
  return {
    title: categoryTitle(insight, t),
    metric: { value: money(insight.current), label: t('metric.silence') },
    comparison: null,
    explanation: t('explanation.unusual', { category: categoryName(insight, t) }),
    advice: null,
    action: RADAR_ACTIONS.EXPENSES,
  }
}

function narrateBudget(insight, ctx) {
  const t = textIn(ctx)
  const money = moneyIn(ctx)
  const { budget, spent, remaining, percent } = insight.facts
  const exceeded = insight.type === BEHAVIOR_TYPES.BUDGET_EXCEEDED

  return {
    title: t('title.budget'),
    metric: {
      value: exceeded ? money(Math.abs(remaining)) : money(remaining),
      label: exceeded ? t('metric.over') : t('metric.left'),
    },
    comparison: {
      text: t('comparison.used', { percent: round(percent) }),
      direction: exceeded ? 'up' : 'flat',
      baselineText: t('baseline.spentof', { spent: money(spent), budget: money(budget) }),
    },
    explanation: exceeded
      ? t('explanation.budgetover', { spent: money(spent), budget: money(budget), over: money(Math.abs(remaining)) })
      : t(ctx.cycleEndLabel ? 'explanation.budgetleftuntil' : 'explanation.budgetleft', { percent: round(percent), left: money(remaining), cycleEnd: ctx.cycleEndLabel }),
    advice: exceeded ? t('advice.budgetover') : t('advice.budgetleft'),
    action: exceeded ? RADAR_ACTIONS.BUDGET : RADAR_ACTIONS.AFFORDABILITY,
  }
}

function narrateBudgetRespected(insight, ctx) {
  const t = textIn(ctx)
  const money = moneyIn(ctx)
  const { budget, spent, remaining, percent } = insight.facts
  return {
    title: t('title.budget'),
    metric: { value: money(remaining), label: t('metric.left') },
    comparison: {
      text: t('comparison.usedonly', { percent: round(percent) }),
      direction: 'down',
      baselineText: t('baseline.spentof', { spent: money(spent), budget: money(budget) }),
    },
    explanation: t('explanation.respected', { percent: round(percent) }),
    advice: null,
    action: RADAR_ACTIONS.ANALYTICS,
  }
}

function narrateSavings(insight, ctx) {
  const t = textIn(ctx)
  const money = moneyIn(ctx)
  const saved = Math.abs(insight.changeAmount)
  return {
    title: t('title.savings'),
    metric: { value: money(saved), label: t('metric.lessusual') },
    comparison: {
      text: t('comparison.vsaverage', { percent: percentText(insight.changePercent) }),
      direction: 'down',
      baselineText: t('baseline.atthispoint', { amount: money(insight.baseline) }),
    },
    explanation: t('explanation.savings', { current: money(insight.current), baseline: money(insight.baseline) }),
    advice: t('advice.savings', { amount: money(saved) }),
    action: RADAR_ACTIONS.GOALS,
  }
}

function narrateStreak(insight, ctx) {
  const t = textIn(ctx)
  const positive = insight.type === BEHAVIOR_TYPES.POSITIVE_STREAK
  return {
    title: positive ? t('title.streakgood') : t('title.streakbad'),
    metric: { value: t('metric.cycles', { count: insight.samples }), label: positive ? t('metric.streakgood') : t('metric.streakbad') },
    comparison: {
      text: positive ? t('comparison.streakgood') : t('comparison.streakbad'),
      direction: positive ? 'down' : 'up',
      baselineText: null,
    },
    explanation: positive
      ? t('explanation.streakgood', { count: insight.samples })
      : t('explanation.streakbad', { count: insight.samples }),
    advice: positive ? null : t('advice.streakbad'),
    action: RADAR_ACTIONS.ANALYTICS,
  }
}

function narrateGoalProgress(insight, ctx) {
  const t = textIn(ctx)
  const money = moneyIn(ctx)
  const { goalLabel, saved, target, percent, missing } = insight.facts
  return {
    title: t('title.goal'),
    metric: { value: `${round(percent)}%`, label: goalLabel },
    comparison: {
      text: `${money(saved)} / ${money(target)}`,
      // Non 'up': l'avanzamento di un obiettivo non è né un aumento da
      // temere né un calo da festeggiare, ha un colore tutto suo.
      direction: 'goal',
      baselineText: t('baseline.missing', { amount: money(missing) }),
    },
    explanation: t('explanation.goal', { goal: goalLabel, saved: money(saved), target: money(target) }),
    advice: t('baseline.missing', { amount: money(missing) }),
    action: RADAR_ACTIONS.GOALS,
  }
}

const NARRATORS = {
  [BEHAVIOR_TYPES.RECURRING_HIGH]: narrateCategoryHigh,
  [BEHAVIOR_TYPES.CATEGORY_SPIKE]: narrateCategoryHigh,
  [BEHAVIOR_TYPES.CATEGORY_TREND_UP]: narrateCategoryHigh,
  [BEHAVIOR_TYPES.RECURRING_LOW]: narrateCategoryLow,
  [BEHAVIOR_TYPES.CATEGORY_DROP]: narrateCategoryLow,
  [BEHAVIOR_TYPES.CATEGORY_TREND_DOWN]: narrateCategoryLow,
  [BEHAVIOR_TYPES.AMOUNT_ABOVE_AVERAGE]: narrateAmountAboveAverage,
  [BEHAVIOR_TYPES.AMOUNT_BELOW_AVERAGE]: narrateCategoryLow,
  [BEHAVIOR_TYPES.SMALL_EXPENSES_ADD_UP]: narrateSmallExpenses,
  [BEHAVIOR_TYPES.UNUSUAL_FREQUENCY]: narrateFrequency,
  [BEHAVIOR_TYPES.UNUSUAL_PURCHASE]: narrateUnusualPurchase,
  [BEHAVIOR_TYPES.BUDGET_EXCEEDED]: narrateBudget,
  [BEHAVIOR_TYPES.BUDGET_HIGH]: narrateBudget,
  [BEHAVIOR_TYPES.BUDGET_RISING]: narrateBudget,
  [BEHAVIOR_TYPES.BUDGET_RESPECTED]: narrateBudgetRespected,
  [BEHAVIOR_TYPES.SAVINGS_VS_USUAL]: narrateSavings,
  [BEHAVIOR_TYPES.POSITIVE_STREAK]: narrateStreak,
  [BEHAVIOR_TYPES.NEGATIVE_STREAK]: narrateStreak,
  [BEHAVIOR_TYPES.GOAL_PROGRESS]: narrateGoalProgress,
}

// --- Costruzione delle schede -------------------------------------------

const BUDGET_TYPES = new Set([
  BEHAVIOR_TYPES.BUDGET_EXCEEDED,
  BEHAVIOR_TYPES.BUDGET_HIGH,
  BEHAVIOR_TYPES.BUDGET_RISING,
  BEHAVIOR_TYPES.BUDGET_RESPECTED,
])

// Gli insight di budget nascono con la sola percentuale (vedi
// checkBudget): qui ricevono i quattro numeri che la scheda deve
// mostrare — totale, speso, residuo, percentuale — presi da
// financialData, che li ha già calcolati. Nessuna nuova matematica.
function enrichBudgetInsight(insight, financialData, monthlyBudget) {
  if (!BUDGET_TYPES.has(insight.type)) return insight
  const budget = financialData?.monthlyBudget ?? monthlyBudget ?? 0
  const spent = financialData?.spentThisMonth ?? 0
  const remaining = financialData?.available ?? budget - spent
  const percent = financialData?.spentRatio ?? (budget > 0 ? (spent / budget) * 100 : 0)
  return { ...insight, facts: { ...(insight.facts ?? {}), budget, spent, remaining, percent } }
}

function buildMessage(insight, { lang, jokeHistory, rng }) {
  const key = getInsightTopicKey(insight)
  const history = jokeHistory.filter((entry) => entry.key === key)
  const candidates = generateJokeCandidates(insight, lang)
  const best = pickBestJoke(candidates, insight, history, rng)
  return { key, message: best?.text ?? null, score: best?.score ?? null }
}

export function buildRadarCard(insight, ctx) {
  const narrate = NARRATORS[insight.type]
  if (!narrate) return null

  const narration = narrate(insight, ctx)
  const { key, message, score } = buildMessage(insight, ctx)
  const tone = TONE_BY_TYPE[insight.type] ?? TONES.NEUTRAL

  return {
    id: key,
    type: insight.type,
    tone,
    dot: TONE_DOT[tone],
    emoji: insight.category?.emoji ?? null,
    state: insight.suggestedState,
    priority: radarPriority(insight),
    title: narration.title,
    // Se nessuna battuta supera i controlli di JokeEvaluator, la scheda
    // resta informativa invece di forzare una frase mediocre: il brief
    // chiede esplicitamente che non tutte siano ironiche.
    message: message ?? narration.explanation,
    hasJoke: Boolean(message),
    messageScore: score,
    metric: narration.metric,
    comparison: narration.comparison,
    explanation: narration.explanation,
    advice: narration.advice,
    action: narration.action,
    actionLabel: radarActionLabel(narration.action, ctx?.lang),
    insight,
  }
}

// Quante volte Spendy ha davvero visto l'utente spendere: sotto i cicli
// richiesti da BEHAVIOR_ENGINE_CONFIG non esiste una "media" con cui
// confrontare niente, e inventarla sarebbe il modo più rapido per
// perdere la fiducia dell'utente.
export function countCyclesWithData(expenses, today, cycleStartDay, config = BEHAVIOR_ENGINE_CONFIG) {
  const cycles = lastCycles(today, config.minimumHistoricalSamples + 1, cycleStartDay)
  return cycles.filter((range) => expenses.some((expense) => isWithinRange(expense.date, range))).length
}

const QUIET_MESSAGES = ['one', 'two', 'three', 'four', 'five', 'six'].map((key) => `radarcard.quiet.${key}`)

export function pickQuietMessage(rng = Math.random, lang = 'it') {
  return translate(lang, QUIET_MESSAGES[Math.floor(rng() * QUIET_MESSAGES.length)])
}

// L'unico punto d'ingresso: dati dentro, schede fuori.
export function buildRadar({
  expenses = [],
  goals = [],
  today,
  monthlyBudget = 0,
  cycleStartDay = 1,
  financialData = null,
  jokeHistory = [],
  lang = 'it',
  limit = RADAR_CARD_LIMIT,
  rng = Math.random,
  config = BEHAVIOR_ENGINE_CONFIG,
} = {}) {
  if (!today) return { status: RADAR_STATUS.LEARNING, cards: [], cyclesSeen: 0, cyclesNeeded: config.minimumHistoricalSamples }

  const cyclesSeen = countCyclesWithData(expenses, today, cycleStartDay, config)
  const ctx = { lang, jokeHistory, rng, cycleEndLabel: null }

  const hasHistory = cyclesSeen >= config.minimumHistoricalSamples
  const insights = rankInsightsByImportance(
    analyzeBehavior({ expenses, today, monthlyBudget, financialData, cycleStartDay, goals, config }),
  )
    .filter((insight) => !EXCLUDED_FROM_RADAR.has(insight.type))
    .filter((insight) => hasHistory || NO_HISTORY_NEEDED.has(insight.type))
    // Riordino con la gerarchia del Radar (vedi RADAR_PRIORITY_BOOST).
    // rankInsightsByImportance resta il punto di partenza: qui cambia
    // solo la posizione relativa dei pochi tipi che il brief mette
    // esplicitamente sopra gli altri.
    .sort((a, b) => radarPriority(b) - radarPriority(a))

  // Deduplica per ARGOMENTO, non per tipo: la stessa categoria può
  // far scattare spike + recurring_high + amount_above_average insieme,
  // e tre schede che dicono la stessa cosa con parole diverse sono
  // esattamente il "Radar come lista di spese" da evitare. Vince la
  // prima, cioe' quella con il punteggio di importanza più alto.
  const seen = new Set()
  const cards = []
  for (const raw of insights) {
    const insight = enrichBudgetInsight(raw, financialData, monthlyBudget)
    const key = getInsightTopicKey(insight)
    if (seen.has(key)) continue
    const card = buildRadarCard(insight, ctx)
    if (!card) continue
    seen.add(key)
    cards.push(card)
    if (cards.length >= limit) break
  }

  if (cards.length > 0) {
    return { status: RADAR_STATUS.ACTIVE, cards, cyclesSeen, cyclesNeeded: config.minimumHistoricalSamples }
  }

  // Nessuna scheda. Due motivi molto diversi, che meritano due schermate
  // diverse: "non c'è niente da segnalare" e "non ti conosco ancora
  // abbastanza per poterlo dire".
  const status = cyclesSeen < config.minimumHistoricalSamples ? RADAR_STATUS.LEARNING : RADAR_STATUS.QUIET
  return {
    status,
    cards: [],
    cyclesSeen,
    cyclesNeeded: config.minimumHistoricalSamples,
    quietMessage: status === RADAR_STATUS.QUIET ? pickQuietMessage(rng, lang) : null,
  }
}
