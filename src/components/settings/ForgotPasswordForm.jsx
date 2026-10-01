import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { requestPasswordReset } from '../../lib/passwordRecovery.js'
import './SyncCard.css'

// "Password dimenticata?": chiede l'email e fa partire l'invio del link di
// recupero. Vive dentro la SyncCard al posto del modulo di accesso.
export function ForgotPasswordForm({ initialEmail = '', onBack, client = supabase }) {
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
      <p className="settings-screen__hint">
        Scrivi l&apos;email del tuo account: ti mandiamo un link per scegliere una nuova password. I dati su questo
        dispositivo non vengono toccati.
      </p>
      <div className="sync-card__form">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <button type="button" className="sync-card__primary" disabled={busy || !email} onClick={send}>
        {busy ? 'Attendi…' : 'Invia il link'}
      </button>
      {result && (
        <p className={`sync-card__message sync-card__message--${result.ok ? 'ok' : 'error'}`}>{result.message}</p>
      )}
      <button type="button" className="sync-card__secondary" disabled={busy} onClick={onBack}>
        Torna all&apos;accesso
      </button>
    </>
  )
}
