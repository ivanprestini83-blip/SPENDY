import './AffordabilityCTA.css'

export function AffordabilityCTA({ onOpen }) {
  return (
    <button type="button" className="affordability-cta" onClick={onOpen}>
      <span className="affordability-cta__icon" aria-hidden="true">💬</span>
      <span className="affordability-cta__text">
        <span className="affordability-cta__title">Posso permettermelo?</span>
        <span className="affordability-cta__subtitle">Chiedi a Spendy prima di fare un acquisto.</span>
      </span>
      <span className="affordability-cta__arrow" aria-hidden="true">→</span>
    </button>
  )
}
