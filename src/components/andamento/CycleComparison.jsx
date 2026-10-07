import { Fragment, useMemo, useState } from 'react'
import { compareCycles } from '../../utils/andamentoEngine.js'
import { formatCurrency } from '../../utils/format.js'
import { describeChange, describeDiff, formatPercent } from './andamentoFormat.js'
import { CategoryComparison } from './CategoryComparison.jsx'
import { MetricChart, MetricChartUnavailable } from './MetricChart.jsx'
import './CycleComparison.css'

// Una metrica compatta della griglia 2 × 2: prima → dopo, e sotto la
// variazione già calcolata (describeChange/describeDiff/budgetChange).
// È un pulsante: apre e chiude il suo grafico (MetricChart) sotto la riga.
function MetricCard({ id, label, before, after, beforeValue, afterValue, change, open, onToggle }) {
  return (
    <button
      type="button"
      className={`cycle-comparison__metric${open ? ' cycle-comparison__metric--open' : ''}`}
      aria-expanded={open}
      aria-controls={`cycle-comparison-chart-${id}`}
      aria-label={`${label}: ${before.shortLabel} ${beforeValue}, ${after.shortLabel} ${afterValue}, ${change.text}`}
      onClick={onToggle}
    >
      <span className="cycle-comparison__metric-label">{label}</span>
      <span className="cycle-comparison__chevron" aria-hidden="true" />
      <span className="cycle-comparison__values">
        <span className="cycle-comparison__value">{beforeValue}</span>
        <span className="cycle-comparison__value-arrow" aria-hidden="true">→</span>
        <span className="cycle-comparison__value cycle-comparison__value--after">{afterValue}</span>
      </span>
      <span className={`cycle-comparison__change cycle-comparison__change--${change.tone}`}>
        {change.arrow && <span aria-hidden="true">{change.arrow} </span>}
        {change.text}
      </span>
    </button>
  )
}

// La frase sotto il grafico: solo dal SEGNO della variazione già calcolata dal
// motore (compareCycles), nessuna soglia o regola nuova.
const directionOf = (diff) => (diff < 0 ? 'down' : diff > 0 ? 'up' : 'same')
const SENTENCES = {
  spent: { down: 'Hai speso meno rispetto al periodo precedente.', up: 'Hai speso di più rispetto al periodo precedente.', same: 'Hai speso quanto nel periodo precedente.' },
  income: { down: 'Le entrate sono diminuite.', up: 'Le entrate sono aumentate.', same: 'Le entrate sono rimaste uguali.' },
  savings: { down: 'Hai messo da parte di meno.', up: 'Hai messo da parte di più.', same: 'Hai messo da parte quanto prima.' },
  budget: { down: 'Hai usato una parte più piccola dello stipendio.', up: 'Hai usato una parte più grande dello stipendio.', same: 'Hai usato la stessa parte dello stipendio.' },
}

const signedMoney = (value) => (value < 0 ? `-${formatCurrency(Math.abs(value))}` : formatCurrency(value))

function budgetChange(budgetUsed) {
  // Senza uno stipendio in uno dei due cicli il budget utilizzato non esiste
  // (compareCycles restituisce null): la card resta, senza confronto.
  if (!budgetUsed) return { arrow: '', text: 'Non confrontabile', tone: 'flat', points: null }
  const points = Math.round(budgetUsed.diffPoints)
  if (points === 0) return { arrow: '=', text: 'Invariato', tone: 'flat', points }
  return {
    arrow: points > 0 ? '▲' : '▼',
    text: `${points > 0 ? '+' : '-'}${Math.abs(points)} punti`,
    tone: points > 0 ? 'bad' : 'good',
    points,
  }
}

// La conclusione, prima ancora dei numeri: stessa regola di sempre (il
// segno della differenza di spesa), presentata da Spendy. Non è una battuta:
// le battute passano da HumorEngine, che ragiona su insight comportamentali
// e non su un confronto scelto a mano dall'utente.
function verdict({ spent }) {
  if (spent.diff < 0) {
    return { tone: 'good', emoji: '💚', title: 'Ottimo!', text: `Hai speso ${formatCurrency(Math.abs(spent.diff))} in meno` }
  }
  if (spent.diff > 0) {
    return { tone: 'bad', emoji: '🧡', title: 'Un ciclo più impegnativo', text: `Hai speso ${formatCurrency(spent.diff)} in più` }
  }
  return { tone: 'flat', emoji: '⚖️', title: 'Tutto stabile', text: 'Hai speso esattamente come' }
}

function CycleStatus({ cycle }) {
  return cycle.isCurrent
    ? <span className="cycle-comparison__status cycle-comparison__status--current"><span aria-hidden="true">● </span>In corso</span>
    : <span className="cycle-comparison__status cycle-comparison__status--done"><span aria-hidden="true">✓ </span>Completo</span>
}

