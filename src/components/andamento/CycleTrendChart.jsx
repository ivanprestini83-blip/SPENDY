import { formatCurrency } from '../../utils/format.js'
import { formatCompactAmount } from './andamentoFormat.js'
import './CycleTrendChart.css'

// Oltre sei colonne le etichette dei cicli personalizzati ("27 Ago") non
// starebbero più su un telefono: il confronto permette comunque di
// scegliere anche i cicli più vecchi.
const CHART_LIMIT = 6

// Una colonna per ciclo, solo CSS: la traccia chiara è quanto è entrato
// (stipendio + extra), il riempimento è quanto è uscito. Si legge al
// volo "quanto ho usato di quello che avevo" senza assi né legende
// complicate. Ogni colonna è un pulsante: toccarla apre il suo
// riepilogo.
export function CycleTrendChart({ cycles, selectedKey, onSelect }) {
  const shown = cycles.slice(-CHART_LIMIT)
  const max = Math.max(1, ...shown.map((cycle) => Math.max(cycle.spent, cycle.income)))

  return (
    <section className="trend-chart" aria-label="Spese per ciclo">
      <div className="trend-chart__head">
        <p className="trend-chart__title">Spese per ciclo</p>
        <p className="trend-chart__legend">
          <span className="trend-chart__legend-swatch trend-chart__legend-swatch--spent" aria-hidden="true" /> Spese
          <span className="trend-chart__legend-swatch trend-chart__legend-swatch--income" aria-hidden="true" /> Entrate
        </p>
      </div>

      <div className="trend-chart__columns">
        {shown.map((cycle) => {
          const isSelected = cycle.key === selectedKey
          const over = cycle.spent > cycle.income
          return (
            <button
              key={cycle.key}
              type="button"
              className={`trend-chart__column${isSelected ? ' trend-chart__column--selected' : ''}`}
              onClick={() => onSelect(cycle.key)}
              aria-pressed={isSelected}
              aria-label={`${cycle.label}: spese ${formatCurrency(cycle.spent)}, entrate ${formatCurrency(cycle.income)}`}
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
            </button>
          )
        })}
      </div>

      {cycles.length === 1 && (
        <p className="trend-chart__note">Questo è il tuo primo ciclo con dei dati: dal prossimo vedrai come cambia.</p>
      )}
    </section>
  )
}
