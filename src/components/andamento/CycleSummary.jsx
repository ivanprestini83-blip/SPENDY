import { formatCurrency } from '../../utils/format.js'
import { NOTIFICATION_THRESHOLDS } from '../../notifications/notificationRules.js'
import { ProgressBar } from '../ProgressBar/ProgressBar.jsx'
import { spendyStates } from '../spendy/spendyStates.js'
import { formatPercent } from './andamentoFormat.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './CycleSummary.css'

// Stesse soglie della barra del budget in Home (BudgetCard, 70% e 90%):
// verde finché c'è margine, oro quando si stringe, coral nell'ultimo 10%.
function budgetColor(budgetUsed) {
  if (budgetUsed >= 90) return 'var(--color-accent-coral)'
  if (budgetUsed >= 70) return 'var(--color-accent-gold)'
  return 'var(--color-accent-mint)'
}

// La sintesi in cima, come la conclusione di "Confronta periodi": solo stati
// che l'app ha già, nessuna regola nuova. Le condizioni si sovrappongono, quindi
// conta l'ordine, dalla più specifica:
//   1. risparmio negativo (uscite oltre le entrate: la nota che il riquadro
//      Risparmio mostra già);
//   2. nessuno stipendio nel ciclo (budget utilizzato = null);
//   3. budget ≥ 100% (la soglia "superato" delle notifiche);
//   4. ≥ 90% e 5. ≥ 70% (le soglie della barra, budgetColor);
//   6. altrimenti, tutto sotto controllo.
// Con un budget, la frase dice quanto è stato usato e quanto resta: il
// "resta" è il risparmio del ciclo (entrate − spese), lo stesso del riquadro.
function overviewOf(cycle, t) {
  if (cycle.savings < 0) {
    return { tone: 'bad', title: t('andamento.overview.overspent'), text: t('andamento.overview.overspenttext', { amount: formatCurrency(Math.abs(cycle.savings)) }) }
  }
  if (cycle.budgetUsed === null) {
    return { tone: 'flat', title: t('andamento.overview.nosalary'), text: t('andamento.overview.spenttext', { amount: formatCurrency(cycle.spent) }) }
  }
  const used = t(cycle.isCurrent ? 'andamento.overview.usedleft' : 'andamento.overview.usedleftdone', { percent: formatPercent(cycle.budgetUsed), amount: formatCurrency(cycle.savings) })
  if (cycle.budgetUsed >= NOTIFICATION_THRESHOLDS.budgetOver) return { tone: 'bad', title: t('andamento.overview.over'), text: used }
  if (cycle.budgetUsed >= 90) return { tone: 'bad', title: t('andamento.overview.near'), text: used }
  if (cycle.budgetUsed >= 70) return { tone: 'warn', title: t('andamento.overview.tight'), text: used }
  return { tone: 'good', title: t('andamento.overview.ok'), text: used }
}

// Spendy accanto alla sintesi, con l'espressione del suo tono (le stesse
// immagini della Home, components/spendy/spendyStates.js).
const MASCOT_BY_TONE = { good: 'happy', warn: 'attentive', bad: 'concerned', flat: 'advisor' }

// "Ritmo di spesa": la stessa regola del messaggio del budget in Home
// (BudgetCard.getStatusKey: sotto il 70% in linea, sotto il 95% vicino al
// limite, poi al limite). Solo per il ciclo in corso e solo con uno stipendio.
function paceOf(budgetUsed) {
  if (budgetUsed < 70) return 'ok'
  if (budgetUsed < 95) return 'near'
  return 'over'
}

// I tracciati delle icone (stile a linea, come le icone delle schede).
const ICONS = {
  spent: 'M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Zm0 0 2-3h10l2 3M15 13h2',
  income: 'M12 4v16M8 8l4-4 4 4M5 20h14',
  savings: 'M5 12a7 5 0 0 1 14 0v3a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-3Zm4-5V5m6 2V5M9 13h.01M15 13h.01',
  calendar: 'M5 6h14v13H5zM5 10h14M9 4v4M15 4v4M9 14h2M13 14h2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2',
}

function Icon({ name }) {
  return <svg className="cycle-summary__icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>
}

function Stat({ kind, tone, label, value, note }) {
  return (
    <div className={`cycle-summary__metric cycle-summary__metric--${kind}${tone ? ` cycle-summary__metric--${tone}` : ''}`}>
      <span className="cycle-summary__metric-head">
        <span className="cycle-summary__metric-icon"><Icon name={kind} /></span>
        <span className="cycle-summary__metric-label">{label}</span>
      </span>
      <span className="cycle-summary__metric-value">{value}</span>
      {note && <span className="cycle-summary__metric-note">{note}</span>}
    </div>
  )
}

