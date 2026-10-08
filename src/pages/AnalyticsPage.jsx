import { useState } from 'react'
import { useAppStore } from '../store/useAppStore.js'
import { categoryComparison, totalForMonth } from '../utils/budgetCalculations.js'
import { formatCurrency, formatSignedPercent } from '../utils/format.js'
import { lastCycles, formatCycleLabel } from '../utils/cycle.js'
import { getCategoryColor } from '../data/categoryColors.js'
import { DonutChart } from '../components/analytics/DonutChart.jsx'
import { CategoryDetailModal } from '../components/modals/CategoryDetailModal.jsx'
import { buildCategoryDetail } from '../utils/categoryDetail.js'
import { useLanguage } from '../i18n/useLanguage.js'
import './AnalyticsPage.css'

// Real spending by category for the SELECTED cycle — current by default,
// but ← / → let you browse past cycles ("sezione dei mesi scorsi"),
// reusing the exact same categoryComparison/totalForMonth this page
// always used: passing any date inside a cycle (here, that cycle's own
// start) makes them compute totals for THAT cycle instead of the one
// containing `today`, so no new calculation function was needed. Re-
// renders (and therefore the donut/legend) update automatically whenever
// `expenses`/`today`/the selected cycle change.
export function AnalyticsPage() {
  const { t } = useLanguage()
  const today = useAppStore((state) => state.today)
  const expenses = useAppStore((state) => state.expenses)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const openModal = useAppStore((state) => state.openModal)

  const [cyclesBack, setCyclesBack] = useState(0) // 0 = ciclo corrente, 1 = precedente, ...
  // Categoria toccata nella legenda: apre il dettaglio delle sue spese per
  // il ciclo mostrato qui sopra (vedi CategoryDetailModal).
  const [openCategoryId, setOpenCategoryId] = useState(null)

  const viewedRange = lastCycles(today, cyclesBack + 1, cycleStartDay)[0]
  const viewedReferenceDate = viewedRange.start

  const monthTotal = totalForMonth(expenses, viewedReferenceDate, cycleStartDay)
  const rows = categoryComparison(expenses, viewedReferenceDate, cycleStartDay)
    .filter((row) => row.current > 0)
    .sort((a, b) => b.current - a.current)

  // Ricalcolato dallo store a ogni render, per il ciclo selezionato: stesso
  // filtro di categoryComparison, quindi il totale del dettaglio è quello
  // della riga toccata.
  const categoryDetail = openCategoryId
    ? buildCategoryDetail(expenses, openCategoryId, viewedReferenceDate, cycleStartDay)
    : null

  const segments = rows.map((row) => ({
    id: row.categoryId,
    value: row.current,
    color: getCategoryColor(row.categoryId),
  }))

  return (
    <div className="analytics-page">
      {/* Andamento vive qui, come il Radar vive nella tab Spendy: la barra
          in basso resta 2 + "+" + 2 (vedi mockNavItems), e "come sto
          andando nel tempo" è il naturale passo dopo "dove sono finiti i
          soldi questo mese". */}
      <button type="button" className="analytics-page__trend" onClick={() => openModal('andamento')}>
        <span className="analytics-page__trend-icon" aria-hidden="true">📈</span>
        <span className="analytics-page__trend-text">
          <span className="analytics-page__trend-title">{t('andamento.title')}</span>
          <span className="analytics-page__trend-subtitle">{t('analytics.trendsubtitle')}</span>
        </span>
        <span className="analytics-page__trend-arrow" aria-hidden="true">→</span>
      </button>

      <div className="analytics-page__period">
        <button
          type="button"
          className="analytics-page__period-nav"
          onClick={() => setCyclesBack((n) => n + 1)}
          aria-label={t('analytics.prev')}
        >
          ←
        </button>
        <p className="analytics-page__heading">{formatCycleLabel(viewedRange, cycleStartDay)}</p>
        <button
          type="button"
          className="analytics-page__period-nav"
          onClick={() => setCyclesBack((n) => Math.max(0, n - 1))}
          disabled={cyclesBack === 0}
          aria-label={t('analytics.next')}
        >
          →
        </button>
      </div>

      {monthTotal > 0 ? (
        <>
          <DonutChart segments={segments} centerLabel={t('analytics.total')} centerValue={formatCurrency(monthTotal)} />

          <ul className="analytics-page__legend">
            {rows.map((row) => {
              const share = (row.current / monthTotal) * 100
              const isIncrease = row.previous > 0 && row.changeAmount > 0
              const isDecrease = row.previous > 0 && row.changeAmount < 0

              return (
                <li key={row.categoryId}>
                  <button
                    type="button"
                    className="analytics-page__legend-row analytics-page__legend-row--button"
                    onClick={() => setOpenCategoryId(row.categoryId)}
                  >
                    <span
                      className="analytics-page__legend-dot"
                      style={{ background: getCategoryColor(row.categoryId) }}
                      aria-hidden="true"
                    />
                    <span className="analytics-page__legend-label">
                      <span aria-hidden="true">{row.category.emoji}</span> {row.category.label}
                    </span>
                    <span className="analytics-page__legend-amount">{formatCurrency(row.current)}</span>
                    <span className="analytics-page__legend-percent">{Math.round(share)}%</span>
                    {row.previous > 0 && (
                      <span
                        className={`analytics-page__legend-change ${
                          isIncrease ? 'analytics-page__legend-change--up' : isDecrease ? 'analytics-page__legend-change--down' : ''
                        }`}
                      >
                        {formatSignedPercent(row.changePercent)}
                      </span>
                    )}
                    <span className="analytics-page__legend-chevron" aria-hidden="true">›</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <p className="analytics-page__empty">{t('analytics.empty')}</p>
      )}

      {categoryDetail && (
        <CategoryDetailModal
          detail={categoryDetail}
          periodLabel={formatCycleLabel(viewedRange, cycleStartDay)}
          onClose={() => setOpenCategoryId(null)}
        />
      )}
    </div>
  )
}
