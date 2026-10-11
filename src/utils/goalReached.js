// QUANDO UN OBIETTIVO È STATO RAGGIUNTO, e fino a quando si festeggia.
//
// Fase 2B.8. Prima Spendy festeggiava un obiettivo completato finché
// l'obiettivo esisteva (saved >= target, nessuna data): la festa copriva
// per sempre gli avvisi sul budget. Ora:
//
//   reachedOn  il giorno (locale, 'YYYY-MM-DD') del versamento con cui il
//              totale ha raggiunto il target. È DERIVATO come `saved`, dai
//              versamenti che già esistono e si sincronizzano: nessuna
//              colonna nuova, nessuna migrazione, e non viaggia mai verso il
//              server (goalToRemote invia solo i campi che elenca).
//              null = non raggiunto, oppure raggiunto in una data che non si
//              conosce (versamento ricostruito da una vecchia migrazione,
//              "gc-legacy-…", o senza data): nessuna festa.
//   finestra   si festeggia il giorno del raggiungimento e quello dopo
//              (GOAL_CELEBRATION_DAYS). Una data "di domani" (versamento
//              fatto su un dispositivo con un fuso più avanti) conta come
//              giorno del raggiungimento.
//
// Funzioni pure: le usano lo store (recomputeGoals), l'import dei backup,
// il coach locale e gli eventi di Spendy AI, così scelgono tutti lo stesso
// obiettivo.

export const GOAL_CELEBRATION_DAYS = 2
export const LEGACY_CONTRIBUTION_PREFIX = 'gc-legacy-'

const cents = (value) => Math.round(Number(value) * 100)
const DAY = /^\d{4}-\d{2}-\d{2}$/

// I versamenti si sommano giorno per giorno, in ordine di data: l'ordine
// dentro lo stesso giorno non cambia il giorno in cui si supera il target,
// quindi il risultato è lo stesso su ogni dispositivo.
export function goalReachedOn(goal, contributions = []) {
  const targetCents = cents(goal?.target)
  if (!(targetCents > 0)) return null
  const days = new Map()
  for (const contribution of contributions) {
    if (contribution?.goalId !== goal.id) continue
    const date = typeof contribution.date === 'string' && DAY.test(contribution.date) ? contribution.date : ''
    const day = days.get(date) ?? { cents: 0, unknown: date === '' }
    day.cents += cents(contribution.amount) || 0
    if (String(contribution.id ?? '').startsWith(LEGACY_CONTRIBUTION_PREFIX)) day.unknown = true
    days.set(date, day)
  }
  let total = 0
  for (const date of [...days.keys()].sort()) {
    const day = days.get(date)
    total += day.cents
    if (total >= targetCents) return day.unknown ? null : date
  }
  return null
}

// Giorni da `from` a `to` (date locali 'YYYY-MM-DD'), senza fusi orari.
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

export function isInCelebrationWindow(reachedOn, today) {
  if (typeof reachedOn !== 'string' || !DAY.test(reachedOn) || typeof today !== 'string' || !DAY.test(today)) return false
  const days = daysBetween(reachedOn, today)
  return days >= -1 && days < GOAL_CELEBRATION_DAYS
}

// L'obiettivo da festeggiare oggi: raggiunto, dentro la finestra, il più
// recente. Un obiettivo senza il campo `reachedOn` (non passato da
// recomputeGoals: per esempio chi chiama il coach con dati costruiti a mano)
// si comporta come prima, cioè si festeggia finché è completo.
export function findCelebratedGoal(goals = [], today) {
  const reached = (goals ?? []).filter((goal) => goal && goal.saved >= goal.target)
  const celebrated = reached.filter((goal) => goal.reachedOn === undefined || isInCelebrationWindow(goal.reachedOn, today))
  if (celebrated.length === 0) return null
  return [...celebrated].sort((a, b) => String(b.reachedOn ?? '').localeCompare(String(a.reachedOn ?? '')))[0]
}
