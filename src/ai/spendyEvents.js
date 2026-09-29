// EVENT DETECTION — "è successo qualcosa di cui valga la pena parlare?"
//
//   BehaviorEngine (insight) + getSpendyCoach (reason) → QUESTO MODULO → eventi
//
// Non calcola NIENTE di finanziario. Traduce in un vocabolario unico di
// eventi quello che due motori già esistenti hanno rilevato:
//   - gli insight di analyzeBehavior (confronti con la media, budget,
//     streak, obiettivi...), con l'importanza di importantEventSelector;
//   - il `reason` di getSpendyCoach per i casi che solo il coach conosce
//     (obiettivo raggiunto, reazione a una spesa appena registrata).
//
// Un evento esiste solo se uno dei due motori l'ha visto: nessuna soglia
// nuova, nessun evento inventato. "Giornata particolarmente positiva" e
// "nuova spesa ricorrente" NON sono qui di proposito: oggi nessun motore
// li rileva (decisione di Ivan, 2026-09-25 — si aggiungeranno al
// BehaviorEngine in un passaggio separato).
import { BEHAVIOR_TYPES } from '../utils/behaviorEngine.js'
import { computeImportance } from '../utils/importantEventSelector.js'

export const SPENDY_EVENTS = {
  GOAL_REACHED: 'goal_reached',
  GOAL_NEAR: 'goal_near',
  GOAL_PROGRESS: 'goal_progress',
  GOAL_AT_RISK: 'goal_at_risk',
  BIG_EXPENSE: 'big_expense',
  EXPENSE_ABOVE_AVERAGE: 'expense_above_average',
  EXPENSE_BELOW_AVERAGE: 'expense_below_average',
  CATEGORY_ABOVE_USUAL: 'category_above_usual',
  CATEGORY_BELOW_USUAL: 'category_below_usual',
  CATEGORY_TREND_UP: 'category_trend_up',
  CATEGORY_TREND_DOWN: 'category_trend_down',
  UNUSUAL_PURCHASE: 'unusual_purchase',
  FREQUENCY_UP: 'frequency_up',
  FREQUENCY_DOWN: 'frequency_down',
  BUDGET_NEAR_LIMIT: 'budget_near_limit',
  BUDGET_EXCEEDED: 'budget_exceeded',
  SAVINGS_ABOVE_USUAL: 'savings_above_usual',
  POSITIVE_STREAK: 'positive_streak',
  NEGATIVE_STREAK: 'negative_streak',
  SMALL_EXPENSES_ADD_UP: 'small_expenses_add_up',
}

const E = SPENDY_EVENTS

// Un obiettivo oltre questa quota è "vicino", non solo "in corso".
const GOAL_NEAR_AT = 80

// Le reazioni di expenseReactionEngine e il traguardo di un obiettivo
// non passano da un BehaviorInsight, quindi non hanno un punteggio di
// importantEventSelector: questo è il loro, sulla stessa scala 0-100,
// nello stesso ordine della cascata del coach (tier 1 > tier 2).
const COACH_REASON_EVENTS = {
  goal_reached: { id: E.GOAL_REACHED, importance: 100 },
  budget_exceeded: { id: E.BUDGET_EXCEEDED, importance: 95 },
  // Tier 3/4 del coach: quando il coach ha deciso che il tema è il budget,
  // l'evento principale deve dire la stessa cosa — altrimenti un "primo
  // acquisto in una categoria" (più alto per importantEventSelector)
  // scavalcherebbe un budget al 90%, contro la cascata approvata.
  budget_high: { id: E.BUDGET_NEAR_LIMIT, importance: 80 },
  budget_rising: { id: E.BUDGET_NEAR_LIMIT, importance: 68 },
  // Tier 5: il coach ha scelto il consiglio "hai ridotto X, sposta i soldi
  // su un obiettivo" — la categoria è quella di financialData.
  savings_opportunity: { id: E.CATEGORY_BELOW_USUAL, importance: 62 },
  mega_expense_1000: { id: E.BIG_EXPENSE, importance: 92 },
  mega_expense_500: { id: E.BIG_EXPENSE, importance: 85 },
  category_severe: { id: E.CATEGORY_ABOVE_USUAL, importance: 80 },
  goal_damaged: { id: E.GOAL_AT_RISK, importance: 72 },
  expense_over_100: { id: E.BIG_EXPENSE, importance: 70 },
  anomalous_increase: { id: E.CATEGORY_ABOVE_USUAL, importance: 65 },
  repeated_expense: { id: E.FREQUENCY_UP, importance: 58 },
  positive_event: { id: E.CATEGORY_BELOW_USUAL, importance: 55 },
}

