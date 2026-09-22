import { useState } from 'react'
import { useAppStore } from '../store/useAppStore.js'
import { categoryComparison, totalForMonth } from '../utils/budgetCalculations.js'
import { formatCurrency, formatSignedPercent } from '../utils/format.js'
import { lastCycles, formatCycleLabel } from '../utils/cycle.js'
import { getCategoryColor } from '../data/categoryColors.js'
import { DonutChart } from '../components/analytics/DonutChart.jsx'
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
  const today = useAppStore((state) => state.today)
  const expenses = useAppStore((state) => state.expenses)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1

  const [cyclesBack, setCyclesBack] = useState(0) // 0 = ciclo corrente, 1 = precedente, ...

  const viewedRange = lastCycles(today, cyclesBack + 1, cycleStartDay)[0]
  const viewedReferenceDate = viewedRange.start

  const monthTotal = totalForMonth(expenses, viewedReferenceDate, cycleStartDay)
  const rows = categoryComparison(expenses, viewedReferenceDate, cycleStartDay)
    .filter((row) => row.current > 0)
    .sort((a, b) => b.current - a.current)

  const segments = rows.map((row) => ({
    id: row.categoryId,
    value: row.current,
    color: getCategoryColor(row.categoryId),
  }))

  return (
    <div className="analytics-page">
      <div className="analytics-page__period">
        <button
          type="button"
          className="analytics-page__period-nav"
          onClick={() => setCyclesBack((n) => n + 1)}
          aria-label="Periodo precedente"
        >
          ←
        </button>
        <p className="analytics-page__heading">{formatCycleLabel(viewedRange, cycleStartDay)}</p>
        <button
          type="button"
          className="analytics-page__period-nav"
          onClick={() => setCyclesBack((n) => Math.max(0, n - 1))}
          disabled={cyclesBack === 0}
          aria-label="Periodo successivo"
        >
          →
        </button>
      </div>

      {monthTotal > 0 ? (
        <>
          <DonutChart segments={segments} centerLabel="Totale" centerValue={formatCurrency(monthTotal)} />

          <ul className="analytics-page__legend">
            {rows.map((row) => {
              const share = (row.current / monthTotal) * 100
              const isIncrease = row.previous > 0 && row.changeAmount > 0
              const isDecrease = row.previous > 0 && row.changeAmount < 0

              return (
                <li key={row.categoryId} className="analytics-page__legend-row">
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
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <p className="analytics-page__empty">Nessuna spesa registrata in questo periodo.</p>
      )}
    </div>
  )
}
