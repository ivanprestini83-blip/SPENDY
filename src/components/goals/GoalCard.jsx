import { useState } from 'react'
import { ProgressBar } from '../ProgressBar/ProgressBar.jsx'
import { formatCurrency } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './GoalCard.css'

// `onContribute`, when passed (GoalsPage does, Home's pinned emergency
// card doesn't need it), renders a small "+" that opens
// ContributeToGoalModal for THIS goal — "inserire una certa cifra
// correlata ad un certo obiettivo". `onDelete` works the same way —
// only GoalsPage passes it, since Home's emergency-fund card reuses
// this component with a synthetic goal that was never a real store
// entry to delete.
export function GoalCard({ goal, onContribute, onDelete }) {
  const { t } = useLanguage()
  const { emoji, label, saved, target, etaMonths } = goal
  const progress = target > 0 ? (saved / target) * 100 : 0

  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const handleDelete = (event) => {
    event.stopPropagation()
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    onDelete(goal)
  }

  return (
    <article className="goal-card">
      <div className="goal-card__top">
        <span className="goal-card__icon" aria-hidden="true">{emoji}</span>
        <div className="goal-card__heading">
          <p className="goal-card__label">{label}</p>
          <p className="goal-card__amounts">
            {formatCurrency(saved)} <span className="goal-card__target">/ {formatCurrency(target)}</span>
          </p>
        </div>
        <span className="goal-card__percent">{Math.round(progress)}%</span>
      </div>

      <ProgressBar value={progress} color="gold" />

      <div className="goal-card__footer">
        {typeof etaMonths === 'number' && (
          <p className="goal-card__eta">{t('goals.eta', { months: etaMonths })}</p>
        )}
        <div className="goal-card__actions">
          {onDelete && (
            <button
              type="button"
              className={`goal-card__delete${confirmingDelete ? ' goal-card__delete--confirm' : ''}`}
              onClick={handleDelete}
            >
              {confirmingDelete ? t('goals.confirmdelete') : '🗑️'}
            </button>
          )}
          {onContribute && (
            <button type="button" className="goal-card__contribute" onClick={() => onContribute(goal)}>
              {t('goals.contribute')}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
