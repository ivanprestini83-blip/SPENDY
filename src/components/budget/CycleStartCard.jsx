import { useAppStore } from '../../store/useAppStore.js'
import { formatCurrency } from '../../utils/format.js'
import { totalForPeriod } from '../../utils/budgetCalculations.js'
import { formatCycleLabel, getCycleRange, getPreviousCycleRange } from '../../utils/cycle.js'
import { parseAmountInput, isValidAmount } from '../../utils/amounts.js'
import {
  SALARY_CATEGORY_ID, extraIncomes, legacySalaryCycles, needsCycleConfirmation, needsLegacySalaryHistory, salaryForPeriod,
} from '../../utils/salary.js'
import './CycleStartCard.css'

// In cima alla Home quando serve una risposta sul ciclo. Non cancella né
// azzera mai nulla: ogni ciclo è fatto delle SUE entrate e spese datate, che
// restano dove sono. Due domande, indipendenti:
//
// 1. Storico del vecchio modello (needsLegacySalaryHistory): prima del 7
//    ottobre 2026 lo stipendio era un numero unico senza ciclo, quindi i cicli
//    passati non hanno uno stipendio salvato e Andamento li mostra senza
//    entrate. Con la conferma dell'utente, l'importo (modificabile) diventa
//    l'entrata stipendio di ciascuno di quei cicli, datata al suo primo giorno
//    e indicata come "impostazione precedente". Nessuna conferma, nessuna
//    entrata.
// 2. Inizio del ciclo nuovo (needsCycleConfirmation): il ciclo precedente resta
//    in Andamento con i suoi numeri; il nuovo parte da 0 finché l'utente non
//    inserisce il nuovo stipendio.
export function CycleStartCard() {
  const today = useAppStore((s) => s.today)
  const incomes = useAppStore((s) => s.incomes)
  const expenses = useAppStore((s) => s.expenses)
  const monthlyBudget = useAppStore((s) => s.monthlyBudget)
  const amountHidden = useAppStore((s) => s.amountHidden)
  const sync = useAppStore((s) => s.sync)
  const legacySalaryHistoryDone = useAppStore((s) => s.legacySalaryHistoryDone)
  const confirmedCycleStart = useAppStore((s) => s.confirmedCycleStart)
  const cycleStartDay = useAppStore((s) => s.cycleStartDay) ?? 1
  const state = { today, incomes, expenses, monthlyBudget, sync, legacySalaryHistoryDone, confirmedCycleStart, cycleStartDay }
  const showLegacy = needsLegacySalaryHistory(state)
  const showCycle = needsCycleConfirmation(state)
  if (!showLegacy && !showCycle) return null

  const money = (value) => (amountHidden ? '•••• €' : formatCurrency(value))
  const current = getCycleRange(today, cycleStartDay)
  const previous = getPreviousCycleRange(current, cycleStartDay)
  const legacyCycles = showLegacy ? legacySalaryCycles({ expenses, incomes, today, cycleStartDay }) : []
  const legacyLabel = legacyCycles.length === 1
    ? formatCycleLabel(legacyCycles[0], cycleStartDay)
    : `${legacyCycles.length} cicli precedenti`

  const handleKeepLegacy = (event) => {
    event.preventDefault()
    const amount = parseAmountInput(event.currentTarget.elements.legacySalary?.value)
    if (!isValidAmount(amount)) return
    const store = useAppStore.getState()
    // Di nuovo al momento del tocco: un ciclo che nel frattempo ha ricevuto
    // uno stipendio (da qui o da un altro dispositivo) non ne riceve un altro.
    for (const range of legacySalaryCycles(store)) {
      store.addSalary({ amount, date: range.start, description: 'Stipendio (impostazione precedente)', keepLastSalary: true })
    }
    useAppStore.getState().completeLegacySalaryHistory()
  }

  const previousIncome = salaryForPeriod(incomes, previous) + totalForPeriod(extraIncomes(incomes), previous)
  const previousSpent = totalForPeriod(expenses, previous)

  return (
    <section className="cycle-start" aria-label="Il tuo ciclo">
      {showLegacy && (
        <form className="cycle-start__part" onSubmit={handleKeepLegacy}>
          <p className="cycle-start__title">Stipendio dei cicli precedenti</p>
          <p className="cycle-start__text">
            Prima dell&apos;aggiornamento SPENDY usava un unico stipendio impostato ({money(monthlyBudget)}), che non era salvato
            come entrata di nessun ciclo: per questo in Andamento {legacyLabel} {legacyCycles.length === 1 ? 'risulta' : 'risultano'} senza entrate.
          </p>
          <p className="cycle-start__text">Vuoi conservarlo come stipendio di {legacyCycles.length === 1 ? 'quel ciclo' : 'quei cicli'}? Puoi correggere l&apos;importo.</p>
          <label className="cycle-start__field">
            <span>Stipendio di {legacyLabel}</span>
            <input name="legacySalary" type="number" inputMode="decimal" defaultValue={monthlyBudget > 0 ? String(monthlyBudget) : ''} />
          </label>
          <div className="cycle-start__actions">
            <button type="submit" className="cycle-start__primary">Conserva nello storico</button>
            <button type="button" className="cycle-start__link" onClick={() => useAppStore.getState().completeLegacySalaryHistory()}>
              Non conservare
            </button>
          </div>
        </form>
      )}

      {showCycle && (
        <div className="cycle-start__part">
          <p className="cycle-start__title">È iniziato un nuovo ciclo</p>
          <p className="cycle-start__text">
            Il ciclo {formatCycleLabel(previous, cycleStartDay)} resta salvato in Andamento: entrate {money(previousIncome)}, spese {money(previousSpent)}.
          </p>
          <p className="cycle-start__text">
            Il nuovo ciclo ({formatCycleLabel(current, cycleStartDay)}) parte da 0 €: entrate e disponibile restano a zero finché non inserisci il nuovo stipendio.
          </p>
          <div className="cycle-start__actions">
            <button
              type="button"
              className="cycle-start__primary"
              onClick={() => {
                useAppStore.getState().confirmCycleStart(current.start)
                useAppStore.getState().openModal('quickAdd', { type: 'income', categoryId: SALARY_CATEGORY_ID })
              }}
            >
              Inserisci il nuovo stipendio
            </button>
            <button type="button" className="cycle-start__link" onClick={() => useAppStore.getState().confirmCycleStart(current.start)}>
              Inizia il ciclo da 0 €
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
