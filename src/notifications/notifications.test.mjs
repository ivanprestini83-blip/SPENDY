// Centro notifiche: stato, regole, watcher, isolamento tra ambiti.
// `npm test`, senza browser e senza rete: lo store è quello vero (zustand +
// persist sul gestore degli ambiti), ogni "dispositivo" ha il suo localStorage
// finto, il tempo è iniettato.

import { check, section, report, italianDevice } from '../sync/testkit.mjs'
import { GUEST, scopeFor, stateKey } from '../store/scope.js'
import { lastCycles } from '../utils/cycle.js'
import { getSnapshot, buildBackup, serializeBackup } from '../sync/backup.js'
import {
  MAX_KEYS, MAX_NOTIFICATIONS, addToState, badgeText, bellLabel, buildNotification, formatRelativeTime,
  markAllReadInState, markReadInState, removeFromState, sanitizeNotificationState, unreadCount,
} from './notificationState.js'
import { NOTIFICATION_THRESHOLDS, aiNotification, evaluateLocalChange, staleOutboxNotifications } from './notificationRules.js'
import { startNotificationWatcher } from './notificationWatcher.js'

const A = 'utente-a-0001'
const B = 'utente-b-0002'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function installStorage(map) {
  const fake = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: fake, addEventListener: () => {}, removeEventListener: () => {} },
    configurable: true, writable: true,
  })
}
let boots = 0
async function bootDevice(map) {
  // Dispositivo di un utente italiano: i testi controllati sono quelli italiani.
  if (!map.has('spendy-language')) italianDevice(map)
  installStorage(map)
  const { useAppStore } = await import(`../store/useAppStore.js?notif-test=${(boots += 1)}`)
  return useAppStore
}

// Orologio e documento finti, con conteggio dei listener.
function createEnv(startAt = new Date()) {
  const env = { date: new Date(startAt), listeners: new Set(), visibility: 'visible' }
  env.now = () => new Date(env.date)
  env.advance = (ms) => { env.date = new Date(env.date.getTime() + ms) }
  env.doc = {
    get visibilityState() { return env.visibility },
    addEventListener: (type, fn) => { if (type === 'visibilitychange') env.listeners.add(fn) },
    removeEventListener: (type, fn) => { if (type === 'visibilitychange') env.listeners.delete(fn) },
  }
  env.show = () => [...env.listeners].forEach((fn) => fn())
  return env
}

const note = (key, extra = {}) => ({ type: 'budget', eventKey: key, title: 'Budget', message: 'Messaggio', ...extra })
const empty = () => ({ notifications: [], notificationKeys: {} })
const messages = (S) => S().notifications.map((n) => n.eventKey)

