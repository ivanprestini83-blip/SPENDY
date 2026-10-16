import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { totalForMonth } from '../../utils/budgetCalculations.js'
import { currentCycleSalary } from '../../utils/salary.js'
import { evaluateAffordability } from '../../utils/affordability.js'
import { currencySymbol } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import { MASCOT_NAME } from '../../brand.js'
import './AffordabilityScreen.css'

const LEVEL_EMOJI = { green: '🟢', yellow: '🟡', red: '🔴' }

// Full-screen overlay (not a Modal sheet) — the spec calls this a
// "schermata dedicata", and the ask/result flow benefits from the extra
// room. No AI involved: evaluateAffordability only ever looks at numbers
// already in the store.
export function AffordabilityScreen({ onClose }) {
  const { language, currency, t } = useLanguage()
  const today = useAppStore((state) => state.today)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const incomes = useAppStore((state) => state.incomes)
  // Lo stipendio DEL CICLO IN CORSO (utils/salary.js): 0 finché in questo
  // ciclo non è stato inserito, mai quello del ciclo precedente.
  const monthlyBudget = currentCycleSalary(incomes, today, cycleStartDay)
  const goals = useAppStore((state) => state.goals)

  const [amount, setAmount] = useState('')
  const [item, setItem] = useState('')
  // L'importo chiesto (numero), non la risposta già scritta: il verdetto si
  // ricalcola a ogni disegno, così segue subito lingua e valuta.
  const [asked, setAsked] = useState(null)

  const availableBudget = monthlyBudget - totalForMonth(expenses, today, cycleStartDay)

  const handleAsk = () => setAsked(parseFloat(amount.replace(',', '.')))
  const result = asked === null ? null : evaluateAffordability({ amount: asked, availableBudget, goals, lang: language, currency })

  return (
    <div className="affordability-screen">
      <div className="affordability-screen__header">
        <button type="button" className="affordability-screen__back" onClick={onClose} aria-label={t('affordability.screen.close')}>
          ←
        </button>
        <p className="affordability-screen__title">{t('affordability.screen.title')}</p>
      </div>

      <div className="affordability-screen__body">
        <label className="affordability-screen__field">
          <span>{t('affordability.screen.amount')}</span>
          <div className="affordability-screen__amount-input">
            <span>{currencySymbol(language, currency)}</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setAsked(null)
              }}
            />
          </div>
        </label>

        <label className="affordability-screen__field">
          <span>{t('affordability.screen.item')}</span>
          <input
            type="text"
            className="affordability-screen__text-input"
            placeholder={t('affordability.screen.placeholder')}
            value={item}
            onChange={(event) => setItem(event.target.value)}
          />
        </label>

        <button type="button" className="affordability-screen__cta" onClick={handleAsk}>
          {t('affordability.screen.ask', { name: MASCOT_NAME })}
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
          {t('affordability.screen.disclaimer', { name: MASCOT_NAME })}
        </p>
      </div>
    </div>
  )
}
