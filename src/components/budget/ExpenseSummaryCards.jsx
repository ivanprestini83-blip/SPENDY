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
  // Solo per disegnare la mini barra: la stessa proporzione speso/budget
  // che la BudgetCard mostra già, limitata a 0–100 (niente NaN senza budget).
  const cycleShare = monthlyBudget > 0 && Number.isFinite(month.total) ? Math.max(0, Math.min(100, (month.total / monthlyBudget) * 100)) : 0
  return (
    <div className="expense-summary">
      <button type="button" className="expense-summary__card expense-summary__card--today" onClick={() => onOpenExpenses('today')}>
        <span className="expense-summary__icon" aria-hidden="true"><WalletIcon /></span>
        <span className="expense-summary__arrow" aria-hidden="true">→</span>
        <p className="expense-summary__label">{t('expenses.summary.today')}</p>
        <p className="expense-summary__amount">{formatCurrency(today.total)}</p>
        <p className="expense-summary__meta">
          {t(today.count === 1 ? 'expenses.summary.countone' : 'expenses.summary.countmany', { count: today.count })}
        </p>
      </button>

      <button type="button" className="expense-summary__card expense-summary__card--cycle" onClick={() => onOpenExpenses('cycle')}>
        <span className="expense-summary__icon" aria-hidden="true"><CalendarIcon /></span>
        <span className="expense-summary__arrow" aria-hidden="true">→</span>
        <p className="expense-summary__label">{t('expenses.summary.cycle')}</p>
        <p className="expense-summary__amount">{formatCurrency(month.total)}</p>
        <p className="expense-summary__meta">{t('expenses.summary.of', { amount: formatCurrency(monthlyBudget) })}</p>
        <span className="expense-summary__bar" aria-hidden="true">
          <span className="expense-summary__bar-fill" style={{ width: `${cycleShare}%` }} />
        </span>
      </button>
    </div>
  )
}

function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <rect x="3.5" y="8" width="17" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="16.25" cy="13.5" r="1.35" fill="currentColor" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3.75" y="5.5" width="16.5" height="14.5" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path d="M3.75 10h16.5M8.5 3.5v4M15.5 3.5v4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8 14.5h3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}
