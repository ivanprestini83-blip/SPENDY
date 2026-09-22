// Billing-cycle date math — lets "questo mese" mean "dal 27 al 27" instead
// of always the 1st-to-1st calendar month. `cycleStartDay` (1-31) is the
// day-of-month the user's cycle starts on; every function here defaults
// it to 1, which makes a cycle identical to a calendar month — so nothing
// that doesn't set a custom day behaves any differently than before.
//
// A cycle is a half-open range [start, end) of 'YYYY-MM-DD' strings — end
// is the NEXT cycle's start, same day-of-month one calendar month later
// (clamped to that month's last real day, e.g. day 31 in April -> 30).
// Plain string comparison works throughout since 'YYYY-MM-DD' sorts
// exactly like real dates.

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate() // month: 1-12
}

function makeDate(year, month, day) {
  let y = year
  let m = month
  if (m === 0) { m = 12; y -= 1 }
  if (m === 13) { m = 1; y += 1 }
  const clampedDay = Math.min(day, daysInMonth(y, m))
  return `${y}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

// The [start, end) cycle range that contains `dateStr`.
export function getCycleRange(dateStr, cycleStartDay = 1) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const startsThisMonth = day >= cycleStartDay
  const startMonth = startsThisMonth ? month : month - 1
  const startYear = startsThisMonth ? year : (startMonth === 0 ? year - 1 : year)

  const start = makeDate(startYear, startMonth === 0 ? 12 : startMonth, cycleStartDay)
  const end = makeDate(startYear, (startMonth === 0 ? 12 : startMonth) + 1, cycleStartDay)
  return { start, end }
}

// The cycle immediately before `range` — always exactly adjacent (its end
// equals this range's start), never re-derived from "today" so it can't
// drift out of sync with whichever range was actually passed in.
export function getPreviousCycleRange(range, cycleStartDay = 1) {
  const [year, month] = range.start.split('-').map(Number)
  const prevMonth = month - 1
  const prevYear = prevMonth === 0 ? year - 1 : year
  const start = makeDate(prevYear, prevMonth === 0 ? 12 : prevMonth, cycleStartDay)
  return { start, end: range.start }
}

// N cycles ending with (and including) the one containing `dateStr`,
// oldest first — the direct replacement for the old "lastMonths" idea,
// now cycle-aware instead of assuming calendar months.
export function lastCycles(dateStr, count, cycleStartDay = 1) {
  const ranges = [getCycleRange(dateStr, cycleStartDay)]
  for (let i = 1; i < count; i++) {
    ranges.unshift(getPreviousCycleRange(ranges[0], cycleStartDay))
  }
  return ranges
}

export function isWithinRange(dateStr, range) {
  return dateStr >= range.start && dateStr < range.end
}

const MONTH_LABELS_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]
const SHORT_MONTH_LABELS_IT = [
  'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
]

function shortDate(dateStr) {
  const [, month, day] = dateStr.split('-').map(Number)
  return `${day} ${SHORT_MONTH_LABELS_IT[month - 1]}`
}

// A human label for a cycle range — "Settembre 2026" when it's a plain
// calendar month (cycleStartDay is 1, or unset), "27 ago – 26 set"
// otherwise, since calling a Sep 27 - Oct 26 span "Settembre" would be
// misleading.
export function formatCycleLabel(range, cycleStartDay = 1) {
  if (cycleStartDay === 1) {
    const [year, month] = range.start.split('-').map(Number)
    return `${MONTH_LABELS_IT[month - 1]} ${year}`
  }
  return `${shortDate(range.start)} – ${shortDate(dayBefore(range.end))}`
}

// A short label for where ONE cycle starts — "Set" in calendar mode
// (just the month name), "27 Set" in custom-cycle mode. Used side by
// side (previous cycle / current cycle) where formatCycleLabel's own
// combined range string would be too long, e.g. Radar's before/after.
export function formatCycleStartLabel(range, cycleStartDay = 1) {
  const [, month] = range.start.split('-').map(Number)
  if (cycleStartDay === 1) return SHORT_MONTH_LABELS_IT[month - 1]
  return shortDate(range.start)
}

// One day before `dateStr` — used only to show the cycle's inclusive
// last day (the range itself is exclusive at `end`, which belongs to
// the NEXT cycle).
function dayBefore(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
