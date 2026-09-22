import './SpendyCoach.css'

const BADGE_BY_STATE = {
  happy: { emoji: '😎', label: 'In forma', tone: 'mint' },
  attentive: { emoji: '👀', label: 'Attento', tone: 'gold' },
  concerned: { emoji: '🤨', label: 'Preoccupato', tone: 'coral' },
  ironic: { emoji: '😏', label: 'Ironico', tone: 'violet' },
  advisor: { emoji: '💡', label: 'Consiglio', tone: 'mint' },
  celebrating: { emoji: '🎉', label: 'Festa!', tone: 'gold' },
}

// A small always-visible label for which of the 6 coach states is active
// — useful for the user at a glance, and doubles as a cheap visual check
// while wiring/testing that the right state made it through.
export function SpendyStateBadge({ state = 'happy' }) {
  const badge = BADGE_BY_STATE[state] ?? BADGE_BY_STATE.happy

  return (
    <span className={`spendy-badge spendy-badge--${badge.tone}`}>
      <span aria-hidden="true">{badge.emoji}</span> {badge.label}
    </span>
  )
}
