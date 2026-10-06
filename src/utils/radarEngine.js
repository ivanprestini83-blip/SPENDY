import { BEHAVIOR_ENGINE_CONFIG, BEHAVIOR_TYPES, analyzeBehavior } from './behaviorEngine.js'
import { rankInsightsByImportance, computeImportance } from './importantEventSelector.js'
import { generateJokeCandidates } from './humorEngine.js'
import { pickBestJoke } from './jokeEvaluator.js'
import { getInsightTopicKey } from './spendyCoach.js'
import { formatCurrency } from './format.js'
import { lastCycles, isWithinRange } from './cycle.js'

// RADAR SPENDY — "quali sono le cose più importanti che Spendy ha
// notato nei miei soldi?"
//
//   BehaviorEngine (cosa è successo)
//        ↓
//   importantEventSelector (quanto conta, 0-100)
//        ↓
//   questo modulo: deduplica, taglia, racconta, propone un'azione
//        ↓
//   RadarScreen (solo rendering)
//
// Non ricalcola NIENTE: non riapre le spese per dedurre variazioni, non
// rifa' la matematica del budget, non decide da solo cosa sia
// importante. Prende gli insight che BehaviorEngine già produce, li
// ordina con il punteggio che importantEventSelector già calcola, e si
// limita a fare le due cose che prima non faceva nessuno: trasformarli
// in schede leggibili e collegarli a un'azione che nell'app esiste
// davvero.
//
// Differenza con la Home: la Home mostra UN solo messaggio, quello scelto
// da getSpendyCoach. Il Radar mostra la classifica — "cos'altro ho
// notato" — ed è per questo che deduplica per argomento invece di
// mostrare quattro schede sulla stessa categoria.

export const RADAR_STATUS = {
  ACTIVE: 'active', // ci sono segnalazioni
  QUIET: 'quiet', // dati sufficienti, ma niente di rilevante
  LEARNING: 'learning', // troppo pochi dati per confrontare qualcosa
}

export const RADAR_CARD_LIMIT = 5

// Quante schede al massimo: oltre questa soglia il Radar smetterebbe di
// essere una classifica e diventerebbe l'elenco delle spese, che è
// esattamente ciò che non deve essere.
const TONES = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  POSITIVE: 'positive',
  GOAL: 'goal',
  NEUTRAL: 'neutral',
}

const TONE_BY_TYPE = {
  [BEHAVIOR_TYPES.BUDGET_EXCEEDED]: TONES.CRITICAL,
  [BEHAVIOR_TYPES.NEGATIVE_STREAK]: TONES.CRITICAL,
  [BEHAVIOR_TYPES.BUDGET_HIGH]: TONES.WARNING,
  [BEHAVIOR_TYPES.BUDGET_RISING]: TONES.WARNING,
  [BEHAVIOR_TYPES.CATEGORY_SPIKE]: TONES.WARNING,
  [BEHAVIOR_TYPES.RECURRING_HIGH]: TONES.WARNING,
  [BEHAVIOR_TYPES.CATEGORY_TREND_UP]: TONES.WARNING,
  [BEHAVIOR_TYPES.AMOUNT_ABOVE_AVERAGE]: TONES.WARNING,
  [BEHAVIOR_TYPES.UNUSUAL_FREQUENCY]: TONES.WARNING,
  [BEHAVIOR_TYPES.SMALL_EXPENSES_ADD_UP]: TONES.WARNING,
  [BEHAVIOR_TYPES.CATEGORY_DROP]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.RECURRING_LOW]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.CATEGORY_TREND_DOWN]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.AMOUNT_BELOW_AVERAGE]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.SAVINGS_VS_USUAL]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.BUDGET_RESPECTED]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.POSITIVE_STREAK]: TONES.POSITIVE,
  [BEHAVIOR_TYPES.GOAL_PROGRESS]: TONES.GOAL,
  [BEHAVIOR_TYPES.UNUSUAL_PURCHASE]: TONES.NEUTRAL,
}

// Lo stato "budget rispettato" NON diventa una scheda del Radar, pur
// restando un insight valido per tutto il resto dell'app: è una
// condizione permanente ("sei sotto il 50%"), non qualcosa che Spendy ha
// NOTATO, ed è già il messaggio che la Home mostra da sola. Tenerlo qui
// riempirebbe il Radar di una scheda sempre presente e sempre uguale —
// proprio la duplicazione della Home che il Radar deve evitare.
const EXCLUDED_FROM_RADAR = new Set([BEHAVIOR_TYPES.BUDGET_RESPECTED])

