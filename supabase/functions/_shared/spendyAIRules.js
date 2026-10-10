// SPENDY AI — REGOLE CONDIVISE tra app e server.
//
// Un solo file, importato da due parti:
//   - l'app (src/ai/spendyAIGuard.js, spendyPersonality.js, i provider);
//   - la Supabase Edge Function (supabase/functions/spendy-ai/).
// Sta qui, dentro supabase/functions/_shared/, perché una Edge Function
// può importare solo file sotto supabase/functions; l'app invece può
// importare qualunque file del progetto. Così personalità, prompt,
// vocabolari e controlli (numeri inventati, tono, struttura) non possono
// divergere tra client e server.
//
// JavaScript puro, zero dipendenze, niente API di Node o di Deno.

// --- Vocabolari --------------------------------------------------------

import { CYCLE_PHASES, EARLY_PHASES, LATE_PHASES } from './cyclePhases.js'

export const AI_STATES = ['happy', 'attentive', 'concerned', 'celebrating', 'advisor', 'ironic']
export const AI_TONES = ['friendly', 'playful', 'ironic', 'celebratory', 'concerned', 'helpful']
export const AI_ANIMATIONS = ['gentle', 'playful', 'celebrate', 'concerned']
export const AI_LAYOUTS = ['left', 'right', 'center', 'overlap']
export const BUDGET_BANDS = ['ok', 'warning', 'high', 'exceeded']

// Le lingue in cui Spendy AI risponde: le stesse dell'app (LANGUAGE_CODES,
// che una Edge Function non può importare; un test verifica che coincidano).
// Qualunque altro valore, o nessun valore, vale l'italiano: la lingua cambia
// solo le parole della risposta, mai consenso, quota o regole.
export const SPENDY_LOCALES = ['it', 'en', 'es', 'fr']
export const DEFAULT_SPENDY_LOCALE = 'it'
export const normalizeSpendyLocale = (value) => (SPENDY_LOCALES.includes(value) ? value : DEFAULT_SPENDY_LOCALE)

export const MAX_MESSAGE_LENGTH = 240
export const MAX_SENTENCES = 3
export const REPEAT_SIMILARITY = 0.85
export const RECENT_WINDOW = 5

const TONE_BY_STATE = {
  happy: 'friendly',
  attentive: 'helpful',
  concerned: 'concerned',
  celebrating: 'celebratory',
  advisor: 'helpful',
  ironic: 'ironic',
}

const ANIMATION_BY_TONE = {
  friendly: 'gentle',
  helpful: 'gentle',
  playful: 'playful',
  ironic: 'playful',
  celebratory: 'celebrate',
  concerned: 'concerned',
}

export const defaultToneFor = (state) => TONE_BY_STATE[state] ?? 'friendly'
export const defaultAnimationFor = (tone) => ANIMATION_BY_TONE[tone] ?? 'gentle'

// --- Tono e sicurezza --------------------------------------------------

const RISKY_ADVICE = /\b(investi\w*|azion[ie]|borsa|crypto\w*|cripto\w*|bitcoin|trading|forex|prestit\w*|finanziament\w*|mutuo|scommess\w*|gratta e vinci|lotteri\w*|leva finanziaria)\b/i
const FEAR_OR_JUDGMENT = /\b(rovin\w*|fallit\w*|fallimento|bancarott\w*|disastr\w*|vergogn\w*|irresponsabil\w*|spendaccion\w*|sprecon\w*|colpa tua|dovresti sentirti|scelta sbagliata|hai sbagliato)\b/i
// Stesse famiglie di JokeEvaluator (insulti, aggressività, contenuti
// espliciti, temi protetti), qui in forma autonoma per il server.
const OFFENSIVE = /\b(idiot\w*|stupid\w*|scem\w*|cretin\w*|imbecill\w*|deficient\w*|incapac\w*|patetic\w*|devi smettere|basta con|non capisci|che vergogna|non hai imparato|sesso|porno|nud[oa]|erotic\w*|sexy|religion\w*|etnia|razza|orientamento sessuale|disabilità|identità di genere|nazionalità)\b/i

