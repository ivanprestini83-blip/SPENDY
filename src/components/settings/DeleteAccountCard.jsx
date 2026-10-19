import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { deleteAccount, isSupabaseConfigured } from '../../sync/spendySync.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import { translate } from '../../i18n/translate.js'
import './DeleteAccountCard.css'

// La parola da scrivere nella seconda conferma, nella lingua scelta ("ELIMINA",
// "DELETE"…): niente eliminazioni per un tocco sbagliato, nemmeno due tocchi
// di fila sullo stesso punto.
const deleteConfirmWord = (language) => translate(language, 'settings.delete.word')

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
  const { t, language } = useLanguage()
  const confirmWord = deleteConfirmWord(language)
  // Il testo con il segnaposto {word} intatto: la parola va in grassetto.
  const [finalBefore, finalAfter = ''] = translate(language, 'settings.delete.finaltext').split('{word}')

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
    if (busy || typed.trim() !== confirmWord) return
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
      <p className="settings-screen__label">{t('settings.delete.title')}</p>
      <p className="settings-screen__hint">{t('settings.delete.hint')}</p>

      {step === 'idle' && (
        <button type="button" className="delete-account__start" onClick={() => setStep('confirm')}>
          {t('settings.delete.start')}
        </button>
      )}

      {step === 'confirm' && (
        <div className="delete-account__box">
          <p className="delete-account__question">{t('settings.delete.question', { email: session.user?.email ?? '' })}</p>
          <p className="delete-account__text">{t('settings.delete.text')}</p>
          <button type="button" className="delete-account__danger" onClick={() => setStep('final')}>
            {t('settings.delete.continue')}
          </button>
          <button type="button" className="delete-account__cancel" onClick={reset}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {step === 'final' && (
        <div className="delete-account__box">
          <p className="delete-account__question">{t('settings.delete.finaltitle')}</p>
          <label className="delete-account__text" htmlFor="delete-account-confirm">
            {finalBefore}<strong>{confirmWord}</strong>{finalAfter}
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
            disabled={busy || typed.trim() !== confirmWord}
            onClick={handleDelete}
          >
            {busy ? t('settings.delete.busy') : t('settings.delete.final')}
          </button>
          <button type="button" className="delete-account__cancel" disabled={busy} onClick={reset}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {error && <p className="delete-account__error" role="alert">{error}</p>}
    </div>
  )
}
