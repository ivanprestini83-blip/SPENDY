import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { getCategory } from '../../data/categories.js'
import './EditExpenseModal.css'
import { isValidAmount } from '../../utils/amounts.js'
import { AmountLimitHint } from '../AmountLimitHint/AmountLimitHint.jsx'
import { currencySymbol } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'

// The income twin of EditExpenseModal — reachable by tapping any row in
// IncomesPage's list. Only ever opened for a ONE-OFF income (Extra/
// Investimenti/Regalo/Rimborso/custom); "Stipendio" never appears in
// that list at all (see useAppStore's addIncome/editIncome comment), so
// there's no ambiguity about which store action this should call.
// Reuses EditExpenseModal's own CSS file — same layout, just a
// different pair of store actions underneath.
export function EditIncomeModal({ income, onClose }) {
  const { t } = useLanguage()
  const editIncome = useAppStore((state) => state.editIncome)
  const deleteIncome = useAppStore((state) => state.deleteIncome)

  const category = getCategory(income.categoryId)
  const [amount, setAmount] = useState(String(income.amount))
  const [date, setDate] = useState(income.date)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const amountValue = parseFloat(amount.replace(',', '.'))
  const canSave = isValidAmount(amountValue)

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
        <button type="button" className="edit-expense__back" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
        <p className="edit-expense__title">{t('incomes.edit.title')}</p>
      </div>

      <div className="edit-expense__body">
        <div className="edit-expense__picked">
          <span className="edit-expense__picked-emoji" aria-hidden="true">{category.emoji}</span>
          <span className="edit-expense__picked-label">{category.label}</span>
        </div>

        <label className="edit-expense__field">
          <span>{t('expenses.edit.amount')}</span>
          <div className="edit-expense__amount-input">
            <span>{currencySymbol()}</span>
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
          <span>{t('expenses.edit.date')}</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>

        <button type="button" className="edit-expense__save" disabled={!canSave} onClick={handleSave}>
          {t('expenses.edit.save')}
        </button>

        <button
          type="button"
          className={`edit-expense__delete${confirmingDelete ? ' edit-expense__delete--confirm' : ''}`}
          onClick={handleDelete}
        >
          {confirmingDelete ? t('expenses.edit.confirm') : t('incomes.edit.delete')}
        </button>
      </div>
    </div>
  )
}
