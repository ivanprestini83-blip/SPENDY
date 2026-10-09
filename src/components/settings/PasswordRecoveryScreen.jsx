import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../../lib/supabase.js'
import {
  MESSAGES,
  getRecoveryState,
  setRecoveryState,
  subscribeRecovery,
  submitNewPassword,
} from '../../lib/passwordRecovery.js'
import { PasswordToggle } from './PasswordToggle.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'
import './SyncCard.css'
import './PasswordRecoveryScreen.css'

// Si apre da sola quando l'app viene aperta dal link di recupero ricevuto per
// email. Sta fuori dalla schermata "a chiave" di App.jsx: la sessione di
// recupero può cambiare l'ambito dei dati e ricreare l'interfaccia, e quello
// che l'utente sta scrivendo non deve sparire.
export function PasswordRecoveryScreen({ client = supabase }) {
  const { t } = useLanguage()
  const recovery = useSyncExternalStore(subscribeRecovery, getRecoveryState, getRecoveryState)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!client) return undefined
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryState({ kind: 'recovery' })
    })
    return () => data?.subscription?.unsubscribe()
  }, [client])

  if (!recovery) return null

  const close = () => {
    // Toglie dall'indirizzo i parametri del link, se sono ancora lì.
    try {
      if (/type=recovery|error_code|access_token/.test(window.location.hash + window.location.search)) {
        window.history.replaceState(null, '', window.location.pathname)
      }
    } catch {
      // niente da ripulire
    }
    setPassword('')
    setConfirmation('')
    setRecoveryState(null)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await submitNewPassword(client, password, confirmation)
      if (result.ok) {
        setPassword('')
        setConfirmation('')
        setDone(true)
      } else {
        setError(result.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="recovery-screen" role="dialog" aria-modal="true" aria-label={t('recovery.screen.label')}>
      <div className="recovery-screen__card settings-screen__card">
        {recovery.kind === 'invalid-link' ? (
          <>
            <p className="settings-screen__label">🔑 {t('recovery.screen.invalidtitle')}</p>
            <p className="settings-screen__hint">{MESSAGES.linkInvalid}</p>
            <button type="button" className="sync-card__primary" onClick={close}>{t('common.close')}</button>
          </>
        ) : done ? (
          <>
            <p className="settings-screen__label">✅ {t('recovery.screen.donetitle')}</p>
            <p className="settings-screen__hint">{t('recovery.screen.donetext')}</p>
            <button type="button" className="sync-card__primary" onClick={close}>{t('recovery.screen.continue')}</button>
          </>
        ) : (
          <>
            <p className="settings-screen__label">🔑 {t('recovery.screen.choosetitle')}</p>
            <div className="sync-card__form">
              <div className="password-field">
                <input
                  id="recovery-new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t('recovery.screen.newpassword')}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <PasswordToggle visible={showPassword} onToggle={() => setShowPassword((shown) => !shown)} controls="recovery-new-password" />
              </div>
              <div className="password-field">
                <input
                  id="recovery-confirm-password"
                  type={showConfirmation ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t('recovery.screen.repeat')}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                <PasswordToggle visible={showConfirmation} onToggle={() => setShowConfirmation((shown) => !shown)} controls="recovery-confirm-password" />
              </div>
            </div>
            <button type="button" className="sync-card__primary" disabled={busy || !password || !confirmation} onClick={save}>
              {busy ? t('auth.wait') : t('recovery.screen.save')}
            </button>
            {error && <p className="sync-card__message sync-card__message--error">{error}</p>}
            <button type="button" className="sync-card__secondary" disabled={busy} onClick={close}>{t('recovery.screen.notnow')}</button>
          </>
        )}
      </div>
    </div>
  )
}
