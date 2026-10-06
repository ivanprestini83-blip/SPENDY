import { useAppStore } from '../../store/useAppStore.js'
import { formatCurrency } from '../../utils/format.js'
import { isSalary, needsSalaryTransition, SALARY_CATEGORY_ID } from '../../utils/salary.js'
import './SalaryTransitionCard.css'

// Una sola volta, per chi ha ancora solo il vecchio stipendio unico
// (monthlyBudget) e nessuno stipendio registrato per ciclo: spiega il nuovo
// modo e chiede che cosa fare. Nessuna data viene inventata e nessuna entrata
// nasce senza un tocco esplicito:
//  - "Inserisci X": uno stipendio normale, datato oggi, nel ciclo corrente;
//  - "Inserisci un altro importo": l'inserimento normale dello stipendio;
//  - "Non ora": niente; il ciclo resta con stipendio 0.
// Qualunque risposta chiude la scheda per sempre (salaryTransitionDone).
export function SalaryTransitionCard() {
  const monthlyBudget = useAppStore((state) => state.monthlyBudget)
  const incomes = useAppStore((state) => state.incomes)
  const salaryTransitionDone = useAppStore((state) => state.salaryTransitionDone)
  const sync = useAppStore((state) => state.sync)
  const today = useAppStore((state) => state.today)
  const amountHidden = useAppStore((state) => state.amountHidden)
  const addSalary = useAppStore((state) => state.addSalary)
  const completeSalaryTransition = useAppStore((state) => state.completeSalaryTransition)
  const openModal = useAppStore((state) => state.openModal)

  if (!needsSalaryTransition({ monthlyBudget, incomes, salaryTransitionDone, sync })) return null

  const amount = amountHidden ? '•••• €' : formatCurrency(monthlyBudget)

  const handleInsert = () => {
    // Doppio tocco, o uno stipendio arrivato nel frattempo da un altro
    // dispositivo: mai un duplicato.
    if (!useAppStore.getState().incomes.some(isSalary)) addSalary({ amount: monthlyBudget, date: today, description: 'Stipendio' })
    completeSalaryTransition()
  }
  const handleOther = () => {
    completeSalaryTransition()
    openModal('quickAdd', { type: 'income', categoryId: SALARY_CATEGORY_ID })
  }

  return (
    <section className="salary-transition" aria-labelledby="salary-transition-title">
      <p id="salary-transition-title" className="salary-transition__title">Nuovo modo di gestire lo stipendio</p>
      <p className="salary-transition__text">
        Da ora SPENDY registra lo stipendio per ogni ciclo, così puoi cambiarlo ogni mese.
      </p>
      <p className="salary-transition__text">
        Hai ancora {amount} come ultimo stipendio salvato. Vuoi inserirlo nel ciclo corrente?
      </p>
      <div className="salary-transition__actions">
        <button type="button" className="salary-transition__primary" onClick={handleInsert}>
          {amountHidden ? 'Inserisci l\'ultimo stipendio' : `Inserisci ${formatCurrency(monthlyBudget)}`}
        </button>
        <button type="button" className="salary-transition__secondary" onClick={handleOther}>
          Inserisci un altro importo
        </button>
        <button type="button" className="salary-transition__link" onClick={completeSalaryTransition}>
          Non ora
        </button>
      </div>
    </section>
  )
}
