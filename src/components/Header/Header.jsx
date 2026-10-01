import { APP_TAGLINE } from '../../brand.js'
import { badgeText, bellLabel } from '../../notifications/notificationState.js'
import './Header.css'

// onOpenNotifications/onOpenSettings default to no-ops so Header renders
// standalone in isolation; App.jsx wires onOpenSettings to the real
// SettingsScreen, onOpenNotifications to the notification center.
// `unreadCount` is the number of unread notifications: the badge exists
// only when it is above zero.
export function Header({ onOpenNotifications = () => {}, onOpenSettings = () => {}, unreadCount = 0 }) {
  const badge = badgeText(unreadCount)
  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__logo">
          SPEND<span className="header__logo-accent">Y</span>
        </span>
        <span className="header__tagline">{APP_TAGLINE}</span>
      </div>

      <div className="header__actions">
        <button
          type="button"
          className="header__icon-button"
          aria-label={bellLabel(unreadCount)}
          onClick={onOpenNotifications}
        >
          <BellIcon />
          {badge && <span className="header__badge" aria-hidden="true">{badge}</span>}
        </button>
        <button
          type="button"
          className="header__icon-button"
          aria-label="Impostazioni"
          onClick={onOpenSettings}
        >
          <GearIcon />
        </button>
      </div>
    </header>
  )
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3.5c-3 0-5 2.2-5 5.3v2.4c0 .7-.3 1.7-.8 2.4L5 15.4c-.6.9-.2 2.1.9 2.3 3.9.8 8.3.8 12.2 0 1.1-.2 1.5-1.4.9-2.3l-1.2-1.8c-.5-.7-.8-1.7-.8-2.4V8.8c0-3.1-2.2-5.3-5-5.3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 18.5a2.5 2.5 0 0 0 5 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.8v2m0 12.4v2m8.2-8.2h-2M5.8 12h-2m12.6-5.8-1.4 1.4M9 15l-1.4 1.4M17.4 17.4 16 16M9 9 7.6 7.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
