import { useState } from 'react'
import { Modal } from './Modal.jsx'
import { FormField } from './FormField.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { formatCurrency } from '../../utils/format.js'
import './modalForm.css'
import { isValidAmount } from '../../utils/amounts.js'
import { AmountLimitHint } from '../AmountLimitHint/AmountLimitHint.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'

// Opened from a GoalCard's "+ Aggiungi" (see GoalsSection.jsx) — the one
// place `saved` on a goal ever changes, via the store's contributeToGoal.
export function ContributeToGoalModal({ goal, onClose }) {
  const { t } = useLanguage()
  const contributeToGoal = useAppStore((state) => state.contributeToGoal)
  const [amount, setAmount] = useState('')

  const amountValue = parseFloat(amount.replace(',', '.'))
  const canSave = isValidAmount(amountValue)

  const handleSave = () => {
    if (!canSave) return
    contributeToGoal(goal.id, amountValue)
    onClose()
  }

  return (
    <Modal title={`${goal.emoji} ${goal.label}`} onClose={onClose}>
      <FormField
        label={t('goalspage.contribute.amount')}
        type="number"
        inputMode="decimal"
        placeholder="€ 0,00"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <AmountLimitHint value={amountValue} />

      <p className="modal-form__hint">
        {t('goalspage.contribute.progress', { saved: formatCurrency(goal.saved), target: formatCurrency(goal.target) })}
      </p>

      <button type="button" className="modal-form__submit" disabled={!canSave} onClick={handleSave}>
        {t('goalspage.contribute.submit')}
      </button>
    </Modal>
  )
}
