Placeholder folder for Spendy's final illustrated assets — one PNG per
coach state, matching SPENDY_ASSET_PATHS in
src/components/spendy/spendyAssetPaths.js:

  happy.png
  attentive.png
  concerned.png
  ironic.png
  advisor.png
  celebrating.png

Until these exist, SpendyMascot renders an inline SVG placeholder fox
instead. Dropping the real PNGs in here and switching that component's
render to <img src={SPENDY_ASSET_PATHS[state]} /> is the only change
needed — no other file (spendyCoach.js, SpendyCoach.jsx, or any page)
references these files directly.
