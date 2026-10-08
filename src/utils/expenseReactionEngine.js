// Expense Reaction Engine — the selection logic for "SISTEMA INTELLIGENTE
// DI REAZIONI DELLA VOLPE". This module owns ONLY the logic: which
// situation applies, which phrase POOL fits it, and which single phrase
// to show right now. It never writes phrase text itself — every string
// it can return comes from data/spendyReactionLibrary.js, verbatim.
//
//   registrazione spesa → evaluateExpenseReaction() → { state, message,
//   reason, insight, ... } | null (getSpendyCoach slots this straight
//   into its own return shape, same as every other tier)
//
// PRIORITY CASCADE (exactly as specified):
//   1. spesa >= 1000€           -> SPESA_ENORME_1000
//   2. spesa >= 500€            -> SPESA_ENORME_500
//   3. obiettivo danneggiato    -> OBIETTIVO_DANNEGGIATO
//   4. budget superato          -> BUDGET_SUPERATO (checked even with NO
//                                  fresh expense today — "sei attualmente
//                                  sopra budget" is a standing fact, not
//                                  only a one-time reaction)
//   5. categoria fortemente sopra la propria media -> CATEGORIA_ECCESSIVA
//      (solo ristoranti/shopping/auto: sono le uniche 3 con frasi
//      approvate — altre categorie passano al gradino successivo)
//   6. spesa ripetuta           -> SPESA_RIPETUTA
//   7. aumento anomalo          -> AUMENTO_ANOMALO
//   8. spesa > 100€ (mandatory) -> SPESA_100 + SPESA_INUTILE
//   9. evento positivo          -> BUONA_SCELTA + RISPARMIO
//   10. nessuna condizione      -> null (getSpendyCoach falls back to its
//       own steady-state tiers — budget_high/rising, general behavior...)
//
// Steps 1, 2, 3, 5, 6, 7, 8, 9 all need a "trigger" — the expense that
// was just registered TODAY (see findTriggerExpense). Step 4 doesn't;
// being over budget is checked regardless, exactly like the old hard
// "over_budget" tier it replaces.
//
// €0-100 rule: nothing here is amount-gated below 100€ except steps 1/2
// (which need >=500) and step 8 (which needs >100 exactly) — so for a
// normal small expense, ONLY a genuine behavioral trigger (3/4/5/6/7/9)
// can produce a reaction. No trigger → null → "€20 normale" stays silent,
// exactly as specified.
import { categoryComparison } from './budgetCalculations.js'
import { REACTION_LIBRARY } from '../data/spendyReactionLibrary.js'

// Combined pools — "quando ci sono più frasi valide" applies within a
// single priority step too: step 8 draws from BOTH the ">100€" bucket
// and the "apparently useless expense" bucket (neither is tied to a
// specific narrower condition of its own in the priority list), and
// step 9 draws from both positive buckets, for a richer rotation.
//
// One set of pools per language, built from that language's library: every
// language has the same phrases in the same order, so the selection below
// (same rng, same history rules) picks the same reaction in each language.
// Unknown language → Italian.
function buildPools(L) {
  return {
    SPESA_ENORME_1000: L.SPESA_ENORME_1000,
    SPESA_ENORME_500: L.SPESA_ENORME_500,
    OBIETTIVO_DANNEGGIATO: L.OBIETTIVO_DANNEGGIATO,
    OBIETTIVO_NO_VACANZA: L.OBIETTIVO_DANNEGGIATO.filter((text) => text !== L.VACATION_ONLY_PHRASE),
    BUDGET_SUPERATO: L.BUDGET_SUPERATO,
    CATEGORIA_ECCESSIVA_RISTORANTI: L.CATEGORIA_ECCESSIVA_RISTORANTI,
    CATEGORIA_ECCESSIVA_SHOPPING: L.CATEGORIA_ECCESSIVA_SHOPPING,
    CATEGORIA_ECCESSIVA_AUTO: L.CATEGORIA_ECCESSIVA_AUTO,
    SPESA_RIPETUTA: L.SPESA_RIPETUTA,
    AUMENTO_ANOMALO: L.AUMENTO_ANOMALO,
    HUNDRED_PLUS: [...L.SPESA_100, ...L.SPESA_INUTILE],
    POSITIVE_EVENT: [...L.BUONA_SCELTA, ...L.RISPARMIO],
    RARE_SPECIALI: L.RARE_SPECIALI,
  }
}
const POOLS = Object.fromEntries(Object.entries(REACTION_LIBRARY).map(([lang, L]) => [lang, buildPools(L)]))
const poolsFor = (lang) => POOLS[lang] ?? POOLS.it

