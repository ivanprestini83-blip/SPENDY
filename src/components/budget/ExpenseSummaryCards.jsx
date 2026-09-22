import { formatCurrency } from '../../utils/format.js'
import './ExpenseSummaryCards.css'

// Both cards are buttons, not divs-with-onClick — same interactive
// element the rest of the app uses for tap targets, so keyboard/focus
// behavior comes for free. `onOpenExpenses` is how Home hands off to the
// Spese tab without importing the store itself.
export function ExpenseSummaryCards({ today, month, monthlyBudget, onOpenExpenses = () => {} }) {
  return (
    <div className="expense-summary">
      <button type="button" className="expense-summary__card" onClick={onOpenExpenses}>
        <p className="expense-summary__label">Spese di oggi</p>
        <p className="expense-summary__amount">{formatCurrency(today.total)}</p>
        <p className="expense-summary__meta">{today.count} transazioni</p>
      </button>

      <button type="button" className="expense-summary__card" onClick={onOpenExpenses}>
        <p className="expense-summary__label">Spese di questo mese</p>
        <p className="expense-summary__amount">{formatCurrency(month.total)}</p>
        <p className="expense-summary__meta">su {formatCurrency(monthlyBudget)}</p>
      </button>
    </div>
  )
}
