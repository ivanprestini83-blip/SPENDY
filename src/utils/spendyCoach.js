// Spendy's deterministic "brain" — v1, no AI. A pure function: financial
// snapshot in, one { state, message, reason, priority, insight,
// messageScore, secondaryInsightText } out. UI components never compute
// this themselves (see SpendyCoach.jsx) — they only ever render whatever
// this returns, so a future AI-generated message can slot in later
// without touching a single component:
//
//   TRANSAZIONI → BehaviorEngine → BehaviorInsight → COACH ENGINE
//   (stato/severity) → HumorEngine → JokeEvaluator → STATO + BATTUTA → UI
//
// financialData shape (all optional, sensible defaults below):
//   spentRatio          number, 0-100+ — % of monthlyBudget already spent
//   available           number — monthlyBudget - spent (can go negative)
//   topCategory         { category:{label,...}, changeAmount, changePercent, previous, current } | null
//                        — biggest month-over-month % INCREASE (see budgetCalculations.topIncreasingCategory)
//   topDecreasingCategory  same shape, biggest % DECREASE (see topDecreasingCategory) | null
//   goals               [{ id, label, saved, target }]
//
// `behaviorContext` (2nd, optional argument) is what lets several tiers
// below source their MESSAGE from a richer pipeline instead of a fixed
// descriptive sentence. It is entirely optional and additive: every
// existing caller that only ever passed financialData (RadarDetailModal)
// keeps working exactly as before, and this function still never
// duplicates the budget/category math those callers already share via
// buildFinancialData.
//   expenses       the raw transaction list
//   today          'YYYY-MM-DD' reference date
//   monthlyBudget  number
//   cycleStartDay  1-31, default 1 — see cycle.js; which day-of-month the
//                  user's billing cycle starts on, so "questo mese"
//                  means "dal 27 al 27" instead of always the calendar month
//   jokeHistory    [{ key, text, shownAt }] — jokes already shown, per
//                  "categoryId:type" key, so the same one never repeats
//
// TIER 2 — "SISTEMA INTELLIGENTE DI REAZIONI DELLA VOLPE": every reaction
// to a freshly-registered expense (>100€ mandatory, mega expenses,
// budget exceeded, category severely over, repeated purchases, anomalous
// increases, goal damage, positive events) is owned entirely by
// utils/expenseReactionEngine.js, drawing ONLY from the approved phrase
// library in data/spendyReactionLibrary.js. This file's job for that
// tier is exclusively priority ordering — see evaluateExpenseReaction's
// own header comment for the full cascade. Everything else here
// (tiers 0, 1, 3-7) is the pre-existing ambient/steady-state behavior,
// untouched.
import { analyzeBehavior, BEHAVIOR_ENGINE_CONFIG, BEHAVIOR_TYPES, getInsightDirection } from './behaviorEngine.js'
import { generateJokeCandidates } from './humorEngine.js'
import { pickBestJoke } from './jokeEvaluator.js'
import { rankInsightsByImportance } from './importantEventSelector.js'
import { evaluateExpenseReaction } from './expenseReactionEngine.js'
import { getCycleTiming } from './cycle.js'

export const SPENDY_STATES = {
  HAPPY: 'happy',
  ATTENTIVE: 'attentive',
  CONCERNED: 'concerned',
  IRONIC: 'ironic',
  ADVISOR: 'advisor',
  CELEBRATING: 'celebrating',
}

// --- Tunable thresholds — named so the rules below read like the spec ---
const BUDGET_ATTENTIVE_AT = 70 // % of monthly budget
const BUDGET_CONCERNED_AT = 85

