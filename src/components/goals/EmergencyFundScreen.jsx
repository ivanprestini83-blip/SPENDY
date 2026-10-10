import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { SpendyCharacterWithMessage } from '../spendy/SpendyCharacterWithMessage.jsx'
import { ProgressBar } from '../ProgressBar/ProgressBar.jsx'
import { formatCurrency, currencySymbol } from '../../utils/format.js'
import './EmergencyFundScreen.css'
import { isValidAmount } from '../../utils/amounts.js'
import { AmountLimitHint } from '../AmountLimitHint/AmountLimitHint.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'

// "fino ad arrivare ad una cifra di 4 o 6 mensilità" — 6 is the target
// this screen aims for; the 10-20% figure below is what Spendy suggests
// setting aside each month to get there, not a hard rule enforced anywhere.
const EMERGENCY_FUND_TARGET_MONTHS = 6
const SUGGESTED_SAVE_RATE = [10, 20]

// Fondo emergenza is deliberately its OWN screen, not folded into the
// generic Obiettivi list — "quando premo fondo emergenza deve solo
// vedersi fondo emergenza", with Spendy's own encouragement about saving
// before spending, not a progress-bar-and-nothing-else card.
function encouragement(saved, target, monthlyBudget, t) {
  if (monthlyBudget <= 0) {
    return {
      state: 'advisor',
      text: t('emergency.coach.nosalary'),
    }
  }
  const progress = target > 0 ? (saved / target) * 100 : 0
  if (progress >= 100) {
    return {
      state: 'celebrating',
      text: t('emergency.coach.complete', { months: EMERGENCY_FUND_TARGET_MONTHS }),
    }
  }
  if (progress >= 50) {
    return {
      state: 'happy',
      text: t('emergency.coach.half'),
    }
  }
  if (saved > 0) {
    return {
      state: 'attentive',
      text: t('emergency.coach.started', { min: SUGGESTED_SAVE_RATE[0], max: SUGGESTED_SAVE_RATE[1] }),
    }
  }
  return {
    state: 'advisor',
    text: t('emergency.coach.start', { min: SUGGESTED_SAVE_RATE[0] }),
  }
}

export function EmergencyFundScreen({ onClose }) {
  const { t } = useLanguage()
  const monthlyBudget = useAppStore((state) => state.monthlyBudget)
  const emergencyFundSaved = useAppStore((state) => state.emergencyFundSaved)
  const emergencyFundContributions = useAppStore((state) => state.emergencyFundContributions)
  const contributeToEmergencyFund = useAppStore((state) => state.contributeToEmergencyFund)
  const editEmergencyFundContribution = useAppStore((state) => state.editEmergencyFundContribution)
  const deleteEmergencyFundContribution = useAppStore((state) => state.deleteEmergencyFundContribution)

  const [amount, setAmount] = useState('')
  // Which past versamento (if any) is currently open for correction —
  // "la possibilità di modificare cifra o giorno" applies here exactly
  // like it does for expenses, just on this screen's own list instead
  // of ExpensesPage's.
  const [editingId, setEditingId] = useState(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')

  const target = monthlyBudget * EMERGENCY_FUND_TARGET_MONTHS
  const progress = target > 0 ? (emergencyFundSaved / target) * 100 : 0
  const coach = encouragement(emergencyFundSaved, target, monthlyBudget, t)

  const amountValue = parseFloat(amount.replace(',', '.'))
  const canAdd = isValidAmount(amountValue)

  const handleAdd = () => {
    if (!canAdd) return
    contributeToEmergencyFund(amountValue)
    setAmount('')
  }

  // "metti un pulsante che mi permetta di tornare indietro" — one tap
  // removes the most recent versamento (the list is newest-first), for
  // when the mistake was literally just the last thing added.
  const handleUndoLast = () => {
    if (emergencyFundContributions.length === 0) return
    deleteEmergencyFundContribution(emergencyFundContributions[0].id)
  }

  const startEdit = (contribution) => {
    setEditingId(contribution.id)
    setEditAmount(String(contribution.amount))
    setEditDate(contribution.date)
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = () => {
    const value = parseFloat(editAmount.replace(',', '.'))
    if (!isValidAmount(value)) return
    editEmergencyFundContribution(editingId, { amount: value, date: editDate })
    setEditingId(null)
  }

  return (
    <div className="emergency-fund-screen">
      <div className="emergency-fund-screen__header">
        <button type="button" className="emergency-fund-screen__back" onClick={onClose} aria-label={t('common.close')}>
          ←
        </button>
        <p className="emergency-fund-screen__title">🚨 {t('home.emergency')}</p>
      </div>

      <div className="emergency-fund-screen__body">
        <div key={coach.state} className="emergency-fund-screen__spendy">
          <SpendyCharacterWithMessage state={coach.state} message={coach.text} size={130} />
        </div>

        <div className="emergency-fund-screen__amount">
          <p className="emergency-fund-screen__saved">{formatCurrency(emergencyFundSaved)}</p>
          <p className="emergency-fund-screen__target">
            {target > 0
              ? t('emergency.target', { amount: formatCurrency(target), months: EMERGENCY_FUND_TARGET_MONTHS })
              : t('emergency.nosalary')}
          </p>
        </div>

        {target > 0 && <ProgressBar value={progress} color="gold" />}

        <label className="emergency-fund-screen__field">
          <span>{t('emergency.addlabel')}</span>
          <div className="emergency-fund-screen__input">
            <span>{currencySymbol()}</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </label>
        <AmountLimitHint value={amountValue} />

        <button type="button" className="emergency-fund-screen__cta" disabled={!canAdd} onClick={handleAdd}>
          {t('emergency.add')}
        </button>

        {emergencyFundContributions.length > 0 && (
          <div className="emergency-fund-screen__history">
            <div className="emergency-fund-screen__history-head">
              <span>{t('emergency.history')}</span>
              <button type="button" className="emergency-fund-screen__undo" onClick={handleUndoLast}>
                ↩️ {t('emergency.undo')}
              </button>
            </div>

            <ul className="emergency-fund-screen__history-list">
              {emergencyFundContributions.map((contribution) =>
                editingId === contribution.id ? (
                  <li key={contribution.id} className="emergency-fund-screen__history-edit">
                    <div className="emergency-fund-screen__history-edit-input">
                      <span>{currencySymbol()}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={editAmount}
                        autoFocus
                        onChange={(event) => setEditAmount(event.target.value)}
                      />
                    </div>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(event) => setEditDate(event.target.value)}
                    />
                    <button type="button" onClick={saveEdit} aria-label={t('common.save')}>✓</button>
                    <button type="button" onClick={cancelEdit} aria-label={t('common.cancel')}>✕</button>
                  </li>
                ) : (
                  <li key={contribution.id} className="emergency-fund-screen__history-item">
                    <span className="emergency-fund-screen__history-date">{contribution.date}</span>
                    <span className="emergency-fund-screen__history-amount">
                      {formatCurrency(contribution.amount)}
                    </span>
                    <button type="button" onClick={() => startEdit(contribution)} aria-label={t('common.edit')}>
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteEmergencyFundContribution(contribution.id)}
                      aria-label={t('common.delete')}
                    >
                      🗑️
                    </button>
                  </li>
                ),
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
