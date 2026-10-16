import { useLayoutEffect, useRef, useState } from 'react'
import { formatCurrency, formatSignedPercent } from '../../utils/format.js'
import { getCategoryColor } from '../../data/categoryColors.js'
import { squarifiedTreemap, treemapHeight, tileDensity } from '../../utils/treemap.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './CategoryTreemap.css'

// Larghezza usata prima di poter misurare il contenitore (e nei test, dove
// non c'è layout): quella di un telefono tipico, al netto dei margini.
const FALLBACK_WIDTH = 340
// Spazio fra le tessere, in px (metà per lato).
const GAP = 6

// La mappa delle spese per categoria: una treemap vera, in cui l'AREA di
// ogni tessera è proporzionale all'importo della categoria sul totale del
// periodo (utils/treemap.js, layout "squarified"). I colori sono quelli
// fissi della categoria (gli stessi della ciambella), resi pastello: non
// giudicano la spesa, la identificano.
//
// `rows` arriva già calcolato dalla pagina (categoryComparison, filtrato e
// ordinato); `total` è il totale del periodo. Nessun calcolo nuovo: qui
// solo la disposizione e la presentazione.
//
// Tocco su una tessera: la seleziona e sotto compaiono nome completo,
// importo, quota e confronto col periodo precedente, con il pulsante per
// aprire le spese della categoria (`onOpenDetail`, il dettaglio di sempre).
export function CategoryTreemap({ rows, total, onOpenDetail = () => {} }) {
  const { t } = useLanguage()
  const boxRef = useRef(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)
  const [selectedId, setSelectedId] = useState(null)

  useLayoutEffect(() => {
    const node = boxRef.current
    if (!node) return undefined
    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width)
      if (next > 0) setWidth(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const height = treemapHeight(width, rows.length)
  const tiles = squarifiedTreemap(
    rows.map((row) => ({ id: row.categoryId, value: row.current, row })),
    width,
    height,
  )
  const shareOf = (value) => (total > 0 ? Math.round((value / total) * 100) : 0)
  const selected = rows.find((row) => row.categoryId === selectedId) ?? null

  return (
    <section className="category-treemap" aria-label={t('analytics.treemap.label')}>
      <div ref={boxRef} className="category-treemap__map" style={{ height }}>
        {tiles.map((tile) => {
          const { row } = tile
          const amountText = formatCurrency(row.current)
          const density = tileDensity(tile.width - GAP, tile.height - GAP, amountText.length)
          const share = shareOf(row.current)
          const isSelected = row.categoryId === selectedId
          return (
            <button
              key={row.categoryId}
              type="button"
              className={`category-treemap__tile category-treemap__tile--${density}${isSelected ? ' category-treemap__tile--selected' : ''}`}
              style={{
                left: tile.x + GAP / 2,
                top: tile.y + GAP / 2,
                width: Math.max(0, tile.width - GAP),
                height: Math.max(0, tile.height - GAP),
                '--tile-color': getCategoryColor(row.categoryId),
              }}
              aria-pressed={isSelected}
              aria-label={`${row.category.label}, ${amountText}, ${share}%`}
              onClick={() => setSelectedId(isSelected ? null : row.categoryId)}
            >
              <span className="category-treemap__icon" aria-hidden="true">{row.category.emoji}</span>
              {(density === 'full' || density === 'name') && (
                <span className="category-treemap__name" aria-hidden="true">{row.category.label}</span>
              )}
              {(density === 'full' || density === 'name' || density === 'wide' || density === 'compact') && (
                <span className="category-treemap__amount" aria-hidden="true">{amountText}</span>
              )}
              {(density === 'full' || density === 'short' || density === 'wide') && (
                <span className="category-treemap__share" aria-hidden="true">{share}%</span>
              )}
            </button>
          )
        })}
      </div>

      {/* La categoria toccata, per intero: anche quella di una tessera
          piccolissima si legge qui, mai tagliata. */}
      <div className="category-treemap__detail-slot" aria-live="polite">
        {selected ? (
          <div className="category-treemap__detail" style={{ '--tile-color': getCategoryColor(selected.categoryId) }}>
            <span className="category-treemap__detail-icon" aria-hidden="true">{selected.category.emoji}</span>
            <div className="category-treemap__detail-text">
              <p className="category-treemap__detail-name">{selected.category.label}</p>
              <p className="category-treemap__detail-amount">
                {formatCurrency(selected.current)}
                <span className="category-treemap__detail-share"> · {t('analytics.treemap.share', { percent: shareOf(selected.current) })}</span>
              </p>
              {selected.previous > 0 && (
                <p className="category-treemap__detail-change">
                  {t('analytics.treemap.previous', { change: formatSignedPercent(selected.changePercent) })}
                </p>
              )}
            </div>
            <button type="button" className="category-treemap__detail-open" onClick={() => onOpenDetail(selected.categoryId)}>
              {t('analytics.treemap.open')}
            </button>
          </div>
        ) : (
          <p className="category-treemap__hint">{t('analytics.treemap.hint')}</p>
        )}
      </div>
    </section>
  )
}
