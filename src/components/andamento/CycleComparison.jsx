import { Fragment, useMemo, useState } from 'react'
import { compareCycles } from '../../utils/andamentoEngine.js'
import { formatCurrency } from '../../utils/format.js'
import { describeChange, describeDiff, formatPercent } from './andamentoFormat.js'
import { CategoryComparison } from './CategoryComparison.jsx'
import { MetricChart, MetricChartUnavailable } from './MetricChart.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'
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
// motore (compareCycles), nessuna soglia o regola nuova. Il testo è
// andamento.sentence.<metrica>.<down|up|same>, nella lingua scelta.
const directionOf = (diff) => (diff < 0 ? 'down' : diff > 0 ? 'up' : 'same')

const signedMoney = (value) => (value < 0 ? `-${formatCurrency(Math.abs(value))}` : formatCurrency(value))

function budgetChange(budgetUsed, t) {
  // Senza uno stipendio in uno dei due cicli il budget utilizzato non esiste
  // (compareCycles restituisce null): la card resta, senza confronto.
  if (!budgetUsed) return { arrow: '', text: t('andamento.change.notcomparable'), tone: 'flat', points: null }
  const points = Math.round(budgetUsed.diffPoints)
  if (points === 0) return { arrow: '=', text: t('andamento.change.unchanged'), tone: 'flat', points }
  return {
    arrow: points > 0 ? '▲' : '▼',
    text: t('andamento.change.points', { points: `${points > 0 ? '+' : '-'}${Math.abs(points)}` }),
    tone: points > 0 ? 'bad' : 'good',
    points,
  }
}

// La conclusione, prima ancora dei numeri: stessa regola di sempre (il
// segno della differenza di spesa), presentata da Spendy. Non è una battuta:
// le battute passano da HumorEngine, che ragiona su insight comportamentali
// e non su un confronto scelto a mano dall'utente.
//
// Due righe ("quanto" e "rispetto a cosa") che ogni lingua scrive come una
// coppia completa: `ref` è la seconda riga giusta per QUESTA conclusione.
function verdict({ spent }, t) {
  if (spent.diff < 0) {
    return { tone: 'good', emoji: '💚', title: t('andamento.verdict.good'), text: t('andamento.verdict.less', { amount: formatCurrency(Math.abs(spent.diff)) }), ref: 'diff' }
  }
  if (spent.diff > 0) {
    return { tone: 'bad', emoji: '🧡', title: t('andamento.verdict.bad'), text: t('andamento.verdict.more', { amount: formatCurrency(spent.diff) }), ref: 'diff' }
  }
  return { tone: 'flat', emoji: '⚖️', title: t('andamento.verdict.flat'), text: t('andamento.verdict.same'), ref: 'same' }
}

function CycleStatus({ cycle }) {
  const { t } = useLanguage()
  return cycle.isCurrent
    ? <span className="cycle-comparison__status cycle-comparison__status--current"><span aria-hidden="true">● </span>{t('andamento.status.current')}</span>
    : <span className="cycle-comparison__status cycle-comparison__status--done"><span aria-hidden="true">✓ </span>{t('andamento.status.done')}</span>
}

