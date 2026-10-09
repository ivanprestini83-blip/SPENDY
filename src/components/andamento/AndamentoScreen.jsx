import { useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { buildAndamento } from '../../utils/andamentoEngine.js'
import { getCycleTiming } from '../../utils/cycle.js'
import { CycleTrendChart } from './CycleTrendChart.jsx'
import { CycleSummary } from './CycleSummary.jsx'
import { CycleCategories } from './CycleCategories.jsx'
import { CycleComparison } from './CycleComparison.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'
import { cycleLabelNames } from '../../i18n/cycleLabelNames.js'
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
  const { t, language } = useLanguage()
  const today = useAppStore((state) => state.today)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay) ?? 1
  const expenses = useAppStore((state) => state.expenses)
  const incomes = useAppStore((state) => state.incomes)

  const andamento = useMemo(
    // `language`: solo le etichette dei periodi ("7 oct. – 6 nov."), non i conti.
    () => buildAndamento({ expenses, incomes, today, cycleStartDay, labelNames: cycleLabelNames(language) }),
    [expenses, incomes, today, cycleStartDay, language],
  )
  const { cycles, current } = andamento
  // Giorni del ciclo in corso: la stessa funzione di Home e Spendy (utils/cycle.js).
  const timing = useMemo(() => getCycleTiming(today, cycleStartDay), [today, cycleStartDay])
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
        <button type="button" className="andamento-screen__back" onClick={onClose} aria-label={t('common.close')}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="andamento-screen__heading">
          <p className="andamento-screen__title">
            <span className="andamento-screen__title-icon" aria-hidden="true">📈</span> {t('andamento.title')}
          </p>
          <p className="andamento-screen__subtitle">
            <span className="andamento-screen__subtitle-dot" aria-hidden="true" />
            {current.label}
          </p>
        </div>
      </div>

      {/* Le due viste sono il "filtro" principale della schermata: un
          controllo segmentato con un'icona per ciascuna, sempre in vista. */}
      <div className="andamento-screen__tabs" role="tablist" aria-label={t('andamento.view')}>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'overview'}
          className={`andamento-screen__tab${view === 'overview' ? ' andamento-screen__tab--active' : ''}`}
          onClick={() => setView('overview')}
        >
          <svg className="andamento-screen__tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V11M12 19V5M19 19v-6" /></svg>
          {t('andamento.tab.overview')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'compare'}
          className={`andamento-screen__tab${view === 'compare' ? ' andamento-screen__tab--active' : ''}`}
          onClick={() => setView('compare')}
        >
          <svg className="andamento-screen__tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3-3M17 17H5l3 3" /></svg>
          {t('andamento.tab.compare')}
        </button>
      </div>

      <div className="andamento-screen__body">
        {view === 'overview' && (
          <>
            {/* Prima la sintesi del periodo scelto, poi il grafico (che sceglie
                anche lui il periodo) e infine dove sono andati i soldi. */}
            <CycleSummary cycle={selected} cycles={cycles} onSelect={setSelectedKey} timing={selected.isCurrent ? timing : null} />
            <CycleTrendChart cycles={cycles} selectedKey={selected.key} onSelect={setSelectedKey} />
            <CycleCategories cycle={selected} />
          </>
        )}

        {view === 'compare' && (cycles.length < 2 ? (
          <div className="andamento-screen__empty">
            <p className="andamento-screen__empty-emoji" aria-hidden="true">⚖️</p>
            <p className="andamento-screen__empty-title">{t('andamento.single.title')}</p>
            <p className="andamento-screen__empty-text">
              {t('andamento.single.text', { cycle: current.label })}
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
