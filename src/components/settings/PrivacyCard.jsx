import { LEGAL_DOCUMENTS } from '../../legal/legal.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './SettingsCards.css'

// "Privacy" in Impostazioni: i documenti pubblici e dove esercitare i
// diritti già disponibili nell'app (esportazione ed eliminazione). Non
// duplica nessuna funzione: rimanda alle card che le fanno già.
export function PrivacyCard() {
  const { t } = useLanguage()
  return (
    <div className="settings-screen__card settings-cards">
      <p className="settings-screen__label">{t('settings.privacy.title')}</p>
      <ul className="settings-cards__links">
        <li>
          <a href={LEGAL_DOCUMENTS.privacy.url} target="_blank" rel="noopener noreferrer">{t('legal.consent.privacylink')}</a>
        </li>
        <li>
          <a href={LEGAL_DOCUMENTS.terms.url} target="_blank" rel="noopener noreferrer">{t('legal.consent.termslink')}</a>
        </li>
      </ul>
      <p className="settings-screen__hint">
        <strong>{t('settings.privacy.exportlabel')}</strong> {t('settings.privacy.exporttext')}
      </p>
      <p className="settings-screen__hint">
        <strong>{t('settings.privacy.deletelabel')}</strong> {t('settings.privacy.deletetext')}
      </p>
    </div>
  )
}
