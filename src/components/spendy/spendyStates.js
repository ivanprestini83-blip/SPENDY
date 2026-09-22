// Real illustrated Spendy art — one PNG per coach state, served straight
// from public/spendy/ so no bundler import step is needed. Adding a state
// later (or swapping an image) means editing only this object; nothing
// that renders SpendyCharacter needs to change.
//
// happy/attentive point at "-transparent" copies: the originals
// (happy.png, attentive.png) are fully opaque with a flat background
// baked in (no alpha channel at all), unlike the other four states which
// already had real transparency. The transparent copies are a background
// removal only — same character, colors, proportions — generated so the
// mascot can sit directly on the page with no visible box; the two
// original files are untouched and still exist as-is.
export const spendyStates = {
  concerned: '/spendy/concerned.png',
  celebrating: '/spendy/celebrating.png',
  happy: '/spendy/happy-transparent.png',
  attentive: '/spendy/attentive-transparent.png',
  ironic: '/spendy/IRONIC.png',
  advisor: '/spendy/advisor.png',
}
