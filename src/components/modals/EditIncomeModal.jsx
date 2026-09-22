import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { getCategory } from '../../data/categories.js'
import './EditExpenseModal.css'

// The income twin of EditExpenseModal — reachable by tapping any row in
// IncomesPage's list. Only ever opened for a ONE-OFF income (Extra/
// Investimenti/Regalo/Rimborso/custom); "Stipendio" never appears in
// that list at all (see useAppStore's addIncome/editIncome comment), so
// there's no ambiguity about which store action this should call.
// Reuses EditExpenseModal's own CSS file — same layout, just a
// different pair of store actions underneath.
export function EditIncomeModal({ income, onClose }) {
  const editIncome = useAppStore((state) => state.editIncome)
  const deleteIncome = useAppStore((state) => state.deleteIncome)

  const category = getCategory(income.categoryId)
  const [amount, setAmount] = useState(String(income.amount))
  const [date, setDate] = useState(income.date)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const amountValue = parseFloat(amount.replace(',', '.'))
  const canSave = Number.isFinite(amountValue) && amountValue > 0

  const handleSave = () => {
    if (!canSave) return
    editIncome(income.id, { amount: amountValue, date })
    onClose()
  }

  const handleDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    deleteIncome(income.id)
    onClose()
  }

  return (
    <div className="edit-expense">
      <div className="edit-expense__header">
        <button type="button" className="edit-expense__back" onClick={onClose} aria-label="Chiudi">
          ✕
        </button>
        <p className="edit-expense__title">Modifica guadagno</p>
      </div>

      <div className="edit-expense__body">
        <div className="edit-expense__picked">
          <span className="edit-expense__picked-emoji" aria-hidden="true">{category.emoji}</span>
          <span className="edit-expense__picked-label">{category.label}</span>
        </div>

        <label className="edit-expense__field">
          <span>Importo</span>
          <div className="edit-expense__amount-input">
            <span>€</span>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </label>

        <label className="edit-expense__field">
          <span>Data</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>

        <button type="button" className="edit-expense__save" disabled={!canSave} onClick={handleSave}>
          Salva modifiche
        </button>

        <button
          type="button"
          className={`edit-expense__delete${confirmingDelete ? ' edit-expense__delete--confirm' : ''}`}
          onClick={handleDelete}
        >
          {confirmingDelete ? 'Tocca di nuovo per confermare' : '🗑️ Elimina guadagno'}
        </button>
      </div>
    </div>
  )
}
