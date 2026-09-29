import { useState } from 'react'
import { formatCurrency } from '../../utils/format.js'
import { describeChange } from './andamentoFormat.js'
import './CategoryComparison.css'

// Le prime cinque bastano per rispondere a "quali categorie stanno
// facendo la differenza?"; il resto è a un tocco, non in faccia.
const VISIBLE_ROWS = 5

// Le righe arrivano già ordinate dall'engine (compareCycles) per
// variazione assoluta: qui si decide solo quante mostrarne.
export function CategoryComparison({ rows, beforeLabel, afterLabel }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS)

  if (rows.length === 0) {
    return <p className="category-comparison__empty">Nessuna spesa in nessuno dei due periodi.</p>
  }

  return (
    <div className="category-comparison">
      <ul className="category-comparison__list">
        {visible.map((row) => {
          const change = describeChange(row, { newLabel: 'Nuova', goneLabel: 'Azzerata' })
          return (
            <li key={row.categoryId} className="category-comparison__row">
              <span className="category-comparison__emoji" aria-hidden="true">{row.category.emoji}</span>
              <span className="category-comparison__body">
                <span className="category-comparison__label">{row.category.label}</span>
                <span className="category-comparison__values">
                  <span>{beforeLabel} {formatCurrency(row.before)}</span>
                  <span aria-hidden="true"> → </span>
                  <span>{afterLabel} {formatCurrency(row.after)}</span>
                </span>
              </span>
              <span className={`category-comparison__change category-comparison__change--${change.tone}`}>
                <span className="category-comparison__change-amount">
                  <span aria-hidden="true">{change.arrow} </span>
                  {change.amount ?? change.detail}
                </span>
                {change.amount && change.detail && (
                  <span className="category-comparison__change-detail">{change.detail}</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      {rows.length > VISIBLE_ROWS && (
        <button type="button" className="category-comparison__toggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Mostra meno' : `Mostra tutte (${rows.length})`}
        </button>
      )}
    </div>
  )
}