// Le stesse famiglie in inglese, spagnolo e francese (Spendy AI risponde
// nella lingua dell'utente). Confini di parola Unicode: \b non conosce le
// lettere accentate.
const word = (alternatives) => new RegExp(`(?<![\\p{L}])(?:${alternatives})(?![\\p{L}])`, 'iu')
const RISKY_ADVICE_INTL = word([
  'invest\\p{L}*', 'stocks?', 'crypto\\p{L}*', 'bitcoin', 'trading', 'forex', 'loans?', 'mortgages?', 'gambl\\p{L}*', 'betting', 'lotter(?:y|ies)',
  'invertir', 'inversi[oó]n\\p{L}*', 'criptomoneda\\p{L}*', 'pr[eé]stamos?', 'hipoteca\\p{L}*', 'apuestas?', 'loter[ií]a\\p{L}*',
  'investir', 'investissement\\p{L}*', 'bourse', 'emprunts?', 'hypoth[eè]que\\p{L}*', 'paris sportifs', 'loterie\\p{L}*',
].join('|'))
const FEAR_OR_JUDGMENT_INTL = word([
  'ruin\\p{L}*', 'bankrupt\\p{L}*', 'disaster\\p{L}*', 'shame\\p{L}*', 'irresponsib\\p{L}*', 'spendthrift', 'your fault', 'you should feel', 'wrong choice', 'you made a mistake',
  'arruin\\p{L}*', 'bancarrota', 'desastr\\p{L}*', 'verg[uü]enza', 'irresponsable\\p{L}*', 'derrochador\\p{L}*', 'culpa tuya', 'deber[ií]as sentirte', 'mala decisi[oó]n', 'te has equivocado',
  'faillite', 'd[ée]sastr\\p{L}*', 'honte\\p{L}*', 'irresponsable\\p{L}*', 'd[ée]pensi[eè]r\\p{L}*', 'ta faute', 'votre faute', 'vous devriez vous sentir', 'mauvais choix', 'vous vous [eê]tes tromp[ée]\\p{L}*',
].join('|'))
const OFFENSIVE_INTL = word([
  'idiot\\p{L}*', 'stupid\\p{L}*', 'dumb', 'moron\\p{L}*', 'pathetic', 'loser', 'sex', 'porn\\p{L}*', 'nude', 'erotic\\p{L}*', 'religio\\p{L}*', 'ethnicity', 'sexual orientation', 'disabilit\\p{L}*', 'gender identity', 'nationality',
  'idiota', 'est[uú]pid\\p{L}*', 'imb[eé]cil\\p{L}*', 'pat[eé]tic\\p{L}*', 'sexo', 'desnud\\p{L}*', 'er[oó]tic\\p{L}*', 'religi[oó]n', 'orientaci[oó]n sexual', 'discapacidad', 'identidad de g[eé]nero', 'nacionalidad',
  'stupide\\p{L}*', 'cr[eé]tin\\p{L}*', 'imb[eé]cile\\p{L}*', 'd[eé]bile\\p{L}*', 'path[eé]tique', 'sexe', '[eé]rotique', 'ethnie', 'orientation sexuelle', 'handicap\\p{L}*', 'identit[eé] de genre', 'nationalit[eé]',
].join('|'))
const isRiskyAdvice = (text) => RISKY_ADVICE.test(text) || RISKY_ADVICE_INTL.test(text)
const isFearOrOffensive = (text) => FEAR_OR_JUDGMENT.test(text) || OFFENSIVE.test(text) || FEAR_OR_JUDGMENT_INTL.test(text) || OFFENSIVE_INTL.test(text)

export function passesToneRules(text) {
  return !isRiskyAdvice(text) && !isFearOrOffensive(text)
}

// --- Numeri ------------------------------------------------------------

// Numeri scritti all'italiana: "1.179", "1.179,50", "66", "12,5".
const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g

function extractLegacyNumbers(text) {
  return (text.match(NUMBER) ?? []).map((raw) => {
    const normalized = /^\d{1,3}(?:\.\d{3})+/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.')
    return Math.round(Math.abs(parseFloat(normalized)))
  })
}

