import { useMemo } from 'react'
import { compareCycles } from '../../utils/andamentoEngine.js'
import { formatCurrency } from '../../utils/format.js'
import { describeChange, describeDiff, formatPercent } from './andamentoFormat.js'
import { CategoryComparison } from './CategoryComparison.jsx'
import './CycleComparison.css'

// Una metrica compatta della griglia 2 × 2: prima → dopo, e sotto la
// variazione già calcolata (describeChange/describeDiff/budgetChange).
function MetricCard({ label, before, after, beforeValue, afterValue, change }) {
  return (
    <div className="cycle-comparison__metric">
      <p className="cycle-comparison__metric-label">{label}</p>
      <p
        className="cycle-comparison__values"
        aria-label={`${label}: ${before.shortLabel} ${beforeValue}, ${after.shortLabel} ${afterValue}`}
      >
        <span className="cycle-comparison__value">{beforeValue}</span>
        <span className="cycle-comparison__value-arrow" aria-hidden="true">→</span>
        <span className="cycle-comparison__value cycle-comparison__value--after">{afterValue}</span>
      </p>
      <p className={`cycle-comparison__change cycle-comparison__change--${change.tone}`}>
        {change.arrow && <span aria-hidden="true">{change.arrow} </span>}
        {change.text}
      </p>
    </div>
  )
}

const signedMoney = (value) => (value < 0 ? `-${formatCurrency(Math.abs(value))}` : formatCurrency(value))

function budgetChange(budgetUsed) {
  // Senza uno stipendio in uno dei due cicli il budget utilizzato non esiste
  // (compareCycles restituisce null): la card resta, senza confronto.
  if (!budgetUsed) return { arrow: '', text: 'Non confrontabile', tone: 'flat' }
  const points = Math.round(budgetUsed.diffPoints)
  if (points === 0) return { arrow: '=', text: 'Invariato', tone: 'flat' }
  return {
    arrow: points > 0 ? '▲' : '▼',
    text: `${points > 0 ? '+' : '-'}${Math.abs(points)} punti`,
    tone: points > 0 ? 'bad' : 'good',
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
            <MetricCard
              label="Spese"
              before={before}
              after={after}
              beforeValue={formatCurrency(before.spent)}
              afterValue={formatCurrency(after.spent)}
              change={describeChange(comparison.spent, { newLabel: 'Nuova spesa' })}
            />
            <MetricCard
              label="Entrate"
              before={before}
              after={after}
              beforeValue={formatCurrency(before.income)}
              afterValue={formatCurrency(after.income)}
              change={describeChange(comparison.income, { higherIsBetter: true, newLabel: 'Nuove entrate', goneLabel: 'Nessuna entrata' })}
            />
            <MetricCard
              label="Risparmio"
              before={before}
              after={after}
              beforeValue={signedMoney(before.savings)}
              afterValue={signedMoney(after.savings)}
              change={describeDiff(comparison.savings.diff, { higherIsBetter: true })}
            />
            <MetricCard
              label="Budget utilizzato"
              before={before}
              after={after}
              beforeValue={formatPercent(before.budgetUsed)}
              afterValue={formatPercent(after.budgetUsed)}
              change={budgetChange(comparison.budgetUsed)}
            />
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
