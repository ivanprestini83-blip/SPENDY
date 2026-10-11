// Le valute di SPENDY — un solo posto per codici, simboli e compatibilità.
//
// La valuta è una preferenza dell'ACCOUNT (riga `profiles`, come budget e
// giorno di ciclo): vale per tutti gli importi, passati e futuri. Cambiarla
// NON converte niente: 2000 resta 2000, cambia solo la valuta di riferimento.
//
// Nello store, nel cloud e nei backup si salva il codice ISO ('EUR', 'USD',
// 'GBP'). Le versioni precedenti salvavano il simbolo ('€', default della
// colonna `profiles.currency`): normalizeCurrency legge entrambe le forme, e
// tutto ciò che manca o non si riconosce vale EUR.
//
// Puro, senza dipendenze: lo usano store, sync, backup e Impostazioni.

export const CURRENCIES = [
  { code: 'EUR', symbol: '€' },
  { code: 'USD', symbol: '$' },
  { code: 'GBP', symbol: '£' },
]

export const CURRENCY_CODES = CURRENCIES.map((currency) => currency.code)

// Per tutti, qualunque sia la lingua: l'inglese non vuol dire sterline.
export const DEFAULT_CURRENCY = 'EUR'

export const isCurrency = (value) => CURRENCY_CODES.includes(value)

// Codice ('EUR', anche ' eur ') o simbolo ('€') → codice supportato; il resto → EUR.
export function normalizeCurrency(value) {
  if (typeof value !== 'string') return DEFAULT_CURRENCY
  const text = value.trim()
  const byCode = CURRENCIES.find((currency) => currency.code === text.toUpperCase())
  if (byCode) return byCode.code
  return CURRENCIES.find((currency) => currency.symbol === text)?.code ?? DEFAULT_CURRENCY
}

export const currencyInfo = (value) => CURRENCIES.find((currency) => currency.code === normalizeCurrency(value))

// La valuta dell'account per i moduli fuori da React (formatter, motori),
// letta nel momento in cui serve: è i18n/useLanguage.js a dire da dove
// (lo store), come per la lingua. Senza nessuno che la imposti (test di un
// modulo da solo): EUR.
let source = () => DEFAULT_CURRENCY

export function setCurrentCurrencySource(read) {
  source = typeof read === 'function' ? read : () => DEFAULT_CURRENCY
}

export const currentCurrency = () => normalizeCurrency(source())

// Il genere grammaticale del nome della valuta, per le frasi che vi si
// accordano ("li hai visti" → euro, dollari; "le hai viste" → sterline).
// L'inglese non ne ha bisogno: vale 'm'.
const FEMININE = { it: ['GBP'], es: ['GBP'], fr: ['GBP'] }
export const currencyGender = (currency, language) => ((FEMININE[language] ?? []).includes(normalizeCurrency(currency)) ? 'f' : 'm')
