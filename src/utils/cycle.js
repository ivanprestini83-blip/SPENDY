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
  // In un mese più corto del giorno di inizio (es. 31 in aprile) il ciclo
  // parte dall'ultimo giorno del mese, come già fa makeDate per la fine:
  // altrimenti quel giorno resterebbe fuori dal suo stesso ciclo.
  const startsThisMonth = day >= Math.min(cycleStartDay, daysInMonth(year, month))
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

// Le etichette dei cicli sono solo testo: date e confini restano quelli di
// `range`. Questo modulo resta logica pura, senza dizionari: i nomi dei mesi
// arrivano già tradotti in `names` ({ long, short, monthYear }, preparati da
// cycleLabelNames nella cartella delle traduzioni). Senza `names` è
// l'italiano di sempre: chi non lo passa vede le stesse etichette di prima.
export const ITALIAN_CYCLE_LABEL_NAMES = Object.freeze({
  long: Object.freeze([
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
  ]),
  short: Object.freeze(['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']),
  // "{month} {year}" ("Settembre 2026"); lo spagnolo usa "{month} de {year}".
  monthYear: '{month} {year}',
})

const namesOrDefault = (names) => names ?? ITALIAN_CYCLE_LABEL_NAMES

function shortDate(dateStr, names) {
  const [, month, day] = dateStr.split('-').map(Number)
  return `${day} ${names.short[month - 1]}`
}

// A human label for a cycle range — "Settembre 2026" when it's a plain
// calendar month (cycleStartDay is 1, or unset), "27 ago – 26 set"
// otherwise, since calling a Sep 27 - Oct 26 span "Settembre" would be
// misleading.
export function formatCycleLabel(range, cycleStartDay = 1, names) {
  const n = namesOrDefault(names)
  if (cycleStartDay === 1) {
    const [year, month] = range.start.split('-').map(Number)
    return n.monthYear.replace('{month}', n.long[month - 1]).replace('{year}', String(year))
  }
  return `${shortDate(range.start, n)} – ${shortDate(dayBefore(range.end), n)}`
}

// A short label for where ONE cycle starts — "Set" in calendar mode
// (just the month name), "27 Set" in custom-cycle mode. Used side by
// side (previous cycle / current cycle) where formatCycleLabel's own
// combined range string would be too long, e.g. Radar's before/after.
export function formatCycleStartLabel(range, cycleStartDay = 1, names) {
  const n = namesOrDefault(names)
  const [, month] = range.start.split('-').map(Number)
  if (cycleStartDay === 1) return n.short[month - 1]
  return shortDate(range.start, n)
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

// --- Dove siamo nel ciclo -------------------------------------------------
// L'UNICA fonte per "quanto manca" e "in che fase siamo", sempre sul ciclo
// impostato dall'utente (non sul mese solare). La usano buildFinancialData,
// il coach locale, BehaviorEngine/HumorEngine e il contesto di Spendy AI.
//
//   start / end            il ciclo [start, end) di getCycleRange
//   lastDay                l'ultimo giorno INCLUSO del ciclo (end - 1)
//   cycleDays              quanti giorni dura il ciclo
//   dayOfCycle             oggi è il giorno N del ciclo (1 … cycleDays)
//   daysRemaining          giorni DOPO oggi fino a lastDay: 0 nell'ultimo giorno
//   daysLeftIncludingToday daysRemaining + 1 (per la quota giornaliera)
//   elapsedPercent         dayOfCycle / cycleDays, in percentuale
//   phase                  una di CYCLE_PHASES (supabase/functions/_shared/cyclePhases.js)
const daysBetween = (fromDateStr, toDateStr) => {
  const [y1, m1, d1] = fromDateStr.split('-').map(Number)
  const [y2, m2, d2] = toDateStr.split('-').map(Number)
  // In UTC: nessun giorno di 23 o 25 ore al cambio dell'ora legale.
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

export function cyclePhaseFor({ dayOfCycle, cycleDays, daysRemaining }) {
  if (dayOfCycle <= 1) return 'new_cycle'
  if (daysRemaining <= 0) return 'last_day'
  if (daysRemaining <= 3) return 'final_days'
  const elapsed = dayOfCycle / cycleDays
  if (elapsed <= 0.15) return 'start'
  if (elapsed < 0.45) return 'first_half'
  if (elapsed <= 0.55) return 'mid'
  return 'second_half'
}

export function getCycleTiming(dateStr, cycleStartDay = 1) {
  const { start, end } = getCycleRange(dateStr, cycleStartDay)
  const lastDay = dayBefore(end)
  const cycleDays = daysBetween(start, end)
  const dayOfCycle = daysBetween(start, dateStr) + 1
  const daysRemaining = Math.max(0, daysBetween(dateStr, lastDay))
  return {
    start,
    end,
    lastDay,
    cycleDays,
    dayOfCycle,
    daysRemaining,
    daysLeftIncludingToday: daysRemaining + 1,
    elapsedPercent: Math.round((dayOfCycle / cycleDays) * 100),
    phase: cyclePhaseFor({ dayOfCycle, cycleDays, daysRemaining }),
  }
}
