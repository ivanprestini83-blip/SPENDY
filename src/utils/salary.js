// Lo stipendio è un'entrata come le altre (tabella `incomes`), con
// categoryId 'stipendio' e una data: appartiene al ciclo in cui cade quella
// data, e solo a quello.
//
//  - Un ciclo senza stipendio registrato ha stipendio 0: nessuno stipendio
//    viene creato o ereditato quando inizia un ciclo nuovo.
//  - Cambiare lo stipendio di un ciclo non tocca gli altri cicli.
//  - Le "entrate extra" sono tutte le entrate TRANNE lo stipendio, così lo
//    stipendio non viene mai contato due volte.
//
// `monthlyBudget` nello store non è più lo stipendio di nessun ciclo: resta
// solo come "ultimo stipendio inserito" (precompilazione, obiettivo del fondo
// emergenza, versioni precedenti dell'app).
import { getCycleRange, getPreviousCycleRange, isWithinRange } from './cycle.js'

export const SALARY_CATEGORY_ID = 'stipendio'

export const isSalary = (income) => income?.categoryId === SALARY_CATEGORY_ID

export const extraIncomes = (incomes = []) => incomes.filter((income) => !isSalary(income))

export const salaryForPeriod = (incomes = [], range) =>
  incomes
    .filter((income) => isSalary(income) && isWithinRange(income.date, range))
    .reduce((sum, income) => sum + income.amount, 0)

// Lo stipendio del ciclo in corso: 0 finché l'utente non lo inserisce.
export const currentCycleSalary = (incomes, today, cycleStartDay = 1) =>
  salaryForPeriod(incomes, getCycleRange(today, cycleStartDay ?? 1))

// L'ultimo stipendio conosciuto: il più recente per data (a parità, l'ultimo
// modificato), altrimenti `fallback` (il vecchio monthlyBudget). Serve SOLO a
// precompilare il campo: non è lo stipendio di nessun ciclo finché l'utente
// non lo conferma.
export function lastKnownSalary(incomes = [], fallback = 0) {
  const latest = incomes
    .filter(isSalary)
    .reduce((best, income) => {
      if (!best) return income
      if (income.date !== best.date) return income.date > best.date ? income : best
      return (income.updatedAt ?? '') > (best.updatedAt ?? '') ? income : best
    }, null)
  if (latest) return latest.amount
  return fallback > 0 ? fallback : 0
}

// --- inizio di un ciclo nuovo e storico del vecchio modello ------------------
//
// Fino al rilascio del 7 ottobre 2026 lo stipendio era un numero unico
// (monthlyBudget) senza ciclo: Andamento lo mostrava su ogni ciclo, ma nessun
// ciclo lo aveva salvato. I cicli finiti PRIMA di questa data che hanno dati
// ma nessuno stipendio registrato sono quelli del vecchio modello: l'utente può
// confermare di conservarne lo stipendio come entrata di quel ciclo (vedi
// components/budget/CycleStartCard). Mai il ciclo in corso, mai i successivi.
export const LEGACY_SALARY_MODEL_END = '2026-10-07'

// Il prima possibile, i cicli più vecchi: non più di un anno, come Andamento.
const MAX_PAST_CYCLES = 12

const hasEntryIn = (entries, range) => entries.some((entry) => isWithinRange(entry.date, range))

// I cicli passati (dal più recente) a partire dal primo con dati.
export function pastCyclesWithData({ expenses = [], incomes = [], today, cycleStartDay = 1 }) {
  const entries = [...expenses, ...incomes]
  const current = getCycleRange(today, cycleStartDay ?? 1)
  const earliest = entries.reduce((min, entry) => (typeof entry.date === 'string' && entry.date < min ? entry.date : min), current.start)
  const ranges = []
  let range = current
  while (ranges.length < MAX_PAST_CYCLES && earliest < range.start) {
    range = getPreviousCycleRange(range, cycleStartDay ?? 1)
    if (hasEntryIn(entries, range)) ranges.push(range)
  }
  return ranges
}

// Cicli del vecchio modello ancora senza stipendio registrato.
export const legacySalaryCycles = ({ expenses = [], incomes = [], today, cycleStartDay = 1 }) =>
  pastCyclesWithData({ expenses, incomes, today, cycleStartDay })
    .filter((range) => range.end <= LEGACY_SALARY_MODEL_END && salaryForPeriod(incomes, range) === 0)

// Con un account, solo dopo almeno un sync completo: prima, dati inseriti da
// un altro dispositivo potrebbero non essere ancora arrivati.
const synced = (sync = {}) => !sync.userId || Boolean(sync.lastSyncAt)

// Proporre di conservare il vecchio stipendio nei cicli del vecchio modello.
export const needsLegacySalaryHistory = (state = {}) =>
  (state.monthlyBudget ?? 0) > 0
  && !state.legacySalaryHistoryDone
  && synced(state.sync)
  && legacySalaryCycles(state).length > 0

// Chiedere conferma dell'inizio del ciclo in corso: non ancora confermato su
// questo dispositivo, senza uno stipendio inserito, e solo per chi ha già dei
// cicli passati (un utente al primo ciclo non ha nulla da "chiudere").
export function needsCycleConfirmation(state = {}) {
  if (!state.today || !synced(state.sync)) return false
  const current = getCycleRange(state.today, state.cycleStartDay ?? 1)
  return state.confirmedCycleStart !== current.start
    && salaryForPeriod(state.incomes ?? [], current) === 0
    && pastCyclesWithData(state).length > 0
}