// Gli insight che NON hanno bisogno di storico per essere veri: sono
// fatti del ciclo corrente (quanto budget resta, quanto ho messo da parte
// per un obiettivo, quante piccole spese ho fatto), non confronti con un
// passato che ancora non esiste. Solo questi possono comparire finché
// Spendy non ha abbastanza cicli alle spalle — tutto il resto sarebbe un
// trend dedotto dal nulla.
const NO_HISTORY_NEEDED = new Set([
  BEHAVIOR_TYPES.BUDGET_EXCEEDED,
  BEHAVIOR_TYPES.BUDGET_HIGH,
  BEHAVIOR_TYPES.BUDGET_RISING,
  BEHAVIOR_TYPES.GOAL_PROGRESS,
  BEHAVIOR_TYPES.SMALL_EXPENSES_ADD_UP,
])

// importantEventSelector assegna un punteggio 0-100 generico, pensato per
// la Home ("qual è la cosa più interessante"), e resta la base anche
// qui — compresa la parte che pesa QUANTO è grande la variazione.
// Il Radar pero' ha una gerarchia sua, dichiarata nel brief: un budget
// sforato viene prima di tutto, anche di uno sforamento piccolo; il
// budget quasi esaurito e un obiettivo vicino vengono prima di una
// variazione di categoria. Questi ritocchi sono esattamente quella
// gerarchia, applicati SOLO al Radar: importantEventSelector non viene
// toccato, quindi la scelta della Home resta identica a prima.
const RADAR_PRIORITY_BOOST = {
  [BEHAVIOR_TYPES.BUDGET_EXCEEDED]: 25,
  [BEHAVIOR_TYPES.BUDGET_HIGH]: 22,
  [BEHAVIOR_TYPES.BUDGET_RISING]: 12,
  [BEHAVIOR_TYPES.GOAL_PROGRESS]: 10,
  [BEHAVIOR_TYPES.NEGATIVE_STREAK]: 8,
}

export function radarPriority(insight) {
  const boost = RADAR_PRIORITY_BOOST[insight.type] ?? 0
  return Math.min(100, computeImportance(insight) + boost)
}

const TONE_DOT = {
  [TONES.CRITICAL]: '🔴',
  [TONES.WARNING]: '🟠',
  [TONES.POSITIVE]: '🟢',
  [TONES.GOAL]: '🎯',
  [TONES.NEUTRAL]: '🔵',
}

// Le uniche destinazioni che l'app offre davvero. Nessuna scheda può
// proporre un'azione che non sia in questa lista: un pulsante che non
// porta da nessuna parte è peggio di nessun pulsante.
//   tab    → setActiveTab(target)
//   modal  → openModal(target)
//   detail → apre il dettaglio della scheda stessa
export const RADAR_ACTIONS = {
  EXPENSES: { id: 'expenses', label: 'Vedi le spese', kind: 'tab', target: 'expenses' },
  ANALYTICS: { id: 'analytics', label: 'Vedi andamento', kind: 'tab', target: 'analytics' },
  CATEGORY: { id: 'category', label: 'Vedi categoria', kind: 'tab', target: 'analytics' },
  GOALS: { id: 'goals', label: 'Vedi obiettivo', kind: 'tab', target: 'goals' },
  BUDGET: { id: 'budget', label: 'Vai al budget', kind: 'modal', target: 'settings' },
  AFFORDABILITY: { id: 'affordability', label: 'Posso permettermelo?', kind: 'modal', target: 'affordability' },
  DETAIL: { id: 'detail', label: 'Analizza', kind: 'detail', target: null },
}

const round = (value) => Math.round(value)
const percentText = (value) => `${value > 0 ? '+' : ''}${round(value)}%`

// --- Narrazione ----------------------------------------------------------
//
// Una funzione per famiglia di insight: titolo, dato principale,
// confronto, spiegazione, consiglio, azione. Tutti i numeri vengono
// dall'insight (o dai suoi `facts`), mai ricalcolati qui.

function categoryTitle(insight) {
  return (insight.category?.label ?? 'Spese').toUpperCase()
}

