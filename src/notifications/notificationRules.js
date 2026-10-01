// NOTIFICHE — le regole. Pure: ricevono lo stato di PRIMA e di DOPO un
// cambiamento e restituiscono solo le notifiche candidate che quel
// cambiamento ha generato. Niente store, niente tempo letto da sé (`now` si
// passa), niente effetti.
//
// Una notifica nasce dal PASSAGGIO di una soglia (sotto → sopra) e non dal
// fatto di essere sopra: così una situazione già esistente non genera niente
// al caricamento di un account, e la stessa soglia non si segnala due volte
// (a questo pensano le chiavi, vedi notificationState.js).
//
// Soglie: BEHAVIOR_ENGINE_CONFIG non ha 90/100 sul budget (il coach usa 70 e
// 85), e non si cambiano i motori per le notifiche: sono costanti di questo file.

import { buildFinancialData } from '../utils/budgetCalculations.js'
import { getCycleRange } from '../utils/cycle.js'
import { buildRadar, RADAR_ACTIONS } from '../utils/radarEngine.js'
import { getInsightTopicKey } from '../utils/spendyCoach.js'
import { BEHAVIOR_TYPES } from '../utils/behaviorEngine.js'
import { VOICE_LIMITS } from '../ai/spendyVoicePolicy.js'
import { isUserScope } from '../store/scope.js'

export const NOTIFICATION_THRESHOLDS = {
  budgetNear: 90,
  budgetOver: 100,
  goalHalf: 50,
  goalDone: 100,
  radarMinPriority: 70,
  staleOutboxHours: 24,
}

// Le destinazioni sono quelle già in uso nell'app: stesse forme di RADAR_ACTIONS
// (kind tab/modal + target), eseguite da setActiveTab / openModal.
const action = (a) => ({ kind: a.kind, target: a.target, label: a.label })
const ACTIONS = {
  home: { kind: 'tab', target: 'home', label: 'Vai alla Home' },
  goals: action(RADAR_ACTIONS.GOALS),
  radar: { kind: 'modal', target: 'radar', label: 'Apri il Radar' },
  settings: { kind: 'modal', target: 'settings', label: 'Apri Impostazioni' },
  spendy: { kind: 'tab', target: 'spendy', label: 'Apri Spendy' },
}

// ------------------------------------------------------------------ utilità

