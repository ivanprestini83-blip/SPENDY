import { useState } from 'react'
import { useAppStore } from '../store/useAppStore.js'
import { expensesForPeriod } from '../utils/budgetCalculations.js'
import { formatCycleLabel } from '../utils/cycle.js'
import { currentCycleSalary } from '../utils/salary.js'
import { formatCurrency } from '../utils/format.js'
import { getCategory } from '../data/categories.js'
import { useLanguage } from '../i18n/useLanguage.js'
import './ExpensesPage.css'

// L'elenco delle spese di UN periodo: oggi, oppure un ciclo (quello in corso
// o uno precedente). Si apre sul periodo del riquadro della Home da cui si
// arriva (useAppStore expensesView); i cicli precedenti restano consultabili
// e modificabili con le frecce. Filtra soltanto: nessuna spesa viene toccata.
export function ExpensesPage() {
  const { t } = useLanguage()
  const today = useAppStore((state) => state.today)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const incomes = useAppStore((state) => state.incomes)
  // Lo stipendio DEL CICLO IN CORSO (utils/salary.js): 0 finché in questo
  // ciclo non è stato inserito, mai quello del ciclo precedente.
  const monthlyBudget = currentCycleSalary(incomes, today, cycleStartDay)
  const openModal = useAppStore((state) => state.openModal)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const initialView = useAppStore((state) => state.expensesView)

  const [view, setView] = useState(initialView === 'today' ? 'today' : 'cycle')
  // Quanti cicli prima di quello in corso (0 = in corso): resta giusto anche
  // se `today` cambia mentre la pagina è aperta.
  const [cycleOffset, setCycleOffset] = useState(0)

  const period = expensesForPeriod(expenses, { view, today, cycleStartDay, cycleOffset })
  const sorted = [...period.items].sort((a, b) => (a.date < b.date ? 1 : -1))
  const hasOlder = period.range !== null && expenses.some((expense) => expense.date < period.range.start)

  let label = t('expenses.summary.today')
  if (view === 'cycle') label = cycleOffset === 0 ? t('expenses.summary.cycle') : t('expenses.page.pastcycle', { cycle: formatCycleLabel(period.range, cycleStartDay) })

  const choose = (next) => {
    setView(next)
    setCycleOffset(0)
  }

  return (
    <div className="expenses-page">
      <div className="expenses-page__periods" role="tablist" aria-label={t('expenses.page.periods')}>
        {[['today', t('expenses.page.today')], ['cycle', t('expenses.page.cycle')]].map(([value, text]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            className={`expenses-page__period${view === value ? ' expenses-page__period--active' : ''}`}
            onClick={() => choose(value)}
          >
            {text}
          </button>
        ))}
      </div>

      {view === 'cycle' && (
        <div className="expenses-page__cycle-nav">
          <button
            type="button"
            className="expenses-page__cycle-arrow"
            aria-label={t('expenses.page.prev')}
            disabled={!hasOlder}
            onClick={() => setCycleOffset((offset) => offset + 1)}
          >
            ←
          </button>
          <p className="expenses-page__cycle-label">{formatCycleLabel(period.range, cycleStartDay)}</p>
          <button
            type="button"
            className="expenses-page__cycle-arrow"
            aria-label={t('expenses.page.next')}
            disabled={cycleOffset === 0}
            onClick={() => setCycleOffset((offset) => Math.max(0, offset - 1))}
          >
            →
          </button>
        </div>
      )}

      <div className="expenses-page__summary">
        <div>
          <p className="expenses-page__summary-label">{label}</p>
          <p className="expenses-page__summary-amount">{formatCurrency(period.total)}</p>
        </div>
        {view === 'cycle' && cycleOffset === 0 && (
          <p className="expenses-page__summary-budget">{t('expenses.summary.of', { amount: formatCurrency(monthlyBudget) })}</p>
        )}
      </div>

      {/* Spese ed entrate sono due elenchi gemelli (stessa struttura,
          stesso CSS): questo e il link gemello su IncomesPage sono il
          modo per passare dall'uno all'altro. È anche l'unica porta per
          arrivare a un'entrata già inserita e correggerne importo o
          data — la bottom nav non ha una voce Entrate. */}
      <button type="button" className="expenses-page__switch" onClick={() => setActiveTab('incomes')}>
        {t('expenses.page.incomes')} <span aria-hidden="true">→</span>
      </button>

      <button type="button" className="expenses-page__add" onClick={() => openModal('quickAdd', { type: 'expense' })}>
        {t('expenses.page.add')}
      </button>

      {sorted.length === 0 && (
        <p className="expenses-page__empty">
          {view === 'today' ? t('expenses.page.emptytoday') : t('expenses.page.emptycycle')}
        </p>
      )}

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
