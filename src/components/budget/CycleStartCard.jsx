import { useAppStore } from '../../store/useAppStore.js'
import { formatCurrency } from '../../utils/format.js'
import { totalForPeriod } from '../../utils/budgetCalculations.js'
import { formatCycleLabel, getCycleRange, getPreviousCycleRange } from '../../utils/cycle.js'
import { parseAmountInput, isValidAmount } from '../../utils/amounts.js'
import {
  SALARY_CATEGORY_ID, extraIncomes, legacySalaryCycles, needsCycleConfirmation, needsLegacySalaryHistory, salaryForPeriod,
} from '../../utils/salary.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import { cycleLabelNames } from '../../i18n/cycleLabelNames.js'
import './CycleStartCard.css'

// In cima alla Home quando serve una risposta sul ciclo. Non cancella né
// azzera mai nulla: ogni ciclo è fatto delle SUE entrate e spese datate, che
// restano dove sono. Due domande, indipendenti:
//
// 1. Storico del vecchio modello (needsLegacySalaryHistory): prima del 7
//    ottobre 2026 lo stipendio era un numero unico senza ciclo, quindi i cicli
//    passati non hanno uno stipendio salvato e Andamento li mostra senza
//    entrate. L'utente scrive lo stipendio di ciascuno di quei cicli, che
//    diventa la sua entrata stipendio, datata al primo giorno del ciclo e
//    indicata come "impostazione precedente". Nessun importo viene proposto:
//    monthlyBudget è l'ultimo stipendio inserito, che può essere già quello di
//    un ciclo successivo, e non può ricostruire uno stipendio passato.
//    Nessun importo scritto, nessuna entrata.
// 2. Inizio del ciclo nuovo (needsCycleConfirmation): il ciclo precedente resta
//    in Andamento con i suoi numeri; il nuovo parte da 0 finché l'utente non
//    inserisce il nuovo stipendio.
export function CycleStartCard() {
  const { t, language } = useLanguage()
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
  // Le etichette dei cicli nella lingua scelta (solo il testo: date e confini restano quelli di range).
  const names = cycleLabelNames(language)
  const legacyLabel = legacyCycles.length === 1
    ? formatCycleLabel(legacyCycles[0], cycleStartDay, names)
    : t('budget.cycle.legacy.cycles', { count: legacyCycles.length })
  const fieldName = (range) => `legacySalary:${range.start}`

  // Ogni ciclo riceve SOLO l'importo scritto nel suo campo; un campo vuoto
  // non salva nulla (quel ciclo resta nella scheda, finché ha un importo o
  // l'utente sceglie "Non conservare").
  const handleKeepLegacy = (event) => {
    event.preventDefault()
    const fields = event.currentTarget.elements
    const store = useAppStore.getState()
    // Di nuovo al momento del tocco: un ciclo che nel frattempo ha ricevuto
    // uno stipendio (da qui o da un altro dispositivo) non ne riceve un altro.
    for (const range of legacySalaryCycles(store)) {
      const amount = parseAmountInput(fields[fieldName(range)]?.value)
      if (!isValidAmount(amount)) continue
      useAppStore.getState().addSalary({ amount, date: range.start, description: 'Stipendio (impostazione precedente)', keepLastSalary: true })
    }
  }

  const previousIncome = salaryForPeriod(incomes, previous) + totalForPeriod(extraIncomes(incomes), previous)
  const previousSpent = totalForPeriod(expenses, previous)

  return (
    <section className="cycle-start" aria-label={t('budget.cycle.label')}>
      {showLegacy && (
        <form className="cycle-start__part" onSubmit={handleKeepLegacy}>
          <p className="cycle-start__title">{t('budget.cycle.legacy.title')}</p>
          <p className="cycle-start__text">
            {t(legacyCycles.length === 1 ? 'budget.cycle.legacy.explainone' : 'budget.cycle.legacy.explainmany', { cycles: legacyLabel })}
          </p>
          <p className="cycle-start__text">
            {t(legacyCycles.length === 1 ? 'budget.cycle.legacy.askone' : 'budget.cycle.legacy.askmany')}
          </p>
          {legacyCycles.map((range) => (
            <label key={range.start} className="cycle-start__field">
              <span>{t('budget.cycle.legacy.field', { cycle: formatCycleLabel(range, cycleStartDay, names) })}</span>
              <input name={fieldName(range)} type="number" inputMode="decimal" placeholder={t('budget.cycle.legacy.placeholder')} defaultValue="" />
            </label>
          ))}
          <div className="cycle-start__actions">
            <button type="submit" className="cycle-start__primary">{t('budget.cycle.legacy.keep')}</button>
            <button type="button" className="cycle-start__link" onClick={() => useAppStore.getState().completeLegacySalaryHistory()}>
              {t('budget.cycle.legacy.skip')}
            </button>
          </div>
        </form>
      )}

      {showCycle && (
        <div className="cycle-start__part">
          <p className="cycle-start__title">{t('budget.cycle.fresh.title')}</p>
          <p className="cycle-start__text">
            {t('budget.cycle.fresh.previous', { cycle: formatCycleLabel(previous, cycleStartDay, names), income: money(previousIncome), spent: money(previousSpent) })}
          </p>
          <p className="cycle-start__text">
            {t('budget.cycle.fresh.current', { cycle: formatCycleLabel(current, cycleStartDay, names) })}
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
              {t('budget.cycle.fresh.addsalary')}
            </button>
            <button type="button" className="cycle-start__link" onClick={() => useAppStore.getState().confirmCycleStart(current.start)}>
              {t('budget.cycle.fresh.startzero')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