// Le frasi descrittive dei livelli 3 e 4 (budget alto / in salita) dipendono
// da DOVE siamo nel ciclo impostato dall'utente: "la strada è ancora lunga" è
// vero all'inizio, falso nell'ultimo giorno. Le soglie restano quelle sopra:
// cambia solo cosa dice Spendy, non quando avvisa. Senza fase nota, la frase
// neutra (nessuna affermazione sul tempo).
const BUDGET_WARNING_MESSAGES = {
  concerned: {
    early: '🚨 Il budget ha alzato le mani: siamo praticamente al tappeto e il ciclo è appena cominciato.',
    middle: '🚨 Il budget ha alzato le mani: siamo praticamente al tappeto e il ciclo non è ancora finito.',
    final_days: '🚨 Il budget è quasi al tappeto: tieni duro, mancano pochi giorni alla fine del ciclo.',
    last_day: '🚨 Il budget è quasi al tappeto, ma oggi è l’ultimo giorno del ciclo: domani si riparte.',
    neutral: '🚨 Il budget ha alzato le mani: siamo praticamente al tappeto.',
  },
  attentive: {
    early: '👀 Il budget sta già sudando: abbiamo superato i tre quarti e la strada è ancora lunga.',
    middle: '👀 Il budget sta sudando: oltre i tre quarti, e il ciclo non è ancora finito.',
    final_days: '👀 Oltre i tre quarti del budget, ma mancano pochi giorni alla fine del ciclo: si può chiudere bene.',
    last_day: '👀 Ultimo giorno del ciclo: oltre i tre quarti del budget, ma domani si riparte.',
    neutral: '👀 Il budget sta sudando: abbiamo superato i tre quarti.',
  },
}

const PHASE_GROUP = {
  new_cycle: 'early', start: 'early', first_half: 'early',
  mid: 'middle', second_half: 'middle',
  final_days: 'final_days', last_day: 'last_day',
}

function budgetWarningMessage(level, phase) {
  return BUDGET_WARNING_MESSAGES[level][PHASE_GROUP[phase] ?? 'neutral']
}

// La fase del ciclo: da buildFinancialData (financialData.cycle) o, se manca,
// ricalcolata dalla data e dal giorno di inizio; null se non si può sapere.
function cyclePhaseOf(financialData, behaviorContext) {
  if (financialData?.cycle?.phase) return financialData.cycle.phase
  if (behaviorContext?.today) return getCycleTiming(behaviorContext.today, behaviorContext.cycleStartDay ?? 1).phase
  return null
}
const CATEGORY_DROP_ADVISOR_AT = -15 // % decrease vs last month
const CATEGORY_DROP_MIN_AMOUNT = 5 // €, ignore trivial drops

function findReachedGoal(goals) {
  return goals.find((goal) => goal.saved >= goal.target) ?? null
}

// Nearest-to-done open goal — where an "advisor" suggestion to redirect
// savings should point. Same idea as affordability.js's closest-goal
// pick, kept separate since the two utils have no other reason to depend
// on each other.
function findClosestOpenGoal(goals) {
  const open = goals.filter((goal) => goal.saved < goal.target)
  if (open.length === 0) return null
  return [...open].sort((a, b) => (a.target - a.saved) - (b.target - b.saved))[0]
}

function daysBetween(fromDateStr, toDateStr) {
  const from = new Date(`${fromDateStr}T00:00:00`)
  const to = new Date(`${toDateStr}T00:00:00`)
  return Math.round((to - from) / (1000 * 60 * 60 * 24))
}

