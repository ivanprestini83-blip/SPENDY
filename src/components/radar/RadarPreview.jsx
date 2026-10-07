import { RADAR_STATUS } from '../../utils/radarEngine.js'
import { formatSignedPercent } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './RadarPreview.css'

const PREVIEW_LIMIT = 3

// "Rispetto al solito" only makes sense when the insight really is a
// comparison with the user's own average; everything else (budget,
// goal, small expenses...) shows the card's own headline metric instead.
function tileFigures(card, t) {
  const change = card.insight?.changePercent
  if (card.insight?.category && Number.isFinite(change)) {
    return { value: formatSignedPercent(change), label: t('radar.preview.usual') }
  }
  return { value: card.metric.value, label: card.metric.label }
}

function tileTitle(card) {
  return card.insight?.category?.label ?? card.title.charAt(0) + card.title.slice(1).toLowerCase()
}

// Home teaser of Radar Spendy. Renders whatever buildRadar() returned —
// the same cards, same order, same tones as RadarScreen — just the top
// few, compressed to one figure each. Nothing is computed here.
export function RadarPreview({ radar, onOpen = () => {} }) {
  const { t } = useLanguage()
  const cards = radar.status === RADAR_STATUS.ACTIVE ? radar.cards.slice(0, PREVIEW_LIMIT) : []

  return (
    <section className="radar-preview">
      <div className="radar-preview__head">
        <span className="radar-preview__icon" aria-hidden="true">
          <RadarIcon />
        </span>
        <h2 className="radar-preview__title">{t('radar.preview.title')}</h2>
        <button type="button" className="radar-preview__all" onClick={onOpen}>
          {radar.status === RADAR_STATUS.ACTIVE && radar.cards.length > PREVIEW_LIMIT
            ? t('radar.preview.allcount', { count: radar.cards.length })
            : t('radar.preview.all')}
          <span aria-hidden="true"> →</span>
        </button>
      </div>

      {cards.length > 0 ? (
        <div className={`radar-preview__tiles radar-preview__tiles--${cards.length}`}>
          {cards.map((card) => {
            const { value, label } = tileFigures(card, t)
            return (
              <button
                key={card.id}
                type="button"
                className={`radar-preview__tile radar-preview__tile--${card.tone}`}
                onClick={onOpen}
              >
                <span className="radar-preview__tile-badge" aria-hidden="true">
                  {card.emoji ?? card.dot}
                </span>
                <span className="radar-preview__tile-title">{tileTitle(card)}</span>
                <span className="radar-preview__tile-value">{value}</span>
                <span className="radar-preview__tile-label">{label}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <button type="button" className="radar-preview__empty" onClick={onOpen}>
          {radar.status === RADAR_STATUS.LEARNING
            ? t('radar.preview.learning', { seen: radar.cyclesSeen, needed: radar.cyclesNeeded })
            : `✅ ${radar.quietMessage ?? t('radar.preview.quiet')}`}
        </button>
      )}
    </section>
  )
}

function RadarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" opacity="0.6" />
      <path d="M12 12l6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}
