import { useAppStore } from '../store/useAppStore.js'
import { totalForMonth } from '../utils/budgetCalculations.js'
import { formatCurrency } from '../utils/format.js'
import { getCategory } from '../data/categories.js'
import './ExpensesPage.css'

export function ExpensesPage() {
  const today = useAppStore((state) => state.today)
  const monthlyBudget = useAppStore((state) => state.monthlyBudget)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const openModal = useAppStore((state) => state.openModal)
  const setActiveTab = useAppStore((state) => state.setActiveTab)

  const monthTotal = totalForMonth(expenses, today, cycleStartDay)
  const sorted = [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1))

  return (
    <div className="expenses-page">
      <div className="expenses-page__summary">
        <div>
          <p className="expenses-page__summary-label">Spese di questo mese</p>
          <p className="expenses-page__summary-amount">{formatCurrency(monthTotal)}</p>
        </div>
        <p className="expenses-page__summary-budget">su {formatCurrency(monthlyBudget)}</p>
      </div>

      {/* Spese ed entrate sono due elenchi gemelli (stessa struttura,
          stesso CSS): questo e il link gemello su IncomesPage sono il
          modo per passare dall'uno all'altro. È anche l'unica porta per
          arrivare a un'entrata già inserita e correggerne importo o
          data — la bottom nav non ha una voce Entrate. */}
      <button type="button" className="expenses-page__switch" onClick={() => setActiveTab('incomes')}>
        Vedi le entrate extra <span aria-hidden="true">→</span>
      </button>

      <button type="button" className="expenses-page__add" onClick={() => openModal('quickAdd', { type: 'expense' })}>
        + Aggiungi spesa
      </button>

      <ul className="expenses-page__list">
        {sorted.map((expense) => {
          const category = getCategory(expense.categoryId)
          return (
            <li key={expense.id}>
              {/* Tap any past expense to correct a wrong amount/date, or
                  delete it entirely — opens EditExpenseModal instead of a
                  second way of writing to `expenses`. */}
              <button
                type="button"
                className="expenses-page__item"
                onClick={() => openModal('editExpense', expense)}
              >
                <span className="expenses-page__item-icon" aria-hidden="true">{category.emoji}</span>
                <div className="expenses-page__item-info">
                  <p className="expenses-page__item-desc">{expense.description}</p>
                  <p className="expenses-page__item-meta">{category.label} · {expense.date}</p>
                </div>
                <span className="expenses-page__item-amount">{formatCurrency(expense.amount)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
