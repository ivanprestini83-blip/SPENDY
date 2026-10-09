import it from './messages/it.js'
import en from './messages/en.js'
import es from './messages/es.js'
import fr from './messages/fr.js'
import { DEFAULT_LANGUAGE, LEGACY_LANGUAGE, normalizeLanguage } from './languages.js'

// I dizionari: chiavi tecniche a punti ("settings.language.title"), mai
// testi italiani come chiavi.
export const MESSAGES = { it, en, es, fr }

const lookup = (dictionary, key) => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dictionary)

// "{name}" → params.name. Un parametro mancante lascia il segnaposto
// com'è, così si vede subito invece di sparire.
const interpolate = (text, params) =>
  text.replace(/\{(\w+)\}/g, (match, name) => (params && params[name] !== undefined && params[name] !== null ? String(params[name]) : match))

// Il testo di una chiave nella lingua richiesta; se manca, in inglese (la
// lingua predefinita), poi in italiano (il dizionario di riferimento); se manca
// anche lì, la chiave stessa (mai un crash, mai `undefined`).
export function translate(language, key, params) {
  if (typeof key !== 'string' || !key) return ''
  const text = [normalizeLanguage(language), DEFAULT_LANGUAGE, LEGACY_LANGUAGE]
    .map((code) => lookup(MESSAGES[code], key))
    .find((value) => typeof value === 'string')
  return typeof text === 'string' ? interpolate(text, params) : key
}