// Runs the BehaviorEngine → HumorEngine → JokeEvaluator pipeline and
// returns the single best { insight, joke, key } to show, or null if
// nothing qualifies (insufficient data, no matching insight, or every
// candidate for every insight was rejected/repeated). `key` comes from
// getInsightTopicKey below — the unit jokeHistory is tracked against.
// `filterInsight` lets a caller restrict which BehaviorInsight objects
// are even considered — tiers 3/4 use it to require the SAME category
// (and direction) that already made the Coach Engine's own budget math
// fire, so the joke shown is never about a different, unrelated anomaly
// than the one the state is reacting to.
//
// Two separate, deliberately different repetition mechanisms: JokeEvaluator
// itself already refuses a candidate that's a near-duplicate of jokeHistory
// (see its originality/repetitionPenalty scoring) — that's what stops the
// exact same line from ever repeating, and it runs FIRST, so a topic with
// fresh wording still available is always shown. `cooldownDays` only
// matters once that's exhausted: if the freshest thing left to say is
// about a topic already discussed too recently AND a genuinely different
// topic is also on offer, this prefers the different topic instead of
// beating the same one into the ground. It never discards the only good
// joke available just because its topic came up before — that would mean
// falling back to the flat descriptive sentence for no real reason.
function pickBehaviorInsightJoke(behaviorContext, filterInsight = () => true, rankInsights = rankInsightsByImportance) {
  if (!behaviorContext?.today) return null
  const {
    expenses = [],
    today,
    monthlyBudget = 0,
    jokeHistory = [],
    financialData = null,
    cycleStartDay = 1,
    // Senza questo, l'unico insight che guarda gli obiettivi
    // (goal_progress, vedi behaviorEngine) non poteva nascere qui: la
    // lista arrivava fino a questa funzione e si fermava.
    goals = [],
    config = BEHAVIOR_ENGINE_CONFIG,
  } = behaviorContext

  const rawInsights = analyzeBehavior({ expenses, today, monthlyBudget, financialData, cycleStartDay, goals, config }).filter(filterInsight)
  // Re-ranked by composite importance (importantEventSelector.js), not
  // trusted on BehaviorEngine's own per-check `significance` alone — see
  // that module for why (a count-based insight can otherwise outscore a
  // real 180€ category spike). Tiers 3/4 pass a category+direction filter
  // above, so this mostly just orders 1-2 candidates there; tier 6 below
  // has no filter, so this is where it actually matters — it's the
  // "successivo accesso: qual è la cosa più interessante successa
  // dall'ultima volta" selection.
  const insights = rankInsights(rawInsights)
  let staleFallback = null

  for (const insight of insights) {
    const key = getInsightTopicKey(insight)
    const keyHistory = jokeHistory.filter((entry) => entry.key === key)

    const candidates = generateJokeCandidates(insight)
    const best = pickBestJoke(candidates, insight, keyHistory)
    if (!best) continue

    const lastShown = keyHistory[keyHistory.length - 1]
    const onCooldown = lastShown && daysBetween(lastShown.shownAt, today) < config.cooldownDays
    if (!onCooldown) return { insight, joke: best, key }
    staleFallback ??= { insight, joke: best, key }
  }
  // Nothing fresh-topic'd was available — a still-valid, still-fresh-worded
  // joke about a recently-discussed topic beats no joke at all.
  return staleFallback
}

// A BehaviorInsight is only a valid stand-in for "the category driving
// this tier" when it's about that exact category AND agrees on
// direction (a category currently spiking up should never be joked about
// via a "you spent so little" insight, even if one happens to exist for
// some other reason).
function sameCategoryAndDirection(categoryId, direction) {
  return (insight) => insight.categoryId === categoryId && getInsightDirection(insight.type) === direction
}

// The jokeHistory/repetition key for one insight — exported so HomePage
// records under the exact same key this module (and
// expenseReactionEngine.js's own topicKeyFor, which mirrors this exact
// formula) checks against, instead of duplicating the logic somewhere it
// could quietly drift out of sync.
//
// Keyed by categoryId+DIRECTION, not categoryId+exact BEHAVIOR_TYPE: a
// category's "high" bucket in humorLibrary.js is shared by
// recurring_high, category_spike, category_trend_up and
// amount_above_average alike (see humorEngine.js's own comment on why —
// from Spendy's comedic point of view they're all just "this ran hot").
// Which one of those four BehaviorEngine happens to detect can differ
// between two calls with the exact same underlying data (ranking ties,
// which check fires first) — keying by exact type would let a joke
// that's really the SAME topic slip past repetition checks just because
// a different detector produced it. Insights without a shared bucket
// (budget_exceeded, unusual_purchase, streaks, the expense-reaction
// engine's own tags, ...) fall back to categoryId+type, which is already
// their own unique bucket.
export function getInsightTopicKey(insight) {
  const direction = getInsightDirection(insight.type)
  if (insight.categoryId && direction) {
    return `${insight.categoryId}:${direction}`
  }
  return `${insight.categoryId ?? 'general'}:${insight.type}`
}

