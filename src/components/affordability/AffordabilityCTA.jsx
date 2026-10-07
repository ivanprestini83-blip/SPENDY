import { MASCOT_NAME } from '../../brand.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './AffordabilityCTA.css'

export function AffordabilityCTA({ onOpen }) {
  const { t } = useLanguage()
  return (
    <button type="button" className="affordability-cta" onClick={onOpen}>
      <span className="affordability-cta__icon" aria-hidden="true">💬</span>
      <span className="affordability-cta__text">
        <span className="affordability-cta__title">{t('home.affordability.title')}</span>
        <span className="affordability-cta__subtitle">{t('home.affordability.subtitle', { name: MASCOT_NAME })}</span>
      </span>
      <span className="affordability-cta__arrow" aria-hidden="true">→</span>
    </button>
  )
}