// Il confronto fra due cicli scelti dall'utente. Il più vecchio fa sempre
// da riferimento, qualunque sia l'ordine in cui sono stati scelti: così
// "+12%" vuol dire sempre "rispetto a prima".
export function CycleComparison({ cycles, firstKey, secondKey, onChangeFirst, onChangeSecond }) {
  const { t, language } = useLanguage()
  const options = [...cycles].reverse()
  const byKey = (key) => cycles.find((cycle) => cycle.key === key)
  const [before, after] = [firstKey, secondKey].map(byKey).sort((a, b) => (a.key < b.key ? -1 : 1))

  const comparison = useMemo(() => compareCycles(before, after), [before, after])
  const sameCycle = before.key === after.key
  // Accordion: al massimo un grafico aperto ('spent' | 'income' | 'savings' | 'budget').
  const [openMetric, setOpenMetric] = useState(null)
  // "il ciclo precedente" solo se i due cicli sono davvero uno dopo l'altro.
  const consecutive = cycles.indexOf(after) - cycles.indexOf(before) === 1
  const conclusion = verdict(comparison, t)

  // Quale dei due selettori è il periodo precedente e quale l'attuale: la
  // stessa regola del confronto (il più vecchio fa da riferimento), quindi
  // segue i periodi davvero scelti, in qualunque ordine.
  const roleOf = (key, position) => {
    if (sameCycle) return position === 0 ? t('andamento.compare.before') : t('andamento.compare.after')
    return key === before.key ? t('andamento.compare.before') : t('andamento.compare.after')
  }

  // Le quattro metriche: valori del riquadro e dati del grafico, tutti già
  // calcolati da buildAndamento/compareCycles e formattati come prima.
  const spentChange = describeChange(comparison.spent, { lang: language, newLabel: t('andamento.change.newspent') })
  const incomeChange = describeChange(comparison.income, { higherIsBetter: true, lang: language, newLabel: t('andamento.change.newincome'), goneLabel: t('andamento.change.noincome') })
  const savingsChange = describeDiff(comparison.savings.diff, { higherIsBetter: true, lang: language })
  const budget = budgetChange(comparison.budgetUsed, t)
  const sentence = (metric, diff) => t(`andamento.sentence.${metric}.${directionOf(diff)}`)
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
      label: t('andamento.metric.spent'),
      beforeValue: formatCurrency(before.spent),
      afterValue: formatCurrency(after.spent),
      change: spentChange,
      chart: {
        title: t('andamento.chart.spent'),
        color: 'violet',
        points: [point(before, before.spent, formatCurrency(before.spent)), point(after, after.spent, formatCurrency(after.spent))],
        summary: `${spentChange.arrow} ${spentChange.text}`,
        summaryTone: spentChange.tone,
        sentence: sentence('spent', comparison.spent.diff),
      },
    },
    {
      id: 'income',
      label: t('andamento.metric.income'),
      beforeValue: incomeText(before),
      afterValue: incomeText(after),
      change: incomeChange,
      chart: {
        title: t('andamento.chart.income'),
        color: 'mint',
        points: [incomePoint(before), incomePoint(after)],
        summary: missingIncome.length > 0 ? null : `${incomeChange.arrow} ${incomeChange.text}`,
        summaryTone: incomeChange.tone,
        sentence: missingIncome.length > 0 ? null : sentence('income', comparison.income.diff),
        notes: missingIncome.map((cycle) => t('andamento.chart.noincome', { cycle: cycle.label })),
      },
    },
    {
      id: 'savings',
      label: t('andamento.metric.savings'),
      beforeValue: signedMoney(before.savings),
      afterValue: signedMoney(after.savings),
      change: savingsChange,
      chart: {
        title: t('andamento.chart.savings'),
        color: 'mint',
        points: [point(before, before.savings, signedMoney(before.savings)), point(after, after.savings, signedMoney(after.savings))],
        summary: `${savingsChange.arrow} ${savingsChange.text}`,
        summaryTone: savingsChange.tone,
        sentence: sentence('savings', comparison.savings.diff),
      },
    },
    {
      id: 'budget',
      label: t('andamento.metric.budget'),
      beforeValue: formatPercent(before.budgetUsed),
      afterValue: formatPercent(after.budgetUsed),
      change: budget,
      chart: comparison.budgetUsed
        ? {
          title: t('andamento.chart.budget'),
          color: 'violet',
          points: [point(before, before.budgetUsed, formatPercent(before.budgetUsed)), point(after, after.budgetUsed, formatPercent(after.budgetUsed))],
          summary: budget.points === 0 ? `= ${t('andamento.change.unchanged')}` : `${budget.arrow} ${t('andamento.change.percentpoints', { points: `${budget.points > 0 ? '+' : '-'}${Math.abs(budget.points)}` })}`,
          summaryTone: budget.tone,
          sentence: sentence('budget', budget.points),
        }
        : {
          unavailable: true,
          title: t('andamento.chart.budget'),
          message: t('andamento.chart.budgetna'),
          // Uno o due periodi senza stipendio: una frase intera per ciascun caso.
          explanation: missingSalary.length === 1
            ? t('andamento.chart.nosalaryone', { cycle: missingSalary[0].label })
            : t('andamento.chart.nosalarytwo', { first: missingSalary[0].label, second: missingSalary[1].label }),
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
      <section className="cycle-comparison__pickers" aria-label={t('andamento.compare.pickers')}>
        {picker(roleOf(firstKey, 0), firstKey, onChangeFirst)}
        <span className="cycle-comparison__pickers-arrow" aria-hidden="true">↔</span>
        {picker(roleOf(secondKey, 1), secondKey, onChangeSecond)}
      </section>

      {sameCycle ? (
        <p className="cycle-comparison__notice">{t('andamento.compare.samecycle')}</p>
      ) : (
        <>
          <section className={`cycle-comparison__verdict cycle-comparison__verdict--${conclusion.tone}`} aria-label={t('andamento.compare.conclusion')}>
            <p className="cycle-comparison__verdict-title">
              <span aria-hidden="true">{conclusion.emoji} </span>{conclusion.title}
            </p>
            <p className="cycle-comparison__verdict-text">{conclusion.text}</p>
            <p className="cycle-comparison__verdict-ref">
              {consecutive ? t(`andamento.verdict.${conclusion.ref}previous`) : t(`andamento.verdict.${conclusion.ref}other`, { cycle: before.label })}
              {consecutive && <span className="cycle-comparison__verdict-period"> ({before.label})</span>}
            </p>
            {after.isCurrent && (
              <p className="cycle-comparison__note">{t('andamento.compare.currentnote')}</p>
            )}
          </section>

          <section className="cycle-comparison__metrics" aria-label={t('andamento.compare.numbers', { before: before.label, after: after.label })}>
            {metrics.map(metricRow)}
          </section>

          <section className="cycle-comparison__categories" aria-labelledby="cycle-comparison-categories">
            <p id="cycle-comparison-categories" className="cycle-comparison__section-title">
              <span aria-hidden="true">🔍 </span>{t('andamento.compare.difference')}
            </p>
            <CategoryComparison rows={comparison.categories} beforeLabel={before.shortLabel} afterLabel={after.shortLabel} />
          </section>
        </>
      )}
    </div>
  )
}
