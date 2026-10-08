import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore.js'
import { buildFinancialData } from '../utils/budgetCalculations.js'
import { currentCycleSalary } from '../utils/salary.js'
import { getSpendyCoach, getInsightTopicKey } from '../utils/spendyCoach.js'
import { buildRadar, RADAR_STATUS } from '../utils/radarEngine.js'
import { SpendyCharacterWithMessage } from '../components/spendy/SpendyCharacterWithMessage.jsx'
import { useLanguage } from '../i18n/useLanguage.js'
import './SpendyPage.css'

// Same coach engine as HomePage (buildFinancialData -> getSpendyCoach) —
// this page just renders it bigger, with no other card chrome around it.
// Radar Spendy lives here now (moved off Home to free up space there),
// ma non e' piu' un modale su una sola categoria: e' una schermata sua
// (components/radar/RadarScreen.jsx) che mostra la classifica di tutto
// cio' che Spendy ha notato. La Home continua a mostrare UN messaggio,
// il Radar risponde a "cos'altro hai visto".
//
// Passing the full behaviorContext (like HomePage does) is what lets the
// richer pipeline — the expense-reaction engine in particular — actually
// fire here too, instead of this page being stuck on the flat
// percentage-only tiers HomePage isn't limited to.
export function SpendyPage() {
  const { language } = useLanguage()
  const today = useAppStore((state) => state.today)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const incomes = useAppStore((state) => state.incomes)
  // Lo stipendio DEL CICLO IN CORSO (utils/salary.js): 0 finché in questo
  // ciclo non è stato inserito, mai quello del ciclo precedente.
  const monthlyBudget = currentCycleSalary(incomes, today, cycleStartDay)
  const goals = useAppStore((state) => state.goals)
  const openModal = useAppStore((state) => state.openModal)
  const jokeHistory = useAppStore((state) => state.spendyJokeHistory)
  const recordSpendyJoke = useAppStore((state) => state.recordSpendyJoke)

  const financialData = buildFinancialData({ today, monthlyBudget, expenses, incomes, goals, cycleStartDay })
  const coach = getSpendyCoach(financialData, { expenses, today, monthlyBudget, cycleStartDay, goals, jokeHistory, financialData, lang: language })
  // Il pulsante Radar non apre piu' il confronto di UNA categoria: apre
  // la schermata Radar, che mostra la classifica completa di cio' che
  // Spendy ha notato (vedi components/radar/RadarScreen.jsx). Qui serve
  // solo sapere QUANTE segnalazioni ci sono, per poterlo scrivere sul
  // pulsante e per non invitare l'utente ad aprire una lista vuota.
  const radar = buildRadar({ expenses, goals, today, monthlyBudget, cycleStartDay, financialData, jokeHistory, lang: language })
  const radarCount = radar.cards.length
  const hasSomethingToShow = radar.status === RADAR_STATUS.ACTIVE

  // Records the joke actually shown so it doesn't repeat — same pattern
  // and same shared jokeHistory as HomePage's own effect (see its
  // comment for why key+day, not key+text, is what's guarded against).
  useEffect(() => {
    if (!coach.insight) return
    const key = getInsightTopicKey(coach.insight)
    const alreadyRecordedToday = jokeHistory.some((entry) => entry.key === key && entry.shownAt === today)
    if (alreadyRecordedToday) return
    recordSpendyJoke({ key, text: coach.message, shownAt: today })
  }, [coach.insight, coach.message, jokeHistory, recordSpendyJoke, today])

  const handleOpenRadar = () => openModal('radar')

  return (
    <div className="spendy-page">
      <div key={coach.state} className="spendy-page__transition">
        <SpendyCharacterWithMessage state={coach.state} message={coach.message} size={110} />
      </div>

      <p className="spendy-page__blurb">
        Sono Spendy, il tuo coach personale per le spese. Tengo d'occhio il tuo budget e intervengo al
        momento giusto — senza giudicarti (troppo).
      </p>

      <button type="button" className="spendy-page__radar" onClick={handleOpenRadar}>
        <span aria-hidden="true">🔥</span> Radar Spendy
        {radarCount > 0 && <span className="spendy-page__radar-count">{radarCount}</span>}
        <span className="spendy-page__radar-arrow" aria-hidden="true">→</span>
      </button>
      {!hasSomethingToShow && (
        <p className="spendy-page__radar-empty">
          {radar.status === RADAR_STATUS.LEARNING
            ? '🔍 Sto ancora imparando le tue abitudini.'
            : '✅ Nessuna anomalia da segnalare al momento.'}
        </p>
      )}
    </div>
  )
}