function eventIdForInsight(insight) {
  switch (insight.type) {
    case BEHAVIOR_TYPES.AMOUNT_ABOVE_AVERAGE: return E.EXPENSE_ABOVE_AVERAGE
    case BEHAVIOR_TYPES.AMOUNT_BELOW_AVERAGE: return E.EXPENSE_BELOW_AVERAGE
    case BEHAVIOR_TYPES.CATEGORY_SPIKE:
    case BEHAVIOR_TYPES.RECURRING_HIGH: return E.CATEGORY_ABOVE_USUAL
    case BEHAVIOR_TYPES.CATEGORY_DROP:
    case BEHAVIOR_TYPES.RECURRING_LOW: return E.CATEGORY_BELOW_USUAL
    case BEHAVIOR_TYPES.CATEGORY_TREND_UP: return E.CATEGORY_TREND_UP
    case BEHAVIOR_TYPES.CATEGORY_TREND_DOWN: return E.CATEGORY_TREND_DOWN
    case BEHAVIOR_TYPES.UNUSUAL_PURCHASE: return E.UNUSUAL_PURCHASE
    case BEHAVIOR_TYPES.UNUSUAL_FREQUENCY: return insight.changeAmount > 0 ? E.FREQUENCY_UP : E.FREQUENCY_DOWN
    case BEHAVIOR_TYPES.BUDGET_HIGH:
    case BEHAVIOR_TYPES.BUDGET_RISING: return E.BUDGET_NEAR_LIMIT
    case BEHAVIOR_TYPES.BUDGET_EXCEEDED: return E.BUDGET_EXCEEDED
    // "Sei in linea" è una condizione permanente, non qualcosa che Spendy
    // ha NOTATO: come nel Radar (radarEngine, EXCLUDED_FROM_RADAR) non è
    // un evento. La fascia del budget arriva comunque all'AI nel contesto.
    case BEHAVIOR_TYPES.BUDGET_RESPECTED: return null
    case BEHAVIOR_TYPES.SAVINGS_VS_USUAL: return E.SAVINGS_ABOVE_USUAL
    case BEHAVIOR_TYPES.POSITIVE_STREAK: return E.POSITIVE_STREAK
    case BEHAVIOR_TYPES.NEGATIVE_STREAK: return E.NEGATIVE_STREAK
    case BEHAVIOR_TYPES.SMALL_EXPENSES_ADD_UP: return E.SMALL_EXPENSES_ADD_UP
    case BEHAVIOR_TYPES.GOAL_PROGRESS:
      return (insight.facts?.percent ?? 0) >= GOAL_NEAR_AT ? E.GOAL_NEAR : E.GOAL_PROGRESS
    default: return null
  }
}

const UP_EVENTS = new Set([E.CATEGORY_ABOVE_USUAL, E.CATEGORY_TREND_UP, E.EXPENSE_ABOVE_AVERAGE, E.FREQUENCY_UP])
const DOWN_EVENTS = new Set([E.CATEGORY_BELOW_USUAL, E.CATEGORY_TREND_DOWN, E.EXPENSE_BELOW_AVERAGE, E.FREQUENCY_DOWN])

