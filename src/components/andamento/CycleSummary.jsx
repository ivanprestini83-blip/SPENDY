import { formatCurrency } from '../../utils/format.js'
import { getCategoryColor } from '../../data/categoryColors.js'
import { NOTIFICATION_THRESHOLDS } from '../../notifications/notificationRules.js'
import { ProgressBar } from '../ProgressBar/ProgressBar.jsx'
import { formatPercent } from './andamentoFormat.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './CycleSummary.css'

const TOP_CATEGORIES = 5

// Stesse soglie della barra del budget in Home (BudgetCard, 70% e 90%):
// verde finché c'è margine, oro quando si stringe, coral nell'ultimo 10%.
function budgetColor(budgetUsed) {
  if (budgetUsed >= 90) return 'var(--color-accent-coral)'
  if (budgetUsed >= 70) return 'var(--color-accent-gold)'
  return 'var(--color-accent-mint)'
}

// La sintesi in cima, come la conclusione di "Confronta periodi": solo stati
// che l'app ha già, nessuna regola nuova. Le condizioni si sovrappongono, quindi
// conta l'ordine, dalla più specifica:
//   1. risparmio negativo (uscite oltre le entrate: la nota che il riquadro
//      Risparmio mostra già);
//   2. nessuno stipendio nel ciclo (budget utilizzato = null);
//   3. budget ≥ 100% (la soglia "superato" delle notifiche);
//   4. ≥ 90% e 5. ≥ 70% (le soglie della barra, budgetColor);
//   6. altrimenti, tutto sotto controllo.
function overviewOf(cycle, t) {
  if (cycle.savings < 0) {
    return { tone: 'bad', title: t('andamento.overview.overspent'), text: t('andamento.overview.overspenttext', { amount: formatCurrency(Math.abs(cycle.savings)) }) }
  }
  if (cycle.budgetUsed === null) {
    return { tone: 'flat', title: t('andamento.overview.nosalary'), text: t('andamento.overview.spenttext', { amount: formatCurrency(cycle.spent) }) }
  }
  const used = t('andamento.overview.used', { percent: formatPercent(cycle.budgetUsed) })
  if (cycle.budgetUsed >= NOTIFICATION_THRESHOLDS.budgetOver) return { tone: 'bad', title: t('andamento.overview.over'), text: used }
  if (cycle.budgetUsed >= 90) return { tone: 'bad', title: t('andamento.overview.near'), text: used }
  if (cycle.budgetUsed >= 70) return { tone: 'warn', title: t('andamento.overview.tight'), text: used }
  return { tone: 'good', title: t('andamento.overview.ok'), text: used }
}

// "Giorno 12 di 30 · 18 giorni rimasti": i numeri sono quelli di
// getCycleTiming (utils/cycle.js), passati da AndamentoScreen solo per il
// ciclo in corso.
function daysText(timing, t) {
  const day = t('andamento.overview.day', { day: timing.dayOfCycle, total: timing.cycleDays })
  const left = timing.daysRemaining === 0
    ? t('andamento.overview.lastday')
    : t(timing.daysRemaining === 1 ? 'andamento.overview.leftone' : 'andamento.overview.leftmany', { count: timing.daysRemaining })
  return `${day} · ${left}`
}

// Il riepilogo di UN ciclo: la sintesi, le quattro cifre che rispondono a
// "come sto andando?" e le categorie che pesano di più. Riceve un ciclo già
// calcolato da buildAndamento, non fa conti suoi.
export function CycleSummary({ cycle, timing = null }) {
  const { t } = useLanguage()
  const topCategories = cycle.categories.slice(0, TOP_CATEGORIES)
  const inRed = cycle.savings < 0
  const overview = overviewOf(cycle, t)
  // Prudenza: i giorni solo se sono davvero quelli di questo ciclo.
  const showDays = Boolean(cycle.isCurrent && timing && timing.start === cycle.range?.start)

  return (
    <section className="cycle-summary" aria-live="polite">
      <div className={`cycle-summary__overview cycle-summary__overview--${overview.tone}`} role="group" aria-label={t('andamento.overview.label')}>
        <div className="cycle-summary__head">
          <p className="cycle-summary__title">{cycle.label}</p>
          {cycle.isCurrent
            ? <span className="cycle-summary__badge cycle-summary__badge--current"><span aria-hidden="true">● </span>{t('andamento.status.current')}</span>
            : <span className="cycle-summary__badge cycle-summary__badge--done"><span aria-hidden="true">✓ </span>{t('andamento.status.done')}</span>}
        </div>
        {showDays && <p className="cycle-summary__days">{daysText(timing, t)}</p>}
        <p className="cycle-summary__overview-title">{overview.title}</p>
        <p className="cycle-summary__overview-text">{overview.text}</p>
        {cycle.budgetUsed !== null && (
          <ProgressBar
            value={cycle.budgetUsed}
            colorValue={budgetColor(cycle.budgetUsed)}
            trackClassName="cycle-summary__progress"
          />
        )}
      </div>

      <div className="cycle-summary__grid">
        <div className="cycle-summary__metric">
          <span className="cycle-summary__metric-label">{t('andamento.metric.income')}</span>
          <span className="cycle-summary__metric-value">{formatCurrency(cycle.income)}</span>
          {cycle.extraIncome > 0 && (
            <span className="cycle-summary__metric-note">{t('andamento.summary.extra', { amount: formatCurrency(cycle.extraIncome) })}</span>
          )}
        </div>

        <div className="cycle-summary__metric">
          <span className="cycle-summary__metric-label">{t('andamento.metric.spent')}</span>
          <span className="cycle-summary__metric-value">{formatCurrency(cycle.spent)}</span>
          <span className="cycle-summary__metric-note">
            {t(cycle.expenseCount === 1 ? 'andamento.expensesone' : 'andamento.expensesmany', { count: cycle.expenseCount })}
          </span>
        </div>

        <div className={`cycle-summary__metric cycle-summary__metric--${inRed ? 'bad' : 'good'}`}>
          <span className="cycle-summary__metric-label">{t('andamento.metric.savings')}</span>
          <span className="cycle-summary__metric-value">
            {inRed ? `-${formatCurrency(Math.abs(cycle.savings))}` : formatCurrency(cycle.savings)}
          </span>
          {inRed && <span className="cycle-summary__metric-note">{t('andamento.summary.overspent')}</span>}
        </div>

        <div className="cycle-summary__metric">
          <span className="cycle-summary__metric-label">{t('andamento.metric.budget')}</span>
          <span className="cycle-summary__metric-value">{formatPercent(cycle.budgetUsed)}</span>
          {cycle.budgetUsed === null && (
            <span className="cycle-summary__metric-note">{t('andamento.summary.nosalary')}</span>
          )}
        </div>
      </div>

      <div className="cycle-summary__categories">
        <p className="cycle-summary__section-title">{t('andamento.summary.where')}</p>
        {topCategories.length === 0 ? (
          <p className="cycle-summary__empty">{t('andamento.noexpenses')}</p>
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
            {/* Cita la scheda della barra in basso con il suo nome tradotto. */}
            {t(cycle.categories.length - TOP_CATEGORIES === 1 ? 'andamento.summary.moreone' : 'andamento.summary.moremany', { count: cycle.categories.length - TOP_CATEGORIES, tab: t('home.nav.analytics') })}
          </p>
        )}
      </div>
    </section>
  )
}