// =====================================================================
section('1. Stato: creazione, lettura, eliminazione, badge')
// =====================================================================
{
  const now = new Date('2026-10-01T10:00:00Z')
  const created = addToState(empty(), note('budget:near:2026-10-01', { action: { kind: 'tab', target: 'home', label: 'Vai alla Home' } }), now)
  const n = created.notifications[0]
  check('creazione: id = eventKey, non letta, con data', n.id === 'budget:near:2026-10-01' && n.eventKey === n.id && n.read === false && n.createdAt === now.toISOString())
  check('   la chiave è registrata', created.notificationKeys['budget:near:2026-10-01'] === now.toISOString())
  check('   nessun campo metadata', !('metadata' in n))
  check('input non valido (senza titolo / tipo sconosciuto / senza chiave) → null',
    buildNotification(note('k', { title: '' })) === null && buildNotification(note('k', { type: 'boh' })) === null && buildNotification(note('')) === null)
  check('azione non reale → notifica senza azione (niente azione finta)',
    !('action' in buildNotification(note('k', { action: { kind: 'tab', target: 'inventata', label: 'x' } }))) && !('action' in buildNotification(note('k2', { action: { kind: 'url', target: 'http://x' } }))))

  const dup = addToState(created, note('budget:near:2026-10-01'), now)
  check('deduplicazione: stessa eventKey → rifiutata', dup === null)

  const read = markReadInState(created.notifications, n.id)
  check('lettura: la notifica diventa letta', read[0].read === true && unreadCount(read) === 0)
  check('   già letta → nessuna modifica (null)', markReadInState(read, n.id) === null)

  let list = addToState(created, note('b'), now)
  list = addToState(list, note('c'), now)
  const all = markAllReadInState(list.notifications)
  check('segna tutte come lette', unreadCount(list.notifications) === 3 && unreadCount(all) === 0)
  check('   nessuna non letta → null', markAllReadInState(all) === null)

  const removed = removeFromState(list.notifications, 'b')
  check('eliminazione: la notifica sparisce', removed.length === 2 && !removed.some((x) => x.id === 'b'))
  check('   le chiavi RESTANO (non può rinascere)', 'b' in list.notificationKeys && addToState({ notifications: removed, notificationKeys: list.notificationKeys }, note('b'), now) === null)

  check('badge: 0 → nessun badge', badgeText(0) === null && badgeText(-1) === null)
  check('   1-99 → numero', badgeText(1) === '1' && badgeText(99) === '99')
  check('   da 100 → "99+"', badgeText(100) === '99+' && badgeText(250) === '99+')
  check('   aria-label', bellLabel(3, 'it') === 'Notifiche, 3 non lette' && bellLabel(0, 'it') === 'Notifiche, nessuna nuova notifica')
  check('stato vuoto: unreadCount([]) = 0, nessuna notifica', unreadCount([]) === 0 && unreadCount(undefined) === 0)

  check('tempo relativo', formatRelativeTime(now.toISOString(), now) === 'adesso'
    && formatRelativeTime(new Date(now - 5 * 60000).toISOString(), now) === '5 min fa'
    && formatRelativeTime(new Date(now - 3 * 3600000).toISOString(), now) === '3 h fa'
    && formatRelativeTime(new Date(now - 30 * 3600000).toISOString(), now) === 'ieri')
}

// =====================================================================
section('2. Limiti: 50 notifiche, 300 chiavi')
// =====================================================================
{
  let s = empty()
  for (let i = 0; i < MAX_NOTIFICATIONS; i += 1) s = addToState(s, note(`k${i}`), new Date(2026, 0, 1, 0, i))
  s = { ...s, notifications: s.notifications.map((n, i) => (i === 10 || i === 20 ? { ...n, read: true } : n)) }
  const oldestRead = s.notifications[20].id
  const next = addToState(s, note('nuova'), new Date(2026, 0, 2))
  check('oltre 50: resta il limite', next.notifications.length === MAX_NOTIFICATIONS)
  check('   si scarta prima la più vecchia GIÀ LETTA', !next.notifications.some((n) => n.id === oldestRead) && next.notifications.some((n) => n.id === s.notifications[10].id))
  check('   le non lette restano tutte (finché c\'è una letta da scartare)', unreadCount(next.notifications) === MAX_NOTIFICATIONS - 2 + 1)

  let keys = {}
  for (let i = 0; i < MAX_KEYS + 25; i += 1) keys = addToState({ notifications: [], notificationKeys: keys }, note(`c${i}`), new Date(2026, 0, 1, 0, 0, i)).notificationKeys
  check('chiavi: massimo 300', Object.keys(keys).length === MAX_KEYS)
  check('   si tolgono le più vecchie', !('c0' in keys) && `c${MAX_KEYS + 24}` in keys)
}

