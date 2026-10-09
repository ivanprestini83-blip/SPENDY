import { useState } from 'react'
import { formatCurrency } from '../../utils/format.js'
import { formatCompactAmount } from './andamentoFormat.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './CycleTrendChart.css'

// Quanti cicli mostrare: il menu "Ultimi N cicli". Sei è il default; con
// dodici le colonne scorrono in orizzontale invece di stringersi.
const RANGES = [3, 6, 12]
const DEFAULT_RANGE = 6
const TICKS = 3

// Un passo "tondo" per l'asse (1, 2, 2,5, 5 × 10ⁿ), così le etichette sono
// 0 / 200 / 400 / 600 e non 0 / 187 / 374.
function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10
  return nice * power
}

// Le colonne delle spese ciclo per ciclo, con l'asse dei valori. La traccia
// chiara dietro ogni barra è quanto è entrato; la barra diventa coral quando
// le spese lo superano. Toccare una colonna sceglie quel ciclo (come il menu
// del riepilogo); il valore preciso compare sopra la colonna scelta.
// Solo disegno: i numeri sono quelli di buildAndamento.
export function CycleTrendChart({ cycles, selectedKey, onSelect }) {
  const { t } = useLanguage()
  const [range, setRange] = useState(DEFAULT_RANGE)
  // Le opzioni che cambiano davvero qualcosa: la prima, più quelle che
  // mostrano più cicli della precedente.
  const options = RANGES.filter((count, index) => index === 0 || RANGES[index - 1] < cycles.length)
  const shown = cycles.slice(-range)
  const peak = Math.max(...shown.map((cycle) => Math.max(cycle.spent, cycle.income)), 0)
  const step = peak > 0 ? niceStep(peak / TICKS) : 1
  const top = Math.max(step, Math.ceil(peak / step) * step)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step).reverse()
  const anyOver = shown.some((cycle) => cycle.spent > cycle.income)
  const height = (value) => `${(value / top) * 100}%`

  return (
    <section className="trend-chart" aria-label={t('andamento.trend.title')}>
      <div className="trend-chart__head">
        <div className="trend-chart__heading">
          <p className="trend-chart__title">{t('andamento.trend.title')}</p>
          {shown.length > 1 && <p className="trend-chart__hint">{t('andamento.trend.hint')}</p>}
        </div>
        {cycles.length > RANGES[0] && (
          <select
            className="trend-chart__range"
            value={range}
            onChange={(event) => setRange(Number(event.target.value))}
            aria-label={t('andamento.trend.rangelabel')}
          >
            {options.map((count) => (
              <option key={count} value={count}>{t('andamento.trend.range', { count })}</option>
            ))}
          </select>
        )}
      </div>

      <div className={`trend-chart__body${shown.length > 6 ? ' trend-chart__body--scroll' : ''}`}>
        <span className="trend-chart__axis" aria-hidden="true">
          {ticks.map((tick) => <span key={tick}>{formatCompactAmount(tick)}</span>)}
        </span>

        <div className="trend-chart__scroller">
          <div className="trend-chart__columns">
            <span className="trend-chart__grid" aria-hidden="true">
              {ticks.map((tick) => <span key={tick} />)}
            </span>

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
                  aria-label={t('andamento.trend.bar', { cycle: cycle.label, spent: formatCurrency(cycle.spent), income: formatCurrency(cycle.income) })}
                >
                  <span className="trend-chart__plot">
                    <span className="trend-chart__income" style={{ height: height(cycle.income) }} />
                    <span
                      className={`trend-chart__spent${over ? ' trend-chart__spent--over' : ''}`}
                      style={{ height: cycle.spent > 0 ? `max(4px, ${height(cycle.spent)})` : '0' }}
                    >
                      {isSelected && <span className="trend-chart__tooltip">{formatCompactAmount(cycle.spent)}</span>}
                    </span>
                  </span>
                  <span className={`trend-chart__label${cycle.isCurrent ? ' trend-chart__label--current' : ''}`}>{cycle.shortLabel}</span>
                </button>
              )
            })}
          </div>
        </div>
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
      </p>

      {cycles.length === 1 && (
        <p className="trend-chart__note">{t('andamento.trend.first')}</p>
      )}
    </section>
  )
}
