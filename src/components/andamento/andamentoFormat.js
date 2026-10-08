import { translate } from '../../i18n/translate.js'
import { formatCurrency } from '../../utils/format.js'

// Formattazioni usate solo da Andamento. Gli importi passano comunque da
// formatCurrency (centesimi inclusi, come nel resto dell'app); qui c'è
// solo il pezzo in più: segno esplicito e percentuale con un decimale
// ("-12,9%"), perché in un confronto il segno è l'informazione.

const percentFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 })
const compactFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })

export function formatSignedCurrency(value) {
  if (value === 0) return formatCurrency(0)
  return `${value > 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`
}

export function formatSignedPercent1(value) {
  const rounded = Math.round(value * 10) / 10
  if (rounded === 0) return '0%'
  return `${rounded > 0 ? '+' : '-'}${percentFormatter.format(Math.abs(rounded))}%`
}

export function formatPercent(value) {
  return value === null ? '—' : `${Math.round(value)}%`
}

// Etichetta corta per le colonne del grafico: "1.080" senza decimali né
// simbolo, perché sei colonne su uno schermo da telefono non ne hanno lo
// spazio. L'importo preciso resta nel riepilogo e nell'aria-label.
export function formatCompactAmount(value) {
  return compactFormatter.format(Math.round(value))
}

// Come leggere una variazione (vedi computeChange nell'engine).
// `higherIsBetter` decide il colore: più spese = coral, più risparmio =
// mint. Il colore non è mai l'unico segnale — c'è sempre la freccia e il
// segno scritto. `lang` sceglie solo le parole (assente → italiano).
export function describeChange(change, { higherIsBetter = false, lang, newLabel = translate(lang, 'andamento.change.new'), goneLabel = translate(lang, 'andamento.change.gone') } = {}) {
  const { kind, diff, percent } = change
  const unchanged = translate(lang, 'andamento.change.unchanged')
  if (kind === 'same') return { arrow: '=', text: unchanged, amount: null, detail: unchanged, tone: 'flat' }

  const good = higherIsBetter ? diff > 0 : diff < 0
  const tone = good ? 'good' : 'bad'
  const arrow = diff > 0 ? '▲' : '▼'
  const amount = formatSignedCurrency(diff)
  let detail = null
  if (kind === 'new') detail = newLabel
  else if (kind === 'gone') detail = goneLabel
  else if (percent !== null) detail = formatSignedPercent1(percent)

  // `text` per le righe larghe (metriche), `amount`/`detail` separati per
  // quelle strette (categorie), dove vanno su due righe.
  const text = detail === null ? amount : kind === 'up' || kind === 'down' ? `${amount} · ${detail}` : `${detail} · ${amount}`
  return { arrow, text, amount, detail, tone }
}

// Solo la differenza in euro, senza percentuale né "Nuova": serve per il
// risparmio, che può partire da zero o essere negativo e dove una
// percentuale non vorrebbe dire niente.
export function describeDiff(diff, { higherIsBetter = false, lang } = {}) {
  if (diff === 0) return { arrow: '=', text: translate(lang, 'andamento.change.unchanged'), tone: 'flat' }
  const good = higherIsBetter ? diff > 0 : diff < 0
  return { arrow: diff > 0 ? '▲' : '▼', text: formatSignedCurrency(diff), tone: good ? 'good' : 'bad' }
}
