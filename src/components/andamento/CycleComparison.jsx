import { useMemo } from 'react'
import { compareCycles } from '../../utils/andamentoEngine.js'
import { formatCurrency } from '../../utils/format.js'
import { describeChange, describeDiff, formatPercent } from './andamentoFormat.js'
import { CategoryComparison } from './CategoryComparison.jsx'
import './CycleComparison.css'

function MetricRow({ label, before, after, beforeValue, afterValue, change }) {
  return (
    <div className="cycle-comparison__metric">
      <p className="cycle-comparison__metric-label">{label}</p>
      <div className="cycle-comparison__values">
        <span className="cycle-comparison__value">
          <span className="cycle-comparison__value-period">{before.shortLabel}</span>
          {beforeValue}
        </span>
        <span className="cycle-comparison__value-arrow" aria-hidden="true">→</span>
        <span className="cycle-comparison__value cycle-comparison__value--after">
          <span className="cycle-comparison__value-period">{after.shortLabel}</span>
          {afterValue}
        </span>
      </div>
      <p className={`cycle-comparison__change cycle-comparison__change--${change.tone}`}>
        <span aria-hidden="true">{change.arrow} </span>
        {change.text}
      </p>
    </div>
  )
}

const signedMoney = (value) => (value < 0 ? `-${formatCurrency(Math.abs(value))}` : formatCurrency(value))

function budgetChange(budgetUsed) {
  const points = Math.round(budgetUsed.diffPoints)
  if (points === 0) return { arrow: '=', text: 'Invariato', tone: 'flat' }
  return {
    arrow: points > 0 ? '▲' : '▼',
    text: `${points > 0 ? '+' : '-'}${Math.abs(points)} punti`,
    tone: points > 0 ? 'bad' : 'good',
  }
}

// Una frase sola, descrittiva, che risponde a "cosa è cambiato?" prima
// ancora di leggere i numeri. Non è una battuta: le battute di Spendy
// passano da HumorEngine, che ragiona su insight comportamentali e non su
// un confronto scelto a mano dall'utente.
function headline({ spent }, before) {
  if (spent.diff < 0) return `Hai speso ${formatCurrency(Math.abs(spent.diff))} in meno rispetto a ${before.label}.`
  if (spent.diff > 0) return `Hai speso ${formatCurrency(spent.diff)} in più rispetto a ${before.label}.`
  return `Hai speso esattamente come in ${before.label}.`
}

// Il confronto fra due cicli scelti dall'utente. Il più vecchio fa sempre
// da riferimento, qualunque sia l'ordine in cui sono stati scelti: così
// "+12%" vuol dire sempre "rispetto a prima".
export function CycleComparison({ cycles, firstKey, secondKey, onChangeFirst, onChangeSecond }) {
  const options = [...cycles].reverse()
  const [before, after] = [firstKey, secondKey]
    .map((key) => cycles.find((cycle) => cycle.key === key))
    .sort((a, b) => (a.key < b.key ? -1 : 1))

  const comparison = useMemo(() => compareCycles(before, after), [before, after])
  const sameCycle = before.key === after.key

  return (
    <div className="cycle-comparison">
      <section className="cycle-comparison__pickers" aria-label="Scegli i periodi">
        <label className="cycle-comparison__picker">
          <span className="cycle-comparison__picker-label">Confronta</span>
          <select value={firstKey} onChange={(event) => onChangeFirst(event.target.value)}>
            {options.map((cycle) => (
              <option key={cycle.key} value={cycle.key}>{cycle.label}</option>
            ))}
          </select>
        </label>
        <label className="cycle-comparison__picker">
          <span className="cycle-comparison__picker-label">con</span>
          <select value={secondKey} onChange={(event) => onChangeSecond(event.target.value)}>
            {options.map((cycle) => (
              <option key={cycle.key} value={cycle.key}>{cycle.label}</option>
            ))}
          </select>
        </label>
      </section>

      {sameCycle ? (
        <p className="cycle-comparison__notice">Scegli due periodi diversi per vedere cosa è cambiato.</p>
      ) : (
        <>
          <section className="cycle-comparison__card">
            <p className="cycle-comparison__title">
              {before.label} <span className="cycle-comparison__title-vs">vs</span> {after.label}
            </p>
            <p className="cycle-comparison__headline">{headline(comparison, before)}</p>
            {after.isCurrent && (
              <p className="cycle-comparison__note">
                {after.label} è ancora in corso: i numeri possono cambiare fino a fine ciclo.
              </p>
            )}

            <div className="cycle-comparison__metrics">
              <MetricRow
                label="Spese"
                before={before}
                after={after}
                beforeValue={formatCurrency(before.spent)}
                afterValue={formatCurrency(after.spent)}
                change={describeChange(comparison.spent, { newLabel: 'Nuova spesa' })}
              />
              <MetricRow
                label="Entrate"
                before={before}
                after={after}
                beforeValue={formatCurrency(before.income)}
                afterValue={formatCurrency(after.income)}
                change={describeChange(comparison.income, { higherIsBetter: true, newLabel: 'Nuove entrate', goneLabel: 'Nessuna entrata' })}
              />
              <MetricRow
                label="Risparmio"
                before={before}
                after={after}
                beforeValue={signedMoney(before.savings)}
                afterValue={signedMoney(after.savings)}
                change={describeDiff(comparison.savings.diff, { higherIsBetter: true })}
              />
              {comparison.budgetUsed && (
                <MetricRow
                  label="Budget utilizzato"
                  before={before}
                  after={after}
                  beforeValue={formatPercent(before.budgetUsed)}
                  afterValue={formatPercent(after.budgetUsed)}
                  change={budgetChange(comparison.budgetUsed)}
                />
              )}
            </div>
          </section>

          <section className="cycle-comparison__card">
            <p className="cycle-comparison__section-title">Categorie che fanno la differenza</p>
            <CategoryComparison rows={comparison.categories} beforeLabel={before.shortLabel} afterLabel={after.shortLabel} />
          </section>
        </>
      )}
    </div>
  )
}