// Numeri scritti nella lingua della risposta (context.locale):
//   it, es  1.794   1.794,50      en  1,794   1,794.50
//   fr      1 794   1 794,50 (spazio normale, NBSP o spazio stretto NNBSP)
// Una sequenza di cifre unite da un solo carattere ( . , ' ’ _ o uno spazio)
// si legge INTERA con la grammatica di quella lingua, mai con quella di
// un'altra: "€1,234" in inglese è 1234 (non 1,234 → 1); "1,794" in
// italiano e "1 794" in inglese non sono numeri validi. Un numero fuori
// grammatica, o con cifre non ASCII ("１２３４"), non viene reinterpretato:
// vale NaN, che nessun numero consentito eguaglia (risposta scartata).
// Senza lingua, extractNumbers legge come prima (all'italiana): serve ad
// allowedNumbers, che legge testi dell'utente di lingua ignota.
//
// Un numero seguito da un moltiplicatore ("€40k", "40 mila €", "2 mil €",
// "40 k€", "€1M", "1,2 million €", "1,5 milliard") vale anch'esso NaN:
// "40k" non è 40, e il suo valore vero non si confronta (la risposta viene
// scartata anche quando sarebbe giusto). Basta una sola lettera o parola
// subito dopo la cifra, con al più uno spazio: "40 km", "2 kg", "9 mesi",
// "1 Monday", "2 miles", "3 milanesi" non contano (dopo la sigla o la
// parola viene un'altra lettera); "4K", "40 mila persone", "1 grand café",
// "2 mille-feuilles" invece sì, per prudenza. I numeri scritti in lettere
// ("duemila euro") non si vedono qui: servirebbe un altro controllo.
const NUMBER_RUN = /\p{Nd}+(?:[.,'’_ \u00a0\u202f\u2009]\p{Nd}+)*/gu
const numberGrammar = (group, decimal) => new RegExp(`^(?:[0-9]{1,3}(?:${group}[0-9]{3})+|[0-9]+)(?:${decimal}[0-9]{1,2})?$`)
const NUMBER_FORMATS = {
  it: { grammar: numberGrammar('\\.', ','), group: /\./g, decimal: ',' },
  es: { grammar: numberGrammar('\\.', ','), group: /\./g, decimal: ',' },
  en: { grammar: numberGrammar(',', '\\.'), group: /,/g, decimal: '.' },
  fr: { grammar: numberGrammar('[ \\u00a0\\u202f]', ','), group: /[ \u00a0\u202f]/g, decimal: ',' },
}

const MULTIPLIER_LETTER = /^[ \u00a0\u202f\u2009]?(?:[kK]|M|B|bn|Mds?|Mrd)(?![\p{L}\p{N}])/u
const MULTIPLIER_WORD = /^[ \u00a0\u202f\u2009]?(?:thousands?|grand|millions?|billions?|mila|mille|migliaia|milion[ei]|miliard[oi]|mil|millar(?:es)?|mill[oó]n(?:es)?|millardos?|milliers?|milliards?)(?![\p{L}\p{N}])/iu
const hasMultiplier = (after) => MULTIPLIER_LETTER.test(after) || MULTIPLIER_WORD.test(after)

function readLocalizedNumber(raw, format, after) {
  if (!format.grammar.test(raw) || hasMultiplier(after)) return Number.NaN
  return Math.round(Math.abs(parseFloat(raw.replace(format.group, '').replace(format.decimal, '.'))))
}

export function extractNumbers(text, locale) {
  if (locale === undefined) return extractLegacyNumbers(text)
  const format = NUMBER_FORMATS[normalizeSpendyLocale(locale)]
  return [...text.matchAll(NUMBER_RUN)].map(({ 0: raw, index }) => readLocalizedNumber(raw, format, text.slice(index + raw.length)))
}

// Ogni numero presente nel contesto, a qualunque profondità, compresi
// quelli dentro le stringhe (un obiettivo chiamato "Vacanze 2027").
export function allowedNumbers(context) {
  const out = new Set()
  const visit = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) out.add(Math.round(Math.abs(value)))
    else if (typeof value === 'string') extractNumbers(value).forEach((n) => out.add(n))
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(context)
  return out
}

// --- Riferimenti tra virgolette ---------------------------------------

function knownLabels(context) {
  const labels = new Set()
  const add = (value) => { if (typeof value === 'string' && value) labels.add(value.toLowerCase()) }
  add(context?.goal?.label)
  add(context?.primaryEvent?.category)
  add(context?.primaryEvent?.expense?.category)
  for (const event of context?.otherEvents ?? []) add(event.category)
  return labels
}

const QUOTED = /"([^"]+)"|“([^”]+)”|«([^»]+)»/g

function quotedNames(text) {
  return [...text.matchAll(QUOTED)].map((match) => (match[1] ?? match[2] ?? match[3]).trim().toLowerCase())
}

// "Ok... e poi?" è una frase sola: i puntini di sospensione non chiudono.
export function countSentences(text) {
  return text.split(/(?<=[^.][.!?])\s+/).map((part) => part.trim()).filter(Boolean).length
}

// Sovrapposizione di parole — usata dal server; l'app usa quella di
// JokeEvaluator, che misura la stessa cosa.
export function wordSimilarity(a, b) {
  const words = (text) => new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean))
  const wa = words(a)
  const wb = words(b)
  if (wa.size === 0 || wb.size === 0) return 0
  const shared = [...wa].filter((word) => wb.has(word)).length
  return shared / new Set([...wa, ...wb]).size
}

