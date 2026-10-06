import { useState } from 'react'
import { Modal } from './Modal.jsx'
import { FormField } from './FormField.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import './modalForm.css'
import { isValidAmount } from '../../utils/amounts.js'
import { AmountLimitHint } from '../AmountLimitHint/AmountLimitHint.jsx'

function monthsUntil(targetDateStr, todayStr) {
  const [ty, tm] = targetDateStr.split('-').map(Number)
  const [ry, rm] = todayStr.split('-').map(Number)
  const months = (ty - ry) * 12 + (tm - rm)
  return Math.max(1, months)
}

export function NewGoalModal({ onClose }) {
  const addGoal = useAppStore((state) => state.addGoal)
  const today = useAppStore((state) => state.today)

  const [label, setLabel] = useState('')
  const [target, setTarget] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [saved, setSaved] = useState('')

  const targetValue = parseFloat(target.replace(',', '.'))
  const savedValue = parseFloat((saved || '0').replace(',', '.'))
  const canSave = label.trim().length > 0 && isValidAmount(targetValue)
    && (!Number.isFinite(savedValue) || savedValue === 0 || isValidAmount(savedValue))

  const handleSave = () => {
    if (!canSave) return
    addGoal({
      emoji: '🎯',
      label: label.trim(),
      saved: Number.isFinite(savedValue) ? savedValue : 0,
      target: targetValue,
      etaMonths: targetDate ? monthsUntil(targetDate, today) : 6,
    })
    onClose()
  }

  return (
    <Modal title="Nuovo obiettivo" onClose={onClose}>
      <FormField
        label="Nome"
        type="text"
        placeholder="Es. Vacanza, Nuovo laptop…"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />

      <FormField
        label="Importo obiettivo"
        type="number"
        inputMode="decimal"
        placeholder="€ 0,00"
        value={target}
        onChange={(event) => setTarget(event.target.value)}
      />
      <AmountLimitHint value={targetValue} />

      <FormField
        label="Data obiettivo"
        type="date"
        value={targetDate}
        onChange={(event) => setTargetDate(event.target.value)}
      />

      <FormField
        label="Importo già disponibile"
        type="number"
        inputMode="decimal"
        placeholder="€ 0,00"
        value={saved}
        onChange={(event) => setSaved(event.target.value)}
      />
      <AmountLimitHint value={savedValue} />

      <button type="button" className="modal-form__submit" disabled={!canSave} onClick={handleSave}>
        Crea obiettivo
      </button>
    </Modal>
  )
}