// =====================================================================
section('3. Ambiti: guest / A / B, cambio ambito, persistenza, refresh')
// =====================================================================
{
  const map = new Map()
  const store = await bootDevice(map)
  const S = store.getState
  check('guest all\'avvio: nessuna notifica', S().scopeId === GUEST && S().notifications.length === 0)

  check('addNotification nell\'ambito attivo', S().addNotification(GUEST, note('guest:1', { title: 'Del guest' })) === true)
  S().switchScope(scopeFor(A))
  check('cambio ambito → A parte vuoto (il guest non si vede)', S().notifications.length === 0 && unreadCount(S().notifications) === 0)
  S().addNotification(scopeFor(A), note('a:1', { title: 'Di A' }))
  S().addNotification(scopeFor(A), note('a:2', { title: 'Di A 2' }))
  check('A ha le sue 2', messages(S).join() === 'a:2,a:1' && unreadCount(S().notifications) === 2)

  S().switchScope(GUEST)
  check('logout → guest: vede solo le sue (e non quelle di A)', messages(S).join() === 'guest:1')
  S().switchScope(scopeFor(B))
  check('B entra: nessuna notifica di A né del guest, badge 0', S().notifications.length === 0 && unreadCount(S().notifications) === 0 && Object.keys(S().notificationKeys).length === 0)
  S().addNotification(scopeFor(B), note('b:1'))
  S().switchScope(scopeFor(A))
  check('A rientra: ritrova le sue, niente di B', messages(S).join() === 'a:2,a:1' && !messages(S).includes('b:1'))
  check('   le chiavi di A non contengono quelle di B', !('b:1' in S().notificationKeys) && 'a:1' in S().notificationKeys)

  check('contenitore di A: solo notifiche di A', map.get(stateKey(scopeFor(A))).includes('a:1') && !map.get(stateKey(scopeFor(A))).includes('b:1'))
  check('contenitore di B: solo notifiche di B', map.get(stateKey(scopeFor(B))).includes('b:1') && !map.get(stateKey(scopeFor(B))).includes('a:1'))
  check('contenitore guest: solo le sue', map.get(stateKey(GUEST)).includes('guest:1') && !map.get(stateKey(GUEST)).includes('a:1'))

  // evento tardivo: generato quando era attivo A, arriva quando c'è B
  S().markNotificationRead('a:1')
  S().switchScope(scopeFor(B))
  const accepted = S().addNotification(scopeFor(A), note('a:tardiva', { title: 'Tardiva di A' }))
  check('evento tardivo di A mentre è attivo B → rifiutato', accepted === false && !messages(S).includes('a:tardiva') && !('a:tardiva' in S().notificationKeys))
  check('   e non finisce nel contenitore di B', !map.get(stateKey(scopeFor(B))).includes('a:tardiva'))
  check('   né nello stato in memoria dopo il rientro di A', (S().switchScope(scopeFor(A)), !messages(S).includes('a:tardiva')))

  // persistenza + refresh
  S().markNotificationRead('a:2')
  S().deleteNotification('a:1')
  const refreshed = await bootDevice(map) // "ricarica la pagina"
  check('persistenza: dopo il riavvio A ha ancora lo stato (a:2 letta, a:1 eliminata)', refreshed.getState().scopeId === scopeFor(A)
    && messages(refreshed.getState).join() === 'a:2' && refreshed.getState().notifications[0].read === true)
  check('refresh: la notifica eliminata non rinasce (chiave ricordata)', refreshed.getState().addNotification(scopeFor(A), note('a:1')) === false && messages(refreshed.getState).join() === 'a:2')
  check('refresh: la stessa notifica non si duplica', refreshed.getState().addNotification(scopeFor(A), note('a:2')) === false && refreshed.getState().notifications.length === 1)

  // contenitore vecchio o rovinato
  const dirty = new Map()
  dirty.set(stateKey(GUEST), JSON.stringify({ state: { notifications: 'boh', notificationKeys: [1, 2] }, version: 0 }))
  const s2 = (await bootDevice(dirty)).getState()
  check('contenitore con notifiche non valide: nessun crash, lista vuota', Array.isArray(s2.notifications) && s2.notifications.length === 0 && typeof s2.notificationKeys === 'object')
  const clean = sanitizeNotificationState([{ id: 'x', eventKey: 'x', type: 'budget', title: 't', message: 'm', createdAt: '2026-01-01T00:00:00.000Z', read: 'si', action: { kind: 'tab', target: 'inventata' } }, { nope: 1 }], null)
  check('sanitize: scarta le righe non valide, azione finta tolta, read normalizzato', clean.notifications.length === 1 && clean.notifications[0].read === false && !('action' in clean.notifications[0]) && 'x' in clean.notificationKeys)

  // backup: le notifiche non sono dati finanziari
  S().addNotification(scopeFor(A), note('backup:1', { title: 'NOTIFICA-NEL-BACKUP' }))
  const snapshot = getSnapshot(S())
  check('backup: lo snapshot non contiene le notifiche né le chiavi', !('notifications' in snapshot) && !('notificationKeys' in snapshot))
  check('   il file di backup non le contiene', !serializeBackup(buildBackup(S())).includes('NOTIFICA-NEL-BACKUP') && !serializeBackup(buildBackup(S())).includes('notification'))
  check('le notifiche non entrano nella coda di invio', !S().sync.outbox.some((op) => /notif/i.test(op.collection)))
}

