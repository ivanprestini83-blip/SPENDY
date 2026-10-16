import { MASCOT_NAME } from '../../brand.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import { spendyStates } from '../spendy/spendyStates.js'
import './AffordabilityCTA.css'

export function AffordabilityCTA({ onOpen }) {
  const { t } = useLanguage()
  return (
    <button type="button" className="affordability-cta" onClick={onOpen}>
      {/* Il volto della mascotte (asset ufficiale, ritagliato dal CSS): qui
          la domanda è rivolta proprio a lei. Decorativo, il testo dice già tutto. */}
      <span
        className="affordability-cta__avatar"
        aria-hidden="true"
        style={{ backgroundImage: `url(${spendyStates.happy})` }}
      />
      <span className="affordability-cta__text">
        <span className="affordability-cta__title">{t('home.affordability.title')}</span>
        <span className="affordability-cta__subtitle">{t('home.affordability.subtitle', { name: MASCOT_NAME })}</span>
      </span>
      <span className="affordability-cta__arrow" aria-hidden="true">→</span>
    </button>
  )
}
