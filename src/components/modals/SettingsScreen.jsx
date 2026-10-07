import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { getCycleRange, formatCycleLabel } from '../../utils/cycle.js'
import { BackupCard } from '../settings/BackupCard.jsx'
import { CurrentSalaryCard } from '../settings/CurrentSalaryCard.jsx'
import { DeleteAccountCard } from '../settings/DeleteAccountCard.jsx'
import { PrivacyCard } from '../settings/PrivacyCard.jsx'
import { SpendyAICard } from '../settings/SpendyAICard.jsx'
import { SyncCard } from '../settings/SyncCard.jsx'
import './SettingsScreen.css'

// Reachable from the Header's gear icon (previously a no-op — see
// Header.jsx's own comment). Its whole reason for existing: once
// cycleStartDay is set, nothing else in the app lets you look at it or
// change it again — setMonthlyBudget only derives it automatically the
// FIRST time ever, by design (a stipendio entered every month shouldn't
// keep reshuffling the billing cycle). "la data del guadagno non cambia
// in home" after that first time isn't a bug, it's this missing control.
// Lo stipendio è un'entrata datata per ciclo (useAppStore addSalary):
// CurrentSalaryCard mostra quello del ciclo in corso e permette di
// modificarlo, eliminarlo o reinserirlo.
export function SettingsScreen({ onClose }) {
  const today = useAppStore((state) => state.today)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay)
  const setCycleStartDay = useAppStore((state) => state.setCycleStartDay)

  // Il campo mostra il giorno salvato finché non lo si modifica: il giorno può
  // cambiare mentre questa schermata è aperta (il primo stipendio inserito qui
  // sopra lo ricava dalla sua data), e "Salva" non deve riportare indietro il
  // ciclo con un valore letto all'apertura.
  const [dayDraft, setDay] = useState(null)
  const day = dayDraft ?? String(cycleStartDay ?? 1)
  const [saved, setSaved] = useState(false)

  const dayValue = parseInt(day, 10)
  const canSave = Number.isInteger(dayValue) && dayValue >= 1 && dayValue <= 31

  const currentRange = getCycleRange(today, cycleStartDay ?? 1)
  const currentLabel = formatCycleLabel(currentRange, cycleStartDay ?? 1)

  const handleSave = () => {
    if (!canSave) return
    setCycleStartDay(dayValue)
    setSaved(true)
  }

  return (
    <div className="settings-screen">
      <div className="settings-screen__header">
        <button type="button" className="settings-screen__back" onClick={onClose} aria-label="Chiudi">
          ←
        </button>
        <p className="settings-screen__title">Impostazioni</p>
      </div>

      <div className="settings-screen__body">
        <CurrentSalaryCard />

        <div className="settings-screen__card">
          <p className="settings-screen__label">Giorno di inizio ciclo</p>
          <p className="settings-screen__hint">
            {cycleStartDay
              ? `Il ciclo attuale va dal ${currentLabel}.`
              : "Non ancora impostato — l'app usa il mese di calendario."}
          </p>

          <div className="settings-screen__field">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              value={day}
              onChange={(event) => {
                setDay(event.target.value)
                setSaved(false)
              }}
            />
            <span>del mese</span>
          </div>

          <button type="button" className="settings-screen__save" disabled={!canSave} onClick={handleSave}>
            {saved ? '✓ Salvato' : 'Salva'}
          </button>
        </div>

        <SyncCard />

        <SpendyAICard />

        <PrivacyCard />

        <BackupCard />

        <DeleteAccountCard />
      </div>
    </div>
  )
}
