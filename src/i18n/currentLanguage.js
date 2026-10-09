import { DEFAULT_LANGUAGE, normalizeLanguage } from './languages.js'
import { translate } from './translate.js'

// La lingua corrente per i moduli fuori da React (messaggi d'errore di
// accesso, consensi, recupero password), senza importare lo store: è
// i18n/useLanguage.js a dire da dove leggerla, come già fa con
// data/categories.js. Senza nessuno che la imposti (test di un modulo da
// solo) è la lingua predefinita.
let source = () => DEFAULT_LANGUAGE

export function setCurrentLanguageSource(read) {
  source = typeof read === 'function' ? read : () => DEFAULT_LANGUAGE
}

export const currentLanguage = () => normalizeLanguage(source())

// Il testo di una chiave nella lingua corrente, letto nel momento in cui serve.
export const tr = (key, params) => translate(currentLanguage(), key, params)
