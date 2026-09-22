// All expense dates are stored as 'YYYY-MM-DD' strings — sortable and
// comparable as plain strings, no timezone-aware Date math needed for the
// same-day check below. Calendar-month/cycle math lives in cycle.js.

export function isSameDay(dateStr, reference) {
  return dateStr === reference
}

// Local calendar date, not UTC — toISOString() would read as "yesterday"
// for anyone east of UTC in the evening (e.g. Italy, UTC+1/+2), which
// would silently misfile a real "oggi" expense into the wrong day/cycle.
export function todayStr() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
