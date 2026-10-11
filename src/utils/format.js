// Formattazione degli importi e dei numeri, nella lingua dell'app.
//
// Solo VISUALIZZAZIONE: nessuna funzione qui cambia un valore, converte una
// valuta o arrotonda un dato salvato. Gli importi sono quelli scritti
// dall'utente, mostrati con due decimali (175,50 € resta 175,50 €, mai
// 176 €: il numero a schermo deve coincidere con quello salvato).
//
// Lingua e valuta sono indipendenti. La valuta è quella dell'account (EUR,
// USD, GBP: utils/currency.js); la lingua decide separatori e posizione del
// simbolo, la valuta il simbolo:
//   EUR  it 1.794,00 €   en €1,794.00   es 1.794,00 €   fr 1 794,00 €
//   USD  it 1.794,00 $   en $1,794.00   es 1.794,00 $   fr 1 794,00 $
//   GBP  it 1.794,00 £   en £1,794.00   es 1.794,00 £   fr 1 794,00 £
// Nessuna conversione: 2000 resta 2000, cambia solo il simbolo.
//
// `language` e `currency` sono facoltativi: senza, valgono la lingua e la
// valuta correnti dell'app (i18n/currentLanguage.js, currentCurrency), così
// i chiamanti di prima continuano a funzionare. Chi ha già una lingua sua
// (motori con `lang`, componenti con useLanguage) la passa esplicitamente.
import { currentLanguage } from '../i18n/currentLanguage.js'
import { languageInfo } from '../i18n/languages.js'
import { currentCurrency, normalizeCurrency } from './currency.js'

const formatters = new Map()
function formatterFor(language, kind, currency) {
  const locale = languageInfo(language).locale
  const code = normalizeCurrency(currency)
  const key = `${locale}|${kind}|${kind === 'money' || kind === 'whole' ? code : ''}`
  if (!formatters.has(key)) {
    // narrowSymbol: "€", "$", "£" (mai "EUR", "US$", "$US"); separatore delle
    // migliaia sempre (anche 1.794,00, non solo da 10.000 come fa l'italiano).
    const money = { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol', useGrouping: 'always' }
    const options = {
      money: { ...money, minimumFractionDigits: 2, maximumFractionDigits: 2 },
      whole: { ...money, minimumFractionDigits: 0, maximumFractionDigits: 0 },
      integer: { useGrouping: 'always', maximumFractionDigits: 0 },
      decimal1: { useGrouping: 'always', maximumFractionDigits: 1 },
    }[kind]
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

export function formatCurrency(value, language = currentLanguage(), currency = currentCurrency()) {
  return render(formatterFor(language, 'money', currency), finiteOrZero(value))
}

// Il simbolo della valuta attiva, per i campi d'importo ("€", "$", "£").
export function currencySymbol(language = currentLanguage(), currency = currentCurrency()) {
  return formatterFor(language, 'money', currency).formatToParts(0).find((part) => part.type === 'currency')?.value ?? '€'
}

// Un importo nascosto ("nascondi gli importi"): le cifre diventano ••••, il
// simbolo resta al suo posto per quella lingua ("•••• €", "$••••").
export function maskedCurrency(language = currentLanguage(), currency = currentCurrency()) {
  const parts = formatterFor(language, 'money', currency).formatToParts(0)
  const symbolFirst = parts.findIndex((part) => part.type === 'currency') < parts.findIndex((part) => part.type === 'integer')
  const symbol = currencySymbol(language, currency)
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
// tonde (soglie, limiti, importi già arrotondati all'unità dai motori):
//   it 1.794 €   en $1,794   es 1.794 £   fr 1 794 €
// Arrotonda solo la scrittura, mai il valore.
export function formatCurrencyWhole(value, language = currentLanguage(), currency = currentCurrency()) {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0
  return render(formatterFor(language, 'whole', currency), rounded === 0 ? 0 : rounded)
}
