import { useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { buildAndamento } from '../../utils/andamentoEngine.js'
import { CycleTrendChart } from './CycleTrendChart.jsx'
import { CycleSummary } from './CycleSummary.jsx'
import { CycleComparison } from './CycleComparison.jsx'
import './AndamentoScreen.css'

// ANDAMENTO — "fammi vedere come sto andando". Il Radar segnala, questa
// schermata mostra: nessun minimo di cicli, nessuna selezione di cosa sia
// importante, solo i cicli che esistono, uno accanto all'altro.
//
// Come RadarScreen, non calcola niente: legge lo store, chiama
// buildAndamento() (utils/andamentoEngine.js) e disegna. Lo storico non è
// salvato da nessuna parte — è ricalcolato dalle stesse spese/entrate che
// il sync tiene allineate fra Mac e Samsung.
export function AndamentoScreen({ onClose }) {
  const today = useAppStore((state) => state.today)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const incomes = useAppStore((state) => state.incomes)

  const andamento = useMemo(
    () => buildAndamento({ expenses, incomes, today, cycleStartDay }),
    [expenses, incomes, today, cycleStartDay],
  )
  const { cycles, current } = andamento
  const previous = cycles.length > 1 ? cycles[cycles.length - 2] : current

  const [view, setView] = useState('overview')
  // Le chiavi scelte restano valide solo finché quel ciclo esiste ancora
  // (una spesa cancellata o spostata può accorciare lo storico): se
  // sparisce si torna al default invece di mostrare un ciclo fantasma.
  const [selectedKey, setSelectedKey] = useState(null)
  const [compareKeys, setCompareKeys] = useState([null, null])
  const exists = (key) => key !== null && cycles.some((cycle) => cycle.key === key)

  const selected = cycles.find((cycle) => cycle.key === selectedKey) ?? current
  const firstKey = exists(compareKeys[0]) ? compareKeys[0] : previous.key
  const secondKey = exists(compareKeys[1]) ? compareKeys[1] : current.key

  return (
    <div className="andamento-screen">
      <div className="andamento-screen__header">
        <button type="button" className="andamento-screen__back" onClick={onClose} aria-label="Chiudi">
          ←
        </button>
        <div>
          <p className="andamento-screen__title">
            <span aria-hidden="true">📈</span> Andamento
          </p>
          <p className="andamento-screen__subtitle">{current.label}</p>
        </div>
      </div>

      <div className="andamento-screen__tabs" role="tablist" aria-label="Vista">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'overview'}
          className={`andamento-screen__tab${view === 'overview' ? ' andamento-screen__tab--active' : ''}`}
          onClick={() => setView('overview')}
        >
          Come sto andando
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'compare'}
          className={`andamento-screen__tab${view === 'compare' ? ' andamento-screen__tab--active' : ''}`}
          onClick={() => setView('compare')}
        >
          Confronta periodi
        </button>
      </div>

      <div className="andamento-screen__body">
        {view === 'overview' && (
          <>
            <CycleTrendChart cycles={cycles} selectedKey={selected.key} onSelect={setSelectedKey} />
            <CycleSummary cycle={selected} />
          </>
        )}

        {view === 'compare' && (cycles.length < 2 ? (
          <div className="andamento-screen__empty">
            <p className="andamento-screen__empty-emoji" aria-hidden="true">⚖️</p>
            <p className="andamento-screen__empty-title">Per ora c&apos;è un solo periodo.</p>
            <p className="andamento-screen__empty-text">
              Il confronto si accende appena hai spese o entrate in due cicli diversi. Il primo
              termina alla fine di {current.label}.
            </p>
          </div>
        ) : (
          <CycleComparison
            cycles={cycles}
            firstKey={firstKey}
            secondKey={secondKey}
            onChangeFirst={(key) => setCompareKeys([key, secondKey])}
            onChangeSecond={(key) => setCompareKeys([firstKey, key])}
          />
        ))}
      </div>
    </div>
  )
}