function narrateCategoryHigh(insight) {
  return {
    title: categoryTitle(insight),
    metric: { value: formatCurrency(insight.current), label: 'questo ciclo' },
    comparison: {
      text: `${percentText(insight.changePercent)} rispetto alla tua media`,
      direction: 'up',
      baselineText: `La tua media è ${formatCurrency(insight.baseline)}.`,
    },
    explanation: `Negli ultimi cicli spendevi intorno a ${formatCurrency(insight.baseline)} in ${insight.category?.label?.toLowerCase() ?? 'questa categoria'}. Questo ciclo sei a ${formatCurrency(insight.current)}.`,
    advice: `È la categoria su cui, se vuoi rientrare, recuperi più facilmente.`,
    action: RADAR_ACTIONS.CATEGORY,
  }
}

function narrateCategoryLow(insight) {
  return {
    title: categoryTitle(insight),
    metric: { value: formatCurrency(insight.current), label: 'questo ciclo' },
    comparison: {
      text: `${percentText(insight.changePercent)} rispetto alla tua media`,
      direction: 'down',
      baselineText: `La tua media è ${formatCurrency(insight.baseline)}.`,
    },
    explanation: `Di solito qui spendi ${formatCurrency(insight.baseline)}. Questo ciclo sei a ${formatCurrency(insight.current)}: ${formatCurrency(Math.abs(insight.changeAmount))} in meno.`,
    advice: 'Se la tieni così, sono soldi che puoi spostare su un obiettivo.',
    action: RADAR_ACTIONS.GOALS,
  }
}

function narrateAmountAboveAverage(insight) {
  return {
    title: categoryTitle(insight),
    metric: { value: formatCurrency(insight.current), label: 'una sola spesa' },
    comparison: {
      text: `${percentText(insight.changePercent)} rispetto alla spesa tipica`,
      direction: 'up',
      baselineText: `Di solito in ${insight.category?.label?.toLowerCase() ?? 'questa categoria'} spendi ${formatCurrency(insight.baseline)} per volta.`,
    },
    explanation: `Una singola spesa da ${formatCurrency(insight.current)}, contro le ${formatCurrency(insight.baseline)} che spendi di solito per volta in questa categoria.`,
    advice: null,
    action: RADAR_ACTIONS.EXPENSES,
  }
}

function narrateSmallExpenses(insight) {
  const { count, total, average, categoryLabel } = insight.facts
  return {
    title: 'PICCOLE SPESE',
    metric: { value: `${count} acquisti`, label: formatCurrency(total) },
    comparison: {
      text: `${formatCurrency(average)} in media l'uno`,
      direction: 'up',
      baselineText: categoryLabel ? `Soprattutto in ${categoryLabel.toLowerCase()}.` : null,
    },
    explanation: categoryLabel
      ? `${count} spese sotto i 15 €, per un totale di ${formatCurrency(total)}. La maggior parte in ${categoryLabel.toLowerCase()}.`
      : `${count} spese sotto i 15 €, per un totale di ${formatCurrency(total)}.`,
    advice: 'Le piccole spese non si notano una per una: si notano a fine ciclo.',
    action: RADAR_ACTIONS.EXPENSES,
  }
}

function narrateFrequency(insight) {
  const up = insight.changeAmount > 0
  return {
    title: categoryTitle(insight),
    metric: { value: `${round(insight.current)} acquisti`, label: 'questo ciclo' },
    comparison: {
      text: `${up ? '+' : ''}${round(insight.changeAmount)} rispetto al solito`,
      direction: up ? 'up' : 'down',
      baselineText: `Di solito sono ${round(insight.baseline)}.`,
    },
    explanation: `Qui conta la frequenza, non l'importo: ${round(insight.current)} acquisti contro i ${round(insight.baseline)} abituali.`,
    advice: null,
    action: RADAR_ACTIONS.EXPENSES,
  }
}

function narrateUnusualPurchase(insight) {
  return {
    title: categoryTitle(insight),
    metric: { value: formatCurrency(insight.current), label: 'dopo diversi cicli di silenzio' },
    comparison: null,
    explanation: `Non spendevi in ${insight.category?.label?.toLowerCase() ?? 'questa categoria'} da diversi cicli.`,
    advice: null,
    action: RADAR_ACTIONS.EXPENSES,
  }
}

