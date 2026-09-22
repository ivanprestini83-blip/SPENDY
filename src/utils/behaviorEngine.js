// BehaviorEngine — the "eyes" of Spendy's insight pipeline:
//
//   TRANSAZIONI → BehaviorEngine → BehaviorInsight[] → HumorEngine → ...
//
// A pure function, no AI: it looks at the raw expenses (plus whatever the
// existing Coach Engine already computed in financialData — see
// budgetCalculations.js) and returns a list of BehaviorInsight objects,
// most-significant first. It never decides what to SAY about them (that's
// HumorEngine) and never decides Spendy's final state (that's still
// getSpendyCoach — see spendyCoach.js's own comment on why). It reuses
// categoryComparison/totalForMonth/totalForPeriod instead of re-deriving
// period-over-period diffs itself, so there is exactly one place that
// logic lives.
//
// "Month" here means one billing cycle (see cycle.js) — `cycleStartDay`
// (1-31, default 1) makes every check below work in terms of "dal 27 al
// 27" instead of assuming the 1st-of-the-month, with zero behavior change
// for anyone who never sets a custom day.
import { getCategory } from '../data/categories.js'
import { categoryComparison, totalForPeriod } from './budgetCalculations.js'
import { lastCycles, isWithinRange } from './cycle.js'

export const BEHAVIOR_TYPES = {
  AMOUNT_ABOVE_AVERAGE: 'amount_above_average',
  AMOUNT_BELOW_AVERAGE: 'amount_below_average',
  CATEGORY_SPIKE: 'category_spike',
  CATEGORY_DROP: 'category_drop',
  RECURRING_HIGH: 'recurring_high',
  RECURRING_LOW: 'recurring_low',
  CATEGORY_TREND_UP: 'category_trend_up',
  CATEGORY_TREND_DOWN: 'category_trend_down',
  BUDGET_EXCEEDED: 'budget_exceeded',
  BUDGET_RESPECTED: 'budget_respected',
  SAVINGS_VS_USUAL: 'savings_vs_usual',
  UNUSUAL_PURCHASE: 'unusual_purchase',
  UNUSUAL_FREQUENCY: 'unusual_frequency',
  POSITIVE_STREAK: 'positive_streak',
  NEGATIVE_STREAK: 'negative_streak',
  BUDGET_HIGH: 'budget_high',
  BUDGET_RISING: 'budget_rising',
  // Aggiunti per il Radar: "tante piccole spese" e "progressione di un
  // obiettivo" sono le due cose che il Radar deve poter segnalare e che
  // nessun check esistente produceva. Stessa identica forma di
  // BehaviorInsight degli altri, quindi HumorEngine, JokeEvaluator,
  // importantEventSelector e getSpendyCoach li trattano senza sapere che
  // sono nuovi.
  SMALL_EXPENSES_ADD_UP: 'small_expenses_add_up',
  GOAL_PROGRESS: 'goal_progress',
}

const HIGH_DIRECTION_TYPES = new Set([
  BEHAVIOR_TYPES.AMOUNT_ABOVE_AVERAGE,
  BEHAVIOR_TYPES.CATEGORY_SPIKE,
  BEHAVIOR_TYPES.RECURRING_HIGH,
  BEHAVIOR_TYPES.CATEGORY_TREND_UP,
])
const LOW_DIRECTION_TYPES = new Set([
  BEHAVIOR_TYPES.AMOUNT_BELOW_AVERAGE,
  BEHAVIOR_TYPES.CATEGORY_DROP,
  BEHAVIOR_TYPES.RECURRING_LOW,
  BEHAVIOR_TYPES.CATEGORY_TREND_DOWN,
])

// Whether a BEHAVIOR_TYPES value reads as "this ran unusually hot" or
// "unusually cold" from Spendy's point of view — shared by HumorEngine
// (to pick a category's high/low joke bank, see humorEngine.js) and by
// getSpendyCoach (to confirm a BehaviorInsight actually points the same
// direction as whatever triggered one of its own tiers, see
// spendyCoach.js). Single source of truth so the two never drift apart.
export function getInsightDirection(type) {
  if (HIGH_DIRECTION_TYPES.has(type)) return 'high'
  if (LOW_DIRECTION_TYPES.has(type)) return 'low'
  return null
}