// A short factual line for whatever underlying data point tier 6's joke
// is about — shown as secondaryInsightText, same "joke first, data
// demoted to secondary" pattern as tiers 3/4 (see their own
// descriptiveMessage). Tier 6 has no single pre-existing descriptive
// sentence to fall back on (there's no CoachEngine tier text for
// "recurring_low" etc. the way there is for a category spike), so this
// builds one from the insight's own fields instead.
function describeInsight(insight) {
  const label = insight.category?.label
  switch (insight.type) {
    case 'recurring_high':
    case 'category_spike':
    case 'category_trend_up':
      return label ? `${label}: ${Math.round(insight.current)} € invece dei soliti ${Math.round(insight.baseline)} €.` : null
    case 'recurring_low':
    case 'category_drop':
    case 'category_trend_down':
      return label ? `${label}: solo ${Math.round(insight.current)} € invece dei soliti ${Math.round(insight.baseline)} €.` : null
    case 'amount_above_average':
      return label ? `È la spesa più alta del ciclo in ${label.toLowerCase()}.` : null
    case 'amount_below_average':
      return label ? `Una spesa ben sotto la media per ${label.toLowerCase()}.` : null
    case 'savings_vs_usual':
      return `${Math.round(Math.abs(insight.changeAmount))} € in meno del solito in questo ciclo.`
    case 'unusual_purchase':
      return label ? `Prima spesa in ${label.toLowerCase()} da diversi cicli.` : null
    case 'unusual_frequency':
      return label ? `Frequenza fuori dal solito in ${label.toLowerCase()} in questo ciclo.` : null
    case 'positive_streak':
      return 'Diversi cicli di fila sotto budget.'
    case 'negative_streak':
      return 'Diversi cicli di fila sopra la soglia di attenzione.'
    default:
      return null
  }
}