// =====================================================================
section('4. Regole: budget')
// =====================================================================
async function freshAccount(scope = scopeFor(A)) {
  const store = await bootDevice(new Map())
  const env = createEnv()
  store.getState().switchScope(scope)
  await tick() // fine del cambio ambito
  const stop = startNotificationWatcher(store, { now: env.now, doc: env.doc })
  return { store, S: store.getState, env, stop }
}

{
  const { S, stop } = await freshAccount()
  S().addSalary({ amount: 1000 })
  S().addExpense({ amount: 850, categoryId: 'spesa', description: 'x' })
  check('85% → niente', S().notifications.length === 0)
  S().addExpense({ amount: 60, categoryId: 'spesa', description: 'x' })
  check('90% → "Attenzione: hai utilizzato il 90% del budget."', S().notifications.length === 1 && S().notifications[0].message === 'Attenzione: hai utilizzato il 90% del budget.' && S().notifications[0].type === 'budget')
  check('   eventKey budget:near:<inizio ciclo>', /^budget:near:\d{4}-\d{2}-\d{2}$/.test(S().notifications[0].eventKey))
  check('   azione: tab Home', S().notifications[0].action?.kind === 'tab' && S().notifications[0].action.target === 'home')
  S().addExpense({ amount: 5, categoryId: 'spesa', description: 'x' })
  check('ancora sopra il 90%: nessuna nuova notifica', S().notifications.length === 1)
  S().addExpense({ amount: 100, categoryId: 'spesa', description: 'x' })
  check('100% → "Budget mensile superato."', S().notifications.length === 2 && S().notifications[0].message === 'Budget mensile superato.' && /^budget:over:/.test(S().notifications[0].eventKey))
  S().addExpense({ amount: 300, categoryId: 'spesa', description: 'x' })
  check('già superato: niente di nuovo, non si ripete', S().notifications.length === 2)
  stop()
}
{
  const { S, stop } = await freshAccount()
  S().addSalary({ amount: 1000 })
  S().addExpense({ amount: 100, categoryId: 'spesa', description: 'x' })
  S().addExpense({ amount: 1000, categoryId: 'spesa', description: 'x' })
  check('salto diretto da sotto il 90% a oltre il 100% → SOLO "superato"', S().notifications.length === 1 && /^budget:over:/.test(S().notifications[0].eventKey))
  check('   la notifica 90% non nasce dopo', (S().addExpense({ amount: 1, categoryId: 'spesa', description: 'x' }), S().notifications.length === 1))
  stop()
}
{
  check('soglie separate da BEHAVIOR_ENGINE_CONFIG (che non ha 90/100)', NOTIFICATION_THRESHOLDS.budgetNear === 90 && NOTIFICATION_THRESHOLDS.budgetOver === 100)
}

// =====================================================================
section('5. Regole: obiettivi')
// =====================================================================
{
  const { S, stop } = await freshAccount()
  S().addGoal({ emoji: '🎯', label: 'Vacanza', target: 1000, etaMonths: 6 })
  const id = S().goals[0].id
  S().contributeToGoal(id, 400)
  check('40% → niente', S().notifications.length === 0)
  S().contributeToGoal(id, 150)
  check('55% → "Sei arrivato al 50% del tuo obiettivo."', S().notifications.length === 1 && S().notifications[0].message === 'Sei arrivato al 50% del tuo obiettivo.' && S().notifications[0].eventKey === `goal:${id}:50`)
  check('   titolo = nome obiettivo, azione = tab Obiettivi', S().notifications[0].title === 'Vacanza' && S().notifications[0].action?.kind === 'tab' && S().notifications[0].action.target === 'goals')
  S().contributeToGoal(id, 10)
  check('ancora sopra il 50%: niente di nuovo', S().notifications.length === 1)
  S().contributeToGoal(id, 500)
  check('100% → "Obiettivo raggiunto."', S().notifications.length === 2 && S().notifications[0].message === 'Obiettivo raggiunto.' && S().notifications[0].eventKey === `goal:${id}:100`)

  S().addGoal({ emoji: '🎯', label: 'Auto', target: 1000, etaMonths: 6 })
  const id2 = S().goals.find((g) => g.label === 'Auto').id
  S().contributeToGoal(id2, 1000)
  const mine = S().notifications.filter((n) => n.eventKey.startsWith(`goal:${id2}`))
  check('salto diretto da sotto il 50% al 100% → SOLO "raggiunto"', mine.length === 1 && mine[0].eventKey === `goal:${id2}:100`)

  S().addGoal({ emoji: '🎯', label: 'Nuovo', target: 1000, etaMonths: 6, saved: 700 })
  check('obiettivo creato già oltre il 50% → nessuna notifica', !S().notifications.some((n) => n.title === 'Nuovo'))
  stop()
}

