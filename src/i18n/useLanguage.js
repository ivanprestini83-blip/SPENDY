import { useAppStore } from '../store/useAppStore.js'
import { languageInfo, normalizeLanguage } from './languages.js'
import { translate } from './translate.js'
import { setCategoryLanguageSource } from '../data/categories.js'
import { setCurrentLanguageSource } from './currentLanguage.js'
import { normalizeCurrency, setCurrentCurrencySource } from '../utils/currency.js'

// L'unica strada per leggere e cambiare la lingua: nessun componente legge o
// scrive `language` nello store per conto suo.

// Fuori da React (motori, funzioni pure che lo riceveranno nelle fasi successive).
export const getCurrentLanguage = () => normalizeLanguage(useAppStore.getState().language)
// Una scelta esplicita dell'utente (Impostazioni): vale per il dispositivo e
// viene salvata anche nell'account (sync/spendySync.js).
export const setLanguage = (language) => useAppStore.getState().setLanguage(language)
export const t = (key, params) => translate(getCurrentLanguage(), key, params)

// I nomi delle categorie predefinite e i messaggi dei moduli fuori da React
// (accesso, consensi, recupero password) seguono la stessa lingua: quei file
// non possono importare lo store, gli si dice da dove leggerla.
setCategoryLanguageSource(getCurrentLanguage)
setCurrentLanguageSource(getCurrentLanguage)
// La valuta dell'account, per i formatter e i motori (utils/currency.js).
setCurrentCurrencySource(() => useAppStore.getState().currency)

// Nei componenti: si ridisegna quando la lingua O la valuta cambiano, senza
// reload. Ogni componente che scrive importi passa di qui, quindi un cambio
// di valuta riscrive subito tutte le cifre (con il nuovo simbolo).
export function useLanguage() {
  const language = normalizeLanguage(useAppStore((state) => state.language))
  const currency = normalizeCurrency(useAppStore((state) => state.currency))
  const change = useAppStore((state) => state.setLanguage)
  const preview = useAppStore((state) => state.previewLanguage)
  return {
    language,
    currency,
    info: languageInfo(language),
    // Una sola lingua alla volta: niente opzioni da passare per sbaglio.
    setLanguage: (code) => change(code),
    previewLanguage: preview,
    // "Continua" nella schermata di benvenuto: la prima scelta del dispositivo.
    confirmWelcomeLanguage: (code) => change(code, { source: 'welcome' }),
    t: (key, params) => translate(language, key, params),
  }
}