export function getSpendyCoach(financialData, behaviorContext = null) {
  const {
    spentRatio = 0,
    monthlyBudget = 0,
    topDecreasingCategory = null,
    goals = [],
  } = financialData ?? {}

  // 0. No income set yet — every tier below assumes a real monthlyBudget
  // to react to; with none, there's nothing genuine to compute (0 spent
  // of 0 budget isn't "on track", it's just unset), so Spendy waits out
  // loud instead of showing a hollow reading. First thing a fresh
  // install ever sees.
  if (!monthlyBudget || monthlyBudget <= 0) {
    return {
      state: SPENDY_STATES.ADVISOR,
      message: '🦊 Sono in attesa... cosa stai aspettando? Imposta il tuo guadagno mensile e si parte!',
      reason: 'awaiting_income',
      priority: 0,
      insight: null,
      messageScore: 100,
      secondaryInsightText: null,
    }
  }

  // 1. Goal celebration — a real milestone, never replaced by anything
  // else: the user must see it before any routine reaction.
  const reachedGoal = findReachedGoal(goals)
  if (reachedGoal) {
    return {
      state: SPENDY_STATES.CELEBRATING,
      message: `🎉 Obiettivo "${reachedGoal.label}" raggiunto! Questa volta offro io... virtualmente 😂`,
      reason: 'goal_reached',
      priority: 1,
      insight: null,
      messageScore: 100,
      secondaryInsightText: null,
    }
  }

  // 2. THE reaction system — "ogni volta che l'utente registra una spesa
  // > €100, Spendy deve reagire SEMPRE", plus every other behavioral
  // trigger in the approved priority cascade. See
  // expenseReactionEngine.js for the full 10-step logic; this just slots
  // its result straight into the tier return shape when it has one.
  const expenseReaction = evaluateExpenseReaction({
    today: behaviorContext?.today,
    expenses: behaviorContext?.expenses ?? [],
    monthlyBudget,
    cycleStartDay: behaviorContext?.cycleStartDay ?? 1,
    goals,
    financialData,
    jokeHistory: behaviorContext?.jokeHistory ?? [],
  })
  if (expenseReaction) {
    return { ...expenseReaction, priority: 2 }
  }

  // 3. Major budget warning — the month itself is running hot (but not
  // yet over — tier 2's "budget_exceeded" step already caught that case
  // unconditionally). Tries the joke pipeline first, falling back to the
  // descriptive sentence if nothing valid comes back.
  if (spentRatio >= BUDGET_CONCERNED_AT) {
    const descriptiveMessage = budgetWarningMessage('concerned', cyclePhaseOf(financialData, behaviorContext))
    const behaviorResult = pickBehaviorInsightJoke(
      behaviorContext,
      (insight) => insight.type === BEHAVIOR_TYPES.BUDGET_HIGH,
    )
    return {
      state: SPENDY_STATES.CONCERNED,
      message: behaviorResult ? behaviorResult.joke.text : descriptiveMessage,
      reason: 'budget_high',
      priority: 3,
      insight: behaviorResult?.insight ?? null,
      messageScore: behaviorResult ? behaviorResult.joke.score : 100,
      secondaryInsightText: behaviorResult ? descriptiveMessage : null,
    }
  }

  // 4. Category/budget warning — noticeable but not yet alarming. Same
  // joke-first / descriptive-fallback treatment as tier 3.
  if (spentRatio >= BUDGET_ATTENTIVE_AT) {
    const descriptiveMessage = budgetWarningMessage('attentive', cyclePhaseOf(financialData, behaviorContext))
    const behaviorResult = pickBehaviorInsightJoke(
      behaviorContext,
      (insight) => insight.type === BEHAVIOR_TYPES.BUDGET_RISING,
    )
    return {
      state: SPENDY_STATES.ATTENTIVE,
      message: behaviorResult ? behaviorResult.joke.text : descriptiveMessage,
      reason: 'budget_rising',
      priority: 4,
      insight: behaviorResult?.insight ?? null,
      messageScore: behaviorResult ? behaviorResult.joke.score : 100,
      secondaryInsightText: behaviorResult ? descriptiveMessage : null,
    }
  }

  // 5. Useful advice — a category genuinely dropped; suggest redirecting
  // the saved amount toward whichever goal is closest to done. State
  // stays advisor either way; the joke (when one wins) replaces the
  // advice sentence as the headline, with the advice itself demoted to
  // secondaryInsightText rather than lost.
  if (
    topDecreasingCategory
    && topDecreasingCategory.changePercent <= CATEGORY_DROP_ADVISOR_AT
    && Math.abs(topDecreasingCategory.changeAmount) >= CATEGORY_DROP_MIN_AMOUNT
  ) {
    const savedAmount = Math.round(Math.abs(topDecreasingCategory.changeAmount))
    const droppedPercent = Math.round(Math.abs(topDecreasingCategory.changePercent))
    const closestGoal = findClosestOpenGoal(goals)
    const descriptiveMessage = closestGoal
      ? `Hai ridotto le spese ${topDecreasingCategory.category.label} del ${droppedPercent}%. Potresti spostare ${savedAmount} € verso "${closestGoal.label}".`
      : `Hai ridotto le spese ${topDecreasingCategory.category.label} del ${droppedPercent}%. Ottimo lavoro!`

    const behaviorResult = pickBehaviorInsightJoke(
      behaviorContext,
      sameCategoryAndDirection(topDecreasingCategory.categoryId, 'low'),
    )

    return {
      state: SPENDY_STATES.ADVISOR,
      message: behaviorResult ? behaviorResult.joke.text : descriptiveMessage,
      reason: 'savings_opportunity',
      priority: 5,
      insight: behaviorResult?.insight ?? null,
      messageScore: behaviorResult ? behaviorResult.joke.score : 100,
      secondaryInsightText: behaviorResult ? descriptiveMessage : null,
    }
  }

  // 6. Behavior-driven observation — a richer, non-repeating, contextual
  // joke about a habitual/unusual spending pattern, for whenever nothing
  // above needed real attention (never used for a real problem — see
  // priorities 1-5). Nothing in the Coach Engine has an opinion about
  // state at this point, so the BehaviorInsight's own suggestedState is
  // used as-is — unlike tiers 3-5, there is no existing tier state to
  // preserve here.
  const behaviorResult = pickBehaviorInsightJoke(behaviorContext)
  if (behaviorResult) {
    return {
      state: behaviorResult.insight.suggestedState,
      message: behaviorResult.joke.text,
      reason: behaviorResult.insight.type,
      priority: 6,
      insight: behaviorResult.insight,
      messageScore: behaviorResult.joke.score,
      secondaryInsightText: describeInsight(behaviorResult.insight),
    }
  }

  // 7. Happy — the default: nothing above fired
  return {
    state: SPENDY_STATES.HAPPY,
    message: '😎 Bravo! Per ora sei sotto budget in questo ciclo.',
    reason: 'on_track',
    priority: 7,
    insight: null,
    messageScore: 100,
    secondaryInsightText: null,
  }
}
