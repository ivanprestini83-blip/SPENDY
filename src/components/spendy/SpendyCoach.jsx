import { APP_NAME, APP_TAGLINE } from '../../brand.js'
import { SpendyCharacterWithMessage } from './SpendyCharacterWithMessage.jsx'
import './SpendyCoach.css'

// The Home "coach moment" — mascot compact and directly on the section's
// own background (no boxed avatar, see SpendyCharacter.jsx), sitting to
// the LEFT of her speech bubble, which gets the majority of the width
// since the message is what's worth reading — mascot on top of the
// bubble was tried and explicitly rejected ("non una sopra e l'altra
// sotto"), so this stays a row like every other SpendyCharacterWithMessage
// usage (Radar detail modal, Spendy page). No state-name badge here
// either: Home is meant to read as "what Spendy is saying", not a status
// readout. The mascot's own name isn't repeated next to her — "SPENDY"
// above already is that name, just in its official lockup with the
// tagline.
//
// `state`/`message` come from getSpendyCoach(financialData) — this
// component never computes them, only renders whatever it's given (see
// utils/spendyCoach.js for why). Keyed on `state` so React remounts the
// animated wrapper — and therefore replays its fade/scale-in — every
// time the coach's state actually changes, not on every re-render.
export function SpendyCoach({
  state = 'happy',
  message,
  secondaryText = null,
  messageScore = null,
  onOpenSpendy = () => {},
  avatarSize = 172,
}) {
  return (
    <section className="spendy-coach">
      <div className="spendy-coach__brand">
        <span className="spendy-coach__brand-name">{APP_NAME}</span>
        <span className="spendy-coach__brand-tagline">{APP_TAGLINE}</span>
      </div>

      <div key={state} className="spendy-coach__transition">
        <SpendyCharacterWithMessage
          state={state}
          message={message}
          secondaryText={secondaryText}
          size={avatarSize}
          tailPosition="left"
        />
      </div>

      <button
        type="button"
        className="spendy-coach__link"
        onClick={onOpenSpendy}
        title={messageScore != null ? `Punteggio battuta: ${messageScore}/100` : undefined}
      >
        Vai da Spendy →
      </button>
    </section>
  )
}
