// FINANCIAL CONTEXT BUILDER — il riassunto che l'AI riceve al posto dei dati.
//
//   eventi (spendyEvents) + numeri già calcolati (financialData) → contesto
//
// Principio: l'AI vede solo ciò che le serve per UNA frase sull'evento
// principale. Mai l'elenco delle spese, mai descrizioni/note, date, id,
// entrate nel dettaglio, email o dati di sincronizzazione. Gli importi
// sono arrotondati all'euro. Un valore che non esiste non viene messo
// (niente zeri "di cortesia"): se il contesto non contiene la media
// abituale, l'AI non può citarla — e il guard lo verifica.
//
// Nessun calcolo finanziario nuovo: tutto viene da financialData
// (buildFinancialData) o dagli insight di BehaviorEngine dentro gli
// eventi. Le sole operazioni qui sono arrotondare, contare i giorni al
// termine del ciclo e dividere il disponibile per quei giorni.
import { getCategory } from '../data/categories.js'
import { getCycleTiming } from '../utils/cycle.js'
import { todaysExpenses } from '../utils/budgetCalculations.js'
import { normalizeSpendyLocale } from '../../supabase/functions/_shared/spendyAIRules.js'
import { SPENDY_EVENTS } from './spendyEvents.js'

export const SPENDY_AI_CONTEXT_VERSION = 1

// Soglie del coach (spendyCoach.js: 70 attentive, 85 concerned) — la
// fascia serve all'AI per scegliere il tono e all'impronta per capire
// quando la situazione è cambiata davvero.
export function budgetBand({ available, spentPercent }) {
  if (available < 0) return 'exceeded'
  if (spentPercent >= 85) return 'high'
  if (spentPercent >= 70) return 'warning'
  return 'ok'
}

const round = (value) => (Number.isFinite(value) ? Math.round(value) : null)

function categoryLabel(categoryId, insight) {
  if (insight?.category?.label) return insight.category.label
  if (!categoryId) return null
  return getCategory(categoryId)?.label ?? null
}

// Dell'obiettivo passa solo ciò che serve a una frase: il nome, a che
// punto è, quanto manca. Non quanto c'è da parte né il totale.
function goalSummary(goal) {
  if (!goal || !(goal.target > 0)) return null
  return {
    label: goal.label,
    percent: round((goal.saved / goal.target) * 100),
    missing: round(Math.max(0, goal.target - goal.saved)),
  }
}

// L'obiettivo più vicino al traguardo — stesso criterio di spendyCoach
// (findClosestOpenGoal). Solo per gli eventi in cui ha senso proporre
// dove spostare dei soldi risparmiati.
function closestOpenGoal(goals) {
  const open = goals.filter((goal) => goal.target > 0 && goal.saved < goal.target)
  if (open.length === 0) return null
  return [...open].sort((a, b) => (a.target - a.saved) - (b.target - b.saved))[0]
}

const SAVING_EVENTS = new Set([
  SPENDY_EVENTS.SAVINGS_ABOVE_USUAL,
  SPENDY_EVENTS.CATEGORY_BELOW_USUAL,
  SPENDY_EVENTS.CATEGORY_TREND_DOWN,
])

// I numeri di UN evento, presi dal suo insight. Solo i campi che hanno
// un senso per quel tipo di evento, con nomi che l'AI capisce.
// Per una spesa grossa il dato che fa la differenza è "quanto è insolita
// PER QUELLA categoria": se BehaviorEngine ha già un insight sulla stessa
// categoria (media per spesa, o media del ciclo), i suoi numeri vengono
// affiancati alla spesa. Nessun calcolo nuovo: si leggono gli eventi.
function relatedCategoryFacts(event, events) {
  const facts = {}
  const related = events.filter((other) => other !== event && other.insight && other.categoryId === event.trigger?.categoryId)
  for (const { insight } of related) {
    if (insight.type === 'amount_above_average' && facts.usualAmount === undefined) facts.usualAmount = round(insight.baseline)
    if (['recurring_high', 'category_spike', 'category_trend_up', 'recurring_low', 'category_drop', 'category_trend_down'].includes(insight.type)
      && facts.categoryCycleUsual === undefined) {
      facts.categoryCycleCurrent = round(insight.current)
      facts.categoryCycleUsual = round(insight.baseline)
    }
  }
  return facts
}

function eventDetails(event, events = []) {
  const { insight } = event
  const details = { id: event.id, importance: event.importance }

  const label = categoryLabel(event.categoryId, insight)
  if (label) details.category = label

  if (event.trigger) {
    details.expense = {
      amount: round(event.trigger.amount),
      category: categoryLabel(event.trigger.categoryId),
      ...relatedCategoryFacts(event, events),
    }
  }
  if (!insight) return details

  switch (event.id) {
    case SPENDY_EVENTS.FREQUENCY_UP:
    case SPENDY_EVENTS.FREQUENCY_DOWN:
      details.purchases = { current: round(insight.current), usual: round(insight.baseline) }
      break
    case SPENDY_EVENTS.EXPENSE_ABOVE_AVERAGE:
    case SPENDY_EVENTS.EXPENSE_BELOW_AVERAGE:
      details.singleExpense = {
        amount: round(insight.current),
        usualAmount: round(insight.baseline),
        changePercent: round(insight.changePercent),
      }
      break
    case SPENDY_EVENTS.SMALL_EXPENSES_ADD_UP:
      details.smallExpenses = { count: insight.facts?.count ?? null, total: round(insight.facts?.total) }
      if (insight.facts?.categoryLabel) details.category = insight.facts.categoryLabel
      break
    case SPENDY_EVENTS.POSITIVE_STREAK:
    case SPENDY_EVENTS.NEGATIVE_STREAK:
      details.streakCycles = insight.samples
      break
    case SPENDY_EVENTS.UNUSUAL_PURCHASE:
      details.amount = round(insight.current)
      break
    case SPENDY_EVENTS.GOAL_NEAR:
    case SPENDY_EVENTS.GOAL_PROGRESS:
    case SPENDY_EVENTS.BUDGET_NEAR_LIMIT:
    case SPENDY_EVENTS.BUDGET_EXCEEDED:
      // i numeri stanno già in `budget` / `goal`
      break
    default:
      if (typeof insight.baseline === 'number' && insight.baseline > 0) {
        details.cycle = {
          current: round(insight.current),
          usual: round(insight.baseline),
          difference: round(Math.abs(insight.changeAmount)),
          changePercent: round(insight.changePercent),
        }
      }
  }
  return details
}

