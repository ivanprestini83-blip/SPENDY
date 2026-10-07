import { useAppStore } from '../store/useAppStore.js'
import { languageInfo, normalizeLanguage } from './languages.js'
import { translate } from './translate.js'

// L'unica strada per leggere e cambiare la lingua: nessun componente legge o
// scrive `language` nello store per conto suo.

// Fuori da React (motori, funzioni pure che lo riceveranno nelle fasi successive).
export const getCurrentLanguage = () => normalizeLanguage(useAppStore.getState().language)
export const setLanguage = (language) => useAppStore.getState().setLanguage(language)
export const t = (key, params) => translate(getCurrentLanguage(), key, params)

// Nei componenti: si ridisegna quando la lingua cambia, senza reload.
export function useLanguage() {
  const language = normalizeLanguage(useAppStore((state) => state.language))
  const change = useAppStore((state) => state.setLanguage)
  return {
    language,
    info: languageInfo(language),
    setLanguage: change,
    t: (key, params) => translate(language, key, params),
  }
}
