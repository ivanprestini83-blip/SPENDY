import { RADAR_STATUS } from '../../utils/radarEngine.js'
import { BEHAVIOR_TYPES } from '../../utils/behaviorEngine.js'
import { formatCurrency, formatSignedPercent } from '../../utils/format.js'
import { goalsProgress } from '../../utils/goalProgress.js'
import { goalIcon } from '../../utils/goalIcon.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './RadarPreview.css'

const PREVIEW_LIMIT = 3
// Quanti colori d'accento si alternano fra gli obiettivi (RadarPreview.css).
const GOAL_ACCENTS = 4

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
//
// Gli obiettivi invece li mostra TUTTI, dallo store (`goals`): la scheda
// "obiettivo" del Radar ne racconta uno solo (il più vicino al traguardo,
// scelto dal BehaviorEngine), quindi qui la sua tessera lascia il posto
// alla lista completa. RadarScreen e il motore restano come sono.
export function RadarPreview({ radar, goals = [], onOpen = () => {}, onOpenGoals = onOpen }) {
  const { t, language, currency } = useLanguage()
  const money = (value) => formatCurrency(value, language, currency)
  const goalRows = goalsProgress(goals)
  const tileCards = goalRows.length > 0 ? radar.cards.filter((card) => card.type !== BEHAVIOR_TYPES.GOAL_PROGRESS) : radar.cards
  const cards = radar.status === RADAR_STATUS.ACTIVE ? tileCards.slice(0, PREVIEW_LIMIT) : []
  const goalTitle = tileTitle({ title: goalRows.length > 1 ? t('home.nav.goals') : t('radarcard.title.goal') })
  // Senza tessere il messaggio segue lo storico, non lo stato del Radar: se
  // l'unica scheda era quella dell'obiettivo (che non richiede storico), il
  // Radar è ACTIVE ma ancora in apprendimento, e "niente da segnalare"
  // sarebbe falso.
  const stillLearning = radar.status === RADAR_STATUS.LEARNING
    || (radar.status === RADAR_STATUS.ACTIVE && radar.cyclesSeen < radar.cyclesNeeded)

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
          {stillLearning
            ? t('radar.preview.learning', { seen: radar.cyclesSeen, needed: radar.cyclesNeeded })
            : `✅ ${radar.quietMessage ?? t('radar.preview.quiet')}`}
        </button>
      )}

      {/* UNA sola tessera, quella dell'obiettivo del Radar, ma con dentro
          tutti gli obiettivi affiancati: percentuale e sotto il nome. Ne
          stanno tre; dal quarto in poi la fila scorre dentro la tessera. */}
      {goalRows.length > 0 && (
        <div
          role="button"
          tabIndex={0}
          className="radar-preview__tile radar-preview__tile--goal radar-preview__goals-tile"
          onClick={onOpenGoals}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpenGoals()
            }
          }}
        >
          <span className="radar-preview__tile-badge" aria-hidden="true">🎯</span>
          <span className="radar-preview__tile-title">{goalTitle}</span>
          <span
            className={`radar-preview__goal-list radar-preview__goal-list--${goalRows.length > 3 ? 'many' : goalRows.length}`}
            role="list"
            aria-label={t('radar.preview.goals')}
          >
            {goalRows.map((goal, index) => (
              <span
                key={goal.id ?? index}
                role="listitem"
                className={`radar-preview__goal-item radar-preview__goal-item--accent-${index % GOAL_ACCENTS}${goal.completed ? ' radar-preview__goal-item--done' : ''}`}
              >
                {/* Dal nome dell'obiettivo ("Casa" → 🏠), se non ne ha già una sua. */}
                <span className="radar-preview__goal-icon" aria-hidden="true">{goalIcon(goal)}</span>
                <span className="radar-preview__tile-value">{goal.percent}%</span>
                <span className="radar-preview__tile-label radar-preview__goal-name">{goal.label}</span>
                {/* Gli importi veri dello store, con i centesimi (format.js):
                    possono andare a capo, mai essere tagliati. */}
                <span className="radar-preview__goal-amounts">
                  <span className="radar-preview__goal-saved">{money(goal.saved)}</span> / {money(goal.target)}
                </span>
                <span
                  className="radar-preview__goal-bar"
                  role="progressbar"
                  aria-label={goal.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={goal.percent}
                >
                  <span className="radar-preview__goal-bar-fill" style={{ width: `${goal.percent}%` }} />
                </span>
              </span>
            ))}
          </span>
        </div>
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
