import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { getCategory } from '../../data/categories.js'
import './EditExpenseModal.css'
import { isValidAmount } from '../../utils/amounts.js'
import { AmountLimitHint } from '../AmountLimitHint/AmountLimitHint.jsx'

// Reachable by tapping any row in ExpensesPage's list — "modificare
// cifra o giorno" on a transaction already entered, or undo it entirely
// if it was a mistake. Same store actions (editExpense/deleteExpense)
// are the only thing that changes the list; nothing here duplicates
// addExpense's own logic.
export function EditExpenseModal({ expense, onClose }) {
  const editExpense = useAppStore((state) => state.editExpense)
  const deleteExpense = useAppStore((state) => state.deleteExpense)

  const category = getCategory(expense.categoryId)
  const [amount, setAmount] = useState(String(expense.amount))
  const [date, setDate] = useState(expense.date)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const amountValue = parseFloat(amount.replace(',', '.'))
  const canSave = isValidAmount(amountValue)

  const handleSave = () => {
    if (!canSave) return
    editExpense(expense.id, { amount: amountValue, date })
    onClose()
  }

  const handleDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    deleteExpense(expense.id)
    onClose()
  }

  return (
    <div className="edit-expense">
      <div className="edit-expense__header">
        <button type="button" className="edit-expense__back" onClick={onClose} aria-label="Chiudi">
          ✕
        </button>
        <p className="edit-expense__title">Modifica spesa</p>
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
        <AmountLimitHint value={amountValue} />

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
          {confirmingDelete ? 'Tocca di nuovo per confermare' : '🗑️ Elimina spesa'}
        </button>
      </div>
    </div>
  )
}
