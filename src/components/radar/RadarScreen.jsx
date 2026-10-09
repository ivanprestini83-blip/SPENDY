import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { buildFinancialData } from '../../utils/budgetCalculations.js'
import { currentCycleSalary } from '../../utils/salary.js'
import { buildRadar, RADAR_STATUS } from '../../utils/radarEngine.js'
import { SpendyCharacterWithMessage } from '../spendy/SpendyCharacterWithMessage.jsx'
import { RadarDetailModal } from '../modals/RadarDetailModal.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'
import './RadarScreen.css'

// RADAR SPENDY — la schermata. Non calcola niente: chiama buildRadar()
// (utils/radarEngine.js) e disegna quello che torna. Tutta la logica —
// quali insight esistono, quanto contano, che frase dire, che azione
// proporre — vive nei moduli puri, dove i test la raggiungono senza
// bisogno di un browser.
export function RadarScreen({ onClose }) {
  const { language, t } = useLanguage()
  const today = useAppStore((state) => state.today)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const incomes = useAppStore((state) => state.incomes)
  // Lo stipendio DEL CICLO IN CORSO (utils/salary.js): 0 finché in questo
  // ciclo non è stato inserito, mai quello del ciclo precedente.
  const monthlyBudget = currentCycleSalary(incomes, today, cycleStartDay)
  const goals = useAppStore((state) => state.goals)
  const jokeHistory = useAppStore((state) => state.spendyJokeHistory)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const openModal = useAppStore((state) => state.openModal)

  // Il dettaglio è uno stato LOCALE, non un modale dello store: lo store
  // tiene un solo modale per volta, quindi aprirlo da li' chiuderebbe il
  // Radar sotto. Così invece il dettaglio si apre sopra e chiudendolo si
  // torna esattamente alla lista dov'era.
  const [detail, setDetail] = useState(null)

  const financialData = buildFinancialData({ today, monthlyBudget, expenses, incomes, goals, cycleStartDay })
  const radar = buildRadar({
    expenses, goals, today, monthlyBudget, cycleStartDay, financialData, jokeHistory, lang: language,
  })

  const runAction = (card) => {
    const { action } = card
    if (!action) return
    if (action.kind === 'detail') {
      setDetail(card)
      return
    }
    if (action.kind === 'tab') {
      setActiveTab(action.target)
      onClose()
      return
    }
    if (action.kind === 'modal') openModal(action.target)
  }

  return (
    <div className="radar-screen">
      <div className="radar-screen__header">
        <button type="button" className="radar-screen__back" onClick={onClose} aria-label={t('common.close')}>
          ←
        </button>
        <div>
          <p className="radar-screen__title">{t('radarscreen.title')}</p>
          <p className="radar-screen__subtitle">{t('radarscreen.subtitle')}</p>
        </div>
      </div>

      <div className="radar-screen__body">
        {radar.status === RADAR_STATUS.ACTIVE && (
          <>
            <p className="radar-screen__count">
              {radar.cards.length === 1
                ? t('radarscreen.countone')
                : t('radarscreen.countmany', { count: radar.cards.length })}
            </p>

            {radar.cards.map((card) => (
              <article
                key={card.id}
                className={`radar-card radar-card--${card.tone}`}
              >
                <button
                  type="button"
                  className="radar-card__main"
                  onClick={() => setDetail(card)}
                  aria-label={t('radarscreen.detail', { title: card.title })}
                >
                  <div className="radar-card__head">
                    <span className="radar-card__dot" aria-hidden="true">{card.dot}</span>
                    <span className="radar-card__title">{card.title}</span>
                    {card.emoji && <span className="radar-card__emoji" aria-hidden="true">{card.emoji}</span>}
                  </div>

                  <p className="radar-card__message">{card.message}</p>

                  <div className="radar-card__metric">
                    <span className="radar-card__metric-value">{card.metric.value}</span>
                    <span className="radar-card__metric-label">{card.metric.label}</span>
                  </div>

                  {card.comparison && (
                    <p className={`radar-card__comparison radar-card__comparison--${card.comparison.direction}`}>
                      {card.comparison.text}
                    </p>
                  )}
                </button>

                <button type="button" className="radar-card__action" onClick={() => runAction(card)}>
                  {card.actionLabel}
                  <span aria-hidden="true"> →</span>
                </button>
              </article>
            ))}
          </>
        )}

        {radar.status === RADAR_STATUS.QUIET && (
          <div className="radar-screen__empty">
            <SpendyCharacterWithMessage state="happy" message={radar.quietMessage} size={120} />
            <p className="radar-screen__empty-text">{t('radarscreen.quiet')}</p>
          </div>
        )}

        {radar.status === RADAR_STATUS.LEARNING && (
          <div className="radar-screen__empty">
            <SpendyCharacterWithMessage
              state="attentive"
              message={t('radarscreen.learning')}
              size={120}
            />
            <p className="radar-screen__empty-text">
              {t('radarscreen.learningtext', {
                needed: radar.cyclesNeeded,
                seen: radar.cyclesSeen === 0 ? t('radarscreen.zero') : radar.cyclesSeen,
              })}
            </p>
            <p className="radar-screen__empty-note">{t('radarscreen.note')}</p>
          </div>
        )}
      </div>

      {detail && <RadarDetailModal card={detail} onClose={() => setDetail(null)} onAction={() => runAction(detail)} />}
    </div>
  )
}
