import { useEffect, useState } from 'react'
import { ProgressBar } from '../ProgressBar/ProgressBar.jsx'
import { formatCurrency, maskedCurrency } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './BudgetCard.css'

function statusMessage(spentRatio) {
  if (spentRatio < 70) return 'budget.status.ok'
  if (spentRatio < 95) return 'budget.status.near'
  return 'budget.status.over'
}

// On the spent PERCENTAGE, not a fixed euro residuo — a bar fixed at
// "always green" for anyone with a mid/large budget was the actual bug
// here (small residuo in € almost never happened for them even at 95%
// spent). "cambia colore quando arriva al 70% del disponibile spese, e
// rosso quando arriva all'ultimo 10%" is exactly these two thresholds.
const BUDGET_WARNING_AT = 70 // % of monthlyBudget spent
const BUDGET_DANGER_AT = 90 // % of monthlyBudget spent — "ultimo 10%" left

const BUDGET_BAR_COLORS = {
  ok: '#12b886',
  warning: '#f0ab1f',
  danger: '#f4645f',
}

// No budget set yet isn't a "danger" — there's nothing to overspend
// against, just nothing configured (Spendy's own message already says
// so, see spendyCoach.js's tier 0). Only judge spentRatio once there's a
// real budget behind it. spentRatio already reads >100 once over
// budget, which the danger check below covers with no extra case.
function budgetBarState(spentRatio, monthlyBudget) {
  if (monthlyBudget <= 0) return 'ok'
  if (spentRatio >= BUDGET_DANGER_AT) return 'danger'
  if (spentRatio >= BUDGET_WARNING_AT) return 'warning'
  return 'ok'
}

// `available`/`spent`/`monthlyBudget` are plain numbers the caller derives
// from the store (budgetCalculations.js) — this component only formats
// and displays them, so it doesn't care whether they came from mock
// expenses or a real API.
export function BudgetCard({ available, spent, monthlyBudget, period, hidden, onToggleHidden }) {
  const { t } = useLanguage()
  const spentRatio = monthlyBudget > 0 ? (spent / monthlyBudget) * 100 : 0

  // Starts at 0 and jumps to the real ratio one tick after mount, purely so
  // the progress bar's own width transition (see ProgressBar.css) plays as
  // an animated fill on load instead of appearing already-full.
  const [animatedRatio, setAnimatedRatio] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimatedRatio(spentRatio))
    return () => cancelAnimationFrame(id)
  }, [spentRatio])

  const barState = budgetBarState(spentRatio, monthlyBudget)

  return (
    <section className="budget-card">
      <div className="budget-card__top">
        <p className="budget-card__label">{t('budget.available')}</p>
        <button
          type="button"
          className="budget-card__hide-toggle"
          onClick={onToggleHidden}
          aria-label={hidden ? t('budget.show') : t('budget.hide')}
        >
          {hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>

      <p className={`budget-card__amount ${barState === 'danger' ? 'budget-card__amount--alarm' : ''}`}>
        {hidden ? maskedCurrency() : formatCurrency(available)}
      </p>

      {/* Il budget è lo stipendio di QUESTO ciclo (utils/salary.js): a inizio
          ciclo, finché non viene inserito, è 0 e lo si dice. */}
      <p className="budget-card__period">
        {monthlyBudget > 0 ? t('budget.monthly', { amount: formatCurrency(monthlyBudget) }) : t('budget.nosalary')} · {period}
      </p>

      <div className="budget-card__progress">
        <ProgressBar value={animatedRatio} colorValue={BUDGET_BAR_COLORS[barState]} />
        <div className="budget-card__progress-labels">
          <span>{Math.round(spentRatio)}%</span>
          {/* Explicit "X spesi di Y", never the old bare "speso di Y" —
              that read as ambiguous (spent how much?). */}
          <span className="budget-card__progress-total">
            {t('budget.spentof', { spent: formatCurrency(spent), budget: formatCurrency(monthlyBudget) })}
          </span>
        </div>
      </div>

      <p className={`budget-card__status budget-card__status--${barState}`}>
        <span className="budget-card__status-icon" aria-hidden="true">
          {barState === 'ok' ? '✓' : '!'}
        </span>
        {t(statusMessage(spentRatio))}
      </p>
    </section>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 3l18 18M10.6 5.7A10.6 10.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a13.4 13.4 0 0 1-2.9 3.6M6.4 6.4C4 8.1 2.5 12 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6M9.5 9.7a3 3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
