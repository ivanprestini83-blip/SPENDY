// Formattazione internazionale degli importi (Fase 1): solo visualizzazione.
// `npm test`, senza rete.
//
// La valuta resta l'euro per tutti; la lingua decide separatori e posizione
// del simbolo. Si controlla anche che nessun valore salvato cambi e che le
// battute di Spendy con importi grandi non vengano più scartate.

import { check, section, report, installFakeLocalStorage } from '../sync/testkit.mjs'
import { formatCurrency, formatCurrencyWhole, currencySymbol, maskedCurrency, formatInteger, formatDecimal1, ACTIVE_CURRENCY } from './format.js'
import { setCurrentLanguageSource } from '../i18n/currentLanguage.js'
import { evaluateJoke, parseShownNumber } from './jokeEvaluator.js'
import { buildInsightVars } from './humorEngine.js'
import { formatSignedCurrency, formatSignedPercent1, formatCompactAmount, describeChange } from '../components/andamento/andamentoFormat.js'

const LANGS = ['it', 'en', 'es', 'fr']
const NNBSP = '\u202f' // lo spazio stretto di Intl per le migliaia in francese
const NBSP = '\u00a0' // quello che l'app mostra al suo posto: leggibile, mai a capo

// =====================================================================
section('Il formato di ogni lingua, con l\'euro')
// =====================================================================
check('una sola valuta attiva: EUR', ACTIVE_CURRENCY === 'EUR')
const EXPECTED = {
  it: { 1794: '1.794,00 €', 0: '0,00 €', '-12.5': '-12,50 €', '175.5': '175,50 €', 1000000: '1.000.000,00 €', '0.3': '0,30 €' },
  en: { 1794: '€1,794.00', 0: '€0.00', '-12.5': '-€12.50', '175.5': '€175.50', 1000000: '€1,000,000.00', '0.3': '€0.30' },
  es: { 1794: '1.794,00 €', 0: '0,00 €', '-12.5': '-12,50 €', '175.5': '175,50 €', 1000000: '1.000.000,00 €', '0.3': '0,30 €' },
  fr: { 1794: `1${NBSP}794,00 €`, 0: '0,00 €', '-12.5': '-12,50 €', '175.5': '175,50 €', 1000000: `1${NBSP}000${NBSP}000,00 €`, '0.3': '0,30 €' },
}
for (const lang of LANGS) {
  const got = Object.keys(EXPECTED[lang]).map((key) => formatCurrency(key === '0.3' ? 0.1 + 0.2 : Number(key), lang))
  check(`${lang}: ${got.join(' | ')}`, got.join('|') === Object.values(EXPECTED[lang]).join('|'), Object.values(EXPECTED[lang]).join(' | '))
}
for (const lang of LANGS) {
  check(`${lang}: zero sempre senza segno (-0, -0,001), valori non numerici come zero`, [-0, -0.001, NaN, undefined, null, 'x'].every((value) => formatCurrency(value, lang) === formatCurrency(0, lang)))
  check(`   ${lang}: sempre due decimali (7 → 7,00; 12,345 → 12,35 arrotondato solo a schermo)`, formatCurrency(7, lang).includes(lang === 'en' ? '7.00' : '7,00') && formatCurrency(12.345, lang).includes(lang === 'en' ? '12.35' : '12,35'))
  check(`   ${lang}: separatore delle migliaia anche a quattro cifre`, formatCurrency(1794, lang) !== formatCurrency(1794, lang).replace(/[.,\u00a0](?=\d{3}[.,])/, ''))
}
{
  // L'italiano sotto 1000 è identico all'implementazione di prima.
  const before = (value) => `${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`
  const values = [0, 0.1, 1, 7, 12.5, 99.99, 175.5, 500, 999.99, -12.5, -50.2, -999.99]
  check('italiano sotto 1000: identico a prima (stesso testo, spazio normale prima di €)', values.every((value) => formatCurrency(value, 'it') === before(value)), values.filter((value) => formatCurrency(value, 'it') !== before(value)).join(', '))
  check('   da 1000 in su compare il punto delle migliaia: 1794 → "1.794,00 €" (prima "1794,00 €")', before(1794) === '1794,00 €' && formatCurrency(1794, 'it') === '1.794,00 €')
}

