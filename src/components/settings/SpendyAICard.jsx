import { useAppStore } from '../../store/useAppStore.js'
import { LEGAL_DOCUMENTS } from '../../legal/legal.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './SettingsCards.css'

// "Spendy AI" in Impostazioni: la scelta dell'utente, spenta di default.
// Spenta: Spendy parla solo con le sue frasi locali e nessun dato parte
// verso il servizio AI. Accesa: tutto come prima (quota, limiti, cache).
export function SpendyAICard() {
  const { t } = useLanguage()
  const enabled = useAppStore((state) => state.spendyAIEnabled === true)
  const setEnabled = useAppStore((state) => state.setSpendyAIEnabled)

  return (
    <div className="settings-screen__card settings-cards">
      <div className="settings-cards__row">
        <p className="settings-screen__label" id="spendy-ai-label">{t('settings.ai.title')}</p>
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
      <p className="settings-screen__hint">{t('settings.ai.hint')}</p>
      <p className="settings-cards__detail">
        {t('settings.ai.detail')}{' '}
        <a href={LEGAL_DOCUMENTS.privacy.url} target="_blank" rel="noopener noreferrer">{t('settings.ai.link')}</a>.
      </p>
      <p className="settings-cards__state">{enabled ? t('settings.ai.on') : t('settings.ai.off')}</p>
    </div>
  )
}
