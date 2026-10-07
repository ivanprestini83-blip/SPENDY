import { useLanguage } from '../../i18n/useLanguage.js'
import './BottomNavigation.css'

// `items` mirrors mockNavItems' shape: { id, emoji, label, isAction?,
// isPrimary? }. Every item — including the "+" — sits inline in the
// SAME row as Home/Analisi/Obiettivi/Spendy; `isPrimary` only changes
// its visual weight (bigger green circle, no label, see
// BottomNavigation.css), not its position in the flex flow. It's a
// plain "+" glyph, not `item.emoji`, so its contrast against the green
// circle is guaranteed regardless of how a platform renders ➕.
// `labelKey`, quando c'è, è la chiave i18n dell'etichetta; senza ("Spendy",
// il nome della mascotte) resta `label`.
export function BottomNavigation({ items, activeId, onSelect = () => {}, onAction = () => {} }) {
  const { t } = useLanguage()
  const labelOf = (item) => (item.labelKey ? t(item.labelKey) : item.label)
  return (
    <nav className="bottom-nav">
      {items.map((item) => {
        const isActive = item.id === activeId
        return (
          <button
            key={item.id}
            type="button"
            className={[
              'bottom-nav__item',
              isActive && 'bottom-nav__item--active',
              item.isPrimary && 'bottom-nav__item--primary',
            ].filter(Boolean).join(' ')}
            onClick={() => (item.isAction ? onAction(item.id) : onSelect(item.id))}
            aria-current={isActive ? 'page' : undefined}
            aria-label={item.isPrimary ? labelOf(item) : undefined}
          >
            {item.isPrimary ? (
              <span className="bottom-nav__plus" aria-hidden="true">+</span>
            ) : (
              <>
                <span className="bottom-nav__icon" aria-hidden="true">{item.emoji}</span>
                <span className="bottom-nav__label">{labelOf(item)}</span>
              </>
            )}
          </button>
        )
      })}
    </nav>
  )
}
