import './ProgressBar.css'

// Shared by BudgetCard, GoalCard and AnalyticsPage — takes a plain 0-100
// value rather than computing ratios itself, so callers stay in control
// of what "value" means (spent-vs-budget, saved-vs-target, ...).
//
// `color` picks one of the preset gradient variants (mint/gold/violet)
// via a CSS class — the default, used where the color never changes at
// runtime. `colorValue` instead sets a literal CSS color as inline
// style on the SAME element (no class swap), which is what makes a
// runtime color change (BudgetCard's residuo-based mint/gold/coral
// thresholds) transition smoothly via `background-color` — swapping
// between two different gradient classes can't animate, a flat color
// value on one persistent element can.
export function ProgressBar({ value, color = 'mint', colorValue = null, trackClassName = '' }) {
  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div className={`progress-bar ${trackClassName}`}>
      <div
        className={`progress-bar__fill ${colorValue ? '' : `progress-bar__fill--${color}`}`}
        style={{ width: `${clamped}%`, ...(colorValue ? { background: colorValue } : {}) }}
      />
    </div>
  )
}