// =====================================================================
section('Francese leggibile: migliaia separate da uno spazio non separabile')
// =====================================================================
{
  // Intl scrive le migliaia francesi con lo spazio stretto U+202F, che con
  // Plus Jakarta Sans è largo poco più di 1 px ("1 234,56 €" sembrava
  // "1234,56 €"): l'app mostra al suo posto U+00A0. Le altre lingue no.
  const VALUES = [1234567.891, 1794, 1000, 999.5, -2100.23, 0]
  const FUNCTIONS = { formatCurrency, formatCurrencyWhole, formatInteger, formatDecimal1 }
  const frOut = Object.entries(FUNCTIONS).flatMap(([name, fn]) => VALUES.map((value) => [name, value, fn(value, 'fr')]))
  check('fr: nessuno spazio stretto U+202F in importi, interi e decimali', frOut.every(([, , out]) => !out.includes(NNBSP)), frOut.filter(([, , out]) => out.includes(NNBSP)).map(([n, v]) => `${n}(${v})`).join(', '))
  check('   fr: "1 234 567,89 €", "1 794 €", "3 000", "12 345,6" con U+00A0 tra le migliaia',
    formatCurrency(1234567.891, 'fr') === `1${NBSP}234${NBSP}567,89 €` && formatCurrencyWhole(1794, 'fr') === `1${NBSP}794 €` && formatInteger(3000, 'fr') === `3${NBSP}000` && formatDecimal1(12345.6, 'fr') === `12${NBSP}345,6`)
  check('   fr: dentro la cifra niente spazi che vanno a capo (solo U+00A0); lo spazio normale resta solo prima di "€"',
    frOut.every(([, , out]) => !/\d \d/.test(out) && !/\d[\u2000-\u200a\u205f\u3000]\d/.test(out)) && formatCurrency(1794, 'fr').endsWith(',00 €'))
  check('   fr: sotto i mille nessun separatore ("999,50 €", "-12,50 €")', formatCurrency(999.5, 'fr') === '999,50 €' && formatCurrency(-12.5, 'fr') === '-12,50 €')
  const raw = (lang, options, value) => new Intl.NumberFormat({ it: 'it-IT', en: 'en-GB', es: 'es-ES' }[lang], options).format(value).replace(/\u00a0/g, ' ')
  const MONEY = { style: 'currency', currency: 'EUR', currencyDisplay: 'narrowSymbol', useGrouping: 'always' }
  for (const lang of ['it', 'en', 'es']) {
    const same = VALUES.every((value) => formatCurrency(value, lang) === raw(lang, { ...MONEY, minimumFractionDigits: 2, maximumFractionDigits: 2 }, Math.abs(value) < 0.005 ? 0 : value)
      && formatCurrencyWhole(value, lang) === raw(lang, { ...MONEY, minimumFractionDigits: 0, maximumFractionDigits: 0 }, Math.round(value) || 0)
      && formatInteger(value, lang) === raw(lang, { useGrouping: 'always', maximumFractionDigits: 0 }, Math.round(value))
      && formatDecimal1(value, lang) === raw(lang, { useGrouping: 'always', maximumFractionDigits: 1 }, value))
    check(`${lang}: invariato, identico a Intl (${formatCurrency(1234567.891, lang)})`, same)
  }
  check('la cifra francese mostrata si rilegge con lo stesso valore (battute di Spendy)', [1794, 1234567.89, 1000].every((value) => parseShownNumber(formatCurrency(value, 'fr').replace(' €', '')) === value))
}

// =====================================================================
section('Simbolo, importi nascosti, numeri senza simbolo')
// =====================================================================
check('simbolo "€" in ogni lingua (campi d\'importo)', LANGS.every((lang) => currencySymbol(lang) === '€'))
check('importo nascosto: "•••• €" (it, es, fr), "€••••" (en)', maskedCurrency('it') === '•••• €' && maskedCurrency('es') === '•••• €' && maskedCurrency('fr') === '•••• €' && maskedCurrency('en') === '€••••')
check('interi per gli assi dei grafici: 3.000 / 3,000 / 3.000 / 3 000', [formatInteger(3000, 'it'), formatInteger(3000, 'en'), formatInteger(3000, 'es'), formatInteger(3000, 'fr')].join('|') === `3.000|3,000|3.000|3${NBSP}000`)
check('percentuali con un decimale: -12,9 / -12.9', formatDecimal1(-12.94, 'it') === '-12,9' && formatDecimal1(-12.94, 'en') === '-12.9' && formatDecimal1(5, 'fr') === '5')

// =====================================================================
section('Compatibilità: chi non passa la lingua usa quella corrente dell\'app')
// =====================================================================
setCurrentLanguageSource(() => 'fr')
check('lingua corrente fr → formatCurrency(1794) in francese', formatCurrency(1794) === formatCurrency(1794, 'fr') && maskedCurrency() === '•••• €')
setCurrentLanguageSource(() => 'en')
check('lingua corrente en → formatCurrency(1794) in inglese', formatCurrency(1794) === '€1,794.00' && maskedCurrency() === '€••••')
setCurrentLanguageSource(null)
check('senza nessuna lingua impostata: quella predefinita (inglese)', formatCurrency(1794) === '€1,794.00')

