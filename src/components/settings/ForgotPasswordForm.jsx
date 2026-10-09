import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { requestPasswordReset } from '../../lib/passwordRecovery.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './SyncCard.css'

// "Password dimenticata?": chiede l'email e fa partire l'invio del link di
// recupero. Vive dentro la SyncCard al posto del modulo di accesso.
export function ForgotPasswordForm({ initialEmail = '', onBack, client = supabase }) {
  const { t } = useLanguage()
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const send = async () => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await requestPasswordReset(client, email))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="settings-screen__hint">{t('recovery.forgot.intro')}</p>
      <div className="sync-card__form">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={t('auth.email')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <button type="button" className="sync-card__primary" disabled={busy || !email} onClick={send}>
        {busy ? t('auth.wait') : t('recovery.forgot.send')}
      </button>
      {result && (
        <p className={`sync-card__message sync-card__message--${result.ok ? 'ok' : 'error'}`}>{result.message}</p>
      )}
      <button type="button" className="sync-card__secondary" disabled={busy} onClick={onBack}>
        {t('recovery.forgot.back')}
      </button>
    </>
  )
}
