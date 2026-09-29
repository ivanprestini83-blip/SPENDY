// Where Spendy stands in the Home hero — pure layout data, no logic.
//
// Four compositions, all built from the same PNGs (spendyStates.js):
//   left     mascot on the left, speech on the right
//   right    mirrored: speech on the left, mascot on the right
//   center   mascot centered and lifted, speech below her
//   overlap  mascot on the left, sitting lower, feet over the budget card
//
// The position is DETERMINISTIC: it comes from the coach state (or from
// an explicit `position` prop on SpendyHero), never from Math.random, so
// the same state always produces the same scene and nothing jumps on
// re-render. Adding a new composition means adding a key here and one
// CSS modifier in SpendyHero.css.
export const SPENDY_HERO_POSITIONS = ['left', 'right', 'center', 'overlap']

// `tilt` (deg) and `lift` (px, negative = higher) are small per-state
// nudges on top of the composition — enough to give each mood its own
// body language without touching the illustrations.
export const SPENDY_HERO_LAYOUT_BY_STATE = {
  happy: { position: 'left', tilt: 0, lift: 0, scale: 1.06 },
  attentive: { position: 'right', tilt: 0, lift: 0, scale: 1 },
  concerned: { position: 'overlap', tilt: 0, lift: 10, scale: 1 },
  celebrating: { position: 'center', tilt: 0, lift: -8, scale: 1 },
  advisor: { position: 'right', tilt: 0, lift: 0, scale: 1 },
  ironic: { position: 'left', tilt: -5, lift: 0, scale: 1 },
}

const DEFAULT_LAYOUT = SPENDY_HERO_LAYOUT_BY_STATE.happy

export function getSpendyHeroLayout(state, positionOverride = null) {
  const layout = SPENDY_HERO_LAYOUT_BY_STATE[state] ?? DEFAULT_LAYOUT
  if (positionOverride && SPENDY_HERO_POSITIONS.includes(positionOverride)) {
    return { ...layout, position: positionOverride }
  }
  return layout
}
