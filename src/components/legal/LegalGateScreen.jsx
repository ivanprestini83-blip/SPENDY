import { useState, useSyncExternalStore } from 'react'
import { getLegalGateState, subscribeLegalGate, LEGAL_GATE_MESSAGES } from '../../legal/legalGate.js'
import { canSignUp } from '../../legal/legal.js'
import { acceptLegalDocuments, retryLegalCheck, signOut } from '../../sync/spendySync.js'
import { LegalConsentFields } from '../settings/LegalConsentFields.jsx'
import '../settings/SyncCard.css'
import '../settings/PasswordRecoveryScreen.css'

// Schermata obbligatoria dopo l'accesso, per gli account che non hanno
// ancora accettato i Termini e preso visione della Privacy Policy nella
// versione corrente. Copre tutta l'app e non si chiude: finché non c'è la
// conferma del server il sync dell'account non parte (sync/spendySync.js).
// Le sole uscite sono "Accetto e continuo" e "Esci dall'account".
// Sta fuori dalla schermata "a chiave" di App.jsx, come PasswordRecoveryScreen.
export function LegalGateScreen() {
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
    <div className="recovery-screen" role="dialog" aria-modal="true" aria-label="Termini e Privacy Policy">
      <div className="recovery-screen__card settings-screen__card">
        {gate.status === 'checking' ? (
          <>
            <p className="settings-screen__label">📄 Verifica dei documenti…</p>
            <p className="settings-screen__hint">Un attimo: stiamo controllando i Termini e la Privacy Policy del tuo account.</p>
          </>
        ) : gate.status === 'unavailable' ? (
          <>
            <p className="settings-screen__label">📄 Documenti da confermare</p>
            <p className="settings-screen__hint">{gate.message ?? LEGAL_GATE_MESSAGES.unavailable}</p>
            <button type="button" className="sync-card__primary" disabled={busy} onClick={() => retryLegalCheck()}>
              Riprova
            </button>
            <button type="button" className="sync-card__signout" disabled={busy} onClick={leave}>
              Esci dall&apos;account
            </button>
          </>
        ) : (
          <>
            <p className="settings-screen__label">📄 Termini e Privacy Policy aggiornati</p>
            <p className="settings-screen__hint">
              Per continuare a usare SPENDY con il tuo account devi accettare i Termini di utilizzo e prendere visione
              della Privacy Policy. Finché non confermi, i dati del tuo account non vengono sincronizzati.
            </p>
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
              {submitting ? 'Conferma in corso…' : 'Accetto e continuo'}
            </button>
            {gate.error && <p className="sync-card__message sync-card__message--error" role="alert">{gate.error}</p>}
            <button type="button" className="sync-card__signout" disabled={submitting} onClick={leave}>
              Esci dall&apos;account
            </button>
            <p className="sync-card__note">
              Se non vuoi accettare puoi uscire dall&apos;account e continuare a usare SPENDY senza account, oppure chiedere
              l&apos;eliminazione dell&apos;account: <a href="/elimina-account.html" target="_blank" rel="noopener noreferrer">Elimina account</a>.
            </p>
          </>
        )}
        {signOutError && <p className="sync-card__message sync-card__message--error" role="alert">{signOutError}</p>}
      </div>
    </div>
  )
}