function narrateBudget(insight, ctx) {
  const { budget, spent, remaining, percent } = insight.facts
  const exceeded = insight.type === BEHAVIOR_TYPES.BUDGET_EXCEEDED

  return {
    title: 'BUDGET',
    metric: {
      value: exceeded ? formatCurrency(Math.abs(remaining)) : formatCurrency(remaining),
      label: exceeded ? 'oltre il budget' : 'ancora disponibili',
    },
    comparison: {
      text: `${round(percent)}% utilizzato`,
      direction: exceeded ? 'up' : 'flat',
      baselineText: `${formatCurrency(spent)} spesi su ${formatCurrency(budget)}.`,
    },
    explanation: exceeded
      ? `Hai speso ${formatCurrency(spent)} a fronte di un budget di ${formatCurrency(budget)}: sei oltre di ${formatCurrency(Math.abs(remaining))}.`
      : `Hai usato il ${round(percent)}% del budget e ti restano ${formatCurrency(remaining)} fino alla fine del ciclo${ctx.cycleEndLabel ? ` (${ctx.cycleEndLabel})` : ''}.`,
    advice: exceeded
      ? 'Da qui a fine ciclo, ogni spesa pesa il doppio.'
      : 'Prima di una spesa importante, chiedimelo: faccio due conti al volo.',
    action: exceeded ? RADAR_ACTIONS.BUDGET : RADAR_ACTIONS.AFFORDABILITY,
  }
}

function narrateBudgetRespected(insight) {
  const { budget, spent, remaining, percent } = insight.facts
  return {
    title: 'BUDGET',
    metric: { value: formatCurrency(remaining), label: 'ancora disponibili' },
    comparison: {
      text: `solo ${round(percent)}% utilizzato`,
      direction: 'down',
      baselineText: `${formatCurrency(spent)} spesi su ${formatCurrency(budget)}.`,
    },
    explanation: `Sei al ${round(percent)}% del budget: per ora c’è un buon margine.`,
    advice: null,
    action: RADAR_ACTIONS.ANALYTICS,
  }
}

function narrateSavings(insight) {
  const saved = Math.abs(insight.changeAmount)
  return {
    title: 'RISPARMIO',
    metric: { value: formatCurrency(saved), label: 'in meno del solito' },
    comparison: {
      text: `${percentText(insight.changePercent)} rispetto alla tua media`,
      direction: 'down',
      baselineText: `Di solito a questo punto sei a ${formatCurrency(insight.baseline)}.`,
    },
    explanation: `Questo ciclo hai speso ${formatCurrency(insight.current)} contro i ${formatCurrency(insight.baseline)} abituali.`,
    advice: `${formatCurrency(saved)} che potresti spostare su un obiettivo, invece di lasciarli scivolare via.`,
    action: RADAR_ACTIONS.GOALS,
  }
}

function narrateStreak(insight) {
  const positive = insight.type === BEHAVIOR_TYPES.POSITIVE_STREAK
  return {
    title: positive ? 'COSTANZA' : 'ATTENZIONE',
    metric: { value: `${insight.samples} cicli`, label: positive ? 'di fila sotto controllo' : 'di fila sopra soglia' },
    comparison: {
      text: positive ? 'sempre sotto il 70% del budget' : 'sempre oltre l’85% del budget',
      direction: positive ? 'down' : 'up',
      baselineText: null,
    },
    explanation: positive
      ? `Da ${insight.samples} cicli chiudi sempre sotto il 70% del budget. Non è fortuna, è un'abitudine.`
      : `Da ${insight.samples} cicli superi l'85% del budget. Non è un episodio, è una tendenza.`,
    advice: positive ? null : 'Vale la pena guardare quale categoria pesa di più.',
    action: RADAR_ACTIONS.ANALYTICS,
  }
}

function narrateGoalProgress(insight) {
  const { goalLabel, saved, target, percent, missing } = insight.facts
  return {
    title: 'OBIETTIVO',
    metric: { value: `${round(percent)}%`, label: goalLabel },
    comparison: {
      text: `${formatCurrency(saved)} / ${formatCurrency(target)}`,
      // Non 'up': l'avanzamento di un obiettivo non è né un aumento da
      // temere né un calo da festeggiare, ha un colore tutto suo.
      direction: 'goal',
      baselineText: `Mancano ${formatCurrency(missing)}.`,
    },
    explanation: `"${goalLabel}": hai messo da parte ${formatCurrency(saved)} sui ${formatCurrency(target)} che ti servono.`,
    advice: `Mancano ${formatCurrency(missing)}.`,
    action: RADAR_ACTIONS.GOALS,
  }
}

