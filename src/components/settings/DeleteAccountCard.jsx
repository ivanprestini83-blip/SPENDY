import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { deleteAccount, isSupabaseConfigured } from '../../sync/spendySync.js'
import './DeleteAccountCard.css'

// La parola da scrivere nella seconda conferma: niente eliminazioni per un
// tocco sbagliato, nemmeno due tocchi di fila sullo stesso punto.
export const DELETE_CONFIRM_WORD = 'ELIMINA'

// "Elimina account" in Impostazioni. Visibile solo con un account attivo.
// Tre passi: pulsante → prima conferma → seconda conferma con la parola da
// scrivere. Il lavoro vero (server, sessione, dati locali) è tutto in
// spendySync.deleteAccount: qui solo i passi, il caricamento e gli errori.
export function DeleteAccountCard() {
  const [session, setSession] = useState(null)
  const [step, setStep] = useState('idle') // idle | confirm | final
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!supabase) return undefined
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => listener?.subscription?.unsubscribe()
  }, [])

  if (!isSupabaseConfigured || !session) return null

  const reset = () => {
    setStep('idle')
    setTyped('')
    setError(null)
  }

  const handleDelete = async () => {
    if (busy || typed.trim() !== DELETE_CONFIRM_WORD) return
    setBusy(true)
    setError(null)
    try {
      const failure = await deleteAccount()
      if (failure) {
        setError(failure)
        return
      }
      // Riuscita: la sessione è chiusa e la card sparisce da sola; la card
      // Sincronizzazione torna a mostrare l'accesso.
      reset()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-screen__card delete-account">
      <p className="settings-screen__label">🗑️ Elimina account</p>
      <p className="settings-screen__hint">
        L&apos;eliminazione dell&apos;account è permanente. I tuoi dati sincronizzati verranno eliminati e non potranno
        essere recuperati.
      </p>

      {step === 'idle' && (
        <button type="button" className="delete-account__start" onClick={() => setStep('confirm')}>
          Elimina account
        </button>
      )}

      {step === 'confirm' && (
        <div className="delete-account__box">
          <p className="delete-account__question">Vuoi davvero eliminare l&apos;account {session.user?.email}?</p>
          <p className="delete-account__text">
            Verranno eliminati dal cloud spese, entrate, obiettivi, categorie, fondo emergenza, impostazioni e
            utilizzo di Spendy AI, e su questo dispositivo i dati di questo account. Se vuoi tenerne una copia, prima
            scarica un backup dalla card qui sopra.
          </p>
          <button type="button" className="delete-account__danger" onClick={() => setStep('final')}>
            Sì, continua
          </button>
          <button type="button" className="delete-account__cancel" onClick={reset}>
            Annulla
          </button>
        </div>
      )}

      {step === 'final' && (
        <div className="delete-account__box">
          <p className="delete-account__question">Ultima conferma</p>
          <label className="delete-account__text" htmlFor="delete-account-confirm">
            Per eliminare definitivamente l&apos;account scrivi <strong>{DELETE_CONFIRM_WORD}</strong>.
          </label>
          <input
            id="delete-account-confirm"
            className="delete-account__input"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={typed}
            disabled={busy}
            onChange={(event) => setTyped(event.target.value)}
          />
          <button
            type="button"
            className="delete-account__danger"
            disabled={busy || typed.trim() !== DELETE_CONFIRM_WORD}
            onClick={handleDelete}
          >
            {busy ? 'Eliminazione in corso…' : 'Elimina definitivamente'}
          </button>
          <button type="button" className="delete-account__cancel" disabled={busy} onClick={reset}>
            Annulla
          </button>
        </div>
      )}

      {error && <p className="delete-account__error" role="alert">{error}</p>}
    </div>
  )
}
