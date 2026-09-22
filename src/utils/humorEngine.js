// HumorEngine — turns one BehaviorInsight into several candidate jokes:
//
//   BehaviorInsight → HumorEngine → multiple joke candidates → JokeEvaluator
//
// v2: personality first. Spendy comments on the SITUATION like a mascot
// would ("hai offerto la cena anche al cuoco? 😂"), never restates the
// numbers ("le spese sono passate da 50 € a 200 €" is exactly the style
// this engine refuses to produce — see humorLibrary.js's own header and
// jokeEvaluator.js's descriptiveness check). All actual joke text lives
// in humorLibrary.js; this file only decides WHICH bucket of that library
// a given insight should draw from, and tags each candidate with enough
// metadata (source, lang) for JokeEvaluator to score it well.
import { BEHAVIOR_TYPES, getInsightDirection } from './behaviorEngine.js'
import { humorLibrary } from './humorLibrary.js'
import { formatCurrency } from './format.js'

// A category's own voice ("la macchina beve più di te") reads the same
// whether the detector that fired was a spike, a recurring baseline, a
// trend, or a single outlier transaction — from Spendy's comedic point of
// view these are all just "this category ran unusually hot/cold", so
// they share one bucket per category instead of four near-identical ones
// (see getInsightDirection in behaviorEngine.js, the shared classifier).
function resolveTemplates(insight, lang) {
  const library = humorLibrary[lang] ?? humorLibrary.it
  const direction = getInsightDirection(insight.type)

  if (insight.categoryId && direction) {
    const bank = library.categories[insight.categoryId]?.[direction]
    if (bank?.length) return { templates: bank, source: 'category' }
  }

  // Un obiettivo in avvicinamento pesca dal bacino "obiettivi", che
  // esisteva gia' in tutte e quattro le lingue in attesa che qualcuno lo
  // emettesse (vedi il commento in humorLibrary.js).
  if (insight.type === BEHAVIOR_TYPES.GOAL_PROGRESS) {
    const bank = library.types.obiettivi
    if (bank?.length) return { templates: bank, source: 'type' }
  }

  if (insight.type === BEHAVIOR_TYPES.UNUSUAL_FREQUENCY) {
    const key = insight.changeAmount > 0 ? 'unusual_frequency_high' : 'unusual_frequency_low'
    const bank = library.types[key]
    if (bank?.length) return { templates: bank, source: 'type' }
  }

  const typeBank = library.types[insight.type]
  if (typeBank?.length) return { templates: typeBank, source: 'type' }

  return { templates: library.types.fallback, source: 'fallback' }
}

// I valori che un segnaposto puo' assumere, ricavati SOLO dall'insight —
// mai calcolati qui, mai inventati. Un segnaposto per cui l'insight non
// ha un valore resta senza valore, e la frase che lo usa viene scartata
// (vedi interpolate): meglio nessuna battuta che una battuta con un
// "{remaining}" a schermo.
//
// La stragrande maggioranza delle frasi in libreria non contiene
// segnaposto ed e' del tutto indifferente a questa funzione.
export function buildInsightVars(insight) {
  const facts = insight.facts ?? {}
  const vars = {}

  if (insight.category?.label) vars.category = insight.category.label.toLowerCase()
  if (typeof facts.categoryLabel === 'string') vars.category = facts.categoryLabel.toLowerCase()
  if (typeof facts.goalLabel === 'string') vars.goal = facts.goalLabel
  if (typeof facts.count === 'number') vars.count = String(facts.count)
  if (typeof facts.days === 'number') vars.days = String(facts.days)

  const amount = facts.total ?? facts.saved ?? (typeof insight.current === 'number' ? insight.current : null)
  if (typeof amount === 'number' && Number.isFinite(amount)) vars.amount = formatCurrency(amount)

  const remaining = facts.missing ?? facts.remaining
  if (typeof remaining === 'number' && Number.isFinite(remaining)) vars.remaining = formatCurrency(remaining)

  const percent = facts.percent ?? (typeof insight.changePercent === 'number' ? Math.abs(insight.changePercent) : null)
  if (typeof percent === 'number' && Number.isFinite(percent)) vars.percentage = `${Math.round(percent)}%`

  return vars
}

const PLACEHOLDER = /\{(\w+)\}/g

// Sostituisce i segnaposto, o restituisce null se anche uno solo non ha
// un valore disponibile. Il null e' il punto: fa sparire il candidato
// invece di mostrarlo rotto.
export function interpolate(template, vars) {
  let missing = false
  const text = template.replace(PLACEHOLDER, (_match, key) => {
    const value = vars[key]
    if (value === undefined) {
      missing = true
      return ''
    }
    return value
  })
  return missing ? null : text
}

// One insight in, several candidate strings out — JokeEvaluator picks the
// winner. `lang` selects which humorLibrary voice to draw from ('it' |
// 'en' | 'fr' | 'es', default 'it').
//
// Ogni candidato porta con se' sia il `template` originale sia il `text`
// gia' interpolato: JokeEvaluator giudica "questa sembra un referto?" sul
// template (dove i numeri non ci sono ancora) e tutto il resto sul testo
// finale, che e' quello che l'utente leggera'.
export function generateJokeCandidates(insight, lang = 'it') {
  const { templates, source } = resolveTemplates(insight, lang)
  const vars = buildInsightVars(insight)

  return templates
    .map((template, index) => {
      const text = interpolate(template, vars)
      if (text === null) return null
      return {
        id: `${lang}:${insight.type}:${insight.categoryId ?? 'general'}:${index}`,
        template,
        text,
        intensity: insight.intensity,
        lang,
        source,
      }
    })
    .filter(Boolean)
}