// --- Tunable thresholds — named so the cascade reads like the spec ---
const MEGA_1000_AT = 1000 // €
const MEGA_500_AT = 500 // €
const HUNDRED_PLUS_AT = 100 // €, STRICTLY greater than (100€ itself does not qualify, 100.01€ does)
const GOAL_DAMAGE_MIN_AMOUNT = 100 // €, only a genuinely notable expense can "damage" a goal
const GOAL_DAMAGE_FRACTION = 0.10 // expense >= 10% of the goal's remaining gap counts as damage
const CATEGORY_SEVERE_AT = 80 // % change vs previous cycle — "fortemente sopra"
const CATEGORY_ANOMALOUS_AT = 30 // % change vs previous cycle — "aumento anomalo" / a real drop for "evento positivo"
const REPEAT_WINDOW_DAYS = 5 // "in pochi giorni"
const REPEAT_THRESHOLD = 3 // same category this many times within the window counts as "ripetuta"
const RARE_SUBSTITUTION_PROBABILITY = 0.08 // "una probabilità molto più bassa"

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The single most recently registered expense dated today — `expenses`
// is newest-first (see useAppStore's addExpense), so this is exactly
// "the transaction the user just entered", the same pattern every prior
// "react to what just happened" tier in this codebase has used.
function findTriggerExpense(expenses, today) {
  return expenses.find((expense) => expense.date === today) ?? null
}

function findDamagedGoal(goals, amount) {
  if (amount < GOAL_DAMAGE_MIN_AMOUNT) return null
  const open = goals.filter((goal) => goal.saved < goal.target)
  if (open.length === 0) return null
  const closest = [...open].sort((a, b) => (a.target - a.saved) - (b.target - b.saved))[0]
  const gap = closest.target - closest.saved
  if (gap <= 0) return null
  return amount >= gap * GOAL_DAMAGE_FRACTION ? closest : null
}

function categoryBucketFor(categoryId) {
  if (categoryId === 'ristoranti') return 'CATEGORIA_ECCESSIVA_RISTORANTI'
  if (categoryId === 'shopping') return 'CATEGORIA_ECCESSIVA_SHOPPING'
  if (categoryId === 'carburante' || categoryId === 'trasporti') return 'CATEGORIA_ECCESSIVA_AUTO'
  return null
}

function countRecentSameCategory(expenses, categoryId, today) {
  const windowStart = shiftDate(today, -(REPEAT_WINDOW_DAYS - 1))
  return expenses.filter(
    (expense) => expense.categoryId === categoryId && expense.date >= windowStart && expense.date <= today,
  ).length
}

// Same formula getInsightTopicKey (spendyCoach.js) uses for every OTHER
// insight — this has to match exactly, or jokeHistory recording and this
// module's own anti-repeat counting silently drift apart (see the
// comment history on the old "notable_expense" tier this replaces for
// why that's a real, easy-to-reintroduce bug).
function topicKeyFor(categoryId, type) {
  return `${categoryId ?? 'general'}:${type}`
}

// "selezionare casualmente; non ripetere immediatamente la stessa frase;
// tenere traccia delle ultime frasi mostrate" — excludes whichever texts
// were the last 3 shown for THIS topic key, then picks uniformly at
// random among what's left (or the whole pool, if that empties it out).
function pickFromPool(pool, jokeHistory, key, rng) {
  const recentTexts = new Set(
    jokeHistory.filter((entry) => entry.key === key).slice(-3).map((entry) => entry.text),
  )
  const fresh = pool.filter((text) => !recentTexts.has(text))
  const usable = fresh.length > 0 ? fresh : pool
  return usable[Math.floor(rng() * usable.length)]
}

// Builds the final { state, message, reason, insight, ... } shape every
// cascade step below returns. `rare: true` rolls a LOW-probability
// chance to swap in a special/rare line instead — "dare alle frasi
// rare/speciali una probabilità molto più bassa" — kept out of the
// gentler steps (goal damage, positive event) whose own tone would clash
// with the rare bucket's sterner voice.
//
// `bucket` is a pool NAME (see buildPools) and `pools` the current
// language's pools. Which pool and which position were picked is
// remembered (REACTION_REF), so the same reaction can be shown again in
// another language without drawing a new one.
const REACTION_REF = new WeakMap()

