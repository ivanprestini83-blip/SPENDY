import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { totalForMonth } from '../../utils/budgetCalculations.js'
import { evaluateAffordability } from '../../utils/affordability.js'
import './AffordabilityScreen.css'

const LEVEL_EMOJI = { green: '🟢', yellow: '🟡', red: '🔴' }

// Full-screen overlay (not a Modal sheet) — the spec calls this a
// "schermata dedicata", and the ask/result flow benefits from the extra
// room. No AI involved: evaluateAffordability only ever looks at numbers
// already in the store.
export function AffordabilityScreen({ onClose }) {
  const today = useAppStore((state) => state.today)
  const monthlyBudget = useAppStore((state) => state.monthlyBudget)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const goals = useAppStore((state) => state.goals)

  const [amount, setAmount] = useState('')
  const [item, setItem] = useState('')
  const [result, setResult] = useState(null)

  const availableBudget = monthlyBudget - totalForMonth(expenses, today, cycleStartDay)

  const handleAsk = () => {
    const amountValue = parseFloat(amount.replace(',', '.'))
    setResult(evaluateAffordability({ amount: amountValue, availableBudget, goals }))
  }

  return (
    <div className="affordability-screen">
      <div className="affordability-screen__header">
        <button type="button" className="affordability-screen__back" onClick={onClose} aria-label="Chiudi">
          ←
        </button>
        <p className="affordability-screen__title">Posso permettermelo?</p>
      </div>

      <div className="affordability-screen__body">
        <label className="affordability-screen__field">
          <span>Quanto vuoi spendere?</span>
          <div className="affordability-screen__amount-input">
            <span>€</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setResult(null)
              }}
            />
          </div>
        </label>

        <label className="affordability-screen__field">
          <span>Cosa vuoi comprare?</span>
          <input
            type="text"
            className="affordability-screen__text-input"
            placeholder="Es. Scarpe nuove, weekend fuori…"
            value={item}
            onChange={(event) => setItem(event.target.value)}
          />
        </label>

        <button type="button" className="affordability-screen__cta" onClick={handleAsk}>
          Chiedi a Spendy
        </button>

        {result && (
          <div className={`affordability-screen__result affordability-screen__result--${result.level}`}>
            <span className="affordability-screen__result-emoji">{LEVEL_EMOJI[result.level]}</span>
            <p className="affordability-screen__result-title">
              {result.title}{item ? ` — ${item}` : ''}
            </p>
            <p className="affordability-screen__result-message">{result.message}</p>
          </div>
        )}

        <p className="affordability-screen__disclaimer">
          Spendy fa una semplice simulazione basata sui tuoi dati locali: non è una consulenza
          finanziaria professionale.
        </p>
      </div>
    </div>
  )
}
