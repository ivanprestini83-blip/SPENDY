import { LANGUAGES, WELCOME_LANGUAGE_ORDER } from '../../i18n/languages.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import { spendyStates } from '../spendy/spendyStates.js'
import '../settings/LanguageCard.css'
import '../settings/SyncCard.css'
import './LanguageWelcomeScreen.css'

const OPTIONS = WELCOME_LANGUAGE_ORDER.map((code) => LANGUAGES.find((language) => language.code === code))

// Alla prima apertura, prima di tutto il resto (anche prima di creare un
// account): la scelta della lingua. Toccare una lingua cambia subito la
// schermata (solo anteprima); "Continua" salva la scelta sul dispositivo, e
// da lì segue l'utente anche nell'account (i18n/languagePreference.js).
// Chi usava già SPENDY non la vede mai: la sua lingua è già nota.
export function LanguageWelcomeScreen() {
  const { language, previewLanguage, confirmWelcomeLanguage, t } = useLanguage()

  return (
    <div className="language-welcome" role="dialog" aria-modal="true" aria-labelledby="language-welcome-title">
      <div className="language-welcome__card">
        <img className="language-welcome__mascot" src={spendyStates.happy} alt="" aria-hidden="true" />
        <h1 id="language-welcome-title" className="language-welcome__title">{t('welcome.title')}</h1>
        <p className="language-welcome__subtitle">{t('welcome.subtitle')}</p>

        <div className="language-card__options language-welcome__options" role="radiogroup" aria-label={t('welcome.label')}>
          {OPTIONS.map((option) => {
            const selected = option.code === language
            return (
              <button
                key={option.code}
                type="button"
                role="radio"
                aria-checked={selected}
                lang={option.code}
                className={`language-card__option${selected ? ' language-card__option--selected' : ''}`}
                onClick={() => previewLanguage(option.code)}
              >
                <span className="language-card__flag" aria-hidden="true">{option.flag}</span>
                <span className="language-card__name">{option.name}</span>
              </button>
            )
          })}
        </div>

        <button type="button" className="sync-card__primary language-welcome__continue" onClick={() => confirmWelcomeLanguage(language)}>
          {t('welcome.continue')}
        </button>
        <p className="language-welcome__hint">{t('welcome.hint')}</p>
      </div>
    </div>
  )
}