// Every threshold a product person might want to tune, named so the
// checks below read like the spec that asked for them.
export const BEHAVIOR_ENGINE_CONFIG = {
  variationPercent: 30, // % change vs baseline considered significant
  minimumAbsoluteDifference: 15, // €, ignore trivial differences even if % is big
  minimumHistoricalSamples: 3, // cycles of real history required for recurring/trend checks
  cooldownDays: 7, // don't resurface the same category+type insight more than once per N days

  // "Tante piccole spese": soglie volutamente prudenti, perche' questo
  // check non ha uno storico alle spalle da cui dedurre se il
  // comportamento sia anomalo — si limita a sommare il ciclo corrente.
  // Senza tre condizioni insieme (importo piccolo, molte volte, totale
  // che pesa davvero) segnalerebbe rumore.
  smallExpenseMaxAmount: 15, // €, sopra questa cifra non e' piu' "una piccola spesa"
  smallExpenseMinCount: 8, // quante ne servono prima che valga la pena parlarne
  smallExpenseMinTotal: 60, // €, quanto devono pesare in totale
  goalProgressMinPercent: 25, // sotto questa quota un obiettivo non e' ancora una notizia
}

function mean(nums) {
  return nums.length ? nums.reduce((sum, n) => sum + n, 0) / nums.length : 0
}

