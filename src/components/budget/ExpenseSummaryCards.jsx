import { formatCurrency } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './ExpenseSummaryCards.css'

// Spese ed entrate del ciclo, come due elementi aperti affiancati (niente
// card): spese in pesca/arancio, entrate in verde. Tutto ciò che si tocca è
// un <button>, così tastiera e focus funzionano come nel resto dell'app.
//
// `onOpenExpenses(view)` è come la Home apre la scheda Spese senza
// importare lo store: 'today' o 'cycle', così la lista mostra lo stesso
// periodo dell'elemento toccato. "Oggi" resta un suo pulsante (la pillola
// in cima), il totale del ciclo un altro.
//
// `income` è facoltativo: chi non lo passa vede solo le spese, come prima.
// Sono numeri già calcolati dalla Home (stipendio del ciclo ed entrate
// extra, buildFinancialData): qui si mostrano soltanto.
export function ExpenseSummaryCards({ today, month, monthlyBudget, income = null, onOpenExpenses = () => {}, onOpenIncomes = () => {} }) {
  const { t } = useLanguage()
  // Solo per disegnare la mini barra: la stessa proporzione speso/budget
  // che la BudgetCard mostra già, limitata a 0–100 (niente NaN senza budget).
  const cycleShare = monthlyBudget > 0 && Number.isFinite(month.total) ? Math.max(0, Math.min(100, (month.total / monthlyBudget) * 100)) : 0
  const incomeNote = income
    ? income.extra > 0
      ? t('andamento.summary.extra', { amount: formatCurrency(income.extra) })
      : income.salary > 0 ? null : t('andamento.summary.nosalary')
    : null

  return (
    <div className={`expense-summary${income ? ' expense-summary--with-income' : ''}`}>
      {/* "Oggi": una pillola pesca a tutta riga, sopra spese ed entrate. */}
      <button type="button" className="expense-summary__today" onClick={() => onOpenExpenses('today')}>
        <span className="expense-summary__today-label">{t('expenses.summary.today')}</span>
        <span className="expense-summary__today-value">{formatCurrency(today.total)}</span>
        <span className="expense-summary__today-count">
          {t(today.count === 1 ? 'expenses.summary.countone' : 'expenses.summary.countmany', { count: today.count })}
        </span>
      </button>

      <div className="expense-summary__item expense-summary__item--spend">
        <button type="button" className="expense-summary__main" onClick={() => onOpenExpenses('cycle')}>
          <span className="expense-summary__icon" aria-hidden="true"><SpendIcon /></span>
          <span className="expense-summary__label">{t('expenses.summary.cycle')}</span>
          <span className="expense-summary__amount">{formatCurrency(month.total)}</span>
          <span className="expense-summary__meta">{t('expenses.summary.of', { amount: formatCurrency(monthlyBudget) })}</span>
          <span className="expense-summary__bar" aria-hidden="true">
            <span className="expense-summary__bar-fill" style={{ width: `${cycleShare}%` }} />
          </span>
        </button>
      </div>

      {income && (
        <button type="button" className="expense-summary__item expense-summary__item--income expense-summary__main" onClick={onOpenIncomes}>
          <span className="expense-summary__icon" aria-hidden="true"><IncomeIcon /></span>
          <span className="expense-summary__label">{t('expenses.summary.income')}</span>
          <span className="expense-summary__amount">{formatCurrency(income.total)}</span>
          {incomeNote && <span className="expense-summary__meta">{incomeNote}</span>}
          <span className="expense-summary__line" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function SpendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M7 7l10 10M17 9.5V17H9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IncomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M17 17L7 7M7 14.5V7h7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
