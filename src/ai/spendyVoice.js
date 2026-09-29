// Il flusso completo di Spendy AI, in un posto solo e senza React:
//
//   dati reali → BehaviorEngine → eventi → contesto → decisione → (AI) → voce
//
// prepareSpendyVoice fa la parte sincrona (tutto tranne la chiamata);
// useSpendyVoice (React) e i test usano entrambi questa funzione, così
// quello che la Home fa è esattamente quello che i test verificano.
import { analyzeBehavior } from '../utils/behaviorEngine.js'
import { detectSpendyEvents } from './spendyEvents.js'
import { buildSpendyAIContext } from './spendyAIContext.js'

export function prepareSpendyVoice({
  coach,
  financialData,
  expenses = [],
  today,
  monthlyBudget = 0,
  cycleStartDay = 1,
  goals = [],
}) {
  // Gli stessi insight che getSpendyCoach e il Radar ottengono: nessuna
  // analisi nuova, solo una seconda lettura dello stesso risultato.
  const insights = analyzeBehavior({ expenses, today, monthlyBudget, financialData, cycleStartDay, goals })
  const events = detectSpendyEvents({ coach, insights, expenses, today, goals, financialData })
  const { context, meta } = buildSpendyAIContext({
    events, coach, financialData, expenses, today, cycleStartDay, goals,
  })
  return { events, context, meta }
}
