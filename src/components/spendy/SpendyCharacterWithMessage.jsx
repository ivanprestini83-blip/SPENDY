import { SpendyCharacter } from './SpendyCharacter.jsx'
import { SpendySpeech } from './SpendySpeech.jsx'
import { SpendyStateBadge } from './SpendyStateBadge.jsx'
import './SpendyCharacterWithMessage.css'

// The one "mascot + what she's saying" layout, shared by Home
// (SpendyCoach), the Radar detail modal, and the Spendy page — so there
// is exactly one place that decides how the character and her speech
// bubble sit next to each other, instead of three near-identical
// implementations. Mascot stays compact and unboxed (SpendyCharacter has
// no background of its own); the bubble gets the majority of the width,
// since the message is the part worth reading.
export function SpendyCharacterWithMessage({
  state = 'happy',
  message,
  secondaryText = null,
  size = 96,
  showBadge = false,
  tailPosition = 'left',
  className = '',
}) {
  return (
    <div className={`spendy-character-row ${className}`.trim()}>
      <div className="spendy-character-row__mascot">
        <SpendyCharacter state={state} size={size} />
        {showBadge && <SpendyStateBadge state={state} />}
      </div>

      <SpendySpeech state={state} message={message} secondaryText={secondaryText} tailPosition={tailPosition} />
    </div>
  )
}
