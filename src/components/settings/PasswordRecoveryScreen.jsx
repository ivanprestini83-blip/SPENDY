import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../../lib/supabase.js'
import {
  MESSAGES,
  getRecoveryState,
  setRecoveryState,
  subscribeRecovery,
  submitNewPassword,
} from '../../lib/passwordRecovery.js'
import './SyncCard.css'
import './PasswordRecoveryScreen.css'

// Si apre da sola quando l'app viene aperta dal link di recupero ricevuto per
// email. Sta fuori dalla schermata "a chiave" di App.jsx: la sessione di
// recupero può cambiare l'ambito dei dati e ricreare l'interfaccia, e quello
// che l'utente sta scrivendo non deve sparire.
export function PasswordRecoveryScreen({ client = supabase }) {
  const recovery = useSyncExternalStore(subscribeRecovery, getRecoveryState, getRecoveryState)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
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
    <div className="recovery-screen" role="dialog" aria-modal="true" aria-label="Recupero password">
      <div className="recovery-screen__card settings-screen__card">
        {recovery.kind === 'invalid-link' ? (
          <>
            <p className="settings-screen__label">🔑 Link non valido</p>
            <p className="settings-screen__hint">{MESSAGES.linkInvalid}</p>
            <button type="button" className="sync-card__primary" onClick={close}>Chiudi</button>
          </>
        ) : done ? (
          <>
            <p className="settings-screen__label">✅ Password aggiornata</p>
            <p className="settings-screen__hint">La nuova password è attiva. D&apos;ora in poi accedi con quella.</p>
            <button type="button" className="sync-card__primary" onClick={close}>Continua</button>
          </>
        ) : (
          <>
            <p className="settings-screen__label">🔑 Scegli una nuova password</p>
            <div className="sync-card__form">
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Nuova password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Ripeti la nuova password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            <button type="button" className="sync-card__primary" disabled={busy || !password || !confirmation} onClick={save}>
              {busy ? 'Attendi…' : 'Salva password'}
            </button>
            {error && <p className="sync-card__message sync-card__message--error">{error}</p>}
            <button type="button" className="sync-card__secondary" disabled={busy} onClick={close}>Non ora</button>
          </>
        )}
      </div>
    </div>
  )
}
