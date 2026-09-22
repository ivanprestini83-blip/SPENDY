import './SpendyCoach.css'

// One border/tail color per coach state, so the bubble itself hints at
// the mood before you even read the text.
const TONE_BY_STATE = {
  happy: 'mint',
  attentive: 'gold',
  concerned: 'coral',
  ironic: 'violet',
  advisor: 'mint',
  celebrating: 'gold',
}

// `tailPosition`: 'top' points up at a mascot sitting above the bubble
// (SpendyCoach's integrated composition), 'left' at one sitting beside it
// (kept for any future side-by-side layout), 'none' hides it entirely.
//
// `secondaryText` is the demoted, factual sentence the Coach Engine would
// have shown on its own (e.g. "Le spese Trasporti sono aumentate del
// 60%...") for whenever a HumorEngine joke won the main `message` slot
// instead (see spendyCoach.js's tiers 3/4/5) — shown smaller, below the
// joke, so the underlying data is still one glance away instead of lost.
export function SpendySpeech({ state = 'happy', message, secondaryText = null, tailPosition = 'left' }) {
  const tone = TONE_BY_STATE[state] ?? 'violet'

  return (
    <div className={`spendy-speech spendy-speech--${tone} spendy-speech--tail-${tailPosition}`}>
      <p className="spendy-speech__text">{message}</p>
      {secondaryText && <p className="spendy-speech__secondary">{secondaryText}</p>}
      {tailPosition !== 'none' && <span className="spendy-speech__tail" aria-hidden="true" />}
    </div>
  )
}