const NARRATORS = {
  [BEHAVIOR_TYPES.RECURRING_HIGH]: narrateCategoryHigh,
  [BEHAVIOR_TYPES.CATEGORY_SPIKE]: narrateCategoryHigh,
  [BEHAVIOR_TYPES.CATEGORY_TREND_UP]: narrateCategoryHigh,
  [BEHAVIOR_TYPES.RECURRING_LOW]: narrateCategoryLow,
  [BEHAVIOR_TYPES.CATEGORY_DROP]: narrateCategoryLow,
  [BEHAVIOR_TYPES.CATEGORY_TREND_DOWN]: narrateCategoryLow,
  [BEHAVIOR_TYPES.AMOUNT_ABOVE_AVERAGE]: narrateAmountAboveAverage,
  [BEHAVIOR_TYPES.AMOUNT_BELOW_AVERAGE]: narrateCategoryLow,
  [BEHAVIOR_TYPES.SMALL_EXPENSES_ADD_UP]: narrateSmallExpenses,
  [BEHAVIOR_TYPES.UNUSUAL_FREQUENCY]: narrateFrequency,
  [BEHAVIOR_TYPES.UNUSUAL_PURCHASE]: narrateUnusualPurchase,
  [BEHAVIOR_TYPES.BUDGET_EXCEEDED]: narrateBudget,
  [BEHAVIOR_TYPES.BUDGET_HIGH]: narrateBudget,
  [BEHAVIOR_TYPES.BUDGET_RISING]: narrateBudget,
  [BEHAVIOR_TYPES.BUDGET_RESPECTED]: narrateBudgetRespected,
  [BEHAVIOR_TYPES.SAVINGS_VS_USUAL]: narrateSavings,
  [BEHAVIOR_TYPES.POSITIVE_STREAK]: narrateStreak,
  [BEHAVIOR_TYPES.NEGATIVE_STREAK]: narrateStreak,
  [BEHAVIOR_TYPES.GOAL_PROGRESS]: narrateGoalProgress,
}

// --- Costruzione delle schede -------------------------------------------

const BUDGET_TYPES = new Set([
  BEHAVIOR_TYPES.BUDGET_EXCEEDED,
  BEHAVIOR_TYPES.BUDGET_HIGH,
  BEHAVIOR_TYPES.BUDGET_RISING,
  BEHAVIOR_TYPES.BUDGET_RESPECTED,
])

// Gli insight di budget nascono con la sola percentuale (vedi
// checkBudget): qui ricevono i quattro numeri che la scheda deve
// mostrare — totale, speso, residuo, percentuale — presi da
// financialData, che li ha già calcolati. Nessuna nuova matematica.
function enrichBudgetInsight(insight, financialData, monthlyBudget) {
  if (!BUDGET_TYPES.has(insight.type)) return insight
  const budget = financialData?.monthlyBudget ?? monthlyBudget ?? 0
  const spent = financialData?.spentThisMonth ?? 0
  const remaining = financialData?.available ?? budget - spent
  const percent = financialData?.spentRatio ?? (budget > 0 ? (spent / budget) * 100 : 0)
  return { ...insight, facts: { ...(insight.facts ?? {}), budget, spent, remaining, percent } }
}

function buildMessage(insight, { lang, jokeHistory, rng }) {
  const key = getInsightTopicKey(insight)
  const history = jokeHistory.filter((entry) => entry.key === key)
  const candidates = generateJokeCandidates(insight, lang)
  const best = pickBestJoke(candidates, insight, history, rng)
  return { key, message: best?.text ?? null, score: best?.score ?? null }
}

export function buildRadarCard(insight, ctx) {
  const narrate = NARRATORS[insight.type]
  if (!narrate) return null

  const narration = narrate(insight, ctx)
  const { key, message, score } = buildMessage(insight, ctx)
  const tone = TONE_BY_TYPE[insight.type] ?? TONES.NEUTRAL

  return {
    id: key,
    type: insight.type,
    tone,
    dot: TONE_DOT[tone],
    emoji: insight.category?.emoji ?? null,
    state: insight.suggestedState,
    priority: radarPriority(insight),
    title: narration.title,
    // Se nessuna battuta supera i controlli di JokeEvaluator, la scheda
    // resta informativa invece di forzare una frase mediocre: il brief
    // chiede esplicitamente che non tutte siano ironiche.
    message: message ?? narration.explanation,
    hasJoke: Boolean(message),
    messageScore: score,
    metric: narration.metric,
    comparison: narration.comparison,
    explanation: narration.explanation,
    advice: narration.advice,
    action: narration.action,
    insight,
  }
}

