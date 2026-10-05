import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { getCycleRange, formatCycleLabel } from '../../utils/cycle.js'
import { formatCurrency } from '../../utils/format.js'
import { BackupCard } from '../settings/BackupCard.jsx'
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
// Same reasoning is why "cancellare uno stipendio già registrato" lives
// here too: Stipendio is a single recurring figure with no per-entry
// list anywhere else to delete a row from (see useAppStore's
// deleteMonthlyBudget).
export function SettingsScreen({ onClose }) {
  const today = useAppStore((state) => state.today)
  const monthlyBudget = useAppStore((state) => state.monthlyBudget)
  const deleteMonthlyBudget = useAppStore((state) => state.deleteMonthlyBudget)
  const cycleStartDay = useAppStore((state) => state.cycleStartDay)
  const setCycleStartDay = useAppStore((state) => state.setCycleStartDay)

  const [day, setDay] = useState(String(cycleStartDay ?? 1))
  const [saved, setSaved] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const dayValue = parseInt(day, 10)
  const canSave = Number.isInteger(dayValue) && dayValue >= 1 && dayValue <= 31

  const currentRange = getCycleRange(today, cycleStartDay ?? 1)
  const currentLabel = formatCycleLabel(currentRange, cycleStartDay ?? 1)

  const handleSave = () => {
    if (!canSave) return
    setCycleStartDay(dayValue)
    setSaved(true)
  }

  const handleDeleteBudget = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    deleteMonthlyBudget()
    setConfirmingDelete(false)
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
        <div className="settings-screen__card">
          <p className="settings-screen__label">Stipendio</p>
          <p className="settings-screen__hint">
            {monthlyBudget > 0
              ? `Guadagno mensile impostato: ${formatCurrency(monthlyBudget)}.`
              : 'Nessuno stipendio impostato al momento.'}
          </p>

          {monthlyBudget > 0 && (
            <button
              type="button"
              className={`settings-screen__delete${confirmingDelete ? ' settings-screen__delete--confirm' : ''}`}
              onClick={handleDeleteBudget}
            >
              {confirmingDelete ? 'Tocca di nuovo per confermare' : '🗑️ Elimina stipendio'}
            </button>
          )}
        </div>

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
