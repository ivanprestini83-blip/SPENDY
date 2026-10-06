import { useAppStore } from '../store/useAppStore.js'
import { totalForMonth } from '../utils/budgetCalculations.js'
import { formatCurrency } from '../utils/format.js'
import { getCategory } from '../data/categories.js'
import './ExpensesPage.css'

// The income twin of ExpensesPage — same layout/CSS, listing every
// income: gli stipendi (uno per ciclo, inseriti con addSalary) e le entrate
// extra (Extra/Investimenti/Regalo/Rimborso/custom). Reachable
// dal link "Vedi le entrate" in fondo al riepilogo di
// ExpensesPage. Tapping a row opens
// EditIncomeModal — "voglio poter modificare la data di un guadagno già
// inserito" needed somewhere to tap INTO in the first place, which this
// page is.
export function IncomesPage() {
  const today = useAppStore((state) => state.today)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const incomes = useAppStore((state) => state.incomes)
  const openModal = useAppStore((state) => state.openModal)
  const setActiveTab = useAppStore((state) => state.setActiveTab)

  const monthTotal = totalForMonth(incomes, today, cycleStartDay)
  const sorted = [...incomes].sort((a, b) => (a.date < b.date ? 1 : -1))

  return (
    <div className="expenses-page">
      <div className="expenses-page__summary">
        <div>
          <p className="expenses-page__summary-label">Entrate di questo ciclo</p>
          <p className="expenses-page__summary-amount">{formatCurrency(monthTotal)}</p>
        </div>
      </div>

      <button type="button" className="expenses-page__switch" onClick={() => setActiveTab('expenses')}>
        <span aria-hidden="true">←</span> Torna alle spese
      </button>

      <button type="button" className="expenses-page__add" onClick={() => openModal('quickAdd', { type: 'income' })}>
        + Aggiungi guadagno
      </button>

      {sorted.length === 0 && (
        <p className="expenses-page__empty">
          Nessuna entrata registrata. Lo stipendio di ogni ciclo si inserisce da "+" → Guadagno → Stipendio.
        </p>
      )}

      <ul className="expenses-page__list">
        {sorted.map((income) => {
          const category = getCategory(income.categoryId)
          return (
            <li key={income.id}>
              {/* Tap any past income to correct a wrong amount/date, or
                  delete it entirely — opens EditIncomeModal instead of a
                  second way of writing to `incomes`. */}
              <button
                type="button"
                className="expenses-page__item"
                onClick={() => openModal('editIncome', income)}
              >
                <span className="expenses-page__item-icon" aria-hidden="true">{category.emoji}</span>
                <div className="expenses-page__item-info">
                  <p className="expenses-page__item-desc">{income.description}</p>
                  <p className="expenses-page__item-meta">{category.label} · {income.date}</p>
                </div>
                <span className="expenses-page__item-amount">{formatCurrency(income.amount)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
