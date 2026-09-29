// ANDAMENTO — "fammi vedere come sto andando".
//
// Radar dice "ho notato qualcosa"; questo engine invece non giudica e non
// seleziona: prende i dati che esistono già nello store e li mette in fila
// ciclo per ciclo, così la schermata può mostrarli e confrontarli.
//
// Funzione pura, come gli altri engine: niente Zustand, niente Date.now().
// Non esiste nessuno storico salvato — ogni ciclo è ricalcolato da
// `expenses`/`incomes`, quindi una spesa sincronizzata da un altro
// dispositivo (o spostata di data) sposta subito i numeri del ciclo giusto.
//
// Le regole sui cicli sono quelle di cycle.js (le stesse di Budget, Analisi
// e Radar), le somme sono quelle di budgetCalculations.js, e le entrate
// seguono buildFinancialData: lo stipendio è `monthlyBudget`, una cifra
// ricorrente che vale per ogni ciclo, più le entrate una tantum del ciclo.
import { lastCycles, getPreviousCycleRange, isWithinRange, formatCycleLabel, formatCycleStartLabel } from './cycle.js'
import { totalForPeriod } from './budgetCalculations.js'
import { getCategory } from '../data/categories.js'

// Oltre un anno la schermata smetterebbe di essere "come sto andando" e
// diventerebbe un archivio: i cicli più vecchi restano nei dati, solo non
// vengono elencati qui.
export const ANDAMENTO_MAX_CYCLES = 12

// La variazione fra due valori, senza mai produrre Infinity/NaN.
// `percent` è null quando non ha senso calcolarlo (valore precedente 0 o
// negativo): sta alla UI dire "Nuova" invece di un numero inventato.
//   kind: 'same' | 'up' | 'down' | 'new' (da 0 a qualcosa) | 'gone' (a 0)
export function computeChange(before, after) {
  const diff = after - before
  const percent = before > 0 ? (diff / before) * 100 : null
  let kind
  if (diff === 0) kind = 'same'
  else if (before === 0) kind = 'new'
  else if (after === 0 && before > 0) kind = 'gone'
  else kind = diff > 0 ? 'up' : 'down'
  return { before, after, diff, percent, kind }
}

// Le somme di spesa sono in euro con i centesimi: arrotondare al centesimo
// evita che 0.1 + 0.2 diventi una "differenza" di 0,0000000001 €.
const round2 = (value) => Math.round(value * 100) / 100

function categoriesFor(expenses, range) {
  const totals = new Map()
  for (const expense of expenses) {
    if (!isWithinRange(expense.date, range)) continue
    totals.set(expense.categoryId, (totals.get(expense.categoryId) ?? 0) + expense.amount)
  }
  return totals
}

// Quanti cicli mostrare: dal ciclo della prima spesa/entrata registrata
// fino a quello corrente, senza chiedere un minimo (a differenza del
// Radar) e senza saltare i cicli vuoti in mezzo — un mese senza spese è
// un dato anche lui.
function countCyclesWithData(entries, currentRange, cycleStartDay, maxCycles) {
  const dates = entries.map((entry) => entry.date).filter((date) => typeof date === 'string' && date < currentRange.end)
  if (dates.length === 0) return 1
  const earliest = dates.reduce((min, date) => (date < min ? date : min))
  let range = currentRange
  let count = 1
  while (earliest < range.start && count < maxCycles) {
    range = getPreviousCycleRange(range, cycleStartDay)
    count += 1
  }
  return count
}

function buildCycle({ range, expenses, incomes, monthlyBudget, cycleStartDay, isCurrent }) {
  const spent = round2(totalForPeriod(expenses, range))
  const extraIncome = round2(totalForPeriod(incomes, range))
  const income = round2(monthlyBudget + extraIncome)
  const categoryTotals = categoriesFor(expenses, range)

  const categories = [...categoryTotals.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      category: getCategory(categoryId),
      amount: round2(amount),
      share: spent > 0 ? (amount / spent) * 100 : 0,
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  return {
    key: range.start,
    range,
    label: formatCycleLabel(range, cycleStartDay),
    shortLabel: formatCycleStartLabel(range, cycleStartDay),
    isCurrent,
    salary: monthlyBudget,
    extraIncome,
    income,
    spent,
    // Stessa formula di buildFinancialData.available.
    savings: round2(income - spent),
    // Stessa formula di buildFinancialData.spentRatio; null invece di 0
    // quando lo stipendio non è impostato, perché "0% del budget" su un
    // budget che non esiste sarebbe una bugia rassicurante.
    budgetUsed: monthlyBudget > 0 ? (spent / monthlyBudget) * 100 : null,
    expenseCount: expenses.filter((expense) => isWithinRange(expense.date, range)).length,
    categories,
  }
}

// Input: gli stessi campi dello store, passati a mano.
// Output: { cycles (dal più vecchio al corrente), current, hasData }.
export function buildAndamento({
  expenses = [],
  incomes = [],
  monthlyBudget = 0,
  today,
  cycleStartDay = 1,
  maxCycles = ANDAMENTO_MAX_CYCLES,
}) {
  const startDay = cycleStartDay ?? 1
  const budget = Number.isFinite(monthlyBudget) ? monthlyBudget : 0
  const [currentRange] = lastCycles(today, 1, startDay)
  const count = countCyclesWithData([...expenses, ...incomes], currentRange, startDay, maxCycles)

  const cycles = lastCycles(today, count, startDay).map((range, index) =>
    buildCycle({ range, expenses, incomes, monthlyBudget: budget, cycleStartDay: startDay, isCurrent: index === count - 1 }),
  )

  return {
    cycles,
    current: cycles[cycles.length - 1],
    hasData: expenses.length > 0 || incomes.length > 0,
  }
}

// Confronta due cicli già costruiti da buildAndamento. `before` è il
// periodo di riferimento (le percentuali sono "rispetto a before").
//
// Le categorie: una riga per ogni categoria con spesa in almeno uno dei
// due periodi (presente in entrambi, solo prima, solo dopo), ordinate per
// variazione assoluta — prima quelle che fanno davvero la differenza.
export function compareCycles(before, after) {
  const beforeTotals = new Map(before.categories.map((row) => [row.categoryId, row.amount]))
  const afterTotals = new Map(after.categories.map((row) => [row.categoryId, row.amount]))
  const ids = new Set([...beforeTotals.keys(), ...afterTotals.keys()])

  const categories = [...ids]
    .map((categoryId) => {
      const change = computeChange(beforeTotals.get(categoryId) ?? 0, afterTotals.get(categoryId) ?? 0)
      return { categoryId, category: getCategory(categoryId), ...change, diff: round2(change.diff) }
    })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.after - a.after)

  const budgetUsed = before.budgetUsed === null || after.budgetUsed === null
    ? null
    : { before: before.budgetUsed, after: after.budgetUsed, diffPoints: after.budgetUsed - before.budgetUsed }

  const spent = computeChange(before.spent, after.spent)

  return {
    before,
    after,
    spent: { ...spent, diff: round2(spent.diff) },
    income: { ...computeChange(before.income, after.income), diff: round2(after.income - before.income) },
    savings: { ...computeChange(before.savings, after.savings), diff: round2(after.savings - before.savings) },
    budgetUsed,
    categories,
  }
}
