import { spendyStates } from './spendyStates.js'
import './SpendyCharacter.css'

// The one place that turns a coach `state` string into Spendy's real
// illustrated image. `state` is just data here — today HomePage passes
// whatever getSpendyCoach(financialData) computed (see utils/spendyCoach.js),
// so the character already reacts to the real budget/goal/category rules
// automatically; this component itself doesn't know or care where `state`
// came from. Adding a 7th state later means only adding a key to
// spendyStates.js — nothing here changes.
export function SpendyCharacter({ state = 'happy', size = 68 }) {
  const src = spendyStates[state] ?? spendyStates.happy

  return (
    <div className="spendy-character" style={{ width: size, height: size }}>
      <img src={src} alt={`Spendy: ${state}`} className="spendy-character__img" />
    </div>
  )
}
