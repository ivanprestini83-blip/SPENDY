import { formatCurrency } from '../../utils/format.js'
import { getCategoryColor } from '../../data/categoryColors.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './CycleSummary.css'

const TOP_CATEGORIES = 5

// "Dove sono andati": le categorie che pesano di più nel ciclo scelto, sotto
// il grafico. Le righe arrivano già calcolate e ordinate da buildAndamento.
export function CycleCategories({ cycle }) {
  const { t } = useLanguage()
  const topCategories = cycle.categories.slice(0, TOP_CATEGORIES)

  return (
    <section className="cycle-summary__categories" aria-live="polite">
      <p className="cycle-summary__section-title">{t('andamento.summary.where')}</p>
      {topCategories.length === 0 ? (
        <p className="cycle-summary__empty">{t('andamento.noexpenses')}</p>
      ) : (
        <ul className="cycle-summary__list">
          {topCategories.map((row) => {
            const color = getCategoryColor(row.categoryId)
            return (
              <li key={row.categoryId} className="cycle-summary__row">
                {/* Il riquadro dell'icona prende il colore della categoria (lo stesso di Analisi). */}
                <span className="cycle-summary__row-emoji" aria-hidden="true" style={{ '--category-color': color }}>{row.category.emoji}</span>
                <span className="cycle-summary__row-body">
                  <span className="cycle-summary__row-line">
                    <span className="cycle-summary__row-label">{row.category.label}</span>
                    <span className="cycle-summary__row-amount">{formatCurrency(row.amount)}</span>
                  </span>
                  <span className="cycle-summary__row-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, row.share)}%`, background: color }} />
                  </span>
                </span>
                <span className="cycle-summary__row-share">{Math.round(row.share)}%</span>
              </li>
            )
          })}
        </ul>
      )}
      {cycle.categories.length > TOP_CATEGORIES && (
        <p className="cycle-summary__more">
          {/* Cita la scheda della barra in basso con il suo nome tradotto. */}
          {t(cycle.categories.length - TOP_CATEGORIES === 1 ? 'andamento.summary.moreone' : 'andamento.summary.moremany', { count: cycle.categories.length - TOP_CATEGORIES, tab: t('home.nav.analytics') })}
        </p>
      )}
    </section>
  )
}
