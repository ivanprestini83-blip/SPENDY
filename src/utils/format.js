// Formattazione degli importi e dei numeri, nella lingua dell'app.
//
// Solo VISUALIZZAZIONE: nessuna funzione qui cambia un valore, converte una
// valuta o arrotonda un dato salvato. Gli importi sono quelli scritti
// dall'utente, mostrati con due decimali (175,50 € resta 175,50 €, mai
// 176 €: il numero a schermo deve coincidere con quello salvato).
//
// La valuta è una sola, l'euro (ACTIVE_CURRENCY). La lingua decide solo
// separatori e posizione del simbolo:
//   it 1.794,00 €   en €1,794.00   es 1.794,00 €   fr 1 794,00 €
//
// `language` è facoltativo: senza, vale la lingua corrente dell'app
// (i18n/currentLanguage.js), così i chiamanti di prima continuano a
// funzionare. Chi ha già una lingua sua (motori con `lang`, componenti con
// useLanguage) la passa esplicitamente.
import { currentLanguage } from '../i18n/currentLanguage.js'
import { languageInfo } from '../i18n/languages.js'

export const ACTIVE_CURRENCY = 'EUR'

const formatters = new Map()
function formatterFor(language, kind) {
  const locale = languageInfo(language).locale
  const key = `${locale}|${kind}`
  if (!formatters.has(key)) {
    const options = kind === 'money'
      // narrowSymbol: "€", mai "EUR"; separatore delle migliaia sempre
      // (anche 1.794,00, non solo da 10.000 come fa l'italiano di Intl).
      ? { style: 'currency', currency: ACTIVE_CURRENCY, currencyDisplay: 'narrowSymbol', useGrouping: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : kind === 'integer'
        ? { useGrouping: 'always', maximumFractionDigits: 0 }
        : { useGrouping: 'always', maximumFractionDigits: 1 }
    formatters.set(key, new Intl.NumberFormat(locale, options))
  }
  return formatters.get(key)
}

// Un valore non numerico vale 0; -0 e i negativi che arrotondati al
// centesimo fanno zero si mostrano come zero ("0,00 €", mai "-0,00 €").
const finiteOrZero = (value) => {
  if (!Number.isFinite(value)) return 0
  return Math.abs(value) < 0.005 ? 0 : value
}

// Lo spazio prima del simbolo (it, es, fr) resta uno spazio normale, come
// prima.
const plainSpaces = (text) => text.replace(/ /g, ' ')

// Il separatore delle migliaia francese di Intl è lo spazio stretto (U+202F):
// con Plus Jakarta Sans è largo poco più di 1 px, e "1 234,56 €" sembra
// "1234,56 €". Al suo posto lo spazio non separabile (U+00A0): largo come lo
// spazio tra le parole, non va mai a capo ed è la forma francese tradizionale.
// Si tocca solo la parte `group` del numero: punto e virgola delle altre
// lingue, e il resto del testo, restano come prima.
const READABLE_GROUP = { '\u202f': '\u00a0' }
const render = (formatter, value) => formatter.formatToParts(value)
  .map((part) => (part.type === 'group' ? READABLE_GROUP[part.value] ?? part.value : plainSpaces(part.value)))
  .join('')

export function formatCurrency(value, language = currentLanguage()) {
  return render(formatterFor(language, 'money'), finiteOrZero(value))
}

// Il simbolo della valuta attiva, per i campi d'importo ("€").
export function currencySymbol(language = currentLanguage()) {
  return formatterFor(language, 'money').formatToParts(0).find((part) => part.type === 'currency')?.value ?? '€'
}

// Un importo nascosto ("nascondi gli importi"): le cifre diventano ••••, il
// simbolo resta al suo posto per quella lingua ("•••• €", "€••••").
export function maskedCurrency(language = currentLanguage()) {
  const parts = formatterFor(language, 'money').formatToParts(0)
  const symbolFirst = parts.findIndex((part) => part.type === 'currency') < parts.findIndex((part) => part.type === 'integer')
  const symbol = currencySymbol(language)
  return symbolFirst ? `${symbol}••••` : `•••• ${symbol}`
}

// Numeri senza simbolo: interi ("1.794") per gli assi dei grafici, e con al
// massimo un decimale ("12,9") per le percentuali.
export function formatInteger(value, language = currentLanguage()) {
  return render(formatterFor(language, 'integer'), Math.round(finiteOrZero(value)))
}

export function formatDecimal1(value, language = currentLanguage()) {
  return render(formatterFor(language, 'decimal1'), Number.isFinite(value) ? value : 0)
}

export function formatSignedPercent(value) {
  const rounded = Math.round(value)
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}

// Un importo intero, senza decimali, per le frasi che parlano di cifre
// tonde (soglie, limiti, importi già arrotondati all'euro dai motori):
//   it 1.794 €   en €1,794   es 1.794 €   fr 1 794 €
// Arrotonda solo la scrittura, mai il valore. Aggiunta a parte: le funzioni
// qui sopra restano come sono.
const wholeFormatters = new Map()
export function formatCurrencyWhole(value, language = currentLanguage()) {
  const locale = languageInfo(language).locale
  if (!wholeFormatters.has(locale)) {
    wholeFormatters.set(locale, new Intl.NumberFormat(locale, { style: 'currency', currency: ACTIVE_CURRENCY, currencyDisplay: 'narrowSymbol', useGrouping: 'always', minimumFractionDigits: 0, maximumFractionDigits: 0 }))
  }
  const rounded = Number.isFinite(value) ? Math.round(value) : 0
  return render(wholeFormatters.get(locale), rounded === 0 ? 0 : rounded)
}
