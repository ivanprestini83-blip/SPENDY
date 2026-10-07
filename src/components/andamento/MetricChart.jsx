import './MetricChart.css'

// Il piccolo grafico a linea che si apre sotto una metrica di "Confronta
// periodi": due punti (periodo precedente → periodo attuale) uniti da una
// linea morbida, il valore sopra ogni punto e il ciclo sotto.
//
// Non calcola niente: riceve i valori già prodotti da buildAndamento /
// compareCycles (via CycleComparison) e le stringhe già formattate. Un valore
// `null` è un dato assente (per esempio nessuna entrata registrata): il punto
// resta vuoto, senza linea, e non viene mai disegnato come 0.

const WIDTH = 300
const HEIGHT = 128
const XS = [64, 236]
const TOP = 32
const BOTTOM = 92

export function MetricChart({ id, title, color, points, summary, summaryTone, sentence, notes = [] }) {
  const present = points.map((point) => point.value).filter((value) => value !== null)
  const low = Math.min(0, ...present)
  let high = Math.max(0, ...present)
  if (high === low) high = low + 1
  const y = (value) => BOTTOM - ((value - low) / (high - low)) * (BOTTOM - TOP)
  const ys = points.map((point) => (point.value === null ? BOTTOM : y(point.value)))
  const both = points.every((point) => point.value !== null)
  const path = `M ${XS[0]} ${ys[0]} C ${XS[0] + 70} ${ys[0]}, ${XS[1] - 70} ${ys[1]}, ${XS[1]} ${ys[1]}`

  return (
    <div id={id} className={`metric-chart metric-chart--${color}`} role="region" aria-label={title}>
      <p className="metric-chart__title">{title}</p>
      <p className="metric-chart__periods">
        {points[0].period ?? points[0].label} <span aria-hidden="true">→</span> {points[1].period ?? points[1].label}
      </p>

      <svg
        className="metric-chart__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${title}: ${points.map((point) => `${point.label} ${point.text}`).join(', ')}`}
      >
        {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map((lineY) => (
          <line key={lineY} className="metric-chart__grid" x1="16" x2={WIDTH - 16} y1={lineY} y2={lineY} />
        ))}
        {both && <path className="metric-chart__line" d={path} pathLength="1" />}
        {points.map((point, index) => (
          <g key={point.label} className="metric-chart__point">
            <circle
              className={point.value === null ? 'metric-chart__dot metric-chart__dot--missing' : 'metric-chart__dot'}
              cx={XS[index]}
              cy={ys[index]}
              r="5.5"
            />
            <text className="metric-chart__value" x={XS[index]} y={Math.max(14, ys[index] - 12)} textAnchor="middle">
              {point.text}
            </text>
            <text className="metric-chart__label" x={XS[index]} y={HEIGHT - 10} textAnchor="middle">
              {point.label}
            </text>
          </g>
        ))}
      </svg>

      {summary && <p className={`metric-chart__summary metric-chart__summary--${summaryTone}`}>{summary}</p>}
      {sentence && <p className="metric-chart__sentence">{sentence}</p>}
      {notes.map((note) => <p key={note} className="metric-chart__note">{note}</p>)}
    </div>
  )
}

// Quando il confronto non esiste (per esempio il budget senza uno stipendio
// in uno dei due periodi): nessun grafico, nessun valore inventato.
export function MetricChartUnavailable({ id, title, message, explanation }) {
  return (
    <div id={id} className="metric-chart metric-chart--unavailable" role="region" aria-label={title}>
      <p className="metric-chart__title">{title}</p>
      <p className="metric-chart__summary metric-chart__summary--flat">{message}</p>
      <p className="metric-chart__sentence">{explanation}</p>
    </div>
  )
}