// Giorno locale 'YYYY-MM-DD' di una data.
export function dayOf(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const cycleStartOf = (state) => getCycleRange(state.today, state.cycleStartDay ?? 1).start

const spentRatioOf = (state) => {
  if (!(state.monthlyBudget > 0)) return 0
  return buildFinancialData({
    today: state.today,
    monthlyBudget: state.monthlyBudget,
    expenses: state.expenses,
    incomes: state.incomes,
    goals: state.goals,
    cycleStartDay: state.cycleStartDay ?? 1,
  }).spentRatio
}

// Un'azione dell'utente su questo dispositivo mette SEMPRE qualcosa in coda
// (ogni mutazione passa da withOp, vedi useAppStore). I dati che arrivano dal
// cloud (applyRemote*) e la lettura di un contenitore non toccano la coda,
// e la conferma di un invio la accorcia: nessuno dei due è "locale".
export function isLocalChange(prev, next) {
  const before = prev.sync.outbox
  const after = next.sync.outbox
  return after !== before && after.length >= before.length
}

// ------------------------------------------------------------------- budget

export function budgetNotifications(prev, next) {
  if (!(next.monthlyBudget > 0)) return []
  const before = spentRatioOf(prev)
  const after = spentRatioOf(next)
  const { budgetNear, budgetOver } = NOTIFICATION_THRESHOLDS
  const cycle = cycleStartOf(next)

  // Da sotto il 90% a oltre il 100% in un colpo solo: solo "superato".
  if (before < budgetOver && after >= budgetOver) {
    return [{ type: 'budget', eventKey: `budget:over:${cycle}`, title: 'Budget', message: 'Budget mensile superato.', action: ACTIONS.home }]
  }
  if (before < budgetNear && after >= budgetNear && after < budgetOver) {
    return [{ type: 'budget', eventKey: `budget:near:${cycle}`, title: 'Budget', message: 'Attenzione: hai utilizzato il 90% del budget.', action: ACTIONS.home }]
  }
  return []
}

// ----------------------------------------------------------------- obiettivi

const percentOf = (goal) => (goal.target > 0 ? (goal.saved / goal.target) * 100 : 0)

export function goalNotifications(prev, next) {
  const { goalHalf, goalDone } = NOTIFICATION_THRESHOLDS
  const before = new Map(prev.goals.map((goal) => [goal.id, goal]))
  const out = []
  for (const goal of next.goals) {
    const old = before.get(goal.id)
    if (!old) continue // obiettivo nuovo: non è un traguardo raggiunto
    const from = percentOf(old)
    const to = percentOf(goal)
    const title = goal.label || 'Obiettivo'
    if (from < goalDone && to >= goalDone) {
      out.push({ type: 'goal', eventKey: `goal:${goal.id}:100`, title, message: 'Obiettivo raggiunto.', action: ACTIONS.goals })
    } else if (from < goalHalf && to >= goalHalf && to < goalDone) {
      out.push({ type: 'goal', eventKey: `goal:${goal.id}:50`, title, message: 'Sei arrivato al 50% del tuo obiettivo.', action: ACTIONS.goals })
    }
  }
  return out
}

// -------------------------------------------------------------------- radar

// Budget e obiettivi hanno già la loro categoria: il Radar non li ripete.
const NOT_FOR_RADAR_NOTIFICATIONS = new Set([
  BEHAVIOR_TYPES.BUDGET_EXCEEDED,
  BEHAVIOR_TYPES.BUDGET_HIGH,
  BEHAVIOR_TYPES.BUDGET_RISING,
  BEHAVIOR_TYPES.BUDGET_RESPECTED,
  BEHAVIOR_TYPES.GOAL_PROGRESS,
])

// Schede del Radar abbastanza importanti da meritare una notifica, per argomento.
function importantRadarCards(state) {
  if (!state.today) return new Map()
  const cycleStartDay = state.cycleStartDay ?? 1
  const financialData = buildFinancialData({
    today: state.today, monthlyBudget: state.monthlyBudget, expenses: state.expenses,
    incomes: state.incomes, goals: state.goals, cycleStartDay,
  })
  const radar = buildRadar({
    expenses: state.expenses, goals: state.goals, today: state.today, monthlyBudget: state.monthlyBudget,
    cycleStartDay, financialData, jokeHistory: [], rng: () => 0,
  })
  const cards = new Map()
  for (const card of radar.cards) {
    if (NOT_FOR_RADAR_NOTIFICATIONS.has(card.type)) continue
    if (card.tone !== 'critical' && card.tone !== 'warning') continue
    if (card.priority < NOTIFICATION_THRESHOLDS.radarMinPriority) continue
    cards.set(getInsightTopicKey(card.insight), card)
  }
  return cards
}

// Al massimo una notifica Radar al giorno (giorno locale di `now`).
const radarAlreadyToday = (keys, now) =>
  Object.entries(keys).some(([key, createdAt]) => key.startsWith('radar:') && dayOf(createdAt) === dayOf(now))

export function radarNotifications(prev, next, now = new Date()) {
  if (prev.expenses === next.expenses) return [] // il Radar dipende dalle spese
  if (radarAlreadyToday(next.notificationKeys, now)) return []
  const known = importantRadarCards(prev)
  const fresh = [...importantRadarCards(next)].filter(([topic]) => !known.has(topic))
  if (fresh.length === 0) return []
  fresh.sort((a, b) => b[1].priority - a[1].priority)
  const [topic, card] = fresh[0]
  const label = card.insight?.category?.label ?? 'Le tue spese'
  const detail = card.comparison?.text ?? 'qualcosa è cambiato rispetto al solito'
  return [{
    type: 'radar',
    eventKey: `radar:${topic}:${cycleStartOf(next)}`,
    title: 'Radar Spendy',
    message: `${label}: ${detail}.`,
    action: ACTIONS.radar,
  }]
}

// ----------------------------------------------------------- sincronizzazione

const hasAccount = (state) => isUserScope(state.scopeId) && Boolean(state.sync?.userId)

// Errore: SOLO il passaggio a 'error'. Il testo dell'errore non si salva.
export function syncErrorNotifications(prev, next, now = new Date()) {
  if (!hasAccount(next)) return []
  if (prev.sync.status === 'error' || next.sync.status !== 'error') return []
  return [{
    type: 'sync',
    eventKey: `sync:error:${dayOf(now)}`,
    title: 'Sincronizzazione',
    message: 'Non siamo riusciti a sincronizzare i tuoi dati. Riproveremo da soli.',
    action: ACTIONS.settings,
  }]
}

// Un'operazione in coda da troppo tempo. Senza account non c'è niente da inviare.
export function staleOutboxNotifications(state, now = new Date()) {
  if (!hasAccount(state)) return []
  const limit = NOTIFICATION_THRESHOLDS.staleOutboxHours * 3600 * 1000
  let oldest = null
  for (const op of state.sync.outbox) {
    const at = Date.parse(op.updatedAt)
    if (Number.isNaN(at)) continue
    if (!oldest || at < oldest.at) oldest = { at, updatedAt: op.updatedAt }
  }
  if (!oldest || now.getTime() - oldest.at <= limit) return []
  return [{
    type: 'sync',
    eventKey: `sync:stale:${oldest.updatedAt}`,
    title: 'Sincronizzazione',
    message: 'Alcune modifiche non sono ancora state inviate al cloud da più di 24 ore.',
    action: ACTIONS.settings,
  }]
}

// ----------------------------------------------------------------------- AI

// Solo una risposta che l'AI ha deciso di mostrare E per un evento urgente
// (stessa soglia con cui la policy di Spendy AI decide che serve fare presto).
export function aiNotification({ result, meta, today }) {
  const response = result?.ok ? result.response : null
  if (!response || response.shouldShow !== true) return null
  if (!meta?.eventKey || !(meta.importance >= VOICE_LIMITS.urgentImportance)) return null
  if (typeof response.message !== 'string' || !response.message.trim()) return null
  return { type: 'ai', eventKey: `ai:${meta.eventKey}:${today}`, title: 'Spendy', message: response.message, action: ACTIONS.spendy }
}

// ------------------------------------------------------------ punti d'ingresso

// Cambiamento locale (spesa, entrata, versamento, impostazioni...).
export function evaluateLocalChange(prev, next, now = new Date()) {
  if (!isLocalChange(prev, next)) return []
  return [...budgetNotifications(prev, next), ...goalNotifications(prev, next), ...radarNotifications(prev, next, now)]
}

// Cambiamento dello stato di sincronizzazione.
export function evaluateSyncChange(prev, next, now = new Date()) {
  return [...syncErrorNotifications(prev, next, now), ...staleOutboxNotifications(next, now)]
}

// Rivalutazione senza cambiamenti (app tornata in primo piano): solo la coda.
export const evaluateStale = staleOutboxNotifications
