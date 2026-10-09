import { MASCOT_NAME } from '../../brand.js'
import { useLanguage } from '../../i18n/useLanguage.js'
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
  const { t } = useLanguage()
  const src = spendyStates[state] ?? spendyStates.happy
  // Il testo alternativo descrive Spendy nella lingua dell'app, mai con il nome interno dello stato.
  const alt = t(`mascot.alt.${spendyStates[state] ? state : 'happy'}`, { name: MASCOT_NAME })

  return (
    <div className="spendy-character" style={{ width: size, height: size }}>
      <img src={src} alt={alt} className="spendy-character__img" />
    </div>
  )
}
