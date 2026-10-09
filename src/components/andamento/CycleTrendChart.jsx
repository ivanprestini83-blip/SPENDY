import { formatCurrency } from '../../utils/format.js'
import { formatCompactAmount } from './andamentoFormat.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './CycleTrendChart.css'

// Oltre sei colonne le etichette dei cicli personalizzati ("27 Ago") non
// starebbero più su un telefono: il confronto permette comunque di
// scegliere anche i cicli più vecchi.
const CHART_LIMIT = 6

// Il risparmio sotto ogni colonna, corto come l'importo sopra: "+722" /
// "-680". È `cycle.savings` di buildAndamento, solo arrotondato per lo spazio.
function compactSigned(value) {
  const rounded = Math.round(value)
  if (rounded === 0) return '0'
  return `${rounded > 0 ? '+' : '-'}${formatCompactAmount(Math.abs(rounded))}`
}

// Una colonna per ciclo, solo CSS: la traccia chiara è quanto è entrato
// (stipendio + extra), il riempimento è quanto è uscito, sotto il risparmio
// del ciclo. Si legge al volo "quanto ho usato di quello che avevo".
// La linea tratteggiata è la media delle spese delle colonne mostrate: solo
// un riferimento visivo, non entra in nessun conto. Ogni colonna è un
// pulsante: toccarla apre il suo riepilogo.
export function CycleTrendChart({ cycles, selectedKey, onSelect }) {
  const { t } = useLanguage()
  const shown = cycles.slice(-CHART_LIMIT)
  const max = Math.max(1, ...shown.map((cycle) => Math.max(cycle.spent, cycle.income)))
  const average = shown.reduce((sum, cycle) => sum + cycle.spent, 0) / shown.length
  const anyOver = shown.some((cycle) => cycle.spent > cycle.income)
  const showAverage = shown.length > 1 && average > 0

  return (
    <section className="trend-chart" aria-label={t('andamento.trend.title')}>
      <div className="trend-chart__head">
        <p className="trend-chart__title">{t('andamento.trend.title')}</p>
        {shown.length > 1 && <p className="trend-chart__hint">{t('andamento.trend.hint')}</p>}
      </div>

      <p className="trend-chart__legend">
        <span className="trend-chart__legend-item">
          <span className="trend-chart__legend-swatch trend-chart__legend-swatch--spent" aria-hidden="true" />
          {t('andamento.metric.spent')}
        </span>
        <span className="trend-chart__legend-item">
          <span className="trend-chart__legend-swatch trend-chart__legend-swatch--income" aria-hidden="true" />
          {t('andamento.metric.income')}
        </span>
        {anyOver && (
          <span className="trend-chart__legend-item">
            <span className="trend-chart__legend-swatch trend-chart__legend-swatch--over" aria-hidden="true" />
            {t('andamento.trend.over')}
          </span>
        )}
        <span className="trend-chart__legend-item">
          <span className="trend-chart__legend-sign" aria-hidden="true">±</span>
          {t('andamento.metric.savings')}
        </span>
      </p>

      <div className="trend-chart__columns">
        <span className="trend-chart__grid" aria-hidden="true">
          {showAverage && (
            <span className="trend-chart__average" style={{ bottom: `${(average / max) * 100}%` }}>
              <span className="trend-chart__average-label">{t('andamento.trend.average', { amount: formatCompactAmount(average) })}</span>
            </span>
          )}
        </span>

        {shown.map((cycle) => {
          const isSelected = cycle.key === selectedKey
          const over = cycle.spent > cycle.income
          const savingsTone = cycle.savings < 0 ? 'bad' : cycle.savings > 0 ? 'good' : 'flat'
          return (
            <button
              key={cycle.key}
              type="button"
              className={`trend-chart__column${isSelected ? ' trend-chart__column--selected' : ''}`}
              onClick={() => onSelect(cycle.key)}
              aria-pressed={isSelected}
              aria-label={t('andamento.trend.bar', { cycle: cycle.label, spent: formatCurrency(cycle.spent), income: formatCurrency(cycle.income) })}
            >
              <span className="trend-chart__amount">{formatCompactAmount(cycle.spent)}</span>
              <span className="trend-chart__plot">
                <span className="trend-chart__income" style={{ height: `${(cycle.income / max) * 100}%` }} />
                <span
                  className={`trend-chart__spent${over ? ' trend-chart__spent--over' : ''}`}
                  style={{ height: `${Math.max(cycle.spent > 0 ? 3 : 0, (cycle.spent / max) * 100)}%` }}
                />
              </span>
              <span className={`trend-chart__label${cycle.isCurrent ? ' trend-chart__label--current' : ''}`}>{cycle.shortLabel}</span>
              <span className={`trend-chart__savings trend-chart__savings--${savingsTone}`}>{compactSigned(cycle.savings)}</span>
            </button>
          )
        })}
      </div>

      {cycles.length === 1 && (
        <p className="trend-chart__note">{t('andamento.trend.first')}</p>
      )}
    </section>
  )
}
