import { useAppStore } from '../store/useAppStore.js'
import { GoalsSection } from '../components/goals/GoalsSection.jsx'

export function GoalsPage() {
  const goals = useAppStore((state) => state.goals)
  const openModal = useAppStore((state) => state.openModal)
  const deleteGoal = useAppStore((state) => state.deleteGoal)

  return (
    <GoalsSection
      goals={goals}
      title="🎯 I tuoi obiettivi"
      onNewGoal={() => openModal('newGoal')}
      onContribute={(goal) => openModal('contributeGoal', goal)}
      onDelete={(goal) => deleteGoal(goal.id)}
    />
  )
}
