import { formatCurrency } from '../../utils/format.js'
import { getCategoryColor } from '../../data/categoryColors.js'
import { ProgressBar } from '../ProgressBar/ProgressBar.jsx'
import { formatPercent } from './andamentoFormat.js'
import './CycleSummary.css'

const TOP_CATEGORIES = 5

// Stesse soglie della barra del budget in Home (BudgetCard, 70% e 90%):
// verde finché c'è margine, oro quando si stringe, coral nell'ultimo 10%.
function budgetColor(budgetUsed) {
  if (budgetUsed >= 90) return 'var(--color-accent-coral)'
  if (budgetUsed >= 70) return 'var(--color-accent-gold)'
  return 'var(--color-accent-mint)'
}

// Il riepilogo di UN ciclo: le quattro cifre che rispondono a "come sto
// andando?" e le categorie che pesano di più. Riceve un ciclo già
// calcolato da buildAndamento, non fa conti suoi.
export function CycleSummary({ cycle }) {
  const topCategories = cycle.categories.slice(0, TOP_CATEGORIES)
  const inRed = cycle.savings < 0

  return (
    <section className="cycle-summary" aria-live="polite">
      <div className="cycle-summary__head">
        <p className="cycle-summary__title">{cycle.label}</p>
        {cycle.isCurrent && <span className="cycle-summary__badge">In corso</span>}
      </div>

      <div className="cycle-summary__grid">
        <div className="cycle-summary__metric">
          <span className="cycle-summary__metric-label">Entrate</span>
          <span className="cycle-summary__metric-value">{formatCurrency(cycle.income)}</span>
          {cycle.extraIncome > 0 && (
            <span className="cycle-summary__metric-note">di cui {formatCurrency(cycle.extraIncome)} extra</span>
          )}
        </div>

        <div className="cycle-summary__metric">
          <span className="cycle-summary__metric-label">Spese</span>
          <span className="cycle-summary__metric-value">{formatCurrency(cycle.spent)}</span>
          <span className="cycle-summary__metric-note">
            {cycle.expenseCount === 1 ? '1 spesa' : `${cycle.expenseCount} spese`}
          </span>
        </div>

        <div className={`cycle-summary__metric cycle-summary__metric--${inRed ? 'bad' : 'good'}`}>
          <span className="cycle-summary__metric-label">Risparmio</span>
          <span className="cycle-summary__metric-value">
            {inRed ? `-${formatCurrency(Math.abs(cycle.savings))}` : formatCurrency(cycle.savings)}
          </span>
          {inRed && <span className="cycle-summary__metric-note">hai speso più di quanto è entrato</span>}
        </div>

        <div className="cycle-summary__metric">
          <span className="cycle-summary__metric-label">Budget utilizzato</span>
          <span className="cycle-summary__metric-value">{formatPercent(cycle.budgetUsed)}</span>
          {cycle.budgetUsed === null ? (
            <span className="cycle-summary__metric-note">stipendio non registrato in questo ciclo</span>
          ) : (
            <ProgressBar
              value={cycle.budgetUsed}
              colorValue={budgetColor(cycle.budgetUsed)}
              trackClassName="cycle-summary__progress"
            />
          )}
        </div>
      </div>

      <div className="cycle-summary__categories">
        <p className="cycle-summary__section-title">Dove sono andati</p>
        {topCategories.length === 0 ? (
          <p className="cycle-summary__empty">Nessuna spesa in questo periodo.</p>
        ) : (
          <ul className="cycle-summary__list">
            {topCategories.map((row) => (
              <li key={row.categoryId} className="cycle-summary__row">
                <span className="cycle-summary__row-emoji" aria-hidden="true">{row.category.emoji}</span>
                <span className="cycle-summary__row-body">
                  <span className="cycle-summary__row-line">
                    <span className="cycle-summary__row-label">{row.category.label}</span>
                    <span className="cycle-summary__row-amount">{formatCurrency(row.amount)}</span>
                  </span>
                  <span className="cycle-summary__row-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, row.share)}%`, background: getCategoryColor(row.categoryId) }} />
                  </span>
                </span>
                <span className="cycle-summary__row-share">{Math.round(row.share)}%</span>
              </li>
            ))}
          </ul>
        )}
        {cycle.categories.length > TOP_CATEGORIES && (
          <p className="cycle-summary__more">
            + altre {cycle.categories.length - TOP_CATEGORIES} categorie (le trovi in Analisi)
          </p>
        )}
      </div>
    </section>
  )
}