// "Come sto andando" di UN ciclo: il periodo (scelto dal menu o toccando una
// colonna del grafico), Spendy con la sintesi, le tre cifre, il budget usato e
// — per il ciclo in corso — giorni trascorsi e ritmo di spesa. Riceve cicli già
// calcolati da buildAndamento e i giorni da getCycleTiming: non fa conti suoi.
export function CycleSummary({ cycle, cycles = [cycle], onSelect = () => {}, timing = null }) {
  const { t } = useLanguage()
  const inRed = cycle.savings < 0
  const overview = overviewOf(cycle, t)
  // Prudenza: i giorni solo se sono davvero quelli di questo ciclo.
  const showDays = Boolean(cycle.isCurrent && timing && timing.start === cycle.range?.start)
  const pace = cycle.isCurrent && cycle.budgetUsed !== null ? paceOf(cycle.budgetUsed) : null
  const daysPercent = showDays ? Math.round((timing.dayOfCycle / timing.cycleDays) * 100) : 0
  const daysLeft = !showDays ? null
    : timing.daysRemaining === 0 ? t('andamento.overview.lastday')
      : t(timing.daysRemaining === 1 ? 'andamento.overview.leftone' : 'andamento.overview.leftmany', { count: timing.daysRemaining })

  return (
    <section className={`cycle-summary cycle-summary--${overview.tone}`} aria-live="polite">
      <div className="cycle-summary__head">
        <div className="cycle-summary__heading">
          <p className="cycle-summary__title">{t('andamento.tab.overview')}</p>
          {cycle.isCurrent
            ? <span className="cycle-summary__badge cycle-summary__badge--current"><span aria-hidden="true">● </span>{t('andamento.status.current')}</span>
            : <span className="cycle-summary__badge cycle-summary__badge--done"><span aria-hidden="true">✓ </span>{t('andamento.status.done')}</span>}
        </div>
        {/* Il periodo da analizzare: un menu nativo, comodo col pollice. */}
        <select
          className="cycle-summary__picker"
          value={cycle.key}
          onChange={(event) => onSelect(event.target.value)}
          aria-label={t('andamento.summary.period')}
        >
          {[...cycles].reverse().map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className={`cycle-summary__overview cycle-summary__overview--${overview.tone}`} role="group" aria-label={t('andamento.overview.label')}>
        <span className="cycle-summary__mascot" aria-hidden="true">
          <img src={spendyStates[MASCOT_BY_TONE[overview.tone]]} alt="" />
        </span>
        <div className="cycle-summary__bubble">
          <p className="cycle-summary__overview-title">{overview.title}</p>
          <p className="cycle-summary__overview-text">{overview.text}</p>
        </div>
      </div>

      <div className="cycle-summary__grid">
        <Stat
          kind="spent"
          label={t('andamento.metric.spent')}
          value={formatCurrency(cycle.spent)}
          note={t(cycle.expenseCount === 1 ? 'andamento.expensesone' : 'andamento.expensesmany', { count: cycle.expenseCount })}
        />
        <Stat
          kind="income"
          label={t('andamento.metric.income')}
          value={formatCurrency(cycle.income)}
          note={cycle.extraIncome > 0 ? t('andamento.summary.extra', { amount: formatCurrency(cycle.extraIncome) }) : null}
        />
        <Stat
          kind="savings"
          tone={inRed ? 'bad' : 'good'}
          label={t('andamento.metric.savings')}
          value={inRed ? `-${formatCurrency(Math.abs(cycle.savings))}` : formatCurrency(cycle.savings)}
          note={inRed ? t('andamento.summary.overspent') : null}
        />
      </div>

      <div className="cycle-summary__budget">
        <span className="cycle-summary__budget-label">{t('andamento.metric.budget')}</span>
        <div className="cycle-summary__budget-row">
          {cycle.budgetUsed !== null
            ? <ProgressBar value={cycle.budgetUsed} colorValue={budgetColor(cycle.budgetUsed)} trackClassName="cycle-summary__progress" />
            : <span className="cycle-summary__budget-note">{t('andamento.summary.nosalary')}</span>}
          <span className="cycle-summary__percent">{formatPercent(cycle.budgetUsed)}</span>
        </div>
      </div>

      {(showDays || pace) && (
        <div className="cycle-summary__footer">
          {showDays && (
            <div className="cycle-summary__fact">
              <span className="cycle-summary__fact-icon"><Icon name="calendar" /></span>
              <span className="cycle-summary__fact-body">
                <span className="cycle-summary__fact-label">{t('andamento.days.label')}</span>
                <span className="cycle-summary__days">{t('andamento.overview.day', { day: timing.dayOfCycle, total: timing.cycleDays })}</span>
                <span className="cycle-summary__days-bar" aria-hidden="true"><span style={{ width: `${daysPercent}%` }} /></span>
                <span className="cycle-summary__days-left">{daysLeft}</span>
              </span>
            </div>
          )}
          {pace && (
            <div className="cycle-summary__fact">
              <span className="cycle-summary__fact-icon"><Icon name="clock" /></span>
              <span className="cycle-summary__fact-body">
                <span className="cycle-summary__fact-label">{t('andamento.pace.label')}</span>
                <span className={`cycle-summary__pace cycle-summary__pace--${pace}`}>
                  <span className="cycle-summary__pace-dot" aria-hidden="true" />
                  {t(`andamento.pace.${pace}`)}
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
