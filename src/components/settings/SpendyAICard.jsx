import { useAppStore } from '../../store/useAppStore.js'
import { LEGAL_DOCUMENTS } from '../../legal/legal.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './SettingsCards.css'

// "Spendy AI" in Impostazioni: la scelta dell'utente, spenta di default.
// Spenta: Spendy parla solo con le sue frasi locali e nessun dato parte
// verso il servizio AI. Accesa: tutto come prima (quota, limiti, cache).
export function SpendyAICard() {
  const enabled = useAppStore((state) => state.spendyAIEnabled === true)
  const setEnabled = useAppStore((state) => state.setSpendyAIEnabled)
  // Spendy AI per ora risponde solo in italiano: in un'altra lingua la
  // preferenza resta salvata ma Spendy usa le sue frasi (vedi useSpendyVoice).
  const { language, t } = useLanguage()
  const italianOnly = enabled && language !== 'it'

  return (
    <div className="settings-screen__card settings-cards">
      <div className="settings-cards__row">
        <p className="settings-screen__label" id="spendy-ai-label">✨ Spendy AI</p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="spendy-ai-label"
          className={`settings-cards__switch${enabled ? ' settings-cards__switch--on' : ''}`}
          onClick={() => setEnabled(!enabled)}
        >
          <span className="settings-cards__knob" aria-hidden="true" />
        </button>
      </div>
      <p className="settings-screen__hint">
        Consenti a Spendy di usare l&apos;AI per generare messaggi personalizzati basati sui dati finanziari necessari
        al funzionamento di questa funzione.
      </p>
      <p className="settings-cards__detail">
        Se attiva, al servizio AI vengono inviati solo dati di riepilogo: budget, speso e disponibile, giorni
        rimanenti, l&apos;evento del momento con la sua categoria (anche personalizzata) e, se rilevante, il nome di un
        obiettivo. Non vengono inviati note, elenco delle spese, email o identificativi. Funziona solo con un account.{' '}
        <a href={LEGAL_DOCUMENTS.privacy.url} target="_blank" rel="noopener noreferrer">Dettagli nella Privacy Policy</a>.
      </p>
      <p className="settings-cards__state">{enabled ? 'Attiva' : 'Disattivata: Spendy usa solo le sue frasi'}</p>
      {italianOnly && <p className="settings-cards__state">{t('settings.ai.italianonly')}</p>}
    </div>
  )
}
