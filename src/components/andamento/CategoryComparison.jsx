import { useState } from 'react'
import { formatCurrency } from '../../utils/format.js'
import { getCategoryColor } from '../../data/categoryColors.js'
import { describeChange } from './andamentoFormat.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './CategoryComparison.css'

// Le prime cinque bastano per rispondere a "quali categorie stanno
// facendo la differenza?"; il resto è a un tocco, non in faccia.
const VISIBLE_ROWS = 5

// Le righe arrivano già ordinate dall'engine (compareCycles) per
// variazione assoluta: qui si decide solo quante mostrarne e quanto lunga
// disegnare la barra (proporzionale alla variazione più grande fra tutte).
export function CategoryComparison({ rows, beforeLabel, afterLabel }) {
  const { t, language } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS)

  if (rows.length === 0) {
    return <p className="category-comparison__empty">{t('andamento.categories.empty')}</p>
  }

  const largest = rows.reduce((max, row) => Math.max(max, Math.abs(row.diff)), 0)

  return (
    <div className="category-comparison">
      <ul className="category-comparison__list">
        {visible.map((row) => {
          const change = describeChange(row, { lang: language })
          const width = largest > 0 ? Math.max(Math.abs(row.diff) / largest, row.diff === 0 ? 0 : 0.04) * 100 : 0
          return (
            <li key={row.categoryId} className="category-comparison__row">
              {/* Il riquadro dell'icona prende il colore della categoria (lo
                  stesso di Analisi), così si riconosce prima di leggerla. */}
              <span
                className="category-comparison__emoji"
                aria-hidden="true"
                style={{ '--category-color': getCategoryColor(row.categoryId) }}
              >
                {row.category.emoji}
              </span>
              <span className="category-comparison__body">
                <span className="category-comparison__top">
                  <span className="category-comparison__label">{row.category.label}</span>
                  <span className={`category-comparison__change category-comparison__change--${change.tone}`}>
                    <span aria-hidden="true">{change.arrow} </span>
                    {change.amount ?? change.detail}
                  </span>
                </span>
                <span className="category-comparison__values" aria-label={`${beforeLabel} ${formatCurrency(row.before)}, ${afterLabel} ${formatCurrency(row.after)}`}>
                  <span>{formatCurrency(row.before)}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="category-comparison__values-after">{formatCurrency(row.after)}</span>
                  {change.amount && change.detail && (
                    <span className="category-comparison__change-detail"> · {change.detail}</span>
                  )}
                </span>
                <span className="category-comparison__bar" aria-hidden="true">
                  <span
                    className={`category-comparison__bar-fill category-comparison__bar-fill--${change.tone}`}
                    style={{ width: `${width}%` }}
                  />
                </span>
              </span>
            </li>
          )
        })}
      </ul>

      {rows.length > VISIBLE_ROWS && (
        <button type="button" className="category-comparison__toggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? t('andamento.categories.showless') : t('andamento.categories.showall', { count: rows.length })}
        </button>
      )}
    </div>
  )
}
