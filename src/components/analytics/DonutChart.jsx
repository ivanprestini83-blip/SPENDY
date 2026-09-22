import './DonutChart.css'

// A plain SVG ring built from stroke-dasharray/-dashoffset — no chart
// library (none exists in this project, and one lightweight ring like
// this isn't worth adding a dependency for). `segments` is
// [{ id, color, value }, ...]; each one gets an arc proportional to
// value/total, starting at 12 o'clock and going clockwise.
export function DonutChart({ segments, size = 220, thickness = 30, centerLabel, centerValue }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius

  const { arcs } = segments
    .filter((segment) => segment.value > 0)
    .reduce(
      (acc, segment) => {
        const fraction = total > 0 ? segment.value / total : 0
        const dash = fraction * circumference
        acc.arcs.push({ ...segment, dash, dashOffset: acc.cumulative })
        acc.cumulative += dash
        return acc
      },
      { arcs: [], cumulative: 0 },
    )

  return (
    <div className="donut-chart" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${centerLabel}: ${centerValue}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-surface-raised)" strokeWidth={thickness} />
        {arcs.map((arc) => (
          <circle
            key={arc.id}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={thickness}
            strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
            strokeDashoffset={-arc.dashOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="butt"
          />
        ))}
      </svg>

      <div className="donut-chart__center">
        <span className="donut-chart__center-label">{centerLabel}</span>
        <span className="donut-chart__center-value">{centerValue}</span>
      </div>
    </div>
  )
}
