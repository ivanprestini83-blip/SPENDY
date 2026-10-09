import { useState, useSyncExternalStore } from 'react'
import { getLegalGateState, subscribeLegalGate, LEGAL_GATE_MESSAGES } from '../../legal/legalGate.js'
import { canSignUp } from '../../legal/legal.js'
import { acceptLegalDocuments, retryLegalCheck, signOut } from '../../sync/spendySync.js'
import { LegalConsentFields } from '../settings/LegalConsentFields.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'
import '../settings/SyncCard.css'
import '../settings/PasswordRecoveryScreen.css'

// Schermata obbligatoria dopo l'accesso, per gli account che non hanno
// ancora accettato i Termini e preso visione della Privacy Policy nella
// versione corrente. Copre tutta l'app e non si chiude: finché non c'è la
// conferma del server il sync dell'account non parte (sync/spendySync.js).
// Le sole uscite sono "Accetto e continuo" e "Esci dall'account".
// Sta fuori dalla schermata "a chiave" di App.jsx, come PasswordRecoveryScreen.
export function LegalGateScreen() {
  const { t } = useLanguage()
  const gate = useSyncExternalStore(subscribeLegalGate, getLegalGateState, getLegalGateState)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signOutError, setSignOutError] = useState(null)

  if (!gate) return null

  const acceptance = { termsAccepted, privacyAcknowledged }
  const submitting = busy || gate.status === 'submitting'

  const accept = async () => {
    if (submitting || !canSignUp(acceptance)) return
    setBusy(true)
    setSignOutError(null)
    try {
      await acceptLegalDocuments(acceptance)
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    if (submitting) return
    setBusy(true)
    setSignOutError(null)
    try {
      const failure = await signOut()
      if (failure) setSignOutError(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="recovery-screen" role="dialog" aria-modal="true" aria-label={t('legal.gate.dialog')}>
      <div className="recovery-screen__card settings-screen__card">
        {gate.status === 'checking' ? (
          <>
            <p className="settings-screen__label">📄 {t('legal.gate.checking')}</p>
            <p className="settings-screen__hint">{t('legal.gate.checkingtext')}</p>
          </>
        ) : gate.status === 'unavailable' ? (
          <>
            <p className="settings-screen__label">📄 {t('legal.gate.unavailabletitle')}</p>
            <p className="settings-screen__hint">{gate.message ?? LEGAL_GATE_MESSAGES.unavailable}</p>
            <button type="button" className="sync-card__primary" disabled={busy} onClick={() => retryLegalCheck()}>
              {t('legal.gate.retry')}
            </button>
            <button type="button" className="sync-card__signout" disabled={busy} onClick={leave}>
              {t('auth.signout.button')}
            </button>
          </>
        ) : (
          <>
            <p className="settings-screen__label">📄 {t('legal.gate.requiredtitle')}</p>
            <p className="settings-screen__hint">{t('legal.gate.requiredtext')}</p>
            <LegalConsentFields
              termsAccepted={termsAccepted}
              privacyAcknowledged={privacyAcknowledged}
              onTermsChange={setTermsAccepted}
              onPrivacyChange={setPrivacyAcknowledged}
              disabled={submitting}
            />
            <button
              type="button"
              className="sync-card__primary"
              disabled={submitting || !canSignUp(acceptance)}
              onClick={accept}
            >
              {submitting ? t('legal.gate.submitting') : t('legal.gate.accept')}
            </button>
            {gate.error && <p className="sync-card__message sync-card__message--error" role="alert">{gate.error}</p>}
            <button type="button" className="sync-card__signout" disabled={submitting} onClick={leave}>
              {t('auth.signout.button')}
            </button>
            <p className="sync-card__note">
              {t('legal.gate.refuse')}{' '}
              <a href="/elimina-account.html" target="_blank" rel="noopener noreferrer">{t('legal.gate.deletelink')}</a>.
            </p>
          </>
        )}
        {signOutError && <p className="sync-card__message sync-card__message--error" role="alert">{signOutError}</p>}
      </div>
    </div>
  )
}
