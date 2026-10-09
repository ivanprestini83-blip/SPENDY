import { Modal } from './Modal.jsx'
import { SpendyCharacterWithMessage } from '../spendy/SpendyCharacterWithMessage.jsx'
import { formatCurrency } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './RadarDetailModal.css'

// Stesse soglie di sempre; il testo nella lingua scelta (t di useLanguage).
function spendyTake(changePercent, t) {
  if (changePercent < 25) {
    return { state: 'attentive', text: t('radarscreen.takemild') }
  }
  if (changePercent < 60) {
    return { state: 'attentive', text: t('radarscreen.takemedium') }
  }
  return { state: 'concerned', text: t('radarscreen.takestrong') }
}

// Due modi di aprire questo modale, non due modali diversi:
//
//  * con `card` — una scheda del Radar (vedi utils/radarEngine.js). È la
//    modalità completa: cosa ho notato, con quali dati, rispetto a cosa,
//    perché conta, cosa puoi farci.
//  * con `insight`/`previousLabel`/`currentLabel` — il confronto
//    mese-su-mese di una singola categoria, la forma che questo modale
//    aveva già. Resta viva perché è ancora la risposta giusta per chi ha
//    in mano solo una riga di categoryComparison.
export function RadarDetailModal({ card = null, insight = null, previousLabel, currentLabel, onClose, onAction = null }) {
  if (card) return <RadarCardDetail card={card} onClose={onClose} onAction={onAction} />
  return <CategoryDetail insight={insight} previousLabel={previousLabel} currentLabel={currentLabel} onClose={onClose} />
}

function RadarCardDetail({ card, onClose, onAction }) {
  const { t } = useLanguage()
  return (
    <Modal title={card.title} onClose={onClose}>
      <div className="radar-detail__spendy">
        <SpendyCharacterWithMessage state={card.state} message={card.message} size={72} />
      </div>

      <div className="radar-detail__headline">
        <p className="radar-detail__headline-value">{card.metric.value}</p>
        <p className="radar-detail__headline-label">{card.metric.label}</p>
      </div>

      {card.comparison && (
        <div className="radar-detail__section">
          <p className="radar-detail__section-title">{t('radarscreen.compare')}</p>
          <p className={`radar-detail__comparison radar-detail__comparison--${card.comparison.direction}`}>
            {card.comparison.text}
          </p>
          {card.comparison.baselineText && (
            <p className="radar-detail__section-text">{card.comparison.baselineText}</p>
          )}
        </div>
      )}

      <div className="radar-detail__section">
        <p className="radar-detail__section-title">{t('radarscreen.noticed')}</p>
        <p className="radar-detail__section-text">{card.explanation}</p>
      </div>

      <div className="radar-detail__section">
        <p className="radar-detail__section-title">{t('radarscreen.why')}</p>
        <p className="radar-detail__section-text">
          {/* La priorità non è un numero decorativo: è lo stesso punteggio
              con cui il Radar ha deciso di mettere questa scheda dove
              l'hai trovata, quindi mostrarlo spiega anche l'ordine. */}
          {/* Stessa lingua del consiglio che segue (Fase 4A). */}
          {t('radarcard.importance', { priority: card.priority })}
          {card.advice ? ` ${card.advice}` : ''}
        </p>
      </div>

      {card.action && onAction && (
        <button type="button" className="radar-detail__action" onClick={onAction}>
          {card.actionLabel}
          <span aria-hidden="true"> →</span>
        </button>
      )}
    </Modal>
  )
}

// `insight` è la stessa forma che topIncreasingCategory restituisce —
// Home e Radar condividono quel calcolo invece di derivarsi ciascuno la
// propria versione di "quale categoria, di quanto". `previousLabel`/
// `currentLabel` sono etichette brevi di ciclo (es. "Ago"/"27 Set") che
// il chiamante ha già da cycle.js, così questo modale non deve sapere
// niente di cycleStartDay.
function CategoryDetail({ insight, previousLabel, currentLabel, onClose }) {
  const { t } = useLanguage()
  const take = spendyTake(insight.changePercent, t)

  return (
    <Modal title={insight.category.label.toUpperCase()} onClose={onClose}>
      <div className="radar-detail__row">
        <div className="radar-detail__month">
          <p className="radar-detail__month-label">{previousLabel}</p>
          <p className="radar-detail__month-amount">{formatCurrency(insight.previous)}</p>
        </div>
        <span className="radar-detail__arrow">→</span>
        <div className="radar-detail__month">
          <p className="radar-detail__month-label">{currentLabel}</p>
          <p className="radar-detail__month-amount radar-detail__month-amount--current">
            {formatCurrency(insight.current)}
          </p>
        </div>
      </div>

      <p className="radar-detail__diff">
        +{formatCurrency(insight.changeAmount)} ({Math.round(insight.changePercent)}%)
      </p>

      <div className="radar-detail__spendy">
        <SpendyCharacterWithMessage state={take.state} message={take.text} size={64} />
      </div>
    </Modal>
  )
}
