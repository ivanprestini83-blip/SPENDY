import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import { CURRENCIES, currencyInfo } from '../../utils/currency.js'
import './CurrencyCard.css'

// Impostazioni → Valuta. La valuta di riferimento dell'ACCOUNT (EUR, USD,
// GBP), indipendente dalla lingua. Toccare un'altra valuta non la cambia:
// prima si chiede conferma, spiegando che nessun importo viene convertito
// (2000 resta 2000). Solo "Conferma" chiama setCurrency, che la salva con le
// altre impostazioni (sincronizzate per chi ha un account).
//
// Confermata, ogni importo dell'app si riscrive subito con il nuovo simbolo
// (useLanguage si ridisegna anche quando cambia la valuta).
export function CurrencyCard() {
  const { t } = useLanguage()
  const currency = useAppStore((state) => state.currency)
  const setCurrency = useAppStore((state) => state.setCurrency)
  const [pending, setPending] = useState(null)

  const active = currencyInfo(currency)
  const label = (info) => `${info.code} (${info.symbol})`
  const choose = (code) => setPending(code === active.code ? null : code)
  const confirm = () => {
    setCurrency(pending)
    setPending(null)
  }

  return (
    <div className="settings-screen__card">
      <p id="currency-card-title" className="settings-screen__label">{t('settings.currency.title')}</p>
      <p className="settings-screen__hint">{t('settings.currency.hint')}</p>

      <div className="currency-card__options" role="radiogroup" aria-labelledby="currency-card-title">
        {CURRENCIES.map((option) => {
          const selected = option.code === active.code
          return (
            <button
              key={option.code}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`currency-card__option${selected ? ' currency-card__option--selected' : ''}${option.code === pending ? ' currency-card__option--pending' : ''}`}
              onClick={() => choose(option.code)}
            >
              <span className="currency-card__symbol" aria-hidden="true">{option.symbol}</span>
              <span className="currency-card__name">{t(`settings.currency.names.${option.code.toLowerCase()}`)}</span>
              <span className="currency-card__code">{option.code}</span>
            </button>
          )
        })}
      </div>

      {pending && (
        <div className="currency-card__confirm" role="alertdialog" aria-labelledby="currency-confirm-title" aria-describedby="currency-confirm-text">
          <p id="currency-confirm-title" className="currency-card__confirm-title">{t('settings.currency.confirm.title', { currency: label(currencyInfo(pending)) })}</p>
          <p id="currency-confirm-text" className="settings-screen__hint">{t('settings.currency.confirm.text', { currency: label(currencyInfo(pending)) })}</p>
          <div className="currency-card__confirm-actions">
            <button type="button" className="settings-screen__save currency-card__confirm-yes" onClick={confirm}>
              {t('settings.currency.confirm.yes')}
            </button>
            <button type="button" className="settings-screen__salary-cancel currency-card__confirm-no" onClick={() => setPending(null)}>
              {t('settings.currency.confirm.no')}
            </button>
          </div>
        </div>
      )}

      <p className="currency-card__current" aria-live="polite">
        {t('settings.currency.current', { currency: `${t(`settings.currency.names.${active.code.toLowerCase()}`)} (${active.symbol})` })}
      </p>
    </div>
  )
}
