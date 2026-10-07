import { formatCurrency } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './ExpenseSummaryCards.css'

// Both cards are buttons, not divs-with-onClick — same interactive
// element the rest of the app uses for tap targets, so keyboard/focus
// behavior comes for free. `onOpenExpenses(view)` is how Home hands off to
// the Spese tab without importing the store itself: 'today' or 'cycle', so
// the list shows the same period as the card that was tapped.
export function ExpenseSummaryCards({ today, month, monthlyBudget, onOpenExpenses = () => {} }) {
  const { t } = useLanguage()
  return (
    <div className="expense-summary">
      <button type="button" className="expense-summary__card" onClick={() => onOpenExpenses('today')}>
        <span className="expense-summary__icon expense-summary__icon--violet" aria-hidden="true">👛</span>
        <span className="expense-summary__arrow" aria-hidden="true">→</span>
        <p className="expense-summary__label">{t('expenses.summary.today')}</p>
        <p className="expense-summary__amount">{formatCurrency(today.total)}</p>
        <p className="expense-summary__meta">
          {t(today.count === 1 ? 'expenses.summary.countone' : 'expenses.summary.countmany', { count: today.count })}
        </p>
      </button>

      <button type="button" className="expense-summary__card" onClick={() => onOpenExpenses('cycle')}>
        <span className="expense-summary__icon expense-summary__icon--blue" aria-hidden="true">📊</span>
        <span className="expense-summary__arrow" aria-hidden="true">→</span>
        <p className="expense-summary__label">{t('expenses.summary.cycle')}</p>
        <p className="expense-summary__amount">{formatCurrency(month.total)}</p>
        <p className="expense-summary__meta">{t('expenses.summary.of', { amount: formatCurrency(monthlyBudget) })}</p>
      </button>
    </div>
  )
}