// =====================================================================
section('6. Regole: Radar')
// =====================================================================
function radarHistory(S, category) {
  const ranges = lastCycles(S().today, 4, S().cycleStartDay ?? 1)
  ;[55, 60, 50].forEach((amount, i) => S().addExpense({ amount, categoryId: category, description: 'storico', date: ranges[i].start }))
}
{
  const { S, env, stop } = await freshAccount()
  radarHistory(S, 'ristoranti')
  radarHistory(S, 'spesa')
  const before = S().notifications.length
  check('storico regolare: nessuna notifica Radar', before === 0, JSON.stringify(messages(S)))
  S().addExpense({ amount: 400, categoryId: 'ristoranti', description: 'cena' })
  const radar = S().notifications.filter((n) => n.type === 'radar')
  check('picco di una categoria (priorità alta) → una notifica Radar', radar.length === 1, JSON.stringify(messages(S)))
  check('   eventKey radar:<argomento>:<ciclo>, azione = modale Radar', /^radar:.+:\d{4}-\d{2}-\d{2}$/.test(radar[0]?.eventKey ?? '') && radar[0]?.action?.kind === 'modal' && radar[0]?.action?.target === 'radar')
  check('   nessun dato finanziario dettagliato nel testo (niente importi in €)', !/€/.test(radar[0]?.message ?? ''))
  S().addExpense({ amount: 450, categoryId: 'spesa', description: 'spesone' })
  check('limite: massimo UNA notifica Radar al giorno', S().notifications.filter((n) => n.type === 'radar').length === 1)
  S().addExpense({ amount: 20, categoryId: 'ristoranti', description: 'altra' })
  check('ancora lo stesso argomento: nessuna notifica nuova', S().notifications.filter((n) => n.type === 'radar').length === 1)
  void env
  stop()
}
{
  // Un'unica spesa normale non genera Radar; un evento "non importante" non fa niente.
  const { S, stop } = await freshAccount()
  radarHistory(S, 'ristoranti')
  S().addExpense({ amount: 12, categoryId: 'ristoranti', description: 'caffè' })
  check('spesa normale: nessuna notifica', S().notifications.length === 0)
  for (let i = 0; i < 5; i += 1) S().addExpense({ amount: 8, categoryId: 'bar', description: 'x' })
  check('una spesa dopo l\'altra: NIENTE notifica per ogni transazione', S().notifications.length === 0)
  stop()
}