function pickGoal(primary, goals) {
  if (!primary) return null
  if (primary.goal) return goalSummary(primary.goal)
  if (SAVING_EVENTS.has(primary.id)) return goalSummary(closestOpenGoal(goals))
  return null
}

// L'impronta della situazione: cambia quando cambia qualcosa di cui
// Spendy parlerebbe in modo diverso — l'evento principale e la sua
// importanza (a fasce di 20), gli eventi secondari, la fascia del budget.
// NON gli importi esatti: un caffè in più non deve generare una frase
// nuova, una spesa grossa sì (ha il suo evento, legato a quella spesa).
function fingerprintOf({ band, primary, others }) {
  const primaryPart = primary ? `${primary.key}~${Math.floor(primary.importance / 20)}` : 'none'
  return [`v${SPENDY_AI_CONTEXT_VERSION}`, band, primaryPart, ...others.map((event) => event.key)].join('|')
}

// I numeri e le etichette che l'AI ha ricevuto, e che quindi può aver
// scritto nella frase: budget (disponibile, speso, giorni rimasti…), speso
// oggi, dettagli degli eventi e dell'obiettivo. NON entrano nell'impronta
// (un caffè in più non deve chiedere una frase nuova): servono solo a non
// riproporre dalla cache una frase con numeri che nel frattempo sono cambiati.
// C'è anche la lingua: una frase generata in un'altra lingua non si ripropone.
function financialFactsOf(context) {
  return JSON.stringify({
    locale: context.locale,
    budget: context.budget,
    spending: context.spending,
    primaryEvent: context.primaryEvent,
    otherEvents: context.otherEvents,
    goal: context.goal,
  })
}

// → { context, meta }
//   context: ciò che viene passato a spendyAI.generate (e, in Fase B, al server)
//   meta:    ciò che serve solo in locale (impronta, chiave dell'evento)
export function buildSpendyAIContext({
  events = [],
  coach = null,
  financialData = null,
  expenses = [],
  today,
  cycleStartDay = 1,
  goals = [],
  locale,
} = {}) {
  const monthly = financialData?.monthlyBudget ?? 0
  const available = financialData?.available ?? 0
  const spentPercent = round(financialData?.spentRatio ?? 0)
  // Il tempo del ciclo impostato dall'utente, dalla stessa fonte del resto
  // dell'app (cycle.js getCycleTiming): daysRemaining = giorni DOPO oggi,
  // quindi 0 nell'ultimo giorno del ciclo.
  const timing = financialData?.cycle ?? getCycleTiming(today, cycleStartDay)
  const band = budgetBand({ available, spentPercent })

  const budget = {
    monthly: round(monthly),
    spent: round(financialData?.spentThisMonth ?? 0),
    available: round(available),
    spentPercent,
    daysRemaining: timing.daysRemaining,
    cyclePhase: timing.phase,
    dayOfCycle: timing.dayOfCycle,
    cycleDays: timing.cycleDays,
    band,
  }
  // La quota giornaliera conta anche oggi: nell'ultimo giorno è tutto il disponibile.
  if (available > 0) budget.dailyAllowance = Math.floor(available / timing.daysLeftIncludingToday)

  const spending = { today: round(todaysExpenses(expenses, today).total) }
  const savings = events.find((event) => event.id === SPENDY_EVENTS.SAVINGS_ABOVE_USUAL)
  if (savings?.insight) spending.usualCycle = round(savings.insight.baseline)

  const [primary = null, ...rest] = events
  const others = rest.slice(0, 2)

  const context = {
    version: SPENDY_AI_CONTEXT_VERSION,
    // La lingua scelta nell'app: il server la ricontrolla (it/en/es/fr, altrimenti it).
    locale: normalizeSpendyLocale(locale),
    today,
    budget,
    spending,
    primaryEvent: primary ? eventDetails(primary, events) : null,
    otherEvents: others.map((event) => ({
      id: event.id,
      importance: event.importance,
      ...(categoryLabel(event.categoryId, event.insight) ? { category: categoryLabel(event.categoryId, event.insight) } : {}),
    })),
    goal: pickGoal(primary, goals),
    suggestedState: coach?.state ?? null,
  }

  return {
    context,
    meta: {
      fingerprint: fingerprintOf({ band, primary, others }),
      facts: financialFactsOf(context),
      eventKey: primary?.key ?? null,
      importance: primary?.importance ?? 0,
    },
  }
}
