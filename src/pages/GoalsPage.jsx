import { useAppStore } from '../store/useAppStore.js'
import { GoalsSection } from '../components/goals/GoalsSection.jsx'
import { useLanguage } from '../i18n/useLanguage.js'

export function GoalsPage() {
  const { t } = useLanguage()
  const goals = useAppStore((state) => state.goals)
  const openModal = useAppStore((state) => state.openModal)
  const deleteGoal = useAppStore((state) => state.deleteGoal)

  return (
    <GoalsSection
      goals={goals}
      title={`🎯 ${t('goalspage.title')}`}
      onNewGoal={() => openModal('newGoal')}
      onContribute={(goal) => openModal('contributeGoal', goal)}
      onDelete={(goal) => deleteGoal(goal.id)}
    />
  )
}