// Quante volte Spendy ha davvero visto l'utente spendere: sotto i cicli
// richiesti da BEHAVIOR_ENGINE_CONFIG non esiste una "media" con cui
// confrontare niente, e inventarla sarebbe il modo più rapido per
// perdere la fiducia dell'utente.
export function countCyclesWithData(expenses, today, cycleStartDay, config = BEHAVIOR_ENGINE_CONFIG) {
  const cycles = lastCycles(today, config.minimumHistoricalSamples + 1, cycleStartDay)
  return cycles.filter((range) => expenses.some((expense) => isWithinRange(expense.date, range))).length
}

const QUIET_MESSAGES = [
  'Ho controllato tutto. Per ora non vedo niente di preoccupante.',
  'Radar acceso, nessun allarme. Continua così.',
  'Ho guardato due volte: è tutto in ordine.',
  'Niente di strano nei tuoi conti. Quasi mi annoio.',
  'Nessuna anomalia. Ti terrò d’occhio lo stesso, per abitudine.',
  'Tutto tranquillo da questa parte. Il bello è proprio questo.',
]

export function pickQuietMessage(rng = Math.random) {
  return QUIET_MESSAGES[Math.floor(rng() * QUIET_MESSAGES.length)]
}

// L'unico punto d'ingresso: dati dentro, schede fuori.
export function buildRadar({
  expenses = [],
  goals = [],
  today,
  monthlyBudget = 0,
  cycleStartDay = 1,
  financialData = null,
  jokeHistory = [],
  lang = 'it',
  limit = RADAR_CARD_LIMIT,
  rng = Math.random,
  config = BEHAVIOR_ENGINE_CONFIG,
} = {}) {
  if (!today) return { status: RADAR_STATUS.LEARNING, cards: [], cyclesSeen: 0, cyclesNeeded: config.minimumHistoricalSamples }

  const cyclesSeen = countCyclesWithData(expenses, today, cycleStartDay, config)
  const ctx = { lang, jokeHistory, rng, cycleEndLabel: null }

  const hasHistory = cyclesSeen >= config.minimumHistoricalSamples
  const insights = rankInsightsByImportance(
    analyzeBehavior({ expenses, today, monthlyBudget, financialData, cycleStartDay, goals, config }),
  )
    .filter((insight) => !EXCLUDED_FROM_RADAR.has(insight.type))
    .filter((insight) => hasHistory || NO_HISTORY_NEEDED.has(insight.type))
    // Riordino con la gerarchia del Radar (vedi RADAR_PRIORITY_BOOST).
    // rankInsightsByImportance resta il punto di partenza: qui cambia
    // solo la posizione relativa dei pochi tipi che il brief mette
    // esplicitamente sopra gli altri.
    .sort((a, b) => radarPriority(b) - radarPriority(a))

  // Deduplica per ARGOMENTO, non per tipo: la stessa categoria può
  // far scattare spike + recurring_high + amount_above_average insieme,
  // e tre schede che dicono la stessa cosa con parole diverse sono
  // esattamente il "Radar come lista di spese" da evitare. Vince la
  // prima, cioe' quella con il punteggio di importanza più alto.
  const seen = new Set()
  const cards = []
  for (const raw of insights) {
    const insight = enrichBudgetInsight(raw, financialData, monthlyBudget)
    const key = getInsightTopicKey(insight)
    if (seen.has(key)) continue
    const card = buildRadarCard(insight, ctx)
    if (!card) continue
    seen.add(key)
    cards.push(card)
    if (cards.length >= limit) break
  }

  if (cards.length > 0) {
    return { status: RADAR_STATUS.ACTIVE, cards, cyclesSeen, cyclesNeeded: config.minimumHistoricalSamples }
  }

  // Nessuna scheda. Due motivi molto diversi, che meritano due schermate
  // diverse: "non c'è niente da segnalare" e "non ti conosco ancora
  // abbastanza per poterlo dire".
  const status = cyclesSeen < config.minimumHistoricalSamples ? RADAR_STATUS.LEARNING : RADAR_STATUS.QUIET
  return {
    status,
    cards: [],
    cyclesSeen,
    cyclesNeeded: config.minimumHistoricalSamples,
    quietMessage: status === RADAR_STATUS.QUIET ? pickQuietMessage(rng) : null,
  }
}
