import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { formatRelativeTime, unreadCount } from '../../notifications/notificationState.js'
import './NotificationsScreen.css'

const TYPE_META = {
  budget: { icon: '💰', label: 'Budget' },
  goal: { icon: '🎯', label: 'Obiettivo' },
  radar: { icon: '📡', label: 'Radar' },
  sync: { icon: '☁️', label: 'Sincronizzazione' },
  ai: { icon: '😈', label: 'Spendy' },
}

// Il centro notifiche. Non calcola niente: legge la lista dallo store (che è
// già quella dell'ambito in uso) e ne disegna lo stato. Le azioni usano solo la
// navigazione che l'app ha già: setActiveTab e openModal.
export function NotificationsScreen({ onClose }) {
  const notifications = useAppStore((state) => state.notifications)
  const markRead = useAppStore((state) => state.markNotificationRead)
  const markAllRead = useAppStore((state) => state.markAllNotificationsRead)
  const remove = useAppStore((state) => state.deleteNotification)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const openModal = useAppStore((state) => state.openModal)
  const closeButton = useRef(null)
  const unread = unreadCount(notifications)
  const now = new Date()

  useEffect(() => {
    closeButton.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const open = (notification) => {
    markRead(notification.id)
    const { action } = notification
    if (!action) return
    if (action.kind === 'tab') {
      setActiveTab(action.target)
      onClose()
    } else if (action.kind === 'modal') {
      // Lo store tiene un solo modale per volta: aprire quello nuovo chiude questo.
      openModal(action.target)
    }
  }

  return (
    <div className="notifications-screen" role="dialog" aria-modal="true" aria-label="Notifiche">
      <div className="notifications-screen__header">
        <button ref={closeButton} type="button" className="notifications-screen__back" onClick={onClose} aria-label="Chiudi">
          ←
        </button>
        <h2 className="notifications-screen__title">Notifiche</h2>
        <button type="button" className="notifications-screen__mark-all" disabled={unread === 0} onClick={markAllRead}>
          Segna tutte come lette
        </button>
      </div>

      <div className="notifications-screen__body">
        {notifications.length === 0 ? (
          <p className="notifications-screen__empty">Non ci sono nuove notifiche.</p>
        ) : (
          <ul className="notifications-screen__list">
            {notifications.map((notification) => {
              const meta = TYPE_META[notification.type] ?? TYPE_META.ai
              return (
                <li
                  key={notification.id}
                  className={`notifications-screen__item${notification.read ? '' : ' notifications-screen__item--unread'}`}
                >
                  <button type="button" className="notifications-screen__main" onClick={() => open(notification)}>
                    <span className="notifications-screen__icon" aria-hidden="true">{meta.icon}</span>
                    <span className="notifications-screen__text">
                      <span className="notifications-screen__row">
                        {!notification.read && <span className="notifications-screen__dot" aria-hidden="true" />}
                        <span className="notifications-screen__item-title">
                          {!notification.read && <span className="notifications-screen__sr">Non letta. </span>}
                          {notification.title}
                        </span>
                        <span className="notifications-screen__time">{formatRelativeTime(notification.createdAt, now)}</span>
                      </span>
                      <span className="notifications-screen__message">{notification.message}</span>
                      <span className="notifications-screen__category">{meta.label}</span>
                      {notification.action && (
                        <span className="notifications-screen__action">{notification.action.label} →</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="notifications-screen__delete"
                    aria-label={`Elimina la notifica: ${notification.title}`}
                    onClick={() => remove(notification.id)}
                  >
                    ✕
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
