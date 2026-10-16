import { useLayoutEffect, useRef, useState } from 'react'
import { formatCurrency, formatSignedPercent } from '../../utils/format.js'
import { getCategoryColor } from '../../data/categoryColors.js'
import { groupSmallTiles, treemapHeight, tileDensity, OTHERS_ID } from '../../utils/treemap.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './CategoryTreemap.css'

// Larghezza usata prima di poter misurare il contenitore (e nei test, dove
// non c'è layout): quella di un telefono tipico, al netto dei margini.
const FALLBACK_WIDTH = 340
// Il colore della tessera "Altre": un lilla neutro, non quello di una categoria.
const OTHERS_COLOR = '#a78bfa'

// La mappa delle spese per categoria: una treemap vera, in cui l'AREA di
// ogni tessera è proporzionale all'importo della categoria sul totale del
// periodo (utils/treemap.js, layout "squarified"). Le tessere sono
// attaccate, come nelle mappe finanziarie; i colori sono quelli fissi della
// categoria (gli stessi della ciambella), resi pastello: identificano, non
// giudicano.
//
// Ogni tessera mostra SEMPRE importo e percentuale. Le categorie troppo
// piccole perché ci stiano si raccolgono in una tessera "Altre N" (area =
// somma delle loro, proporzioni vere); toccandola si vedono una per una.
//
// `rows` arriva già calcolato dalla pagina (categoryComparison, filtrato e
// ordinato); `total` è il totale del periodo. Nessun calcolo nuovo.
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

  const shareOf = (value) => (total > 0 ? Math.round((value / total) * 100) : 0)
  const height = treemapHeight(width, rows.length)
  const fits = (rect) => tileDensity(rect.width, rect.height, formatCurrency(rect.value).length, `${shareOf(rect.value)}%`.length) !== null
  const { rects, grouped } = groupSmallTiles(
    rows.map((row) => ({ id: row.categoryId, value: row.current, row })),
    width,
    height,
    fits,
  )

  const selectedRow = rows.find((row) => row.categoryId === selectedId) ?? null
  const othersSelected = selectedId === OTHERS_ID && grouped.length > 0
  const othersTotal = grouped.reduce((sum, item) => sum + item.value, 0)
  const toggle = (id) => setSelectedId((current) => (current === id ? null : id))

  return (
    <section className="category-treemap" aria-label={t('analytics.treemap.label')}>
      <div ref={boxRef} className="category-treemap__map" style={{ height }}>
        {rects.map((rect) => {
          const isOthers = rect.id === OTHERS_ID
          const label = isOthers ? t('analytics.treemap.others', { count: grouped.length }) : rect.row.category.label
          const emoji = isOthers ? '•••' : rect.row.category.emoji
          const amountText = formatCurrency(rect.value)
          const share = shareOf(rect.value)
          // Se per arrotondamento una tessera non ci sta più (resize), resta
          // comunque nel formato più piccolo: importo e percentuale sempre.
          const density = tileDensity(rect.width, rect.height, amountText.length, `${share}%`.length) ?? 'stack'
          const isSelected = rect.id === selectedId
          return (
            <button
              key={rect.id}
              type="button"
              className={`category-treemap__tile category-treemap__tile--${density}${isOthers ? ' category-treemap__tile--others' : ''}${isSelected ? ' category-treemap__tile--selected' : ''}`}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                '--tile-color': isOthers ? OTHERS_COLOR : getCategoryColor(rect.id),
              }}
              aria-pressed={isSelected}
              aria-label={`${label}, ${amountText}, ${share}%`}
              onClick={() => toggle(rect.id)}
            >
              <span className="category-treemap__icon" aria-hidden="true">{emoji}</span>
              {(density === 'full' || density === 'name') && (
                <span className="category-treemap__name" aria-hidden="true">{label}</span>
              )}
              <span className="category-treemap__figures" aria-hidden="true">
                <span className="category-treemap__amount">{amountText}</span>
                <span className="category-treemap__share">{share}%</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* La categoria toccata, per intero: nome completo, importo, quota e
          confronto; per "Altre", l'elenco delle categorie raccolte. */}
      <div className="category-treemap__detail-slot" aria-live="polite">
        {selectedRow && (
          <div className="category-treemap__detail" style={{ '--tile-color': getCategoryColor(selectedRow.categoryId) }}>
            <span className="category-treemap__detail-icon" aria-hidden="true">{selectedRow.category.emoji}</span>
            <div className="category-treemap__detail-text">
              <p className="category-treemap__detail-name">{selectedRow.category.label}</p>
              <p className="category-treemap__detail-amount">
                {formatCurrency(selectedRow.current)}
                <span className="category-treemap__detail-share"> · {t('analytics.treemap.share', { percent: shareOf(selectedRow.current) })}</span>
              </p>
              {selectedRow.previous > 0 && (
                <p className="category-treemap__detail-change">
                  {t('analytics.treemap.previous', { change: formatSignedPercent(selectedRow.changePercent) })}
                </p>
              )}
            </div>
            <button type="button" className="category-treemap__detail-open" onClick={() => onOpenDetail(selectedRow.categoryId)}>
              {t('analytics.treemap.open')}
            </button>
          </div>
        )}

        {othersSelected && (
          <div className="category-treemap__detail category-treemap__detail--others" style={{ '--tile-color': OTHERS_COLOR }}>
            <div className="category-treemap__others-head">
              <p className="category-treemap__detail-name">{t('analytics.treemap.others', { count: grouped.length })}</p>
              <p className="category-treemap__detail-amount">
                {formatCurrency(othersTotal)}
                <span className="category-treemap__detail-share"> · {t('analytics.treemap.share', { percent: shareOf(othersTotal) })}</span>
              </p>
            </div>
            <ul className="category-treemap__others-list">
              {grouped.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="category-treemap__others-row"
                    style={{ '--tile-color': getCategoryColor(item.id) }}
                    onClick={() => onOpenDetail(item.id)}
                  >
                    <span className="category-treemap__others-dot" aria-hidden="true" />
                    <span className="category-treemap__others-name">
                      <span aria-hidden="true">{item.row.category.emoji}</span> {item.row.category.label}
                    </span>
                    <span className="category-treemap__others-amount">{formatCurrency(item.value)}</span>
                    <span className="category-treemap__others-share">{shareOf(item.value)}%</span>
                    <span className="category-treemap__others-chevron" aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!selectedRow && !othersSelected && <p className="category-treemap__hint">{t('analytics.treemap.hint')}</p>}
      </div>
    </section>
  )
}
