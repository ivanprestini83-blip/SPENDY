import { useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { FIELD_LABELS, downloadBackup, parseBackup, previewImport, saveAutoBackup } from '../../sync/backup.js'
import './BackupCard.css'

// La card "Backup" in Impostazioni: esporta tutto lo stato in un JSON e
// lo reimporta. È il primo pezzo costruito della migrazione al cloud, e
// resterà utile anche dopo — è il modo per portarsi via i propri dati
// senza dipendere da nessun servizio.
//
// L'import è volutamente in DUE tempi: si sceglie il file, si legge cosa
// contiene a confronto con quello che c'è adesso, e solo dopo si decide.
// Fino al click su "Unisci"/"Sostituisci" non è stato scritto niente.
export function BackupCard() {
  const importBackup = useAppStore((state) => state.importBackup)
  const fileInputRef = useRef(null)

  const [exported, setExported] = useState(false)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(null) // { fileName, snapshot, warnings, meta, rows }
  const [confirmingReplace, setConfirmingReplace] = useState(false)
  const [result, setResult] = useState(null) // { report, autoBackupKey, warnings }

  const reset = () => {
    setPending(null)
    setConfirmingReplace(false)
    setError(null)
  }

  const handleExport = () => {
    downloadBackup(useAppStore.getState())
    setExported(true)
    setTimeout(() => setExported(false), 2500)
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    // Azzerare il value permette di riselezionare lo STESSO file dopo un
    // annulla: senza, il browser non riemette l'evento change.
    event.target.value = ''
    if (!file) return

    setResult(null)
    setError(null)

    const parsed = parseBackup(await file.text())
    if (!parsed.ok) {
      setError(parsed.error)
      setPending(null)
      return
    }

    setPending({
      fileName: file.name,
      snapshot: parsed.snapshot,
      warnings: parsed.warnings,
      meta: parsed.meta,
      rows: previewImport(useAppStore.getState(), parsed.snapshot),
    })
    setConfirmingReplace(false)
  }

  const applyImport = (mode) => {
    // Copia di sicurezza dello stato attuale PRIMA di toccarlo, su una
    // chiave sua ('spendy-backup-auto-…'). 'spendy-storage' non viene
    // mai né cancellato né riscritto a mano: ci pensa zustand persist,
    // come sempre.
    const autoBackupKey = saveAutoBackup(useAppStore.getState())
    const report = importBackup(pending.snapshot, mode)
    setResult({ report, autoBackupKey, warnings: pending.warnings })
    setPending(null)
    setConfirmingReplace(false)
  }

  const totalToAdd = pending?.rows.reduce((sum, row) => sum + row.added, 0) ?? 0

  return (
    <div className="settings-screen__card">
      <p className="settings-screen__label">💾 Backup dei dati</p>
      <p className="settings-screen__hint">
        Esporta tutte le tue spese, entrate, obiettivi e impostazioni in un file JSON. Serve anche per
        spostare i dati tra due indirizzi diversi dell&apos;app.
      </p>

      <div className="backup-card__actions">
        <button type="button" className="backup-card__button" onClick={handleExport}>
          {exported ? '✓ File scaricato' : '📤 Esporta backup'}
        </button>
        <button type="button" className="backup-card__button" onClick={() => fileInputRef.current?.click()}>
          📥 Importa backup
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="backup-card__file"
        onChange={handleFile}
      />

      {error && (
        <div className="backup-card__panel backup-card__panel--error">
          <p className="backup-card__panel-title">Import non riuscito</p>
          <p className="backup-card__panel-text">{error}</p>
          <p className="backup-card__panel-text">I tuoi dati attuali non sono stati toccati.</p>
        </div>
      )}

      {pending && (
        <div className="backup-card__panel">
          <p className="backup-card__panel-title">{pending.fileName}</p>
          <p className="backup-card__panel-text">
            {pending.meta.exportedAt
              ? `Esportato il ${pending.meta.exportedAt.slice(0, 10)}`
              : 'Nessuna data di esportazione nel file'}
            {pending.meta.exportedFrom ? ` da ${pending.meta.exportedFrom}` : ''}
          </p>

          <ul className="backup-card__rows">
            {pending.rows.map((row) => (
              <li key={row.field} className="backup-card__row">
                <span className="backup-card__row-label">{row.label}</span>
                <span className="backup-card__row-numbers">
                  <span className="backup-card__row-current">ora {row.current}</span>
                  <span className="backup-card__row-arrow">→</span>
                  <span className="backup-card__row-added">
                    {row.added > 0 ? `+${row.added}` : '—'}
                  </span>
                  {row.skipped > 0 && <span className="backup-card__row-skipped">{row.skipped} già presenti</span>}
                </span>
              </li>
            ))}
          </ul>

          {pending.warnings.length > 0 && (
            <div className="backup-card__warnings">
              <p className="backup-card__panel-text">Righe riparate durante la lettura:</p>
              <ul>
                {pending.warnings.slice(0, 5).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {pending.warnings.length > 5 && <li>…e altre {pending.warnings.length - 5}.</li>}
              </ul>
            </div>
          )}

          <button
            type="button"
            className="backup-card__button backup-card__button--primary"
            onClick={() => applyImport('merge')}
            disabled={totalToAdd === 0}
          >
            {totalToAdd > 0 ? `Unisci — aggiungi ${totalToAdd} righe` : 'Niente di nuovo da aggiungere'}
          </button>
          <p className="backup-card__note">
            Unisci non tocca nulla di quello che hai già: aggiunge solo le righe mancanti.
          </p>

          <button
            type="button"
            className={`settings-screen__delete${confirmingReplace ? ' settings-screen__delete--confirm' : ''}`}
            onClick={() => (confirmingReplace ? applyImport('replace') : setConfirmingReplace(true))}
          >
            {confirmingReplace
              ? 'Tocca di nuovo: sostituisco tutto con il file'
              : 'Sostituisci tutto con il file'}
          </button>

          <button type="button" className="backup-card__cancel" onClick={reset}>
            Annulla
          </button>
        </div>
      )}

      {result && (
        <div className="backup-card__panel backup-card__panel--done">
          <p className="backup-card__panel-title">
            ✓ Import completato ({result.report.mode === 'replace' ? 'sostituzione' : 'unione'})
          </p>
          <ul className="backup-card__rows">
            {Object.entries(result.report.collections).map(([field, stats]) => (
              <li key={field} className="backup-card__row">
                <span className="backup-card__row-label">{FIELD_LABELS[field]}</span>
                <span className="backup-card__row-numbers">
                  <span className="backup-card__row-added">+{stats.added}</span>
                  <span className="backup-card__row-current">totale {stats.total}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="backup-card__panel-text">
            {result.autoBackupKey
              ? `Copia dello stato precedente salvata in "${result.autoBackupKey}".`
              : 'Attenzione: non è stato possibile salvare la copia di sicurezza automatica (storage pieno o bloccato).'}
          </p>
          <button type="button" className="backup-card__cancel" onClick={() => setResult(null)}>
            Chiudi
          </button>
        </div>
      )}
    </div>
  )
}