// =====================================================================
section('7. Dati remoti, caricamento account, sincronizzazione')
// =====================================================================
{
  const { S, stop } = await freshAccount()
  S().addSalary({ amount: 1000 })
  const remote = Array.from({ length: 3 }, (_, i) => ({ id: `r-${i}`, date: S().today, amount: 500, categoryId: 'spesa', description: 'dal cloud', updatedAt: new Date().toISOString() }))
  S().applyRemote('expenses', remote)
  check('dati arrivati dal cloud che superano il budget → nessuna notifica', S().notifications.length === 0 && S().expenses.length === 3)
  S().applyRemoteSettings({ monthly_budget: 100, currency: '€', cycle_start_day: null, updated_at: new Date().toISOString() })
  check('impostazioni dal cloud → nessuna notifica', S().notifications.length === 0)
  stop()
}
{
  // Caricare un account che ha già dati oltre soglia non genera niente.
  const map = new Map()
  const first = await bootDevice(map)
  first.getState().switchScope(scopeFor(A))
  first.getState().addSalary({ amount: 1000 })
  first.getState().addExpense({ amount: 1500, categoryId: 'spesa', description: 'x' })
  first.getState().addGoal({ emoji: '🎯', label: 'G', target: 100, etaMonths: 1, saved: 100 })
  check('(preparazione) A senza watcher: nessuna notifica', first.getState().notifications.length === 0)

  const store = await bootDevice(map) // riapertura dell'app
  const env = createEnv()
  const stop = startNotificationWatcher(store, { now: env.now, doc: env.doc })
  const S = store.getState
  check('apertura app con A già oltre soglia: nessuna notifica', S().scopeId === scopeFor(A) && S().notifications.length === 0)
  S().switchScope(GUEST); await tick()
  S().switchScope(scopeFor(B)); await tick()
  S().switchScope(scopeFor(A)); await tick()
  check('guest → B → A (caricamento dei contenitori): nessuna notifica', S().notifications.length === 0 && S().expenses.length === 1)
  const { S: S2 } = { S }
  S2().addExpense({ amount: 1, categoryId: 'spesa', description: 'y' })
  check('una spesa locale dopo il caricamento, già oltre soglia: nessuna notifica', S2().notifications.length === 0)
  stop()
}
{
  const { S, env, stop } = await freshAccount()
  S().setSyncStatus({ status: 'syncing' })
  S().setSyncStatus({ status: 'synced', lastSyncAt: new Date().toISOString() })
  check('sincronizzazione riuscita → nessuna notifica', S().notifications.length === 0)
  S().setSyncStatus({ status: 'offline' })
  check('semplice offline → nessuna notifica', S().notifications.length === 0)
  S().setSyncStatus({ status: 'syncing' })
  S().setSyncStatus({ status: 'error', error: 'JWT expired: segreto' })
  check('errore di sync → una notifica', S().notifications.length === 1 && S().notifications[0].type === 'sync' && /^sync:error:\d{4}-\d{2}-\d{2}$/.test(S().notifications[0].eventKey))
  check('   azione: Impostazioni; il testo dell\'errore NON viene salvato', S().notifications[0].action?.target === 'settings' && !JSON.stringify(S().notifications[0]).includes('segreto'))
  S().setSyncStatus({ status: 'syncing' })
  S().setSyncStatus({ status: 'error', error: 'ancora' })
  check('stesso giorno, nuovo errore → nessun duplicato', S().notifications.length === 1)
  env.advance(26 * 3600 * 1000)
  S().setSyncStatus({ status: 'syncing' })
  S().setSyncStatus({ status: 'error', error: 'domani' })
  check('giorno dopo, nuovo errore → nuova notifica', S().notifications.length === 2)
  stop()
}
{
  const { S, env, stop } = await freshAccount()
  S().addExpense({ amount: 5, categoryId: 'spesa', description: 'in coda' })
  check('operazione appena accodata → niente', S().notifications.length === 0)
  env.advance(25 * 3600 * 1000)
  env.show() // l'app torna in primo piano
  const stale = S().notifications.filter((n) => n.eventKey.startsWith('sync:stale:'))
  check('coda ferma da più di 24 ore → una notifica', stale.length === 1 && stale[0].type === 'sync' && stale[0].action?.target === 'settings')
  env.show(); env.show()
  check('altri ritorni in primo piano → nessun duplicato', S().notifications.filter((n) => n.eventKey.startsWith('sync:stale:')).length === 1)
  env.visibility = 'hidden'; env.advance(48 * 3600 * 1000)
  S().addExpense({ amount: 6, categoryId: 'spesa', description: 'altra' })
  env.show()
  check('app in background: la rivalutazione non parte', S().notifications.filter((n) => n.eventKey.startsWith('sync:stale:')).length === 1)
  stop()
}
{
  // Senza account non c'è niente da inviare: nessun avviso.
  const store = await bootDevice(new Map())
  const env = createEnv()
  const stop = startNotificationWatcher(store, { now: env.now, doc: env.doc })
  store.getState().addExpense({ amount: 5, categoryId: 'spesa', description: 'guest' })
  env.advance(30 * 3600 * 1000); env.show()
  check('guest con coda vecchia → nessun avviso di sincronizzazione', store.getState().notifications.length === 0)
  check('regola pura: ambito guest → nessun candidato', staleOutboxNotifications({ scopeId: GUEST, sync: { userId: null, outbox: [{ updatedAt: '2020-01-01T00:00:00.000Z' }] } }, new Date()).length === 0)
  stop()
}

