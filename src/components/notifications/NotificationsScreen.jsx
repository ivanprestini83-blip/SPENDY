import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { formatRelativeTime, unreadCount } from '../../notifications/notificationState.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './NotificationsScreen.css'

// Le etichette sono in notificationcenter.types.<tipo>, nella lingua scelta.
const TYPE_META = {
  budget: { icon: '💰' },
  goal: { icon: '🎯' },
  radar: { icon: '📡' },
  sync: { icon: '☁️' },
  ai: { icon: '😈' },
}

// Il centro notifiche. Non calcola niente: legge la lista dallo store (che è
// già quella dell'ambito in uso) e ne disegna lo stato. Le azioni usano solo la
// navigazione che l'app ha già: setActiveTab e openModal.
export function NotificationsScreen({ onClose }) {
  const { t, language } = useLanguage()
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
    <div className="notifications-screen" role="dialog" aria-modal="true" aria-label={t('notificationcenter.screen.title')}>
      <div className="notifications-screen__header">
        <button ref={closeButton} type="button" className="notifications-screen__back" onClick={onClose} aria-label={t('common.close')}>
          ←
        </button>
        <h2 className="notifications-screen__title">{t('notificationcenter.screen.title')}</h2>
        <button type="button" className="notifications-screen__mark-all" disabled={unread === 0} onClick={markAllRead}>
          {t('notificationcenter.screen.markall')}
        </button>
      </div>

      <div className="notifications-screen__body">
        {notifications.length === 0 ? (
          <p className="notifications-screen__empty">{t('notificationcenter.screen.empty')}</p>
        ) : (
          <ul className="notifications-screen__list">
            {notifications.map((notification) => {
              const type = TYPE_META[notification.type] ? notification.type : 'ai'
              const meta = TYPE_META[type]
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
                          {!notification.read && <span className="notifications-screen__sr">{t('notificationcenter.screen.unread')}</span>}
                          {notification.title}
                        </span>
                        <span className="notifications-screen__time">{formatRelativeTime(notification.createdAt, now, language)}</span>
                      </span>
                      <span className="notifications-screen__message">{notification.message}</span>
                      <span className="notifications-screen__category">{t(`notificationcenter.types.${type}`)}</span>
                      {notification.action && (
                        <span className="notifications-screen__action">{notification.action.label} →</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="notifications-screen__delete"
                    aria-label={t('notificationcenter.screen.remove', { title: notification.title })}
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
