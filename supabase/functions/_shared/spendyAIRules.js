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

export function passesToneRules(text) {
  return !RISKY_ADVICE.test(text) && !FEAR_OR_JUDGMENT.test(text) && !OFFENSIVE.test(text)
}

// --- Numeri ------------------------------------------------------------

// Numeri scritti all'italiana: "1.179", "1.179,50", "66", "12,5".
const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g

export function extractNumbers(text) {
  return (text.match(NUMBER) ?? []).map((raw) => {
    const normalized = /^\d{1,3}(?:\.\d{3})+/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.')
    return Math.round(Math.abs(parseFloat(normalized)))
  })
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

export function contradictsCyclePhase(message, phase) {
  if (typeof message !== 'string' || !CYCLE_PHASES.includes(phase)) return false
  if (LATE_PHASES.includes(phase) && TIME_LEFT_CLAIM.test(message)) return true
  if (phase === 'last_day' && DAYS_LEFT_CLAIM.test(message)) return true
  if (EARLY_PHASES.includes(phase) && END_CLAIM.test(message)) return true
  if ((phase === 'mid' || phase === 'second_half') && JUST_STARTED_CLAIM.test(message)) return true
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
  const invented = extractNumbers(message).filter((n) => ![...allowed].some((a) => Math.abs(a - n) <= 1))
  if (invented.length > 0) errors.push(`invented_numbers:${invented.join(',')}`)

  const labels = knownLabels(context)
  if (quotedNames(message).some((name) => !labels.has(name))) errors.push('unknown_reference')

  if (RISKY_ADVICE.test(message)) errors.push('risky_advice')
  if (FEAR_OR_JUDGMENT.test(message) || OFFENSIVE.test(message)) errors.push('offensive_or_judgmental')

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
    locale: input.locale === 'it' ? 'it' : 'it',
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
- Italiano naturale, 1-3 frasi brevi, massimo 220 caratteri: una battuta da fumetto, non un paragrafo.
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

export function buildSpendyPrompt(context, { previous = null, history = [], styleExamples = STYLE_EXAMPLES } = {}) {
  return {
    system: SPENDY_PERSONALITY,
    input: {
      context,
      previous,
      recentMessages: history.slice(-RECENT_WINDOW),
      styleExamples: styleExamples.slice(0, 12),
    },
  }
}
