// JokeEvaluator — the "editor" of Spendy's insight pipeline:
//
//   multiple joke candidates → JokeEvaluator → best valid joke
//
// Scores every HumorEngine candidate 0-100 on nine dimensions and rejects
// anything that shouldn't be shown at all: invented numbers, anything
// accusatory/offensive/aggressive/explicit, a near-duplicate of a joke
// already shown for the same category+insight-type, or — v2 — a line
// that just narrates the data ("le spese sono passate da 50 € a 200 €")
// instead of actually joking about it. Spendy can be ironic, never mean
// — it teases the situation, not the person, and it should sound like a
// mascot's spontaneous quip, not a financial advisor's report.
const INSULT_WORDS = [
  'idiota', 'idiot', 'stupid', 'scemo', 'cretino', 'imbecille', 'deficiente',
  'incapace', 'patetico', 'pathetic', 'vergognati', 'irresponsabile', 'disastro',
]
const AGGRESSIVE_PHRASES = [
  'devi smettere', 'basta con', 'non capisci', 'sei un disastro', 'che vergogna', 'non hai imparato',
]
const SEXUAL_WORDS = ['sesso', 'porno', 'nudo', 'nuda', 'erotic', 'sexy']
const PROTECTED_TOPICS = ['religione', 'etnia', 'razza', 'orientamento sessuale', 'disabilità', 'genere', 'nazionalità']

// v2's whole reason for being: a joke that just reports the numbers is
// exactly what "NON deve sembrare descrizioni dei dati" forbids, even
// when it's 100% factually correct. Caught structurally (patterns), not
// by trying to guess intent.
const DESCRIPTIVE_PATTERNS = [
  /\d+\s?€?\s*(?:->|→|a)\s*\d+\s?€/i, // "50 € a 200 €" / "50->200"
  /\d+\s?%/, // a bare percentage reads like a report, not a joke
  /le (tue )?spese.*(sono|è|risultano) (aumentat|diminuit|sal|sces)/i,
  /(hai speso|you spent|tu as dépensé|gastaste) (molto|troppo|poco|too much|trop|demasiado)/i,
  /(stai spendendo troppo|you’re overspending|tu dépenses trop|estás gastando demasiado)/i,
  /(attenzione alle spese|watch your spending|attention aux dépenses|cuidado con los gastos)/i,
  /budget (superato|rispettato|usato|exceeded|respected|dépassé|respecté|superado|respetado) (di|al|by|de)/i,
]

function isDescriptive(text) {
  return DESCRIPTIVE_PATTERNS.some((pattern) => pattern.test(text))
}

function containsAny(lowerText, words) {
  return words.some((word) => lowerText.includes(word))
}

function normalize(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim()
}

