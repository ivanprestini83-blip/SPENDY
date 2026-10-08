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
import { currentCycleSalary } from '../utils/salary.js'
import { buildRadar, RADAR_ACTIONS } from '../utils/radarEngine.js'
import { getInsightTopicKey } from '../utils/spendyCoach.js'
import { BEHAVIOR_TYPES } from '../utils/behaviorEngine.js'
import { VOICE_LIMITS } from '../ai/spendyVoicePolicy.js'
import { isUserScope } from '../store/scope.js'
import { translate } from '../i18n/translate.js'

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
//
// Una notifica si salva come testo nel momento in cui nasce: titolo, messaggio
// ed etichetta dell'azione sono nella lingua scelta in QUEL momento
// (`state.language`; assente → italiano). Le notifiche già salvate non si
// riscrivono mai.
const ACTIONS = {
  home: { kind: 'tab', target: 'home', labelKey: 'notifications.action.home' },
  goals: { kind: RADAR_ACTIONS.GOALS.kind, target: RADAR_ACTIONS.GOALS.target, labelKey: RADAR_ACTIONS.GOALS.labelKey },
  radar: { kind: 'modal', target: 'radar', labelKey: 'notifications.action.radar' },
  settings: { kind: 'modal', target: 'settings', labelKey: 'notifications.action.settings' },
  spendy: { kind: 'tab', target: 'spendy', labelKey: 'notifications.action.spendy' },
}
const actionIn = (name, lang) => ({ kind: ACTIONS[name].kind, target: ACTIONS[name].target, label: translate(lang, ACTIONS[name].labelKey) })
const textIn = (lang) => (key, params) => translate(lang, `notifications.${key}`, params)

// ------------------------------------------------------------------ utilità

// Giorno locale 'YYYY-MM-DD' di una data.
export function dayOf(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const cycleStartOf = (state) => getCycleRange(state.today, state.cycleStartDay ?? 1).start

// Lo stipendio del ciclo in corso (utils/salary.js), non monthlyBudget: senza
// uno stipendio registrato in questo ciclo non c'è un budget da superare.
const cycleSalaryOf = (state) => currentCycleSalary(state.incomes, state.today, state.cycleStartDay ?? 1)

const spentRatioOf = (state) => {
  const monthlyBudget = cycleSalaryOf(state)
  if (!(monthlyBudget > 0)) return 0
  return buildFinancialData({
    today: state.today,
    monthlyBudget,
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
  if (!(cycleSalaryOf(next) > 0)) return []
  const before = spentRatioOf(prev)
  const after = spentRatioOf(next)
  const { budgetNear, budgetOver } = NOTIFICATION_THRESHOLDS
  const cycle = cycleStartOf(next)
  const t = textIn(next.language)

  // Da sotto il 90% a oltre il 100% in un colpo solo: solo "superato".
  if (before < budgetOver && after >= budgetOver) {
    return [{ type: 'budget', eventKey: `budget:over:${cycle}`, title: t('budget.title'), message: t('budget.over'), action: actionIn('home', next.language) }]
  }
  if (before < budgetNear && after >= budgetNear && after < budgetOver) {
    return [{ type: 'budget', eventKey: `budget:near:${cycle}`, title: t('budget.title'), message: t('budget.near'), action: actionIn('home', next.language) }]
  }
  return []
}

// ----------------------------------------------------------------- obiettivi

const percentOf = (goal) => (goal.target > 0 ? (goal.saved / goal.target) * 100 : 0)

export function goalNotifications(prev, next) {
  const { goalHalf, goalDone } = NOTIFICATION_THRESHOLDS
  const before = new Map(prev.goals.map((goal) => [goal.id, goal]))
  const t = textIn(next.language)
  const out = []
  for (const goal of next.goals) {
    const old = before.get(goal.id)
    if (!old) continue // obiettivo nuovo: non è un traguardo raggiunto
    const from = percentOf(old)
    const to = percentOf(goal)
    const title = goal.label || t('goal.fallback')
    if (from < goalDone && to >= goalDone) {
      out.push({ type: 'goal', eventKey: `goal:${goal.id}:100`, title, message: t('goal.done'), action: actionIn('goals', next.language) })
    } else if (from < goalHalf && to >= goalHalf && to < goalDone) {
      out.push({ type: 'goal', eventKey: `goal:${goal.id}:50`, title, message: t('goal.half'), action: actionIn('goals', next.language) })
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
  const monthlyBudget = cycleSalaryOf(state)
  const financialData = buildFinancialData({
    today: state.today, monthlyBudget, expenses: state.expenses,
    incomes: state.incomes, goals: state.goals, cycleStartDay,
  })
  const radar = buildRadar({
    expenses: state.expenses, goals: state.goals, today: state.today, monthlyBudget,
    cycleStartDay, financialData, jokeHistory: [], rng: () => 0, lang: state.language,
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
  const t = textIn(next.language)
  const label = card.insight?.category?.label ?? t('radar.category')
  const detail = card.comparison?.text ?? t('radar.detail')
  return [{
    type: 'radar',
    eventKey: `radar:${topic}:${cycleStartOf(next)}`,
    title: t('radar.title'),
    message: t('radar.message', { category: label, detail }),
    action: actionIn('radar', next.language),
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
    title: textIn(next.language)('sync.title'),
    message: textIn(next.language)('sync.error'),
    action: actionIn('settings', next.language),
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
    title: textIn(state.language)('sync.title'),
    message: textIn(state.language)('sync.stale'),
    action: actionIn('settings', state.language),
  }]
}

// ----------------------------------------------------------------------- AI

// Solo una risposta che l'AI ha deciso di mostrare E per un evento urgente
// (stessa soglia con cui la policy di Spendy AI decide che serve fare presto).
export function aiNotification({ result, meta, today, lang }) {
  const response = result?.ok ? result.response : null
  if (!response || response.shouldShow !== true) return null
  if (!meta?.eventKey || !(meta.importance >= VOICE_LIMITS.urgentImportance)) return null
  if (typeof response.message !== 'string' || !response.message.trim()) return null
  return { type: 'ai', eventKey: `ai:${meta.eventKey}:${today}`, title: 'Spendy', message: response.message, action: actionIn('spendy', lang) }
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
