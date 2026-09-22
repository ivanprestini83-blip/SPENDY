// Important Event Selector — a small ranking layer ON TOP of
// BehaviorEngine, not a parallel system: it takes the exact same
// BehaviorInsight objects analyzeBehavior() already produces (see
// behaviorEngine.js) and re-ranks them by a composite "how important is
// this, really" score, instead of trusting each check's own
// `significance` number blindly across different TYPES.
//
// Why this exists: `significance` is computed independently per check
// and isn't on one consistent scale — a count-based unusual_frequency
// insight can score higher than a genuinely major 180€/475% category
// spike just because its baseline count was tiny (see the worked
// example in this module's tests). getSpendyCoach's tier 6 — "nothing
// urgent enough for tiers 1-5 fired, so what's the single most
// interesting thing right now" — is the one place this ranking is used;
// it never recomputes financial data itself, only reorders insights
// BehaviorEngine already found.
//
// The four factors below are exactly the ones the product spec asked
// for: absolute euro impact, deviation from normal (BehaviorEngine's own
// intensity already normalizes this per-type, budget-relevant weight via
// TYPE_BASE_WEIGHT, and confidence from how many real samples back it up.

// How inherently newsworthy each KIND of event is, before looking at its
// specific numbers — a real budget overrun always matters more than a
// mild frequency blip, independent of magnitude.
const TYPE_BASE_WEIGHT = {
  budget_exceeded: 100,
  budget_high: 70,
  budget_rising: 55,
  category_spike: 65,
  recurring_high: 65,
  category_trend_up: 60,
  negative_streak: 55,
  category_drop: 50,
  recurring_low: 55,
  category_trend_down: 50,
  savings_vs_usual: 55,
  amount_above_average: 45,
  amount_below_average: 40,
  budget_respected: 45,
  positive_streak: 40,
  unusual_purchase: 35,
  unusual_frequency: 22, // count-based, the noisiest signal — deliberately capped low
  // Un obiettivo vicino al traguardo e' una delle poche buone notizie
  // che merita di stare in alto quanto un problema: e' il momento in cui
  // una spinta serve davvero.
  goal_progress: 58,
  // "tante piccole spese" pesa come una variazione di categoria: e' un
  // fenomeno reale, ma quasi mai urgente quanto un budget sforato.
  small_expenses_add_up: 48,
}

// BehaviorEngine's own `intensity` ('light'|'funny'|'strong') already
// says "how far past its own threshold" in a way that's meaningful for
// THAT type, whether its numbers are euros, percentages or counts — a
// cross-type-safe proxy for "how deviant is this", used instead of
// re-reading raw changePercent (which isn't on a comparable scale either).
const INTENSITY_SCORE = { strong: 30, funny: 18, light: 8 }

// Types whose `current`/`changeAmount` are NOT euro amounts (percentages
// or transaction counts) — euro-impact scoring would misread them.
const NON_EURO_TYPES = new Set(['budget_respected', 'positive_streak', 'negative_streak', 'unusual_frequency'])

function euroImpactScore(insight) {
  if (NON_EURO_TYPES.has(insight.type)) return 0
  const amount = Math.abs(insight.changeAmount ?? insight.current ?? 0)
  return Math.min(25, amount / 8) // saturates around 200€
}

function confidenceScore(insight) {
  const samples = typeof insight.samples === 'number' ? insight.samples : 1
  return Math.min(10, samples * 2)
}

// 0-100 composite importance for one BehaviorInsight. Pure, deterministic,
// no side effects — same insight always scores the same.
export function computeImportance(insight) {
  const base = TYPE_BASE_WEIGHT[insight.type] ?? 30
  const intensity = INTENSITY_SCORE[insight.intensity] ?? 10
  const euro = euroImpactScore(insight)
  const confidence = confidenceScore(insight)
  const score = base * 0.35 + intensity + euro + confidence
  return Math.max(0, Math.min(100, Math.round(score)))
}

// Re-sorts (never filters) a list of BehaviorInsight objects by
// composite importance, most important first. Ties keep their relative
// analyzeBehavior order (stable sort).
export function rankInsightsByImportance(insights) {
  return insights
    .map((insight, index) => ({ insight, index, importance: computeImportance(insight) }))
    .sort((a, b) => (b.importance - a.importance) || (a.index - b.index))
    .map((entry) => entry.insight)
}