function pickInto({ state, ...rest }, pools, poolName, jokeHistory, key, rng) {
  const pool = pools[poolName]
  const message = pickFromPool(pool, jokeHistory, key, rng)
  const reaction = { state, message, ...rest }
  REACTION_REF.set(reaction, { poolName, index: pool.indexOf(message) })
  return reaction
}

function buildResult({ bucket, pools, state, reason, insightCategoryId = null, rare = false, jokeHistory, rng }) {
  if (rare && rng() < RARE_SUBSTITUTION_PROBABILITY) {
    const rareKey = topicKeyFor(null, 'rare_special')
    return pickInto({
      state,
      reason,
      insight: { type: 'rare_special', categoryId: null, category: null },
      messageScore: 100,
      secondaryInsightText: null,
    }, pools, 'RARE_SPECIALI', jokeHistory, rareKey, rng)
  }

  const key = topicKeyFor(insightCategoryId, reason)
  return pickInto({
    state,
    reason,
    insight: { type: reason, categoryId: insightCategoryId, category: null },
    messageScore: 100,
    secondaryInsightText: null,
  }, pools, bucket, jokeHistory, key, rng)
}

// The same reaction (same pool, same position) in another language.
function inLanguage(reaction, lang) {
  const ref = REACTION_REF.get(reaction)
  const text = ref ? poolsFor(lang)[ref.poolName]?.[ref.index] : null
  if (!text || text === reaction.message) return reaction
  const translated = { ...reaction, message: text }
  REACTION_REF.set(translated, ref)
  return translated
}

// "Una nuova spesa = massimo una reaction visibile."
//
// getSpendyCoach runs on EVERY render of HomePage/SpendyPage, and the
// selection below is random — so the same new expense used to be shown
// with one phrase, then immediately a second one: HomePage records the
// shown phrase into jokeHistory (recordSpendyJoke), which re-renders the
// page, and pickFromPool — correctly, for a *new* event — excludes that
// just-recorded phrase and draws another. Any other re-render (sync
// pulling the expense back from Supabase, a toggle...) re-rolled it too.
//
// So the reaction chosen for one event is remembered and reused: same
// event (the trigger expense's id, or the day for the standing
// "budget_exceeded" reaction with no new expense) + same cascade step →
// same result, however many times the coach re-runs. A new expense is a
// new event and still gets a fresh, non-repeating pick exactly as before.
// Only in-memory for this session; jokeHistory recording is unchanged.
const shownReactionByEvent = new Map()
const SHOWN_REACTION_MEMORY = 50

function reactionEventKey(expenses, today, reason) {
  const trigger = findTriggerExpense(expenses, today)
  const event = trigger
    ? `expense:${trigger.id ?? `${trigger.date}|${trigger.amount}|${trigger.categoryId}`}`
    : `standing:${today}`
  return `${event}|${reason}`
}

// The one entry point getSpendyCoach calls. `rng` is injectable purely
// for deterministic testing — production code never passes it, and it
// defaults to real randomness. Tests that inject `rng` bypass the
// one-reaction-per-event memory above, so every call stays deterministic.
export function evaluateExpenseReaction(args) {
  const result = selectExpenseReaction(args)
  if (!result || args.rng) return result

  const key = reactionEventKey(args.expenses ?? [], args.today, result.reason)
  const alreadyShown = shownReactionByEvent.get(key)
  // Same event after a language change: the same reaction, translated.
  if (alreadyShown) return inLanguage(alreadyShown, args.lang)

  shownReactionByEvent.set(key, result)
  if (shownReactionByEvent.size > SHOWN_REACTION_MEMORY) {
    shownReactionByEvent.delete(shownReactionByEvent.keys().next().value)
  }
  return result
}

