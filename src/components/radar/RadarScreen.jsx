import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { buildFinancialData } from '../../utils/budgetCalculations.js'
import { buildRadar, RADAR_STATUS } from '../../utils/radarEngine.js'
import { SpendyCharacterWithMessage } from '../spendy/SpendyCharacterWithMessage.jsx'
import { RadarDetailModal } from '../modals/RadarDetailModal.jsx'
import './RadarScreen.css'

// RADAR SPENDY — la schermata. Non calcola niente: chiama buildRadar()
// (utils/radarEngine.js) e disegna quello che torna. Tutta la logica —
// quali insight esistono, quanto contano, che frase dire, che azione
// proporre — vive nei moduli puri, dove i test la raggiungono senza
// bisogno di un browser.
export function RadarScreen({ onClose }) {
  const today = useAppStore((state) => state.today)
  const monthlyBudget = useAppStore((state) => state.monthlyBudget)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const incomes = useAppStore((state) => state.incomes)
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
    expenses, goals, today, monthlyBudget, cycleStartDay, financialData, jokeHistory,
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
        <button type="button" className="radar-screen__back" onClick={onClose} aria-label="Chiudi">
          ←
        </button>
        <div>
          <p className="radar-screen__title">RADAR SPENDY</p>
          <p className="radar-screen__subtitle">Ho dato un&apos;occhiata ai tuoi soldi.</p>
        </div>
      </div>

      <div className="radar-screen__body">
        {radar.status === RADAR_STATUS.ACTIVE && (
          <>
            <p className="radar-screen__count">
              {radar.cards.length === 1
                ? 'Una cosa che ho notato:'
                : `${radar.cards.length} cose che ho notato:`}
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
                  aria-label={`Dettaglio: ${card.title}`}
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
                  {card.action.label}
                  <span aria-hidden="true"> →</span>
                </button>
              </article>
            ))}
          </>
        )}

        {radar.status === RADAR_STATUS.QUIET && (
          <div className="radar-screen__empty">
            <SpendyCharacterWithMessage state="happy" message={radar.quietMessage} size={120} />
            <p className="radar-screen__empty-text">
              Nessuna anomalia, nessuna categoria fuori controllo, nessun budget in bilico. Torna a
              trovarmi dopo qualche spesa.
            </p>
          </div>
        )}

        {radar.status === RADAR_STATUS.LEARNING && (
          <div className="radar-screen__empty">
            <SpendyCharacterWithMessage
              state="attentive"
              message="Sto ancora imparando le tue abitudini."
              size={120}
            />
            <p className="radar-screen__empty-text">
              Per dirti se una spesa è fuori dal normale devo prima sapere qual è il tuo
              normale. Mi servono circa {radar.cyclesNeeded} cicli di spese: finora ne ho{' '}
              {radar.cyclesSeen === 0 ? 'zero' : radar.cyclesSeen}. Continua a registrare le spese e
              inizio a ragionare.
            </p>
            <p className="radar-screen__empty-note">
              Nel frattempo non mi invento tendenze che non posso dimostrare.
            </p>
          </div>
        )}
      </div>

      {detail && <RadarDetailModal card={detail} onClose={() => setDetail(null)} onAction={() => runAction(detail)} />}
    </div>
  )
}
