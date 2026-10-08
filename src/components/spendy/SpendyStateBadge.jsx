import { useLanguage } from '../../i18n/useLanguage.js'
import './SpendyCoach.css'

// Il testo è mascot.badge.<stato>, nella lingua scelta.
const BADGE_BY_STATE = {
  happy: { emoji: '😎', tone: 'mint' },
  attentive: { emoji: '👀', tone: 'gold' },
  concerned: { emoji: '🤨', tone: 'coral' },
  ironic: { emoji: '😏', tone: 'violet' },
  advisor: { emoji: '💡', tone: 'mint' },
  celebrating: { emoji: '🎉', tone: 'gold' },
}

// A small always-visible label for which of the 6 coach states is active
// — useful for the user at a glance, and doubles as a cheap visual check
// while wiring/testing that the right state made it through.
export function SpendyStateBadge({ state = 'happy' }) {
  const { t } = useLanguage()
  const known = state in BADGE_BY_STATE ? state : 'happy'
  const badge = BADGE_BY_STATE[known]

  return (
    <span className={`spendy-badge spendy-badge--${badge.tone}`}>
      <span aria-hidden="true">{badge.emoji}</span> {t(`mascot.badge.${known}`)}
    </span>
  )
}