function selectExpenseReaction({
  today,
  expenses = [],
  monthlyBudget = 0,
  cycleStartDay = 1,
  goals = [],
  financialData = null,
  jokeHistory = [],
  rng = Math.random,
  lang = 'it',
}) {
  if (!today) return null
  const pools = poolsFor(lang)

  const available = financialData?.available ?? 0
  const overBudget = monthlyBudget > 0 && available < 0

  const triggerExpense = findTriggerExpense(expenses, today)
  if (!triggerExpense && !overBudget) return null

  // 1 & 2. Mega expense — absolute euro amounts, independent of budget size.
  if (triggerExpense) {
    if (triggerExpense.amount >= MEGA_1000_AT) {
      return buildResult({ bucket: 'SPESA_ENORME_1000', pools, state: 'concerned', reason: 'mega_expense_1000', rare: true, jokeHistory, rng })
    }
    if (triggerExpense.amount >= MEGA_500_AT) {
      return buildResult({ bucket: 'SPESA_ENORME_500', pools, state: 'concerned', reason: 'mega_expense_500', rare: true, jokeHistory, rng })
    }

    // 3. Goal damaged — only a notable expense meaningfully eating into
    // the closest open goal's remaining gap counts.
    const damagedGoal = findDamagedGoal(goals, triggerExpense.amount)
    if (damagedGoal) {
      const isVacationGoal = /vacanza/i.test(damagedGoal.label)
      const pool = isVacationGoal ? 'OBIETTIVO_DANNEGGIATO' : 'OBIETTIVO_NO_VACANZA'
      return buildResult({ bucket: pool, pools, state: 'ironic', reason: 'goal_damaged', insightCategoryId: damagedGoal.id, jokeHistory, rng })
    }
  }

  // 4. Budget exceeded — the one step that fires even with no fresh
  // expense today, same as the "steady state" it replaces.
  if (overBudget) {
    return buildResult({ bucket: 'BUDGET_SUPERATO', pools, state: 'concerned', reason: 'budget_exceeded', rare: true, jokeHistory, rng })
  }

  if (!triggerExpense) return null

  const categoryId = triggerExpense.categoryId
  const categoryRow = categoryComparison(expenses, today, cycleStartDay).find((row) => row.categoryId === categoryId)
  const hasCategoryHistory = Boolean(categoryRow && categoryRow.previous > 0)

  // 5. Category severely over its own usual pace — only the 3 categories
  // with approved phrases; others fall through to step 6/7.
  if (hasCategoryHistory && categoryRow.changePercent >= CATEGORY_SEVERE_AT) {
    const bucket = categoryBucketFor(categoryId)
    if (bucket) {
      return buildResult({ bucket, pools, state: 'concerned', reason: 'category_severe', insightCategoryId: categoryId, rare: true, jokeHistory, rng })
    }
  }

  // 6. Repeated expense — same category, several times in a short window.
  if (countRecentSameCategory(expenses, categoryId, today) >= REPEAT_THRESHOLD) {
    return buildResult({ bucket: 'SPESA_RIPETUTA', pools, state: 'ironic', reason: 'repeated_expense', insightCategoryId: categoryId, jokeHistory, rng })
  }

  // 7. Anomalous increase — any category, moderate threshold.
  if (hasCategoryHistory && categoryRow.changePercent >= CATEGORY_ANOMALOUS_AT) {
    return buildResult({ bucket: 'AUMENTO_ANOMALO', pools, state: 'attentive', reason: 'anomalous_increase', insightCategoryId: categoryId, jokeHistory, rng })
  }

  // 8. €100+ — the mandatory floor. Strictly greater than 100.
  if (triggerExpense.amount > HUNDRED_PLUS_AT) {
    return buildResult({ bucket: 'HUNDRED_PLUS', pools, state: 'ironic', reason: 'expense_over_100', rare: true, jokeHistory, rng })
  }

  // 9. Positive event — this category is running meaningfully BELOW its
  // usual pace, a genuine "buona scelta" signal instead of just "budget
  // happens to still be comfortable" (which would fire constantly and
  // break "€20 normale -> nessuna reazione").
  if (hasCategoryHistory && categoryRow.changeAmount < 0 && Math.abs(categoryRow.changePercent) >= CATEGORY_ANOMALOUS_AT) {
    return buildResult({ bucket: 'POSITIVE_EVENT', pools, state: 'happy', reason: 'positive_event', insightCategoryId: categoryId, jokeHistory, rng })
  }

  // 10. Nothing applies.
  return null
}

// Exposed only for SpendyPage's Radar gating (see its own comment) — a
// quick, dependency-light way to tell "was this coach result one of this
// engine's reactions" without re-running the whole cascade.
export const EXPENSE_REACTION_REASONS = new Set([
  'mega_expense_1000',
  'mega_expense_500',
  'goal_damaged',
  'budget_exceeded',
  'category_severe',
  'repeated_expense',
  'anomalous_increase',
  'expense_over_100',
  'positive_event',
])
