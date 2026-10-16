import { useEffect, useState } from 'react'
import { formatCurrency, maskedCurrency } from '../../utils/format.js'
import { budgetTone } from '../../utils/budgetTone.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './BudgetCard.css'

// Il messaggio sotto la card segue lo stesso livello del colore (e di
// Andamento, utils/budgetTone.js): in linea sotto il 60% speso, "attento"
// fino al 100%, superato oltre. Senza stipendio non c'è niente da giudicare.
function statusMessage(level) {
  if (level === 'ok' || level === 'neutral') return 'budget.status.ok'
  if (level === 'over') return 'budget.status.over'
  return 'budget.status.near'
}

// L'arco della card: mezza circonferenza, lunghezza normalizzata a 100
// (pathLength), così il riempimento è direttamente la percentuale spesa.
// Il colore viene dal tono della card (BudgetCard.css), lo stesso che
// decide fondo, bordo e messaggio.
const ARC_PATH = 'M 14 110 A 96 96 0 0 1 206 110'

// `available`/`spent`/`monthlyBudget` are plain numbers the caller derives
// from the store (budgetCalculations.js) — this component only formats
// and displays them, so it doesn't care whether they came from mock
// expenses or a real API.
// `extraIncome`: le entrate extra del ciclo (buildFinancialData), che con lo
// stipendio formano il budget del mese mostrato sotto l'arco. Solo per
// mostrarlo: il disponibile arriva già calcolato.
export function BudgetCard({ available, spent, monthlyBudget, extraIncome = 0, period, hidden, onToggleHidden }) {
  const { t } = useLanguage()
  const spentRatio = monthlyBudget > 0 ? (spent / monthlyBudget) * 100 : 0

  // Starts at 0 and jumps to the real ratio one tick after mount, purely so
  // the arc's own transition (BudgetCard.css) plays as an animated fill on
  // load instead of appearing already-full.
  const [animatedRatio, setAnimatedRatio] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimatedRatio(spentRatio))
    return () => cancelAnimationFrame(id)
  }, [spentRatio])

  // Un solo livello per colore, messaggio e importo (lo stesso di Andamento).
  const { tone, level } = budgetTone({ spent, monthlyBudget })
  const statusState = level === 'ok' || level === 'neutral' ? 'ok' : level === 'caution' || level === 'warning' ? 'warning' : 'danger'
  const amountText = hidden ? maskedCurrency() : formatCurrency(available)
  // Explicit "X spesi di Y", never the old bare "speso di Y" — that read as
  // ambiguous (spent how much?). Ora è l'etichetta accessibile dell'arco.
  const spentLabel = t('budget.spentof', { spent: formatCurrency(spent), budget: formatCurrency(monthlyBudget) })
  const extra = Number.isFinite(extraIncome) && extraIncome > 0 ? extraIncome : 0
  const incomeTotal = (monthlyBudget > 0 ? monthlyBudget : 0) + extra
  const incomeNote = monthlyBudget > 0
    ? (extra > 0 ? t('andamento.summary.extra', { amount: formatCurrency(extra) }) : null)
    : t('budget.nosalary')

  return (
    <section className={`budget-card budget-card--${tone}`}>
      <div className="budget-card__top">
        <div className="budget-card__heading">
          <p className="budget-card__label">{t('budget.available')}</p>
          <p className="budget-card__period">{period}</p>
        </div>
        {/* Quanto resta del budget del ciclo: il complemento della quota
            spesa mostrata nell'arco (64% speso → 36% residuo, sempre 100 in
            tutto). Nessun chip senza un budget su cui calcolarla. */}
        {tone !== 'neutral' && (
          <span className="budget-card__left">
            {tone === 'over' ? t('budget.exhausted') : t('budget.remaining', { percent: Math.max(0, 100 - Math.round(spentRatio)) })}
          </span>
        )}
        <button
          type="button"
          className="budget-card__hide-toggle"
          onClick={onToggleHidden}
          aria-label={hidden ? t('budget.show') : t('budget.hide')}
        >
          {hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>

      {/* L'importo disponibile, il numero più grande della Home, e accanto
          l'arco: quanta parte del budget del ciclo è già spesa (la stessa
          percentuale di prima, solo disegnata ad arco). */}
      <div className="budget-card__main">
        <p className={`budget-card__amount${amountText.length > 9 ? ' budget-card__amount--long' : ''}${statusState === 'danger' ? ' budget-card__amount--alarm' : ''}`}>
          {amountText}
        </p>
        <div className="budget-card__gauge">
          <svg
            className="budget-card__arc"
            viewBox="0 0 220 118"
            role="progressbar"
            aria-label={spentLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(100, Math.max(0, spentRatio)))}
          >
            <path className="budget-card__arc-track" d={ARC_PATH} pathLength="100" />
            <path
              className="budget-card__arc-fill"
              d={ARC_PATH}
              pathLength="100"
              style={{ strokeDashoffset: 100 - Math.min(100, Math.max(0, animatedRatio)) }}
            />
          </svg>
          <p className="budget-card__share">
            <strong>{Math.round(spentRatio)}%</strong> {t('budget.gauge')}
          </p>
        </div>
      </div>

      {/* Quanto è entrato e quanto è uscito, ben in vista sotto l'importo.
          Il budget del mese è lo stipendio di QUESTO ciclo (utils/salary.js)
          più le entrate extra: a inizio ciclo, finché lo stipendio non è
          inserito, lo si dice. */}
      <div className="budget-card__stats">
        <div
          className="budget-card__stat budget-card__stat--income"
          role="group"
          aria-label={monthlyBudget > 0 ? t('budget.monthly', { amount: formatCurrency(monthlyBudget) }) : t('budget.nosalary')}
        >
          <span className="budget-card__stat-head">
            <span className="budget-card__stat-icon" aria-hidden="true"><ArrowUpIcon /></span>
            <span className="budget-card__stat-label">{t('budget.income')}</span>
          </span>
          <span className="budget-card__stat-value">{formatCurrency(incomeTotal)}</span>
          {incomeNote && <span className="budget-card__stat-note">{incomeNote}</span>}
        </div>
        <div className="budget-card__stat budget-card__stat--spent">
          <span className="budget-card__stat-head">
            <span className="budget-card__stat-icon" aria-hidden="true"><ArrowDownIcon /></span>
            <span className="budget-card__stat-label">{t('budget.spent')}</span>
          </span>
          <span className="budget-card__stat-value">{formatCurrency(spent)}</span>
        </div>
      </div>

      <p className={`budget-card__status budget-card__status--${statusState}`}>
        <span className="budget-card__status-icon" aria-hidden="true">
          {statusState === 'ok' ? '✓' : '!'}
        </span>
        {t(statusMessage(level))}
      </p>
    </section>
  )
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M17 17L7 7M7 14.5V7h7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M7 7l10 10M17 9.5V17H9.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
