// One fixed color per category, for the Analisi donut chart/legend —
// fixed by categoryId (not by sort order) so a category keeps the same
// color from month to month regardless of how big its slice is this
// time. Purely a chart-legend concern, unrelated to the state/tone
// colors used elsewhere (SpendyStateBadge, ProgressBar's mint/gold/coral).
export const CATEGORY_COLORS = {
  casa: '#6d5cf0',
  carburante: '#ff8a3d',
  spesa: '#12b886',
  ristoranti: '#f4645f',
  bar: '#c68b3a',
  farmacia: '#ff5da2',
  salute: '#38c6c6',
  trasporti: '#3aa9ff',
  shopping: '#ff8fc7',
  tecnologia: '#5c6bff',
  abbonamenti: '#7c5cff',
  svago: '#f0ab1f',
  viaggi: '#2ec4b6',
  sport: '#e0479e',
  abbigliamento: '#a685ff',
  istruzione: '#4d8dff',
  animali: '#c9a15a',
  altro: '#98a1b3',
}

// Custom categories get a color assigned from this rotation the first
// time they're seen, cached here for the session — deterministic within
// a session, doesn't need to be stable across reloads the way the fixed
// map above is (a custom category's chart color shifting slightly after
// a reload is a fair trade for not needing to persist yet another field).
const FALLBACK_PALETTE = ['#6d5cf0', '#12b886', '#f4645f', '#3aa9ff', '#ff8fc7', '#f0ab1f', '#38c6c6', '#a685ff']
const fallbackAssignments = new Map()

export function getCategoryColor(categoryId) {
  if (CATEGORY_COLORS[categoryId]) return CATEGORY_COLORS[categoryId]
  if (!fallbackAssignments.has(categoryId)) {
    fallbackAssignments.set(categoryId, FALLBACK_PALETTE[fallbackAssignments.size % FALLBACK_PALETTE.length])
  }
  return fallbackAssignments.get(categoryId)
}