// =====================================================================
section('Andamento: variazioni, percentuali e assi nella lingua')
// =====================================================================
check('variazione con segno: -2.100,23 € / -€2,100.23 / +2.014,23 €', formatSignedCurrency(-2100.23, 'it') === '-2.100,23 €' && formatSignedCurrency(-2100.23, 'en') === '-€2,100.23' && formatSignedCurrency(2014.23, 'es') === '+2.014,23 €')
check('percentuale con segno: -99,2% / -99.2% / 0%', formatSignedPercent1(-99.2, 'it') === '-99,2%' && formatSignedPercent1(-99.2, 'en') === '-99.2%' && formatSignedPercent1(0.01, 'fr') === '0%')
check('assi del grafico: 2.000 / 2,000', formatCompactAmount(2000, 'it') === '2.000' && formatCompactAmount(2000, 'en') === '2,000')
check('describeChange: importo e percentuale nella lingua del testo', describeChange({ kind: 'down', diff: -2100.23, percent: -99.2 }, { lang: 'en' }).text === '-€2,100.23 · -99.2%'
  && describeChange({ kind: 'down', diff: -2100.23, percent: -99.2 }, { lang: 'it' }).text === '-2.100,23 € · -99,2%')

// =====================================================================
section('Battute di Spendy: gli importi grandi non vengono più scartati')
// =====================================================================
check('lettura delle cifre a schermo in ogni formato', [['1.794,00', 1794], ['1,794.00', 1794], [`1${NNBSP}794,00`, 1794], [`1${NBSP}794,00`, 1794], ['1794,00', 1794], ['12,50', 12.5], ['12.50', 12.5], ['18', 18], ['3.000', 3000]]
  .every(([shown, value]) => parseShownNumber(shown) === value))
for (const lang of LANGS) {
  const insight = { type: 'small_expenses_add_up', categoryId: 'bar', current: 1794, baseline: 900, changeAmount: 894, changePercent: 99, facts: { total: 1794 } }
  const vars = buildInsightVars(insight, lang)
  const real = evaluateJoke({ text: `Totale ${vars.amount}. Notevole.`, template: 'Totale {amount}. Notevole.' }, insight)
  const invented = evaluateJoke({ text: `Totale ${formatCurrency(5555, lang)}. Notevole.`, template: 'Totale {amount}. Notevole.' }, insight)
  check(`${lang}: {amount} = "${vars.amount}" → cifra riconosciuta come vera (accuratezza 100); una cifra inventata resta scartata (0)`,
    vars.amount === formatCurrency(1794, lang) && real.breakdown.factualAccuracy === 100 && invented.breakdown.factualAccuracy === 0)
}

// =====================================================================
section('Nessun valore salvato cambia (cambio di lingua, visualizzazione)')
// =====================================================================
{
  installFakeLocalStorage()
  const { useAppStore } = await import('../store/useAppStore.js?format-test=1')
  const S = useAppStore.getState
  useAppStore.setState({ today: '2026-10-20' })
  S().addSalary({ amount: 1794, date: '2026-10-01' })
  S().addExpense({ amount: 1234.56, categoryId: 'casa', description: 'affitto', date: '2026-10-02' })
  S().addExpense({ amount: 0.1, categoryId: 'bar', description: '', date: '2026-10-03' })
  S().addGoal({ emoji: '✈️', label: 'Viaggio', target: 2500, etaMonths: 6 })
  S().contributeToGoal(S().goals[0].id, 300.5)
  S().contributeToEmergencyFund(1000)
  const FIELDS = ['monthlyBudget', 'currency', 'cycleStartDay', 'expenses', 'incomes', 'goals', 'goalContributions', 'emergencyFundSaved', 'emergencyFundContributions', 'sync']
  const snapshot = () => JSON.stringify(Object.fromEntries(FIELDS.map((field) => [field, S()[field]])))
  const before = snapshot()
  const rent = () => S().expenses.find((expense) => expense.description === 'affitto')
  const shownBefore = formatCurrency(rent().amount, 'it')
  for (const lang of ['en', 'es', 'fr', 'it']) S().setLanguage(lang)
  check('importi, stipendio, obiettivi, fondo, valuta e coda di sync identici dopo quattro cambi di lingua', snapshot() === before)
  check('   valori salvati come numeri (1234.56, 0.1, 1794), valuta "€"', S().expenses.some((e) => e.amount === 1234.56) && S().expenses.some((e) => e.amount === 0.1) && S().incomes[0].amount === 1794 && S().currency === '€')
  check('   la stessa spesa si legge 1.234,56 € / €1,234.56: cambia solo la scrittura', shownBefore === '1.234,56 €' && formatCurrency(rent().amount, 'en') === '€1,234.56')
}

report('Formattazione internazionale degli importi')
