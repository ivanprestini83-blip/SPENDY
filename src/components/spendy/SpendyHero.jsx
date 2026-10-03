import { MASCOT_NAME } from '../../brand.js'
import { spendyStates, spendyToneByState } from './spendyStates.js'
import { getSpendyHeroLayout } from './spendyHeroLayouts.js'
import './SpendyHero.css'

// The Home hero: Spendy as a character on the page, not an avatar in a
// card. No box around her — a soft glow behind, the mascot large enough
// to lead the screen, and her line in a real speech bubble whose tail
// points back at her.
//
// Pure presentation. `state`/`message`/`secondaryText` come from
// getSpendyCoach (utils/spendyCoach.js) via HomePage; this component
// never decides what Spendy thinks, only where she stands while saying
// it. The stance comes from spendyHeroLayouts.js (state -> composition),
// or from `position` when a caller wants to force one.
//
// `image` overrides the PNG for the state (defaults to spendyStates).
// The stage is keyed on `state` so the entrance replays when her mood
// actually changes, not on every re-render; the bubble is keyed on the
// message, so a new line (e.g. Spendy AI replacing the local one) pops in.
//
// Spendy AI can suggest three more things (see src/ai/): `layout` (one of
// spendyHeroLayouts' compositions, same as `position`), `tone` (bubble
// accent) and `animation` (entrance flavour). All optional: without them
// everything is derived from `state`, exactly as before.

// AI tone → bubble accent (same four accents the states already use).
const ACCENT_BY_TONE = {
  friendly: 'mint',
  helpful: 'mint',
  playful: 'violet',
  ironic: 'violet',
  celebratory: 'gold',
  concerned: 'coral',
}
const HERO_ANIMATIONS = ['gentle', 'playful', 'celebrate', 'concerned']

export function SpendyHero({
  state = 'happy',
  message,
  secondaryText = null,
  image = null,
  position = null,
  layout = null,
  tone = null,
  animation = null,
  messageScore = null,
  onTalk = () => {},
}) {
  const composition = getSpendyHeroLayout(state, position ?? layout)
  const src = image ?? spendyStates[state] ?? spendyStates.happy
  const accent = ACCENT_BY_TONE[tone] ?? spendyToneByState[state] ?? 'violet'
  const motion = HERO_ANIMATIONS.includes(animation) ? animation : 'gentle'

  const style = {
    '--spendy-tilt': `${composition.tilt}deg`,
    '--spendy-lift': `${composition.lift}px`,
    '--spendy-scale': composition.scale,
  }

  return (
    <section
      className={`spendy-hero spendy-hero--${composition.position} spendy-hero--${state} spendy-hero--anim-${motion}`}
      style={style}
      aria-label={`${MASCOT_NAME} ti dice`}
    >
      <div className="spendy-hero__glow" aria-hidden="true">
        <span className="spendy-hero__spark spendy-hero__spark--a" />
        <span className="spendy-hero__spark spendy-hero__spark--b" />
        <span className="spendy-hero__spark spendy-hero__spark--c" />
      </div>

      <div key={state} className="spendy-hero__stage">
        <div className="spendy-hero__mascot">
          <div className="spendy-hero__float">
            <img src={src} alt={`${MASCOT_NAME}: ${state}`} className="spendy-hero__img" draggable="false" />
          </div>
          <span className="spendy-hero__ground" aria-hidden="true" />
        </div>

        <div key={message} className={`spendy-hero__speech spendy-hero__speech--${accent}`} aria-live="polite">
          <p className="spendy-hero__speaker">{MASCOT_NAME}</p>
          <p className="spendy-hero__message">{message}</p>
          {secondaryText && <p className="spendy-hero__secondary">{secondaryText}</p>}
          <span className="spendy-hero__tail" aria-hidden="true" />
        </div>

        <button
          type="button"
          className="spendy-hero__cta"
          onClick={onTalk}
          title={messageScore != null ? `Punteggio battuta: ${messageScore}/100` : undefined}
        >
          <span className="spendy-hero__cta-icon" aria-hidden="true">
            <ChatIcon />
          </span>
          Radar
          <span className="spendy-hero__cta-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  )
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 4c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L5 19.5l1.2-3.3C4.5 14.9 3.5 13 3.5 11c0-3.9 3.8-7 8.5-7Z"
        fill="currentColor"
      />
      <circle cx="8.5" cy="11" r="1.1" fill="#6d5cf0" />
      <circle cx="12" cy="11" r="1.1" fill="#6d5cf0" />
      <circle cx="15.5" cy="11" r="1.1" fill="#6d5cf0" />
    </svg>
  )
}
