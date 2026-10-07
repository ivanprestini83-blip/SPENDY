import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { formatCurrency } from '../../utils/format.js'
import { formatCycleLabel, getCycleRange, isWithinRange } from '../../utils/cycle.js'
import { isValidAmount, parseAmountInput } from '../../utils/amounts.js'
import { isSalary, lastKnownSalary } from '../../utils/salary.js'
import { AmountLimitHint } from '../AmountLimitHint/AmountLimitHint.jsx'

// Impostazioni → Stipendio di questo ciclo: sempre presente. Mostra lo
// stipendio DEL CICLO IN CORSO e permette, qui dentro, di modificarne la
// cifra, eliminarlo (con un secondo tocco di conferma) e inserirlo di nuovo.
// Sono le normali entrate "stipendio" del ciclo (useAppStore addSalary/
// editIncome/deleteIncome), cercate solo dentro il ciclo in corso: gli
// stipendi dei cicli precedenti non vengono mai toccati, e Andamento continua
// a mostrare per ogni ciclo il suo importo.
export function CurrentSalaryCard() {
  const today = useAppStore((state) => state.today)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const incomes = useAppStore((state) => state.incomes)
  const monthlyBudget = useAppStore((state) => state.monthlyBudget)
  const addSalary = useAppStore((state) => state.addSalary)
  const editIncome = useAppStore((state) => state.editIncome)
  const deleteIncome = useAppStore((state) => state.deleteIncome)

  // editingId: id dello stipendio in modifica, 'new' per un inserimento.
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null)

  const range = getCycleRange(today, cycleStartDay)
  const salaries = incomes
    .filter((income) => isSalary(income) && isWithinRange(income.date, range))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  const draftValue = parseAmountInput(draft)
  const canSave = isValidAmount(draftValue)

  const startEdit = (salary) => {
    setConfirmingDeleteId(null)
    setEditingId(salary.id)
    setDraft(String(salary.amount))
  }
  const startInsert = () => {
    const suggested = lastKnownSalary(incomes, monthlyBudget)
    setConfirmingDeleteId(null)
    setEditingId('new')
    setDraft(suggested > 0 ? String(suggested) : '')
  }
  const cancel = () => {
    setEditingId(null)
    setDraft('')
  }
  const save = () => {
    if (!canSave) return
    if (editingId === 'new') addSalary({ amount: draftValue, date: today })
    else editIncome(editingId, { amount: draftValue })
    cancel()
  }
  const handleDelete = (id) => {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id)
      return
    }
    deleteIncome(id)
    setConfirmingDeleteId(null)
  }

  const editor = (
    <div className="settings-screen__salary-editor">
      <div className="settings-screen__field">
        <input
          type="number"
          inputMode="decimal"
          aria-label="Importo dello stipendio di questo ciclo"
          placeholder="0"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" className="settings-screen__save" disabled={!canSave} onClick={save}>
          Salva
        </button>
      </div>
      <AmountLimitHint value={draftValue} />
      <button type="button" className="settings-screen__salary-cancel" onClick={cancel}>
        Annulla
      </button>
    </div>
  )

  return (
    <div className="settings-screen__card">
      <p className="settings-screen__label">Stipendio di questo ciclo</p>
      <p className="settings-screen__hint">
        {`Ciclo ${formatCycleLabel(range, cycleStartDay)}. Modifica ed eliminazione valgono solo per questo ciclo: i cicli precedenti restano come sono in Andamento.`}
      </p>

      {salaries.map((salary) => (
        <div key={salary.id} className="settings-screen__salary">
          <p className="settings-screen__salary-amount">{formatCurrency(salary.amount)}</p>
          {editingId === salary.id ? editor : (
            <div className="settings-screen__salary-actions">
              <button type="button" className="settings-screen__salary-edit" onClick={() => startEdit(salary)}>
                Modifica
              </button>
              <button
                type="button"
                className={`settings-screen__delete${confirmingDeleteId === salary.id ? ' settings-screen__delete--confirm' : ''}`}
                onClick={() => handleDelete(salary.id)}
              >
                {confirmingDeleteId === salary.id ? 'Tocca di nuovo per confermare' : 'Elimina'}
              </button>
            </div>
          )}
        </div>
      ))}

      {salaries.length === 0 && (
        <div className="settings-screen__salary">
          <p className="settings-screen__salary-empty">Nessuno stipendio inserito per questo ciclo</p>
          {editingId === 'new' ? editor : (
            <button type="button" className="settings-screen__salary-edit settings-screen__salary-add" onClick={startInsert}>
              Inserisci stipendio
            </button>
          )}
        </div>
      )}
    </div>
  )
}
