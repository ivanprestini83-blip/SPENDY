// NOTIFICHE — la parte di stato, pura (niente store, niente React).
//
// Una notifica è:
//   { id, eventKey, type, title, message, createdAt, read, action? }
//
// `id` coincide con `eventKey`: la stessa situazione ha sempre lo stesso
// identificatore, quindi non può esistere due volte.
//
// `notificationKeys` (eventKey → createdAt) è la memoria di tutto ciò che è
// già stato mostrato, anche se poi l'utente l'ha eliminato: è ciò che impedisce
// di ricreare una notifica già vista. Eliminare una notifica NON tocca le chiavi.
//
// Tutto questo vive nel contenitore dell'ambito (guest / account) insieme al
// resto dei dati, e non viene mai sincronizzato né esportato nei backup.

import { translate } from '../i18n/translate.js'

export const MAX_NOTIFICATIONS = 50
export const MAX_KEYS = 300

export const NOTIFICATION_TYPES = ['budget', 'goal', 'radar', 'sync', 'ai']

// Le uniche destinazioni che la navigazione dell'app offre davvero (vedi
// RADAR_ACTIONS in radarEngine.js e App.jsx): una notifica non può proporne altre.
export const ACTION_TABS = ['home', 'expenses', 'incomes', 'analytics', 'goals', 'spendy']
export const ACTION_MODALS = ['settings', 'radar']

const TITLE_MAX = 80
const MESSAGE_MAX = 240

const clip = (value, max) => {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function normalizeAction(action) {
  if (!action || typeof action !== 'object') return null
  const { kind, target } = action
  const valid = (kind === 'tab' && ACTION_TABS.includes(target)) || (kind === 'modal' && ACTION_MODALS.includes(target))
  if (!valid) return null
  return { kind, target, label: clip(action.label, 40) || 'Apri' }
}

// Una notifica valida o null. Un'azione non riconosciuta viene tolta: la
// notifica resta, senza pulsante, invece di proporre un'azione finta.
export function buildNotification(input, now = new Date()) {
  if (!input || typeof input !== 'object') return null
  const eventKey = typeof input.eventKey === 'string' ? input.eventKey.trim() : ''
  const title = clip(input.title, TITLE_MAX)
  const message = clip(input.message, MESSAGE_MAX)
  if (!eventKey || !title || !message || !NOTIFICATION_TYPES.includes(input.type)) return null
  const action = normalizeAction(input.action)
  return {
    id: eventKey,
    eventKey,
    type: input.type,
    title,
    message,
    createdAt: now.toISOString(),
    read: false,
    ...(action ? { action } : {}),
  }
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// Toglie il necessario per stare nel limite: prima le più vecchie GIÀ LETTE
// (la lista è dalla più recente alla più vecchia), solo se non ce ne sono
// più si arriva a scartare una non letta.
function trimNotifications(list) {
  const next = [...list]
  while (next.length > MAX_NOTIFICATIONS) {
    let index = -1
    for (let i = next.length - 1; i >= 0; i -= 1) {
      if (next[i].read) { index = i; break }
    }
    next.splice(index === -1 ? next.length - 1 : index, 1)
  }
  return next
}

function trimKeys(keys) {
  const entries = Object.entries(keys)
  if (entries.length <= MAX_KEYS) return keys
  entries.sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  return Object.fromEntries(entries.slice(entries.length - MAX_KEYS))
}

// Aggiunge una notifica. Restituisce la parte di stato da applicare, oppure
// null se non si deve fare niente (non valida, oppure già vista/eliminata).
export function addToState({ notifications, notificationKeys }, input, now = new Date()) {
  const notification = buildNotification(input, now)
  if (!notification) return null
  if (Object.hasOwn(notificationKeys, notification.eventKey)) return null
  return {
    notifications: trimNotifications([notification, ...notifications]),
    notificationKeys: trimKeys({ ...notificationKeys, [notification.eventKey]: notification.createdAt }),
  }
}

export function markReadInState(notifications, id) {
  if (!notifications.some((n) => n.id === id && !n.read)) return null
  return notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
}

export function markAllReadInState(notifications) {
  if (!notifications.some((n) => !n.read)) return null
  return notifications.map((n) => (n.read ? n : { ...n, read: true }))
}

// Le chiavi restano: una notifica eliminata non deve poter rinascere.
export function removeFromState(notifications, id) {
  if (!notifications.some((n) => n.id === id)) return null
  return notifications.filter((n) => n.id !== id)
}

// ------------------------------------------------------------------ badge

export const unreadCount = (notifications) =>
  Array.isArray(notifications) ? notifications.reduce((count, n) => count + (n.read ? 0 : 1), 0) : 0

// 0 → niente badge; 1-99 → il numero; da 100 → "99+".
export function badgeText(count) {
  if (!(count > 0)) return null
  return count >= 100 ? '99+' : String(count)
}

// `language` assente → italiano (translate ricade sempre sull'italiano).
export const bellLabel = (count, language) =>
  count > 0
    ? translate(language, 'home.header.notifications.unread', { count })
    : translate(language, 'home.header.notifications.none')

// ------------------------------------------------------------- dopo il caricamento

// Un contenitore salvato da una versione senza notifiche, o rovinato a mano,
// non deve mandare in crash l'app: si tiene solo ciò che è valido.
export function sanitizeNotificationState(rawNotifications, rawKeys) {
  const notifications = (Array.isArray(rawNotifications) ? rawNotifications : [])
    .filter((n) => isPlainObject(n) && typeof n.id === 'string' && typeof n.eventKey === 'string'
      && typeof n.title === 'string' && typeof n.message === 'string' && typeof n.createdAt === 'string'
      && NOTIFICATION_TYPES.includes(n.type))
    .map((n) => {
      const action = normalizeAction(n.action)
      const { action: _drop, ...rest } = n
      return { ...rest, read: n.read === true, ...(action ? { action } : {}) }
    })
  const keys = isPlainObject(rawKeys)
    ? Object.fromEntries(Object.entries(rawKeys).filter(([, value]) => typeof value === 'string'))
    : {}
  for (const n of notifications) if (!Object.hasOwn(keys, n.eventKey)) keys[n.eventKey] = n.createdAt
  return { notifications: trimNotifications(notifications), notificationKeys: trimKeys(keys) }
}

// ------------------------------------------------------------- tempo relativo

export function formatRelativeTime(iso, now = new Date()) {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const minutes = Math.floor((now - then) / 60000)
  if (minutes < 1) return 'adesso'
  if (minutes < 60) return `${minutes} min fa`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h fa`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'ieri'
  if (days < 7) return `${days} giorni fa`
  return then.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}