// L'ARGOMENTO di un evento, per deduplicare: "ristoranti su" è una sola
// notizia anche quando spike, trend e spesa singola scattano insieme —
// stessa idea di getInsightTopicKey (spendyCoach.js). Una spesa grossa è
// invece legata alla transazione che l'ha fatta scattare: una seconda
// spesa grossa è un evento nuovo, non una ripetizione.
function topicOf(event) {
  if (event.id === E.BIG_EXPENSE && event.trigger) return `${event.id}:${event.trigger.id}`
  if (event.categoryId && UP_EVENTS.has(event.id)) return `${event.categoryId}:up`
  if (event.categoryId && DOWN_EVENTS.has(event.id)) return `${event.categoryId}:down`
  if (event.goal) return `${event.id}:${event.goal.id ?? event.goal.label}`
  return `${event.id}:${event.categoryId ?? 'general'}`
}

// "La spesa appena registrata" — stessa regola di expenseReactionEngine
// (findTriggerExpense): la più recente datata oggi, `expenses` è
// newest-first. Serve solo a sapere DI QUALE spesa parla la reazione.
function findTriggerExpense(expenses, today) {
  return expenses.find((expense) => expense.date === today) ?? null
}

function eventFromCoach(coach, { expenses, today, goals, financialData }) {
  const mapping = COACH_REASON_EVENTS[coach?.reason]
  if (!mapping) return null

  const event = { id: mapping.id, importance: mapping.importance, source: 'coach', categoryId: null }

  if (coach.reason === 'goal_reached') {
    event.goal = goals.find((goal) => goal.target > 0 && goal.saved >= goal.target) ?? null
    return event.goal ? event : null
  }
  if (['budget_exceeded', 'budget_high', 'budget_rising'].includes(coach.reason)) return event
  if (coach.reason === 'savings_opportunity') {
    event.categoryId = financialData?.topDecreasingCategory?.categoryId ?? null
    return event.categoryId ? event : null
  }

  const trigger = findTriggerExpense(expenses, today)
  if (coach.reason === 'goal_damaged') {
    // expenseReactionEngine mette l'id dell'obiettivo in insight.categoryId
    event.goal = goals.find((goal) => goal.id === coach.insight?.categoryId) ?? null
  } else if (coach.insight?.categoryId) {
    event.categoryId = coach.insight.categoryId
  }
  if (trigger) {
    event.trigger = trigger
    event.categoryId ??= trigger.categoryId
  }
  return event
}

function eventFromInsight(insight, goals) {
  const id = eventIdForInsight(insight)
  if (!id) return null
  const event = {
    id,
    importance: computeImportance(insight),
    source: 'insight',
    categoryId: insight.categoryId ?? null,
    insight,
  }
  if (insight.type === BEHAVIOR_TYPES.GOAL_PROGRESS) {
    event.goal = goals.find((goal) => goal.id === insight.goalId) ?? null
  }
  return event
}

// Tutti gli eventi rilevanti, il più importante per primo, uno per
// argomento. `insights` sono quelli di analyzeBehavior (qualunque ordine);
// `coach` è il risultato di getSpendyCoach già calcolato dalla pagina.
export function detectSpendyEvents({ coach = null, insights = [], expenses = [], today = null, goals = [], financialData = null } = {}) {
  const raw = []
  const fromCoach = eventFromCoach(coach, { expenses, today, goals, financialData })
  if (fromCoach) raw.push(fromCoach)
  for (const insight of insights) {
    const event = eventFromInsight(insight, goals)
    if (event) raw.push(event)
  }

  const byTopic = new Map()
  for (const event of raw) {
    const key = topicOf(event)
    const existing = byTopic.get(key)
    if (!existing) {
      byTopic.set(key, { ...event, key })
      continue
    }
    // Stesso argomento visto da due motori: vince l'importanza più alta,
    // ma i numeri dell'insight (media, variazione) non vanno persi.
    const winner = event.importance > existing.importance ? event : existing
    byTopic.set(key, {
      ...winner,
      key,
      insight: winner.insight ?? existing.insight ?? event.insight,
      goal: winner.goal ?? existing.goal ?? event.goal,
    })
  }

  return [...byTopic.values()].sort((a, b) => b.importance - a.importance)
}
