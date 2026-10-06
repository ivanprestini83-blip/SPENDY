import { LEGAL_DOCUMENTS } from '../../legal/legal.js'

// Le due caselle di Termini e Privacy Policy, con i link alle pagine. Usate
// alla registrazione (SyncCard) e dalla schermata di conferma per gli account
// esistenti (LegalGateScreen). Due scelte distinte, mai preselezionate: lo
// stato lo tiene chi le usa. Stili in SyncCard.css (.sync-card__legal).
export function LegalConsentFields({ title, termsAccepted, privacyAcknowledged, onTermsChange, onPrivacyChange, disabled = false }) {
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
          Ho letto e accetto i{' '}
          <a href={LEGAL_DOCUMENTS.terms.url} target="_blank" rel="noopener noreferrer">Termini di utilizzo</a>.
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
          Ho preso visione della{' '}
          <a href={LEGAL_DOCUMENTS.privacy.url} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
        </span>
      </label>
    </div>
  )
}