// =====================================================================
section('8. AI / Spendy')
// =====================================================================
{
  const meta = { eventKey: 'budget_exceeded', importance: 90 }
  const ok = { ok: true, response: { shouldShow: true, message: 'Hai sforato, ma si rimedia.' } }
  const c = aiNotification({ result: ok, meta, today: '2026-10-01' })
  check('risposta con shouldShow e evento urgente → notifica', c?.type === 'ai' && c.eventKey === 'ai:budget_exceeded:2026-10-01' && c.message === 'Hai sforato, ma si rimedia.' && c.action.target === 'spendy')
  check('shouldShow false → niente', aiNotification({ result: { ok: true, response: { shouldShow: false, message: 'x' } }, meta, today: 'd' }) === null)
  check('evento non urgente → niente', aiNotification({ result: ok, meta: { eventKey: 'k', importance: 40 }, today: 'd' }) === null)
  check('chiamata fallita → niente', aiNotification({ result: { ok: false, error: 'network' }, meta, today: 'd' }) === null)
  check('senza eventKey → niente', aiNotification({ result: ok, meta: { importance: 99 }, today: 'd' }) === null)

  const store = await bootDevice(new Map())
  const S = store.getState
  S().switchScope(scopeFor(A))
  const request = scopeFor(A) // la richiesta parte in A…
  S().switchScope(scopeFor(B)) // …e prima della risposta entra B
  check('risposta AI tardiva (richiesta in A, attivo B) → NON crea notifica in B', S().addNotification(request, c) === false && S().notifications.length === 0)
  S().switchScope(scopeFor(A))
  check('   e non l\'ha creata nemmeno in A', S().notifications.length === 0)
  check('risposta AI con ambito invariato → creata, una volta sola', S().addNotification(scopeFor(A), c) === true && S().addNotification(scopeFor(A), c) === false && S().notifications.length === 1)
}

// =====================================================================
section('9. Watcher: un solo listener, pulizia, niente timer')
// =====================================================================
{
  const store = await bootDevice(new Map())
  const env = createEnv()
  let active = 0
  const spy = { getState: store.getState, subscribe: (fn) => { active += 1; const off = store.subscribe(fn); return () => { active -= 1; off() } } }
  const stopA = startNotificationWatcher(spy, { now: env.now, doc: env.doc })
  const stopB = startNotificationWatcher(spy, { now: env.now, doc: env.doc }) // es. StrictMode
  check('avviato due volte → un solo store.subscribe attivo e un solo listener visibilitychange', active === 1 && env.listeners.size === 1)
  stopB()
  check('stop → nessun listener resta', active === 0 && env.listeners.size === 0)
  stopA()
  check('stop ripetuto non rompe niente', active === 0)

  const timers = []
  const realSetInterval = globalThis.setInterval
  globalThis.setInterval = (...args) => { timers.push(args); return realSetInterval(...args) }
  const stop = startNotificationWatcher(store, { now: env.now, doc: env.doc })
  store.getState().addExpense({ amount: 1, categoryId: 'spesa', description: 'x' })
  globalThis.setInterval = realSetInterval
  check('nessun setInterval (niente polling)', timers.length === 0)
  stop()
}
{
  // Nessuna notifica generata per semplice rendering/lettura/cambio di scheda.
  const { S, stop } = await freshAccount()
  S().setActiveTab('expenses'); S().openModal('settings'); S().closeModal(); S().refreshToday(); S().toggleAmountHidden()
  check('navigazione, modali, refresh della data, preferenze → nessuna notifica', S().notifications.length === 0)
  const prev = { ...S() }
  check('regola pura: nessun cambiamento locale → nessun candidato', evaluateLocalChange(prev, prev).length === 0)
  stop()
}

report('Centro notifiche')
