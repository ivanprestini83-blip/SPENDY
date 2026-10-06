import { isSameDay } from './date.js'
import { getCycleRange, getCycleTiming, getPreviousCycleRange, isWithinRange } from './cycle.js'
import { getCategory } from '../data/categories.js'
import { extraIncomes } from './salary.js'

// `cycleStartDay` (1-31, default 1) is the day-of-month the user's
// budgeting cycle starts on — see cycle.js. Every function below takes
// it as a plain parameter rather than assuming calendar months, so a
// custom cycle ("dal 27 al 27") flows through Radar/Analisi/Coach exactly
// the same way a calendar month always did. Passing nothing keeps the
// old calendar-month behavior.

export function totalForPeriod(expenses, range) {
  return expenses
    .filter((expense) => isWithinRange(expense.date, range))
    .reduce((sum, expense) => sum + expense.amount, 0)
}

export function totalForMonth(expenses, today, cycleStartDay = 1) {
  return totalForPeriod(expenses, getCycleRange(today, cycleStartDay))
}

export function todaysExpenses(expenses, today) {
  const items = expenses.filter((expense) => isSameDay(expense.date, today))
  return {
    items,
    total: items.reduce((sum, expense) => sum + expense.amount, 0),
    count: items.length,
  }
}

// One row per category that has spending in either cycle, sorted by
// biggest increase first — Radar/Analisi both just take the head/whole
// list rather than recomputing this themselves.
export function categoryComparison(expenses, today, cycleStartDay = 1) {
  const currentRange = getCycleRange(today, cycleStartDay)
  const previousRange = getPreviousCycleRange(currentRange, cycleStartDay)
  const totals = new Map()

  for (const expense of expenses) {
    if (isWithinRange(expense.date, currentRange)) {
      const entry = totals.get(expense.categoryId) || { current: 0, previous: 0 }
      entry.current += expense.amount
      totals.set(expense.categoryId, entry)
    } else if (isWithinRange(expense.date, previousRange)) {
      const entry = totals.get(expense.categoryId) || { current: 0, previous: 0 }
      entry.previous += expense.amount
      totals.set(expense.categoryId, entry)
    }
  }

  return [...totals.entries()]
    .map(([categoryId, { current, previous }]) => {
      const category = getCategory(categoryId)
      const changeAmount = current - previous
      const changePercent = previous > 0
        ? (changeAmount / previous) * 100
        : (current > 0 ? 100 : 0)
      return { categoryId, category, current, previous, changeAmount, changePercent }
    })
    .sort((a, b) => b.changePercent - a.changePercent)
}

export function topIncreasingCategory(expenses, today, cycleStartDay = 1) {
  const comparison = categoryComparison(expenses, today, cycleStartDay)
  return comparison.find((row) => row.changeAmount > 0 && row.previous > 0) ?? null
}

// The category that dropped the most, in percent — feeds the Coach
// engine's "advisor" state (spendyCoach.js). Requires `current > 0`, not
// just `changeAmount < 0`: a category that went to zero usually just
// means "no expense yet this cycle", not a deliberate reduction worth
// suggesting the saved amount be redirected toward a goal.
export function topDecreasingCategory(expenses, today, cycleStartDay = 1) {
  const decreasing = categoryComparison(expenses, today, cycleStartDay)
    .filter((row) => row.changeAmount < 0 && row.previous > 0 && row.current > 0)
  if (decreasing.length === 0) return null
  return decreasing.reduce((most, row) => (row.changePercent < most.changePercent ? row : most))
}

// The one function that turns store state into what getSpendyCoach
// (spendyCoach.js) needs. Both HomePage and SpendyPage call this instead
// of each re-deriving spentRatio/topCategory/etc themselves — "NON
// duplicare la logica finanziaria nella Home" applies just as much to a
// second page reusing the same coach.
//
// `monthlyBudget` qui è lo stipendio DEL CICLO IN CORSO (utils/salary.js
// currentCycleSalary), non più una cifra ricorrente: 0 se in questo ciclo non
// è ancora stato inserito. `incomes` (default []) sono le entrate: quelle
// "stipendio" sono già in monthlyBudget, quindi qui si sommano solo le extra
// (Extra/Investimenti/Regalo/Rimborso/personalizzate) del ciclo.
export function buildFinancialData({ today, monthlyBudget, expenses, goals, cycleStartDay = 1, incomes = [] }) {
  const spentThisMonth = totalForMonth(expenses, today, cycleStartDay)
  const extraIncomeThisMonth = totalForMonth(extraIncomes(incomes), today, cycleStartDay)
  const available = monthlyBudget + extraIncomeThisMonth - spentThisMonth
  const spentRatio = monthlyBudget > 0 ? (spentThisMonth / monthlyBudget) * 100 : 0

  return {
    spentRatio,
    available,
    spentThisMonth,
    extraIncomeThisMonth,
    monthlyBudget,
    topCategory: topIncreasingCategory(expenses, today, cycleStartDay),
    topDecreasingCategory: topDecreasingCategory(expenses, today, cycleStartDay),
    goals,
    // Dove siamo nel ciclo impostato dall'utente (cycle.js getCycleTiming):
    // l'unica fonte per giorni rimasti e fase, per coach, BehaviorEngine e AI.
    cycle: today ? getCycleTiming(today, cycleStartDay) : null,
  }
}