function median(nums) {
  if (!nums.length) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Blending mean+median (rather than either alone) is what the brief means
// by "non usare solamente la media... usa anche mediana e storico recente
// per evitare falsi positivi" — a single outlier cycle can't swing the
// baseline as far as it would swing a pure average.
function blendedBaseline(nums) {
  return (mean(nums) + median(nums)) / 2
}

function classifyIntensity(thresholdRatio) {
  if (thresholdRatio >= 2.5) return 'strong'
  if (thresholdRatio >= 1.6) return 'funny'
  return 'light'
}

function categoryTransactionsInRange(expenses, categoryId, range) {
  return expenses.filter((expense) => expense.categoryId === categoryId && isWithinRange(expense.date, range))
}

function categoryTotalInRange(expenses, categoryId, range) {
  return categoryTransactionsInRange(expenses, categoryId, range).reduce((sum, e) => sum + e.amount, 0)
}

// --- Per-category checks -------------------------------------------------

// "spesa ricorrente insolitamente alta/bassa" — the Giugno/Luglio/Agosto
// example: a category's usual cycle total vs this cycle's, backed by
// several real cycles of history (not just the last one).
function checkRecurring(expenses, categoryId, today, cycleStartDay, config) {
  const cycles = lastCycles(today, config.minimumHistoricalSamples + 1, cycleStartDay)
  const currentRange = cycles[cycles.length - 1]
  const totals = cycles.slice(0, -1).map((range) => categoryTotalInRange(expenses, categoryId, range))
  const active = totals.filter((total) => total > 0)
  if (active.length < config.minimumHistoricalSamples) return null

  const current = categoryTotalInRange(expenses, categoryId, currentRange)
  const baseline = blendedBaseline(active)
  if (baseline <= 0) return null

  const changeAmount = current - baseline
  const changePercent = (changeAmount / baseline) * 100
  if (Math.abs(changeAmount) < config.minimumAbsoluteDifference) return null
  if (Math.abs(changePercent) < config.variationPercent) return null

  const ratio = Math.abs(changePercent) / config.variationPercent
  const isHigh = changeAmount > 0
  return {
    type: isHigh ? BEHAVIOR_TYPES.RECURRING_HIGH : BEHAVIOR_TYPES.RECURRING_LOW,
    categoryId,
    category: getCategory(categoryId),
    current,
    baseline,
    changeAmount,
    changePercent,
    intensity: classifyIntensity(ratio),
    // Backed by several cycles of real history — weighted a bit above a
    // single-cycle spike/drop when both fire for the same category.
    significance: Math.abs(changePercent) * 1.2 + (isHigh ? 0 : 5),
    suggestedState: isHigh ? (classifyIntensity(ratio) === 'strong' ? 'concerned' : 'attentive') : 'ironic',
    samples: active.length,
  }
}

// "categoria che cresce/diminuisce mese dopo mese" — a real multi-cycle
// trend, not a one-off jump.
function checkTrend(expenses, categoryId, today, cycleStartDay, config) {
  const cycles = lastCycles(today, config.minimumHistoricalSamples, cycleStartDay)
  const totals = cycles.map((range) => categoryTotalInRange(expenses, categoryId, range))
  if (totals.some((total) => total <= 0)) return null

  const increasing = totals.every((total, i) => i === 0 || total > totals[i - 1])
  const decreasing = totals.every((total, i) => i === 0 || total < totals[i - 1])
  if (!increasing && !decreasing) return null

  const changeAmount = totals[totals.length - 1] - totals[0]
  const changePercent = totals[0] > 0 ? (changeAmount / totals[0]) * 100 : 0
  if (Math.abs(changeAmount) < config.minimumAbsoluteDifference) return null
  if (Math.abs(changePercent) < config.variationPercent) return null

  const ratio = Math.abs(changePercent) / config.variationPercent
  return {
    type: increasing ? BEHAVIOR_TYPES.CATEGORY_TREND_UP : BEHAVIOR_TYPES.CATEGORY_TREND_DOWN,
    categoryId,
    category: getCategory(categoryId),
    current: totals[totals.length - 1],
    baseline: totals[0],
    changeAmount,
    changePercent,
    intensity: classifyIntensity(ratio),
    significance: Math.abs(changePercent) + 3,
    suggestedState: increasing ? 'attentive' : 'ironic',
    samples: totals.length,
    ranges: cycles,
  }
}

// "spesa molto superiore/inferiore alla media" — a single transaction far
// from the category's typical transaction size (not the cycle total).
function checkTransactionAmount(expenses, categoryId, today, cycleStartDay, config) {
  const cycles = lastCycles(today, config.minimumHistoricalSamples + 1, cycleStartDay)
  const currentRange = cycles[cycles.length - 1]
  const historyAmounts = cycles.slice(0, -1)
    .flatMap((range) => categoryTransactionsInRange(expenses, categoryId, range))
    .map((expense) => expense.amount)
  if (historyAmounts.length < config.minimumHistoricalSamples) return null

  const baseline = blendedBaseline(historyAmounts)
  if (baseline <= 0) return null

  const currentTransactions = categoryTransactionsInRange(expenses, categoryId, currentRange)
  const candidates = []
  for (const transaction of currentTransactions) {
    const changeAmount = transaction.amount - baseline
    const changePercent = (changeAmount / baseline) * 100
    if (Math.abs(changeAmount) < config.minimumAbsoluteDifference) continue
    if (Math.abs(changePercent) < config.variationPercent) continue
    const ratio = Math.abs(changePercent) / config.variationPercent
    const isHigh = changeAmount > 0
    candidates.push({
      type: isHigh ? BEHAVIOR_TYPES.AMOUNT_ABOVE_AVERAGE : BEHAVIOR_TYPES.AMOUNT_BELOW_AVERAGE,
      categoryId,
      category: getCategory(categoryId),
      current: transaction.amount,
      baseline,
      changeAmount,
      changePercent,
      intensity: classifyIntensity(ratio),
      significance: Math.abs(changePercent) * 0.8,
      suggestedState: isHigh ? (classifyIntensity(ratio) === 'strong' ? 'concerned' : 'attentive') : 'ironic',
      samples: historyAmounts.length,
      transaction,
    })
  }
  if (candidates.length === 0) return null
  return candidates.reduce((best, cur) => (cur.significance > best.significance ? cur : best))
}

// "acquisto insolito" — spending real money in a category with no recent
// history at all.
function checkUnusualPurchase(expenses, categoryId, today, cycleStartDay, config) {
  const cycles = lastCycles(today, config.minimumHistoricalSamples + 1, cycleStartDay)
  const currentRange = cycles[cycles.length - 1]
  const historyRanges = cycles.slice(0, -1)
  if (historyRanges.length < config.minimumHistoricalSamples) return null
  const hadHistory = historyRanges.some((range) => categoryTotalInRange(expenses, categoryId, range) > 0)
  if (hadHistory) return null

  const current = categoryTotalInRange(expenses, categoryId, currentRange)
  if (current < config.minimumAbsoluteDifference) return null

  return {
    type: BEHAVIOR_TYPES.UNUSUAL_PURCHASE,
    categoryId,
    category: getCategory(categoryId),
    current,
    baseline: 0,
    changeAmount: current,
    changePercent: 100,
    intensity: current >= config.minimumAbsoluteDifference * 3 ? 'strong' : 'funny',
    significance: current * 0.3,
    suggestedState: 'ironic',
    samples: 0,
  }
}

// "frequenza insolita di acquisti" — how many transactions, not how much.
function checkFrequency(expenses, categoryId, today, cycleStartDay, config) {
  const cycles = lastCycles(today, config.minimumHistoricalSamples + 1, cycleStartDay)
  const currentRange = cycles[cycles.length - 1]
  const historyRanges = cycles.slice(0, -1)
  if (historyRanges.length < config.minimumHistoricalSamples) return null

  const counts = historyRanges.map((range) => categoryTransactionsInRange(expenses, categoryId, range).length)
  if (counts.every((count) => count === 0)) return null

  const baseline = blendedBaseline(counts)
  const current = categoryTransactionsInRange(expenses, categoryId, currentRange).length
  const changeAmount = current - baseline
  if (Math.abs(changeAmount) < 2) return null // need at least 2 transactions of difference to matter

  const changePercent = baseline > 0 ? (changeAmount / baseline) * 100 : 100
  if (Math.abs(changePercent) < config.variationPercent) return null

  const ratio = Math.abs(changePercent) / config.variationPercent
  return {
    type: BEHAVIOR_TYPES.UNUSUAL_FREQUENCY,
    categoryId,
    category: getCategory(categoryId),
    current,
    baseline,
    changeAmount,
    changePercent,
    intensity: classifyIntensity(ratio),
    significance: Math.abs(changePercent) * 0.5,
    suggestedState: changeAmount > 0 ? 'attentive' : 'ironic',
    samples: counts.length,
  }
}

// --- Whole-cycle / cross-category checks ---------------------------------

// "aumento/diminuzione improvvisa di una categoria" — reuses
// categoryComparison (budgetCalculations.js) instead of re-diffing cycles.
function checkCategorySpike(expenses, today, cycleStartDay, config) {
  const rows = categoryComparison(expenses, today, cycleStartDay)
  const candidate = rows.find((row) => row.previous > 0 && row.changeAmount > 0)
  if (!candidate) return null
  if (Math.abs(candidate.changeAmount) < config.minimumAbsoluteDifference) return null
  if (Math.abs(candidate.changePercent) < config.variationPercent) return null

  const ratio = Math.abs(candidate.changePercent) / config.variationPercent
  return {
    type: BEHAVIOR_TYPES.CATEGORY_SPIKE,
    categoryId: candidate.categoryId,
    category: candidate.category,
    current: candidate.current,
    baseline: candidate.previous,
    changeAmount: candidate.changeAmount,
    changePercent: candidate.changePercent,
    intensity: classifyIntensity(ratio),
    significance: Math.abs(candidate.changePercent),
    suggestedState: classifyIntensity(ratio) === 'strong' ? 'concerned' : 'attentive',
    samples: 1,
  }
}

function checkCategoryDrop(expenses, today, cycleStartDay, config) {
  const rows = categoryComparison(expenses, today, cycleStartDay)
  const candidate = [...rows].reverse().find((row) => row.previous > 0 && row.current > 0 && row.changeAmount < 0)
  if (!candidate) return null
  if (Math.abs(candidate.changeAmount) < config.minimumAbsoluteDifference) return null
  if (Math.abs(candidate.changePercent) < config.variationPercent) return null

  const ratio = Math.abs(candidate.changePercent) / config.variationPercent
  return {
    type: BEHAVIOR_TYPES.CATEGORY_DROP,
    categoryId: candidate.categoryId,
    category: candidate.category,
    current: candidate.current,
    baseline: candidate.previous,
    changeAmount: candidate.changeAmount,
    changePercent: candidate.changePercent,
    intensity: classifyIntensity(ratio),
    significance: Math.abs(candidate.changePercent),
    suggestedState: 'ironic',
    samples: 1,
  }
}

// "budget superato/rispettato" — a pass-through read of what the Coach
// Engine's own financialData already computed (available/spentRatio), so
// this never re-derives the budget math itself.
function checkBudget(financialData, config) {
  if (!financialData) return null
  const { available = 0, spentRatio = 0 } = financialData

  if (available < 0) {
    return {
      type: BEHAVIOR_TYPES.BUDGET_EXCEEDED,
      categoryId: null,
      category: null,
      current: -available,
      baseline: 0,
      changeAmount: -available,
      changePercent: null,
      intensity: Math.abs(available) > config.minimumAbsoluteDifference * 3 ? 'strong' : 'funny',
      significance: 200,
      suggestedState: 'concerned',
      samples: null,
    }
  }

  if (spentRatio > 0 && spentRatio <= 50) {
    return {
      type: BEHAVIOR_TYPES.BUDGET_RESPECTED,
      categoryId: null,
      category: null,
      current: spentRatio,
      baseline: 100,
      changeAmount: spentRatio - 100,
      changePercent: spentRatio - 100,
      intensity: spentRatio <= 25 ? 'strong' : 'funny',
      significance: 60,
      suggestedState: 'happy',
      samples: null,
    }
  }

  // Not yet over budget, but close — these two give getSpendyCoach's
  // tiers 5/6 (see spendyCoach.js) a real, varied joke pool instead of
  // one fixed sentence for whenever no single category is the obvious
  // cause. Thresholds intentionally match spendyCoach.js's own
  // BUDGET_CONCERNED_AT/BUDGET_ATTENTIVE_AT — this only ever gets a
  // chance to matter when that tier has already decided to fire.
  if (spentRatio >= 85) {
    return {
      type: BEHAVIOR_TYPES.BUDGET_HIGH,
      categoryId: null,
      category: null,
      current: spentRatio,
      baseline: 100,
      changeAmount: spentRatio - 100,
      changePercent: spentRatio - 100,
      intensity: 'strong',
      significance: 150,
      suggestedState: 'concerned',
      samples: null,
    }
  }

  if (spentRatio >= 70) {
    return {
      type: BEHAVIOR_TYPES.BUDGET_RISING,
      categoryId: null,
      category: null,
      current: spentRatio,
      baseline: 100,
      changeAmount: spentRatio - 100,
      changePercent: spentRatio - 100,
      intensity: 'funny',
      significance: 120,
      suggestedState: 'attentive',
      samples: null,
    }
  }

  return null
}

// "risparmio rispetto al comportamento abituale" — whole-cycle total vs
// its own historical baseline (distinct from a single category's).
function checkSavingsVsUsual(expenses, today, cycleStartDay, config) {
  const cycles = lastCycles(today, config.minimumHistoricalSamples + 1, cycleStartDay)
  const currentRange = cycles[cycles.length - 1]
  const totals = cycles.slice(0, -1).map((range) => totalForPeriod(expenses, range))
  const active = totals.filter((total) => total > 0)
  if (active.length < config.minimumHistoricalSamples) return null

  const current = totalForPeriod(expenses, currentRange)
  const baseline = blendedBaseline(active)
  if (baseline <= 0) return null

  const changeAmount = current - baseline
  if (changeAmount >= 0) return null // only interesting when spending LESS than usual overall
  const changePercent = (changeAmount / baseline) * 100
  if (Math.abs(changeAmount) < config.minimumAbsoluteDifference) return null
  if (Math.abs(changePercent) < config.variationPercent) return null

  const ratio = Math.abs(changePercent) / config.variationPercent
  return {
    type: BEHAVIOR_TYPES.SAVINGS_VS_USUAL,
    categoryId: null,
    category: null,
    current,
    baseline,
    changeAmount,
    changePercent,
    intensity: classifyIntensity(ratio),
    significance: Math.abs(changePercent) * 0.9,
    suggestedState: 'happy',
    samples: active.length,
  }
}

// "comportamento positivo/negativo ricorrente" — several cycles in a row
// consistently under or over the attentive/concerned thresholds.
function checkStreaks(expenses, today, cycleStartDay, monthlyBudget, config) {
  if (!monthlyBudget || monthlyBudget <= 0) return null

  const cycles = lastCycles(today, config.minimumHistoricalSamples, cycleStartDay)
  const ratios = cycles.map((range) => (totalForPeriod(expenses, range) / monthlyBudget) * 100)
  if (ratios.some((ratio) => ratio === 0)) return null // require real activity every cycle to call it a streak

  const allLow = ratios.every((ratio) => ratio < 70)
  const allHigh = ratios.every((ratio) => ratio >= 85)
  if (!allLow && !allHigh) return null

  return {
    type: allHigh ? BEHAVIOR_TYPES.NEGATIVE_STREAK : BEHAVIOR_TYPES.POSITIVE_STREAK,
    categoryId: null,
    category: null,
    current: ratios[ratios.length - 1],
    baseline: allHigh ? 85 : 70,
    changeAmount: null,
    changePercent: null,
    intensity: 'funny',
    significance: 40,
    suggestedState: allHigh ? 'concerned' : 'celebrating',
    samples: ratios.length,
    ranges: cycles,
  }
}

// "tante piccole spese" — il caso "€7 non sono niente, €7 diciotto volte
// iniziano ad avere un'opinione diversa". Non guarda lo storico: guarda
// quanto pesano INSIEME le spese piccole del ciclo corrente, cosa che
// nessun altro check vede (checkFrequency conta le transazioni di UNA
// categoria rispetto alla sua media, che e' una domanda diversa).
function checkSmallExpenses(expenses, today, cycleStartDay, config) {
  const currentRange = lastCycles(today, 1, cycleStartDay)[0]
  const small = expenses.filter(
    (expense) => isWithinRange(expense.date, currentRange) && expense.amount > 0 && expense.amount <= config.smallExpenseMaxAmount,
  )
  if (small.length < config.smallExpenseMinCount) return null

  const total = small.reduce((sum, expense) => sum + expense.amount, 0)
  if (total < config.smallExpenseMinTotal) return null

  // La categoria che domina davvero il fenomeno, se ce n'e' una: serve
  // per poter dire "in bar" invece di un generico "in giro", e per dare
  // al Radar un'azione su cui portare l'utente. Sotto meta' delle spese
  // piccole non e' dominante, e l'insight resta generale.
  const counts = new Map()
  for (const expense of small) counts.set(expense.categoryId, (counts.get(expense.categoryId) ?? 0) + 1)
  const [dominantId, dominantCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const dominant = dominantCount >= small.length / 2 ? dominantId : null

  // L'intensita' tiene conto di ENTRAMBE le soglie superate: dodici
  // caffe' da 7 € non sono "quasi niente" solo perche' il totale e'
  // vicino al minimo — sono anche il doppio degli acquisti richiesti, e
  // il fenomeno e' tanto piu' evidente quanto piu' cresce su tutti e due
  // gli assi. Usare solo il totale sottovaluta proprio il caso che
  // questo check esiste per raccontare.
  const ratio = (small.length / config.smallExpenseMinCount) * (total / config.smallExpenseMinTotal)
  return {
    type: BEHAVIOR_TYPES.SMALL_EXPENSES_ADD_UP,
    categoryId: dominant,
    category: dominant ? getCategory(dominant) : null,
    current: total,
    baseline: 0,
    changeAmount: total,
    changePercent: null,
    intensity: classifyIntensity(ratio),
    significance: Math.min(100, total / 2 + small.length * 2),
    suggestedState: total >= config.smallExpenseMinTotal * 3 ? 'attentive' : 'ironic',
    samples: small.length,
    // I numeri esatti che la card del Radar mostrera' e che le frasi
    // possono interpolare. Stanno qui, calcolati una volta sola da chi
    // ha i dati sotto mano, invece di essere ricavati di nuovo dalla UI.
    facts: {
      count: small.length,
      total,
      average: total / small.length,
      categoryLabel: dominant ? getCategory(dominant).label : null,
    },
  }
}

// "obiettivo in avvicinamento" — l'unico check che non guarda le spese
// ma gli obiettivi. Prende quello piu' vicino al traguardo: e' l'unico
// su cui una spinta ha senso adesso.
function checkGoalProgress(goals, config) {
  const candidates = (goals ?? [])
    .filter((goal) => goal && goal.target > 0 && goal.saved > 0 && goal.saved < goal.target)
    .map((goal) => ({ goal, percent: (goal.saved / goal.target) * 100 }))
    .filter((entry) => entry.percent >= config.goalProgressMinPercent)
  if (candidates.length === 0) return null

  const { goal, percent } = candidates.sort((a, b) => b.percent - a.percent)[0]
  const missing = goal.target - goal.saved

  return {
    type: BEHAVIOR_TYPES.GOAL_PROGRESS,
    categoryId: null,
    category: null,
    current: goal.saved,
    baseline: goal.target,
    // I soldi gia' messi da parte, non quelli che mancano: e' il
    // risultato raggiunto a dare peso alla notizia (euroImpactScore in
    // importantEventSelector legge questo campo).
    changeAmount: goal.saved,
    changePercent: percent,
    intensity: percent >= 90 ? 'strong' : percent >= 60 ? 'funny' : 'light',
    // Piu' si e' vicini al traguardo, piu' la cosa merita di essere detta.
    significance: 30 + percent / 2,
    suggestedState: percent >= 90 ? 'celebrating' : 'happy',
    samples: 1,
    goalId: goal.id,
    facts: {
      goalLabel: goal.label,
      saved: goal.saved,
      target: goal.target,
      percent,
      missing,
    },
  }
}

// The one entry point HumorEngine (and anything else) consumes: every
// BehaviorInsight this cycle's data supports, most-significant first.
export function analyzeBehavior({ expenses = [], today, monthlyBudget = 0, financialData = null, cycleStartDay = 1, goals = [], config = BEHAVIOR_ENGINE_CONFIG }) {
  if (!today) return []
  const categoryIds = [...new Set(expenses.map((expense) => expense.categoryId))]
  const insights = []

  for (const categoryId of categoryIds) {
    const perCategoryChecks = [
      checkRecurring(expenses, categoryId, today, cycleStartDay, config),
      checkTrend(expenses, categoryId, today, cycleStartDay, config),
      checkTransactionAmount(expenses, categoryId, today, cycleStartDay, config),
      checkFrequency(expenses, categoryId, today, cycleStartDay, config),
      checkUnusualPurchase(expenses, categoryId, today, cycleStartDay, config),
    ]
    for (const insight of perCategoryChecks) if (insight) insights.push(insight)
  }

  const wholeCycleChecks = [
    checkCategorySpike(expenses, today, cycleStartDay, config),
    checkCategoryDrop(expenses, today, cycleStartDay, config),
    checkBudget(financialData, config),
    checkSavingsVsUsual(expenses, today, cycleStartDay, config),
    checkStreaks(expenses, today, cycleStartDay, monthlyBudget, config),
    checkSmallExpenses(expenses, today, cycleStartDay, config),
    checkGoalProgress(goals, config),
  ]
  for (const insight of wholeCycleChecks) if (insight) insights.push(insight)

  return insights.sort((a, b) => b.significance - a.significance)
}