// --- Struttura narrativa ----------------------------------------------
//
// Una frase può cambiare tutte le parole e restare la stessa frase:
// "Ecco una categoria che non si vedeva da un po'", "Si vede che lo svago
// è tornato", "Rieccolo, lo shopping". Questi controlli guardano lo
// SCHEMA NARRATIVO, non il lessico.
const FRAME_PATTERNS = {
  comeback: /(\btorna\w*|\britorn\w*|\bbentornat\w*|\bricompar\w*|\briappar\w*|\brieccol\w*|rifatt\w* viv\w*|\bdi nuovo\b|non si vedeva|da un po[’']|dopo (diversi|tanti|parecchi|alcuni) cicli)/i,
  novelty: /(new entry|\bnovità|\bmai vist\w*|nuovo territorio|\bnuova entrata\b)/i,
  spotlight: /(^|[.!?…]\s+)(ed )?ecco\b|guarda (un po[’'] )?chi\b/i,
  inference: /\b(si vede che|a quanto pare|sembra (proprio )?che|evidentemente|pare che)\b/i,
  surprise: /^(ops|oops|wow|aspetta|ehi|oh|toh|ma dai)\b/i,
  question: /\?[\s\p{Extended_Pictographic}️]*$/u,
  labelColon: /^[\p{L}][\p{L} ]{1,30}:\s/u,
}

const STALE_PATTERNS = [
  /non si vedeva da un po/i,
  /\becco\b[^.!?]{0,40}\b(che )?(ri)?torna/i,
  /si vede che[^.!?]{0,40}\b(è )?(ri)?tornat/i,
  /(^|\s)(è|sono) (ri)?tornat\w* (tra le|nelle) tue spese/i,
  /guarda (un po[’'] )?chi (si rivede|è tornat)/i,
]

const ONCE_IN_A_WHILE = ['comeback', 'novelty']

function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .replace(/[^\p{L}#\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function openingOf(text) {
  return normalizeWords(text).slice(0, 2).join(' ')
}

export function narrativeFrames(text) {
  const frames = new Set()
  if (typeof text !== 'string' || !text.trim()) return frames
  const trimmed = text.trim()
  for (const [name, pattern] of Object.entries(FRAME_PATTERNS)) {
    if (pattern.test(trimmed)) frames.add(name)
  }
  const opening = openingOf(trimmed)
  if (opening) frames.add(`open:${opening}`)
  return frames
}

export function hasStaleStructure(text) {
  return STALE_PATTERNS.some((pattern) => pattern.test(text))
}

export function structureProblems(text, { previous = null, history = [] } = {}) {
  const problems = []
  if (hasStaleStructure(text)) problems.push('stale_structure')

  const frames = narrativeFrames(text)
  if (previous) {
    const before = narrativeFrames(previous)
    const shared = [...frames].filter((frame) => before.has(frame))
    if (shared.length > 0) problems.push(`repeated_structure:${shared.join(',')}`)
  }

  const recent = [...history.slice(-RECENT_WINDOW), ...(previous ? [previous] : [])]
  for (const frame of ONCE_IN_A_WHILE) {
    if (frames.has(frame) && recent.some((line) => narrativeFrames(line).has(frame))) {
      problems.push(`overused_structure:${frame}`)
    }
  }
  return [...new Set(problems)]
}

// --- Validazione della risposta ---------------------------------------
//
// → { valid: true, response } | { valid: false, errors: [...] }
// Stessa funzione sul server (prima di rispondere) e nell'app (prima di
// mostrare): il frontend non si fida mai di quello che torna.
// --- Coerenza con la fase del ciclo ----------------------------------
// Frasi che affermano un momento del ciclo (in italiano, la lingua di Spendy
// AI e dei messaggi locali): vietate quando la fase dice il contrario. Usata
// dal controllo delle risposte AI e dai test dei messaggi locali.
const TIME_LEFT_CLAIM = /strada\s+(è\s+)?(ancora\s+)?lunga|(ancora|tanta|molta)\s+strada|ha\s+ancora\s+strada|(il\s+)?(mese|ciclo)\s+non\s+è\s+(ancora\s+)?finit|(il\s+)?(mese|ciclo)\s+è\s+(ancora\s+)?lung|metà\s+(del\s+)?(mese|ciclo)|ancora\s+(molti|tanti|parecchi)\s+giorni|più\s+(mese|ciclo)\s+che\s+budget|appena\s+(iniziat|cominciat|partit)|inizio\s+(del\s+)?(mese|ciclo)|primi\s+giorni/i
const END_CLAIM = /ultim[oi]\s+giorn|agli\s+sgoccioli|quasi\s+(alla\s+)?fine\s+(del\s+)?(mese|ciclo)|(mese|ciclo)\s+(sta\s+)?per\s+finire|fine\s+(del\s+)?(mese|ciclo)\s+è\s+vicin|mancano\s+pochi\s+giorni/i
const DAYS_LEFT_CLAIM = /(restano|mancano|ancora)\s+\d+\s+giorn|per\s+\d+\s+giorn|(i\s+)?prossimi\s+giorni/i
const JUST_STARTED_CLAIM = /appena\s+(iniziat|cominciat|partit)|inizio\s+(del\s+)?(mese|ciclo)|primi\s+giorni/i

// Le stesse affermazioni sul tempo in inglese, spagnolo e francese.
const TIME_LEFT_CLAIM_INTL = /long way to go|still (?:a lot of|plenty of|lots of) time|(?:cycle|month) (?:has |is )?(?:only )?just (?:started|begun)|beginning of the cycle|first (?:few )?days|halfway through|queda mucho camino|todav[ií]a (?:queda|hay) mucho|(?:el )?ciclo (?:acaba de|reci[eé]n) empez|principio del ciclo|primeros d[ií]as|mitad del ciclo|encore (?:un )?long chemin|la route est (?:encore )?longue|(?:le )?cycle vient (?:juste |tout juste )?de commencer|d[ée]but du cycle|premiers jours|moiti[ée] du cycle/i
const END_CLAIM_INTL = /last days?|almost (?:at )?the end of the cycle|(?:cycle|month) is (?:almost|nearly) over|only a few days left|[uú]ltimos? d[ií]as?|casi al final del ciclo|el ciclo est[aá] por terminar|quedan pocos d[ií]as|derniers? jours?|presque (?:à )?la fin du cycle|(?:le )?cycle (?:touche|arrive) à sa fin|il (?:ne )?reste (?:que )?(?:quelques|peu de) jours/i
const DAYS_LEFT_CLAIM_INTL = /\d+ days? (?:left|to go)|for \d+ days|(?:the )?next few days|quedan \d+ d[ií]as|durante \d+ d[ií]as|pr[oó]ximos d[ií]as|il (?:te |vous )?reste \d+ jours|pendant \d+ jours|prochains jours/i
const JUST_STARTED_CLAIM_INTL = /just (?:started|begun)|beginning of the cycle|first (?:few )?days|acaba de empezar|principio del ciclo|primeros d[ií]as|vient (?:juste |tout juste )?de commencer|d[ée]but du cycle|premiers jours/i
const claims = (italian, intl, message) => italian.test(message) || intl.test(message)

export function contradictsCyclePhase(message, phase) {
  if (typeof message !== 'string' || !CYCLE_PHASES.includes(phase)) return false
  if (LATE_PHASES.includes(phase) && claims(TIME_LEFT_CLAIM, TIME_LEFT_CLAIM_INTL, message)) return true
  if (phase === 'last_day' && claims(DAYS_LEFT_CLAIM, DAYS_LEFT_CLAIM_INTL, message)) return true
  if (EARLY_PHASES.includes(phase) && claims(END_CLAIM, END_CLAIM_INTL, message)) return true
  if ((phase === 'mid' || phase === 'second_half') && claims(JUST_STARTED_CLAIM, JUST_STARTED_CLAIM_INTL, message)) return true
  return false
}

export function validateSpendyResponse(raw, context, { history = [], previous = null, similarity = wordSimilarity } = {}) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { valid: false, errors: ['not_an_object'] }
  if (typeof raw.shouldShow !== 'boolean') errors.push('shouldShow_missing')

  const state = raw.state
  if (!AI_STATES.includes(state)) errors.push('invalid_state')
  const tone = raw.tone ?? defaultToneFor(state)
  if (!AI_TONES.includes(tone)) errors.push('invalid_tone')
  const layout = raw.layout ?? null
  if (layout !== null && !AI_LAYOUTS.includes(layout)) errors.push('invalid_layout')
  const animation = raw.animation ?? defaultAnimationFor(tone)
  if (!AI_ANIMATIONS.includes(animation)) errors.push('invalid_animation')
  const priority = parsePriority(raw.priority)
  if (priority === undefined) errors.push('invalid_priority')

  // Spendy ha deciso di stare zitto: il messaggio non conta.
  if (raw.shouldShow === false && errors.length === 0) {
    return { valid: true, response: { message: '', state, tone, layout, animation, priority, shouldShow: false } }
  }

  const message = typeof raw.message === 'string' ? raw.message.trim() : null
  if (!message) errors.push('empty_message')
  if (errors.length > 0) return { valid: false, errors }

  if (message.length > MAX_MESSAGE_LENGTH) errors.push('too_long')
  if (countSentences(message) > MAX_SENTENCES) errors.push('too_many_sentences')
  if (/[*_`#]|^\s*[-•]/m.test(message)) errors.push('markdown')

  const allowed = allowedNumbers(context)
  // Sempre nella lingua della risposta (senza lingua: italiano, come il resto).
  const numbers = extractNumbers(message, normalizeSpendyLocale(context?.locale))
  // Un numero fuori dalla grammatica della lingua: scartato, senza
  // riportarne le cifre.
  if (numbers.some(Number.isNaN)) errors.push('malformed_number')
  const invented = numbers.filter((n) => !Number.isNaN(n) && ![...allowed].some((a) => Math.abs(a - n) <= 1))
  if (invented.length > 0) errors.push(`invented_numbers:${invented.join(',')}`)

  const labels = knownLabels(context)
  if (quotedNames(message).some((name) => !labels.has(name))) errors.push('unknown_reference')

  if (isRiskyAdvice(message)) errors.push('risky_advice')
  if (isFearOrOffensive(message)) errors.push('offensive_or_judgmental')

  const band = context?.budget?.band
  if (band === 'exceeded' && (state === 'celebrating' || state === 'happy')) errors.push('incoherent_state')
  if (contradictsCyclePhase(message, context?.budget?.cyclePhase)) errors.push('incoherent_cycle_phase')

  const said = [...history, ...(previous ? [previous] : [])].filter((line) => typeof line === 'string')
  if (said.some((line) => similarity(message, line) >= REPEAT_SIMILARITY)) errors.push('repeated')
  errors.push(...structureProblems(message, { previous, history }))

  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, response: { message, state, tone, layout, animation, priority, shouldShow: true } }
}

// null = non indicata; undefined = sbagliata. Accetta anche "72".
function parsePriority(value) {
  if (value === undefined || value === null) return null
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(100, Math.round(n)))
}

// --- Contesto: solo ciò che è ammesso ---------------------------------
//
// Lista bianca di ciò che il contesto di Spendy può contenere (la forma
// prodotta da src/ai/spendyAIContext.js). Tutto il resto viene scartato:
// anche se un giorno un bug nell'app mandasse le transazioni, al modello
// non arriverebbero. Usata dall'app prima di inviare e dal server
// prima di chiamare il modello.
const MAX_LABEL = 60

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined)
const str = (value, max = MAX_LABEL) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined)
const oneOf = (value, list) => (list.includes(value) ? value : undefined)
const EVENT_ID = /^[a-z_]{3,40}$/

function pick(source, spec) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined
  const out = {}
  for (const [key, clean] of Object.entries(spec)) {
    const value = clean(source[key])
    if (value !== undefined) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const obj = (spec) => (value) => pick(value, spec)

const EVENT_SPEC = {
  id: (v) => (typeof v === 'string' && EVENT_ID.test(v) ? v : undefined),
  importance: num,
  category: str,
  amount: num,
  streakCycles: num,
  expense: obj({ amount: num, category: str, usualAmount: num, categoryCycleCurrent: num, categoryCycleUsual: num }),
  purchases: obj({ current: num, usual: num }),
  singleExpense: obj({ amount: num, usualAmount: num, changePercent: num }),
  smallExpenses: obj({ count: num, total: num }),
  cycle: obj({ current: num, usual: num, difference: num, changePercent: num }),
}

export function sanitizeSpendyContext(input) {
  if (!input || typeof input !== 'object') return null
  const budget = pick(input.budget, {
    monthly: num,
    spent: num,
    available: num,
    spentPercent: num,
    daysRemaining: num,
    dailyAllowance: num,
    cyclePhase: (v) => oneOf(v, CYCLE_PHASES),
    dayOfCycle: num,
    cycleDays: num,
    band: (v) => oneOf(v, BUDGET_BANDS),
  })
  if (!budget || budget.band === undefined || budget.available === undefined) return null

  const primaryEvent = pick(input.primaryEvent, EVENT_SPEC)
  return {
    version: num(input.version) ?? 1,
    locale: normalizeSpendyLocale(input.locale),
    today: typeof input.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.today) ? input.today : undefined,
    budget,
    spending: pick(input.spending, { today: num, usualCycle: num }) ?? {},
    primaryEvent: primaryEvent?.id ? primaryEvent : null,
    otherEvents: (Array.isArray(input.otherEvents) ? input.otherEvents : [])
      .slice(0, 2)
      .map((event) => pick(event, { id: EVENT_SPEC.id, importance: num, category: str }))
      .filter((event) => event?.id),
    goal: pick(input.goal, { label: str, percent: num, missing: num }) ?? null,
    suggestedState: oneOf(input.suggestedState, AI_STATES) ?? null,
  }
}

export function sanitizeMessages(list, limit = RECENT_WINDOW) {
  return (Array.isArray(list) ? list : [])
    .filter((line) => typeof line === 'string' && line.trim())
    .slice(-limit)
    .map((line) => line.trim().slice(0, MAX_MESSAGE_LENGTH))
}

// --- Personalità e prompt ---------------------------------------------

export const SPENDY_PERSONALITY = `Sei Spendy, la volpe di SPENDY: un amico sveglio che conosce le abitudini di spesa dell'utente e ogni tanto gli dice una cosa, dentro un fumetto nell'app.
Non sei un commercialista, una banca, un consulente, un predicatore, un chatbot generico, né un bambino che racconta barzellette.

PRIMA AIUTA, POI FA SORRIDERE.
Ricevi un riassunto della situazione (contesto), non le spese. Leggilo tutto insieme: l'evento principale, la categoria, quanto si scosta dall'abitudine, il budget e quanto ne resta, i giorni al termine del ciclo, l'obiettivo se c'è, lo stato suggerito e gli altri eventi. Poi decidi tu come reagire: ironico, serio, incoraggiante, attento, festoso, o una semplice osservazione.
- Interpreta, non fare il resoconto. "Hai fatto una spesa di 150 € per Shopping." è un report: non va bene. "150 € di shopping oggi: si fa notare. Il budget regge… ma quanto entusiasmo avevi?" è Spendy.
- Una spesa alta con il budget sano può essere presa con ironia. La stessa spesa con il budget al limite merita un aiuto concreto (quanto resta, per quanti giorni). Se è molto sopra la tua media, o in una categoria dove di solito spendi poco, dillo a modo tuo.
- Budget stretto o superato: niente battute, solo un aiuto concreto e un tono incoraggiante.
- L'obiettivo, se c'è, usalo solo quando rende la frase più viva o più utile.
- Una frase semplice e naturale è meglio di una battuta forzata. Se non c'è niente di interessante da dire: shouldShow = false.

STILE
- Lingua naturale (quella indicata in LINGUA), 1-3 frasi brevi, massimo 220 caratteri: una battuta da fumetto, non un paragrafo.
- Ironia leggera, curiosità, sorpresa. Mai insulti, giudizi, paura, sensi di colpa o moralismi.
- Non dire mai che una scelta è giusta o sbagliata. Niente consigli finanziari professionali, investimenti, crediti, trading, scommesse, cosa comprare o vendere, niente diagnosi.

DATI
- Usa SOLO i numeri che compaiono nel contesto, scritti come sono. Non fare calcoli, non inventare spese, saldi, percentuali o nomi.
- Se un dato non c'è, non usarlo.

TEMPO
- Il periodo è il ciclo di budget impostato dall'utente, non il mese solare: parla di "ciclo", mai di "mese".
- Per il tempo usa solo budget.cyclePhase, budget.dayOfCycle, budget.cycleDays e budget.daysRemaining (giorni DOPO oggi: 0 vuol dire che oggi è l'ultimo giorno del ciclo).
- cyclePhase: new_cycle = primo giorno di un nuovo ciclo, start = primi giorni, first_half = prima metà, mid = metà ciclo, second_half = seconda metà, final_days = ultimi giorni, last_day = ultimo giorno.
- In final_days e last_day non dire che la strada è lunga, che manca molto o che il ciclo è appena iniziato. In last_day non parlare di giorni che restano.
- In new_cycle, start e first_half non dire che siamo alla fine del ciclo o negli ultimi giorni.

VARIETÀ
- In "previous" trovi l'ultima frase che l'utente ha letto, in "recentMessages" le ultime dette: non ripeterne né le parole né la struttura (stessa apertura, stesso schema, stessa domanda finale). Se la situazione è simile, cerca un'angolazione diversa.
- Mai raccontare una categoria come "tornata": vietati "Ecco X che torna", "Guarda chi è tornato", "X è tornato", "Si vede che X è tornato", "Non si vedeva da un po'" e simili.
- "styleExamples" mostra il tono di Spendy: non copiarli.

RISPOSTA: soltanto l'oggetto JSON richiesto, senza markdown né spiegazioni.
state: happy | attentive | concerned | celebrating | advisor | ironic
tone: friendly | playful | ironic | celebratory | concerned | helpful
layout: left | right | center | overlap (dove sta Spendy: center per festeggiare, overlap per le preoccupazioni sul budget)
animation: gentle | playful | celebrate | concerned
priority: 0-100, quanto è importante che l'utente legga questa frase.`

// Pochi esempi di voce, non la libreria intera (HumorLibrary e reaction
// library restano nell'app come fallback locale).
export const STYLE_EXAMPLES = [
  '150 € di shopping oggi: si fa notare. Il budget regge… ma quanto entusiasmo avevi?',
  'Il Giappone si avvicina. E questa volta non è merito dello shopping.',
  'Hai offerto la cena anche al cuoco? 😂',
  'Il forno di casa ha lavorato più del delivery, stavolta.',
  'Restano 120 € per 9 giorni: si può fare, con un po’ di calma.',
  'Le piccole spese non si notano una per una: si notano a fine ciclo.',
  'Hai speso meno del previsto. Mi sto emozionando.',
  'Oggi il portafoglio può dormire tranquillo.',
]

// Gli stessi esempi di voce nelle altre lingue: il modello prende il tono
// dalla lingua in cui deve rispondere.
export const STYLE_EXAMPLES_BY_LOCALE = {
  it: STYLE_EXAMPLES,
  en: [
    '€150 of shopping today: hard to miss. The budget is holding up… but how excited were you?',
    'Japan is getting closer. And this time it’s not thanks to shopping.',
    'Did you buy the chef dinner too? 😂',
    'The oven at home worked harder than delivery this time.',
    '€120 left for 9 days: doable, with a bit of calm.',
    'Small expenses don’t show one by one: they show at the end of the cycle.',
    'You spent less than expected. I’m getting emotional.',
    'Your wallet can sleep soundly today.',
  ],
  es: [
    '150 € de compras hoy: se nota. El presupuesto aguanta… pero ¿cuánta ilusión tenías?',
    'Japón está más cerca. Y esta vez no es gracias a las compras.',
    '¿También le pagaste la cena al cocinero? 😂',
    'El horno de casa ha trabajado más que el delivery esta vez.',
    'Quedan 120 € para 9 días: se puede, con un poco de calma.',
    'Los gastos pequeños no se notan uno a uno: se notan al final del ciclo.',
    'Has gastado menos de lo previsto. Me estoy emocionando.',
    'Hoy la cartera puede dormir tranquila.',
  ],
  fr: [
    '150 € de shopping aujourd’hui\u00a0: ça se remarque. Le budget tient bon… mais quel enthousiasme\u00a0!',
    'Le Japon se rapproche. Et cette fois, ce n’est pas grâce au shopping.',
    'Vous avez aussi offert le dîner au chef\u00a0? 😂',
    'Le four de la maison a travaillé plus que la livraison, cette fois.',
    'Il reste 120 € pour 9 jours\u00a0: c’est faisable, avec un peu de calme.',
    'Les petites dépenses ne se voient pas une par une\u00a0: elles se voient en fin de cycle.',
    'Vous avez dépensé moins que prévu. Ça m’émeut.',
    'Aujourd’hui, le portefeuille peut dormir tranquille.',
  ],
}

const LANGUAGE_NAMES = { it: 'italiano', en: 'inglese (English)', es: 'spagnolo (español)', fr: 'francese (français)' }

// La sezione LINGUA del prompt: la sola parte che cambia con la lingua.
export function spendyLanguageInstructions(locale) {
  const code = normalizeSpendyLocale(locale)
  const name = LANGUAGE_NAMES[code]
  const lines = [
    'LINGUA',
    `- Rispondi esclusivamente in ${name} (context.locale = "${code}"): tutto il campo message è in ${name}, anche se queste istruzioni sono scritte in italiano.`,
    '- Scrivi i numeri esattamente come compaiono nel contesto, senza separatori delle migliaia.',
  ]
  if (code !== 'it') {
    lines.push(`- Le regole di TEMPO e VARIETÀ valgono anche per le frasi equivalenti in ${name}: per "ciclo" usa la parola equivalente in ${name}.`)
    lines.push(`- I nomi delle categorie e degli obiettivi nel contesto si scrivono così come sono.`)
  }
  return lines.join('\n')
}

// JSON Schema della risposta (per gli output strutturati del modello).
export const SPENDY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    state: { type: 'string', enum: AI_STATES },
    tone: { type: 'string', enum: AI_TONES },
    layout: { type: 'string', enum: AI_LAYOUTS },
    animation: { type: 'string', enum: AI_ANIMATIONS },
    priority: { type: 'integer' },
    shouldShow: { type: 'boolean' },
  },
  required: ['message', 'state', 'tone', 'layout', 'animation', 'priority', 'shouldShow'],
  additionalProperties: false,
}

export function buildSpendyPrompt(context, { previous = null, history = [], styleExamples } = {}) {
  const locale = normalizeSpendyLocale(context?.locale)
  const examples = styleExamples ?? STYLE_EXAMPLES_BY_LOCALE[locale]
  return {
    system: `${SPENDY_PERSONALITY}\n\n${spendyLanguageInstructions(locale)}`,
    input: {
      context,
      previous,
      recentMessages: history.slice(-RECENT_WINDOW),
      styleExamples: examples.slice(0, 12),
    },
  }
}
