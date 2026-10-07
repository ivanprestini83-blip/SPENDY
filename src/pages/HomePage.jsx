import { useEffect, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore.js'
import {
  buildFinancialData,
  todaysExpenses,
} from '../utils/budgetCalculations.js'
import { getSpendyCoach, getInsightTopicKey } from '../utils/spendyCoach.js'
import { getCycleRange, formatCycleLabel } from '../utils/cycle.js'
import { currentCycleSalary } from '../utils/salary.js'
import { buildRadar } from '../utils/radarEngine.js'
import { SpendyHero } from '../components/spendy/SpendyHero.jsx'
import { getSpendyHeroLayout } from '../components/spendy/spendyHeroLayouts.js'
import { RadarPreview } from '../components/radar/RadarPreview.jsx'
import { SpendyVoiceDebug } from '../components/spendy/SpendyVoiceDebug.jsx'
import { useSpendyVoice } from '../ai/useSpendyVoice.js'
import { BudgetCard } from '../components/budget/BudgetCard.jsx'
import { CycleStartCard } from '../components/budget/CycleStartCard.jsx'
import { ExpenseSummaryCards } from '../components/budget/ExpenseSummaryCards.jsx'
import { AffordabilityCTA } from '../components/affordability/AffordabilityCTA.jsx'
import { GoalCard } from '../components/goals/GoalCard.jsx'
import { useLanguage } from '../i18n/useLanguage.js'
import './HomePage.css'

// "6 mensilità" — matches EmergencyFundScreen's own target so the
// preview shown here and the full screen never disagree.
const EMERGENCY_FUND_TARGET_MONTHS = 6

// The only page that reads the store directly and does the derived-data
// math (spent this cycle, today's total, which category spiked...).
// Every component below only ever receives plain props, so none of them
// care that the numbers came from a Zustand store instead of an API.
//
// Spendy's own state/message come from getSpendyCoach(financialData) —
// this page builds the financial snapshot (buildFinancialData) and hands
// it to the coach engine, it never decides happy/attentive/concerned/etc
// itself. Re-running on every render (no memoization) is exactly what
// makes the reaction to a newly-added expense immediate: the store
// mutates, this component re-renders, buildFinancialData/getSpendyCoach
// just recompute from the latest numbers.
export function HomePage() {
  const { t } = useLanguage()
  const today = useAppStore((state) => state.today)
  // L'ultimo stipendio inserito: solo per l'obiettivo del fondo emergenza
  // (logica invariata, monthlyBudget × mesi).
  const lastSalary = useAppStore((state) => state.monthlyBudget)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const incomes = useAppStore((state) => state.incomes)
  // Lo stipendio DEL CICLO IN CORSO (utils/salary.js): 0 finché in questo
  // ciclo non è stato inserito, mai quello del ciclo precedente.
  const monthlyBudget = currentCycleSalary(incomes, today, cycleStartDay)
  const goals = useAppStore((state) => state.goals)
  const emergencyFundSaved = useAppStore((state) => state.emergencyFundSaved)
  const amountHidden = useAppStore((state) => state.amountHidden)
  const toggleAmountHidden = useAppStore((state) => state.toggleAmountHidden)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const openExpenses = useAppStore((state) => state.openExpenses)
  const openModal = useAppStore((state) => state.openModal)
  const jokeHistory = useAppStore((state) => state.spendyJokeHistory)
  const recordSpendyJoke = useAppStore((state) => state.recordSpendyJoke)

  // Gli obiettivi veri, non una lista vuota: sono cio' che permette al
  // coach di accorgersi che ne hai raggiunto uno (ed e' l'unico caso in
  // cui Spendy festeggia) e di citarlo per nome quando consiglia dove
  // spostare i soldi risparmiati.
  const financialData = buildFinancialData({ today, monthlyBudget, expenses, incomes, goals, cycleStartDay })
  const { spentThisMonth, available } = financialData
  const todaySummary = todaysExpenses(expenses, today)
  const cycleLabel = formatCycleLabel(getCycleRange(today, cycleStartDay), cycleStartDay)

  // getSpendyCoach still fully owns Spendy's general state (see
  // utils/spendyCoach.js) — passing behaviorContext only lets its lowest
  // priority tiers source a richer, non-repeating joke from the
  // BehaviorEngine → HumorEngine → JokeEvaluator pipeline instead of a
  // fixed string; it changes nothing about the tier cascade itself.
  const coach = getSpendyCoach(financialData, { expenses, today, monthlyBudget, cycleStartDay, goals, jokeHistory, financialData })
  const spendyMessage = coach.message
  const spendyInsight = coach.insight
  const spendyMessageScore = coach.messageScore

  // Spendy AI (src/ai/): riceve il coach già calcolato e decide se questa
  // volta vale la pena generare una frase nuova. Se no — o se l'AI non
  // risponde — `voice` è esattamente il coach di sempre (fallback).
  const { voice, debug: voiceDebug } = useSpendyVoice({
    coach, financialData, expenses, today, monthlyBudget, cycleStartDay, goals,
  })
  // Only needed so the budget card can make room when Spendy stands on it.
  const heroPosition = getSpendyHeroLayout(voice.state, voice.layout).position

  // Radar is back on Home as a teaser (top 3), same buildRadar() the
  // Radar screen uses — nothing recomputed here. Memoized on the store
  // inputs, with a fixed rng: buildRadar's rng only picks phrasing, and a
  // Home that reshuffled its "all quiet" sentence on every re-render
  // would read as flicker, not as Spendy talking.
  const radar = useMemo(
    () => buildRadar({
      expenses, goals, today, monthlyBudget, cycleStartDay, jokeHistory,
      financialData: buildFinancialData({ today, monthlyBudget, expenses, incomes, goals, cycleStartDay }),
      rng: () => 0,
    }),
    [expenses, goals, today, monthlyBudget, cycleStartDay, incomes, jokeHistory],
  )

  // Remember a behavior-engine joke once it's actually shown, so the same
  // one doesn't come back for this category+insight-type (see
  // getSpendyCoach's tier 6 and useAppStore's recordSpendyJoke).
  //
  // Guarded by KEY+DAY, not key+text: getSpendyCoach reads jokeHistory as
  // an input, so recording immediately changes what it computes next
  // render (JokeEvaluator correctly avoids repeating the just-recorded
  // text and picks the next-best remaining candidate instead) — guarding
  // by exact text would re-trigger this effect on every one of those
  // renders, recording every remaining candidate in turn until the whole
  // bucket for this key was exhausted and getSpendyCoach had nothing
  // left to fall back on but the plain descriptive sentence. One write
  // per key per day converges in at most two renders to a stable, still
  // non-repeating joke instead.
  //
  // Only while the LOCAL line is on screen: when Spendy AI is talking, the
  // library joke was never shown, so it must not be marked as used.
  const showingLocalLine = voice.source === 'local'
  useEffect(() => {
    if (!showingLocalLine || !spendyInsight) return
    const key = getInsightTopicKey(spendyInsight)
    const alreadyRecordedToday = jokeHistory.some((entry) => entry.key === key && entry.shownAt === today)
    if (alreadyRecordedToday) return
    recordSpendyJoke({ key, text: spendyMessage, shownAt: today })
  }, [showingLocalLine, spendyInsight, spendyMessage, jokeHistory, recordSpendyJoke, today])

  // L'obiettivo più vicino al traguardo: è l'unico su cui, adesso,
  // una spinta ha senso, ed è lo stesso criterio che usa il Radar per
  // scegliere quale obiettivo raccontare. Se non ce n'è nessuno la Home
  // non mostra niente al suo posto — meglio uno spazio vuoto che una
  // card vuota.
  const featuredGoal = goals.length > 0
    ? [...goals].sort((a, b) => (b.target > 0 ? b.saved / b.target : 0) - (a.target > 0 ? a.saved / a.target : 0))[0]
    : null

  // Fondo emergenza is its own store field (emergencyFundSaved), not a
  // generic goal — its target is a function of income, and it has its
  // own dedicated screen (EmergencyFundScreen), reached from here.
  const emergencyFundGoal = {
    emoji: '🚨',
    label: t('home.emergency'),
    saved: emergencyFundSaved,
    target: lastSalary * EMERGENCY_FUND_TARGET_MONTHS,
    etaMonths: null,
  }

  return (
    <div className={`home-page home-page--hero-${heroPosition}`}>
      {/* Header → Spendy → Disponibile → Spese → Radar → Fondo emergenza
          → Obiettivi. Spendy leads the screen; the budget is the second
          thing the eye lands on and must stay fully readable (the hero
          never paints over it — see SpendyHero.css). */}
      <SpendyHero
        state={voice.state}
        message={voice.message}
        secondaryText={voice.secondaryText}
        layout={voice.layout}
        tone={voice.tone}
        animation={voice.animation}
        messageScore={voice.source === 'local' ? spendyMessageScore : null}
        onTalk={() => setActiveTab('spendy')}
      />

      <SpendyVoiceDebug voice={voice} debug={voiceDebug} />

      <CycleStartCard />

      <BudgetCard
        available={available}
        spent={spentThisMonth}
        monthlyBudget={monthlyBudget}
        period={cycleLabel}
        hidden={amountHidden}
        onToggleHidden={toggleAmountHidden}
      />

      <ExpenseSummaryCards
        today={todaySummary}
        month={{ total: spentThisMonth }}
        monthlyBudget={monthlyBudget}
        onOpenExpenses={openExpenses}
      />

      <RadarPreview radar={radar} onOpen={() => openModal('radar')} />

      <button type="button" className="home-page__goal-link" onClick={() => openModal('emergencyFund')}>
        <GoalCard goal={emergencyFundGoal} />
      </button>

      {/* L'obiettivo in evidenza, con la sua barra di avanzamento. Stessa
          GoalCard di GoalsPage e del fondo emergenza qui sopra: una sola
          card, un solo modo di disegnare un obiettivo. Tocco -> scheda
          Obiettivi, dove si può anche versare o crearne di nuovi. */}
      {featuredGoal && (
        <button type="button" className="home-page__goal-link" onClick={() => setActiveTab('goals')}>
          <GoalCard goal={featuredGoal} />
          {goals.length > 1 && (
            <span className="home-page__goals-more">
              {goals.length === 2 ? t('home.goals.moreone') : t('home.goals.moremany', { count: goals.length - 1 })}
            </span>
          )}
        </button>
      )}

      <AffordabilityCTA onOpen={() => openModal('affordability')} />
    </div>
  )
}
