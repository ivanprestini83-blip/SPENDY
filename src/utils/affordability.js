import { translate } from '../i18n/translate.js'
import { formatCurrencyWhole } from './format.js'

// Deliberately simple, non-AI simulation: it only ever looks at numbers
// already in the store (remaining budget this month + the closest goal),
// never an external model. See AffordabilityScreen for the disclaimer
// shown alongside this result. `lang` only picks the words (missing or
// unknown → Italian): levels and thresholds are the same in every language.
export function evaluateAffordability({ amount, availableBudget, goals, lang = 'it' }) {
  const t = (key, params) => translate(lang, `affordability.${key}`, params)
  // Gli stessi importi arrotondati all'euro, scritti nel formato della lingua.
  const money = (value) => formatCurrencyWhole(Math.round(value), lang)

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      level: 'yellow',
      title: t('noamount.title'),
      message: t('noamount.message'),
    }
  }

  const remainingAfter = availableBudget - amount
  const ratio = availableBudget > 0 ? amount / availableBudget : Infinity

  const closestGoal = [...goals].sort((a, b) => (a.target - a.saved) - (b.target - b.saved))[0]
  const goalHint = closestGoal
    ? ` ${t('goalhint', { goal: closestGoal.label })}`
    : ''

  if (remainingAfter < 0) {
    return {
      level: 'red',
      title: t('wait'),
      message: `${t('over', { amount: money(-remainingAfter) })}${goalHint}`,
    }
  }

  if (ratio <= 0.3) {
    return {
      level: 'green',
      title: t('ok.title'),
      message: t('ok.message', { amount: money(remainingAfter) }),
    }
  }

  if (ratio <= 0.7) {
    return {
      level: 'yellow',
      title: t('careful.title'),
      message: `${t('careful.message', { amount: money(remainingAfter) })}${goalHint}`,
    }
  }

  return {
    level: 'red',
    title: t('wait'),
    message: `${t('most', { amount: money(availableBudget) })}${goalHint}`,
  }
}
