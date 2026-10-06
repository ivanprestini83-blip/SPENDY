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
import { getCycleRange, isWithinRange } from './cycle.js'

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

// La scheda di passaggio (components/budget/SalaryTransitionCard) va mostrata
// solo a chi ha ancora SOLO il vecchio stipendio unico:
//  - monthlyBudget > 0 e nessuna entrata "stipendio" (chi ne ha già una usa
//    il nuovo modello e non vede nulla);
//  - non ancora risposto su questo dispositivo per questo account;
//  - con un account, solo dopo almeno un sync completo: prima, gli stipendi
//    inseriti da un altro dispositivo potrebbero non essere ancora arrivati, e
//    la scheda proporrebbe un duplicato.
export const needsSalaryTransition = ({ monthlyBudget = 0, incomes = [], salaryTransitionDone = false, sync = {} } = {}) =>
  monthlyBudget > 0
  && !salaryTransitionDone
  && !incomes.some(isSalary)
  && (!sync.userId || Boolean(sync.lastSyncAt))
