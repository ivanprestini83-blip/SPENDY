import { translate } from './translate.js'

// I nomi dei mesi per le etichette dei cicli (formatCycleLabel /
// formatCycleStartLabel in utils/cycle.js), presi dai dizionari months.* nella
// lingua scelta. utils/cycle.js resta logica pura: riceve questo oggetto già
// tradotto invece di importare l'i18n.
const MONTH_IDS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function cycleLabelNames(lang) {
  return {
    long: MONTH_IDS.map((id) => translate(lang, `months.long.${id}`)),
    short: MONTH_IDS.map((id) => translate(lang, `months.short.${id}`)),
    // Segnaposto lasciati com'è: li riempie formatCycleLabel.
    monthYear: translate(lang, 'months.monthyear'),
  }
}
