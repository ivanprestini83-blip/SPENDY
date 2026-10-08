import { GoalCard } from './GoalCard.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'
import './GoalsSection.css'

// `limit` lets Home show a preview (e.g. top 3) while GoalsPage passes
// none and gets the full list — same component, same card, no
// duplication between the two screens.
export function GoalsSection({ goals, limit, title = null, onNewGoal = () => {}, onContribute, onDelete }) {
  const { t } = useLanguage()
  const visibleGoals = limit ? goals.slice(0, limit) : goals

  return (
    <section className="goals-section">
      <p className="goals-section__title">{title ?? `🎯 ${t('home.nav.goals')}`}</p>

      <div className="goals-section__list">
        {visibleGoals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} onContribute={onContribute} onDelete={onDelete} />
        ))}
      </div>

      <button type="button" className="goals-section__new" onClick={onNewGoal}>
        {t('goalspage.new')}
      </button>
    </section>
  )
}
