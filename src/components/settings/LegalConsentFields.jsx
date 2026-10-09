import { LEGAL_DOCUMENTS } from '../../legal/legal.js'
import { useLanguage } from '../../i18n/useLanguage.js'

// Le due caselle di Termini e Privacy Policy, con i link alle pagine. Usate
// alla registrazione (SyncCard) e dalla schermata di conferma per gli account
// esistenti (LegalGateScreen). Due scelte distinte, mai preselezionate: lo
// stato lo tiene chi le usa. Stili in SyncCard.css (.sync-card__legal).
export function LegalConsentFields({ title, termsAccepted, privacyAcknowledged, onTermsChange, onPrivacyChange, disabled = false }) {
  const { language, t } = useLanguage()
  return (
    <div className="sync-card__legal">
      {title && <p className="sync-card__legal-title">{title}</p>}
      <label className="sync-card__check">
        <input
          type="checkbox"
          checked={termsAccepted === true}
          disabled={disabled}
          onChange={(event) => onTermsChange(event.target.checked)}
        />
        <span>
          {t('legal.consent.termsprefix')}{' '}
          <a href={LEGAL_DOCUMENTS.terms.url} target="_blank" rel="noopener noreferrer">{t('legal.consent.termslink')}</a>{t('legal.consent.suffix')}
        </span>
      </label>
      <label className="sync-card__check">
        <input
          type="checkbox"
          checked={privacyAcknowledged === true}
          disabled={disabled}
          onChange={(event) => onPrivacyChange(event.target.checked)}
        />
        <span>
          {t('legal.consent.privacyprefix')}{' '}
          <a href={LEGAL_DOCUMENTS.privacy.url} target="_blank" rel="noopener noreferrer">{t('legal.consent.privacylink')}</a>{t('legal.consent.suffix')}
        </span>
      </label>
      {/* I documenti, per ora, esistono solo in italiano: lo si dice prima di accettarli. */}
      {language !== 'it' && <p className="sync-card__note">{t('legal.consent.italiannote')}</p>}
    </div>
  )
}