// Il confronto fra due cicli scelti dall'utente. Il più vecchio fa sempre
// da riferimento, qualunque sia l'ordine in cui sono stati scelti: così
// "+12%" vuol dire sempre "rispetto a prima".
export function CycleComparison({ cycles, firstKey, secondKey, onChangeFirst, onChangeSecond }) {
  const options = [...cycles].reverse()
  const byKey = (key) => cycles.find((cycle) => cycle.key === key)
  const [before, after] = [firstKey, secondKey].map(byKey).sort((a, b) => (a.key < b.key ? -1 : 1))

  const comparison = useMemo(() => compareCycles(before, after), [before, after])
  const sameCycle = before.key === after.key
  // Accordion: al massimo un grafico aperto ('spent' | 'income' | 'savings' | 'budget').
  const [openMetric, setOpenMetric] = useState(null)
  // "il ciclo precedente" solo se i due cicli sono davvero uno dopo l'altro.
  const consecutive = cycles.indexOf(after) - cycles.indexOf(before) === 1
  const conclusion = verdict(comparison)

  // Quale dei due selettori è il periodo precedente e quale l'attuale: la
  // stessa regola del confronto (il più vecchio fa da riferimento), quindi
  // segue i periodi davvero scelti, in qualunque ordine.
  const roleOf = (key, position) => {
    if (sameCycle) return position === 0 ? 'Periodo precedente' : 'Periodo attuale'
    return key === before.key ? 'Periodo precedente' : 'Periodo attuale'
  }

  // Le quattro metriche: valori del riquadro e dati del grafico, tutti già
  // calcolati da buildAndamento/compareCycles e formattati come prima.
  const spentChange = describeChange(comparison.spent, { newLabel: 'Nuova spesa' })
  const incomeChange = describeChange(comparison.income, { higherIsBetter: true, newLabel: 'Nuove entrate', goneLabel: 'Nessuna entrata' })
  const savingsChange = describeDiff(comparison.savings.diff, { higherIsBetter: true })
  const budget = budgetChange(comparison.budgetUsed)
  const point = (cycle, value, text) => ({ label: cycle.shortLabel, period: cycle.label, value, text })
  // Un periodo senza alcuna entrata (income 0: niente stipendio né extra
  // registrati — un'entrata registrata è sempre > 0, vedi utils/amounts.js) è
  // un dato ASSENTE, non uno 0: "—" nel riquadro e nel grafico.
  const incomeText = (cycle) => (cycle.income > 0 ? formatCurrency(cycle.income) : '—')
  const incomePoint = (cycle) => point(cycle, cycle.income > 0 ? cycle.income : null, incomeText(cycle))
  const missingIncome = [before, after].filter((cycle) => !(cycle.income > 0))
  const missingSalary = [before, after].filter((cycle) => cycle.budgetUsed === null)

  const metrics = [
    {
      id: 'spent',
      label: 'Spese',
      beforeValue: formatCurrency(before.spent),
      afterValue: formatCurrency(after.spent),
      change: spentChange,
      chart: {
        title: 'Andamento delle spese',
        color: 'violet',
        points: [point(before, before.spent, formatCurrency(before.spent)), point(after, after.spent, formatCurrency(after.spent))],
        summary: `${spentChange.arrow} ${spentChange.text}`,
        summaryTone: spentChange.tone,
        sentence: SENTENCES.spent[directionOf(comparison.spent.diff)],
      },
    },
    {
      id: 'income',
      label: 'Entrate',
      beforeValue: incomeText(before),
      afterValue: incomeText(after),
      change: incomeChange,
      chart: {
        title: 'Andamento delle entrate',
        color: 'mint',
        points: [incomePoint(before), incomePoint(after)],
        summary: missingIncome.length > 0 ? null : `${incomeChange.arrow} ${incomeChange.text}`,
        summaryTone: incomeChange.tone,
        sentence: missingIncome.length > 0 ? null : SENTENCES.income[directionOf(comparison.income.diff)],
        notes: missingIncome.map((cycle) => `${cycle.label}: Nessuna entrata registrata`),
      },
    },
    {
      id: 'savings',
      label: 'Risparmio',
      beforeValue: signedMoney(before.savings),
      afterValue: signedMoney(after.savings),
      change: savingsChange,
      chart: {
        title: 'Andamento del risparmio',
        color: 'mint',
        points: [point(before, before.savings, signedMoney(before.savings)), point(after, after.savings, signedMoney(after.savings))],
        summary: `${savingsChange.arrow} ${savingsChange.text}`,
        summaryTone: savingsChange.tone,
        sentence: SENTENCES.savings[directionOf(comparison.savings.diff)],
      },
    },
    {
      id: 'budget',
      label: 'Budget utilizzato',
      beforeValue: formatPercent(before.budgetUsed),
      afterValue: formatPercent(after.budgetUsed),
      change: budget,
      chart: comparison.budgetUsed
        ? {
          title: 'Andamento del budget',
          color: 'violet',
          points: [point(before, before.budgetUsed, formatPercent(before.budgetUsed)), point(after, after.budgetUsed, formatPercent(after.budgetUsed))],
          summary: budget.points === 0 ? '= Invariato' : `${budget.arrow} ${budget.points > 0 ? '+' : '-'}${Math.abs(budget.points)} punti percentuali`,
          summaryTone: budget.tone,
          sentence: SENTENCES.budget[directionOf(budget.points)],
        }
        : {
          unavailable: true,
          title: 'Andamento del budget',
          message: 'Budget non confrontabile',
          explanation: `Il budget utilizzato si misura sullo stipendio del periodo, e ${missingSalary.map((cycle) => cycle.label).join(' e ')} ${missingSalary.length === 1 ? 'non ha' : 'non hanno'} uno stipendio registrato.`,
        },
    },
  ]

  const toggle = (id) => setOpenMetric((current) => (current === id ? null : id))
  const chartFor = (metric) => {
    const chartId = `cycle-comparison-chart-${metric.id}`
    return metric.chart.unavailable
      ? <MetricChartUnavailable id={chartId} title={metric.chart.title} message={metric.chart.message} explanation={metric.chart.explanation} />
      : <MetricChart id={chartId} {...metric.chart} />
  }
  // Il grafico va sotto la riga del riquadro aperto (dopo il 2° o il 4°), a
  // tutta larghezza: la griglia 2 × 2 resta com'è.
  const openIndex = metrics.findIndex((metric) => metric.id === openMetric)
  const metricRow = (metric, index) => (
    <Fragment key={metric.id}>
      <MetricCard
        id={metric.id}
        label={metric.label}
        before={before}
        after={after}
        beforeValue={metric.beforeValue}
        afterValue={metric.afterValue}
        change={metric.change}
        open={openMetric === metric.id}
        onToggle={() => toggle(metric.id)}
      />
      {index % 2 === 1 && openIndex >= 0 && Math.floor(openIndex / 2) === Math.floor(index / 2) && chartFor(metrics[openIndex])}
    </Fragment>
  )

  const picker = (label, key, onChange) => (
    <label className="cycle-comparison__picker">
      <span className="cycle-comparison__picker-head">
        <span className="cycle-comparison__picker-label">{label}</span>
        <CycleStatus cycle={byKey(key)} />
      </span>
      <select value={key} onChange={(event) => onChange(event.target.value)}>
        {options.map((cycle) => (
          <option key={cycle.key} value={cycle.key}>{cycle.label}</option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="cycle-comparison">
      <section className="cycle-comparison__pickers" aria-label="Scegli i periodi">
        {picker(roleOf(firstKey, 0), firstKey, onChangeFirst)}
        <span className="cycle-comparison__pickers-arrow" aria-hidden="true">↔</span>
        {picker(roleOf(secondKey, 1), secondKey, onChangeSecond)}
      </section>

      {sameCycle ? (
        <p className="cycle-comparison__notice">Scegli due periodi diversi per vedere cosa è cambiato.</p>
      ) : (
        <>
          <section className={`cycle-comparison__verdict cycle-comparison__verdict--${conclusion.tone}`} aria-label="Conclusione">
            <p className="cycle-comparison__verdict-title">
              <span aria-hidden="true">{conclusion.emoji} </span>{conclusion.title}
            </p>
            <p className="cycle-comparison__verdict-text">{conclusion.text}</p>
            <p className="cycle-comparison__verdict-ref">
              rispetto {consecutive ? 'al ciclo precedente' : `a ${before.label}`}
              {consecutive && <span className="cycle-comparison__verdict-period"> ({before.label})</span>}
            </p>
            {after.isCurrent && (
              <p className="cycle-comparison__note">Il ciclo attuale è ancora in corso: i numeri possono cambiare.</p>
            )}
          </section>

          <section className="cycle-comparison__metrics" aria-label={`Confronto in numeri: ${before.label} → ${after.label}`}>
            {metrics.map(metricRow)}
          </section>

          <section className="cycle-comparison__categories" aria-labelledby="cycle-comparison-categories">
            <p id="cycle-comparison-categories" className="cycle-comparison__section-title">
              <span aria-hidden="true">🔍 </span>Cosa ha fatto la differenza
            </p>
            <CategoryComparison rows={comparison.categories} beforeLabel={before.shortLabel} afterLabel={after.shortLabel} />
          </section>
        </>
      )}
    </div>
  )
}