// Word-overlap (Jaccard-ish) similarity — cheap, dependency-free, good
// enough to catch "praticamente uguale a una battuta già mostrata"
// without needing exact string equality.
export function similarity(a, b) {
  const normA = normalize(a)
  const normB = normalize(b)
  if (normA === normB) return 1
  const wordsA = new Set(normA.split(/\s+/).filter(Boolean))
  const wordsB = new Set(normB.split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length
  const union = new Set([...wordsA, ...wordsB]).size
  return union > 0 ? shared / union : 0
}

function extractAmounts(text) {
  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? []
  return matches.map((match) => Math.round(parseFloat(match.replace(',', '.'))))
}

// "non deve contenere informazioni non presenti nei dati" — every € or %
// figure the joke mentions must match one of the insight's own numbers.
// humorLibrary.js's v2 content essentially never mentions numbers at all
// (that's the point), so this is mostly a safety net now.
function scoreFactualAccuracy(text, insight) {
  const mentioned = extractAmounts(text)
  if (mentioned.length === 0) return 90 // no numeric claim to verify — neutral-good
  // Ai quattro numeri dell'insight si aggiungono quelli di `facts`
  // (vedi behaviorEngine): sono calcolati dagli stessi dati reali, e
  // sono cio' che i segnaposto {amount}/{remaining}/{count}... possono
  // aver inserito nel testo. Tutto il resto resta inventato e quindi
  // vietato: una cifra che non viene da qui azzera il punteggio.
  const factValues = Object.values(insight.facts ?? {}).filter((value) => typeof value === 'number')
  const allowed = [insight.current, insight.baseline, insight.changeAmount, insight.changePercent, ...factValues]
    .filter((n) => typeof n === 'number' && Number.isFinite(n))
    .map((n) => Math.round(Math.abs(n)))
  return mentioned.every((n) => allowed.some((a) => Math.abs(a - n) <= 1)) ? 100 : 0
}

// v2: relevance is established by construction, not by keyword-hunting
// the rendered text. HumorEngine only ever pulls a candidate from the
// bucket that matches insight.categoryId+direction (or insight.type) —
// see humorEngine.js's resolveTemplates — so a candidate tagged
// source:'category' IS contextually relevant even if it never says the
// category's name (that's the whole point of "hai offerto la cena anche
// al cuoco?" never saying "ristoranti"). Scoring by keyword presence, as
// v1 did, would have punished exactly the personality-first jokes this
// version exists to reward.
function scoreRelevance(candidate) {
  if (candidate.source === 'category') return 100
  if (candidate.source === 'type') return 90
  return 60 // fallback bucket — still on-topic, just generic
}

function scoreClarity(text) {
  if (!text || text.length < 6) return 0
  if (text.length > 160) return 30
  return 95
}

function scoreNaturalness(text) {
  if (isDescriptive(text)) return 20
  const shouting = /[A-ZÀ-Ù]{6,}/.test(text)
  const excessivePunctuation = /[!?]{3,}/.test(text)
  return shouting || excessivePunctuation ? 25 : 95
}

function scoreTone(text) {
  const warmMarkers = ['😂', '😏', '🎉', '😎', '💡', 'insieme', 'complimenti', 'bravo', 'together', 'well done', 'nice', 'ensemble', 'bravo', 'juntos', 'bien hecho']
  const lower = text.toLowerCase()
  const hasWarmth = warmMarkers.some((marker) => text.includes(marker) || lower.includes(marker))
  return hasWarmth ? 95 : 80
}

// Humor is judged on the "spontaneous mascot quip" qualities the brief
// asks for: short, punchy, never a plain data report. A descriptive line
// is capped low here even when every other dimension would look fine —
// "una battuta che descrive i dati deve ottenere un punteggio basso anche
// se è factualmente corretta".
function scoreHumor(candidate) {
  if (isDescriptive(candidate.text)) return 10
  const base = { light: 55, funny: 82, strong: 90 }[candidate.intensity] ?? 65
  const short = candidate.text.length <= 70
  const punchy = /[?!]\s*$/.test(candidate.text.trim()) || /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(candidate.text)
  return Math.min(100, base + (short ? 6 : 0) + (punchy ? 4 : 0))
}

function scoreOriginality(text, history) {
  if (history.length === 0) return 100
  const maxSimilarity = Math.max(...history.map((entry) => similarity(text, entry.text)))
  return Math.round((1 - maxSimilarity) * 100)
}

function isOffensive(text) {
  const lower = text.toLowerCase()
  return (
    containsAny(lower, INSULT_WORDS)
    || containsAny(lower, SEXUAL_WORDS)
    || containsAny(lower, PROTECTED_TOPICS)
    || containsAny(lower, AGGRESSIVE_PHRASES)
  )
}

// v2 weighting — "aumenta il peso di humor, naturalness, contextual
// relevance, originality": these four now count double toward the final
// score, clarity/spendyTone/factualAccuracy remain as a lighter-weight
// sanity layer rather than the dominant signal they were in v1.
const SCORE_WEIGHTS = {
  relevance: 2,
  humor: 2,
  originality: 2,
  naturalness: 2,
  clarity: 1,
  spendyTone: 1,
  factualAccuracy: 1,
}
const TOTAL_WEIGHT = Object.values(SCORE_WEIGHTS).reduce((sum, w) => sum + w, 0)

// Scores one candidate 0-100 and decides whether it may be shown at all.
// `history` is the slice of previously-shown jokes for this SAME
// category+insight-type (see spendyCoach.js) — that's what
// repetitionPenalty/originality check against.
export function evaluateJoke(candidate, insight, history = []) {
  const text = candidate.text ?? ''
  // Il controllo "non sembrare la descrizione dei dati" gira sul
  // TEMPLATE, non sul testo finale: una frase come "Ti restano
  // {remaining}" e' una battuta, la stessa frase gia' interpolata
  // conterrebbe una cifra e verrebbe scartata dai DESCRIPTIVE_PATTERNS.
  // E' questo che permette ai numeri veri di entrare nelle frasi senza
  // riaprire la porta alle frasi-referto.
  const template = candidate.template ?? text

  const factualAccuracy = scoreFactualAccuracy(text, insight)
  const relevance = scoreRelevance(candidate)
  const clarity = scoreClarity(text)
  const naturalness = scoreNaturalness(text)
  const spendyTone = scoreTone(text)
  const humor = scoreHumor(candidate)
  const originality = scoreOriginality(text, history)

  const descriptive = isDescriptive(template)
  const offensive = isOffensive(text)
  const offensivenessPenalty = offensive ? 100 : 0
  const nearDuplicate = history.some((entry) => similarity(text, entry.text) >= 0.85)
  const repetitionPenalty = nearDuplicate ? 100 : 0

  const breakdown = {
    relevance, humor, originality, clarity, naturalness, spendyTone,
    factualAccuracy, repetitionPenalty, offensivenessPenalty,
  }

  const valid = (
    !offensive
    && !nearDuplicate
    && !descriptive
    && factualAccuracy >= 80
    && relevance >= 50
    && clarity >= 50
    && naturalness >= 50
  )

  const weightedPositive = (
    relevance * SCORE_WEIGHTS.relevance
    + humor * SCORE_WEIGHTS.humor
    + originality * SCORE_WEIGHTS.originality
    + naturalness * SCORE_WEIGHTS.naturalness
    + clarity * SCORE_WEIGHTS.clarity
    + spendyTone * SCORE_WEIGHTS.spendyTone
    + factualAccuracy * SCORE_WEIGHTS.factualAccuracy
  ) / TOTAL_WEIGHT
  const penalty = (repetitionPenalty + offensivenessPenalty) / 2
  const score = valid ? Math.max(0, Math.min(100, Math.round(weightedPositive - penalty))) : 0

  return { ...candidate, score, breakdown, valid }
}

// How close to the top score a candidate must be to still be considered
// "just as good" — picking randomly among this cluster (instead of
// always the single highest-scoring one) is what fixes "vedo sempre la
// stessa battuta": with an empty/short history, scoring is otherwise
// fully deterministic (same text properties in, same score out), so the
// exact same line would win EVERY time a given bucket is used, no matter
// how many genuinely good alternatives sit right behind it.
const TOP_CLUSTER_MARGIN = 12

// Evaluates every candidate and returns a random one of the best-scoring
// ("close enough to the top") valid candidates, or null if none of them
// are valid (e.g. every candidate for this insight turned out to be a
// near-duplicate of one already shown).
export function pickBestJoke(candidates, insight, history = [], rng = Math.random) {
  const evaluated = candidates.map((candidate) => evaluateJoke(candidate, insight, history))
  const valid = evaluated.filter((entry) => entry.valid)
  if (valid.length === 0) return null
  const topScore = Math.max(...valid.map((entry) => entry.score))
  const contenders = valid.filter((entry) => entry.score >= topScore - TOP_CLUSTER_MARGIN)
  return contenders[Math.floor(rng() * contenders.length)]
}
