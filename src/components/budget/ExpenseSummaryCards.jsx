import { formatCurrency } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './ExpenseSummaryCards.css'

// Spese di oggi e spese del ciclo, come due elementi aperti affiancati
// (niente card), nei toni pesca/corallo e arancio delle spese. Le entrate
// non stanno qui: sono già nella card del budget. Entrambi sono <button>,
// così tastiera e focus funzionano come nel resto dell'app.
//
// `onOpenExpenses(view)` è come la Home apre la scheda Spese senza
// importare lo store: 'today' o 'cycle', così la lista mostra lo stesso
// periodo dell'elemento toccato.
export function ExpenseSummaryCards({ today, month, monthlyBudget, onOpenExpenses = () => {} }) {
  const { t } = useLanguage()
  // Solo per disegnare la mini barra: la stessa proporzione speso/budget
  // che la BudgetCard mostra già, limitata a 0–100 (niente NaN senza budget).
  const cycleShare = monthlyBudget > 0 && Number.isFinite(month.total) ? Math.max(0, Math.min(100, (month.total / monthlyBudget) * 100)) : 0

  return (
    <div className="expense-summary">
      <button type="button" className="expense-summary__item expense-summary__item--today" onClick={() => onOpenExpenses('today')}>
        <span className="expense-summary__icon" aria-hidden="true"><TodayIcon /></span>
        <span className="expense-summary__label">{t('expenses.summary.today')}</span>
        <span className="expense-summary__amount">{formatCurrency(today.total)}</span>
        <span className="expense-summary__meta">
          {t(today.count === 1 ? 'expenses.summary.countone' : 'expenses.summary.countmany', { count: today.count })}
        </span>
        <span className="expense-summary__line" aria-hidden="true" />
      </button>

      <button type="button" className="expense-summary__item expense-summary__item--cycle" onClick={() => onOpenExpenses('cycle')}>
        <span className="expense-summary__icon" aria-hidden="true"><CycleIcon /></span>
        <span className="expense-summary__label">{t('expenses.summary.cycle')}</span>
        <span className="expense-summary__amount">{formatCurrency(month.total)}</span>
        <span className="expense-summary__meta">{t('expenses.summary.of', { amount: formatCurrency(monthlyBudget) })}</span>
        <span className="expense-summary__bar" aria-hidden="true">
          <span className="expense-summary__bar-fill" style={{ width: `${cycleShare}%` }} />
        </span>
      </button>
    </div>
  )
}

function TodayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <rect x="3.5" y="8" width="17" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="16.25" cy="13.5" r="1.35" fill="currentColor" />
    </svg>
  )
}

function CycleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3.75" y="5.5" width="16.5" height="14.5" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path d="M3.75 10h16.5M8.5 3.5v4M15.5 3.5v4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8 14.5h3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}
