import { LANGUAGES } from '../../i18n/languages.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './LanguageCard.css'

// Impostazioni → Lingua. La scelta si salva subito nel contenitore locale
// dell'account (useLanguage → useAppStore.setLanguage) e cambia solo la
// lingua dell'app: nessun dato finanziario viene toccato, niente reload né
// logout. I nomi delle lingue sono scritti ciascuno nella propria lingua.
export function LanguageCard() {
  const { language, info, setLanguage, t } = useLanguage()

  return (
    <div className="settings-screen__card">
      <p id="language-card-title" className="settings-screen__label">{t('settings.language.title')}</p>
      <p className="settings-screen__hint">{t('settings.language.hint')}</p>

      <div className="language-card__options" role="radiogroup" aria-labelledby="language-card-title">
        {LANGUAGES.map((option) => {
          const selected = option.code === language
          return (
            <button
              key={option.code}
              type="button"
              role="radio"
              aria-checked={selected}
              lang={option.code}
              className={`language-card__option${selected ? ' language-card__option--selected' : ''}`}
              onClick={() => setLanguage(option.code)}
            >
              <span className="language-card__flag" aria-hidden="true">{option.flag}</span>
              <span className="language-card__name">{option.name}</span>
            </button>
          )
        })}
      </div>

      <p className="language-card__current" aria-live="polite">{t('settings.language.current', { language: info.name })}</p>
      {language !== 'it' && <p className="settings-screen__hint">{t('settings.language.partial')}</p>}
    </div>
  )
}
