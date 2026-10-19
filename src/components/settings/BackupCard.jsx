import { useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { FIELD_LABELS, downloadBackup, parseBackup, previewImport, saveAutoBackup } from '../../sync/backup.js'
import { useLanguage } from '../../i18n/useLanguage.js'
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
  const { t } = useLanguage()
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
    // chiave sua ('spendy-backup-auto-<ambito>-…'). Lo stato dell'app non
    // viene mai né cancellato né riscritto a mano: ci pensa zustand persist,
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
      <p className="settings-screen__label">{t('settings.backup.title')}</p>
      <p className="settings-screen__hint">{t('settings.backup.hint')}</p>

      <div className="backup-card__actions">
        <button type="button" className="backup-card__button" onClick={handleExport}>
          {exported ? t('settings.backup.exported') : t('settings.backup.export')}
        </button>
        <button type="button" className="backup-card__button" onClick={() => fileInputRef.current?.click()}>
          {t('settings.backup.import')}
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
          <p className="backup-card__panel-title">{t('settings.backup.failed')}</p>
          <p className="backup-card__panel-text">{error}</p>
          <p className="backup-card__panel-text">{t('settings.backup.untouched')}</p>
        </div>
      )}

      {pending && (
        <div className="backup-card__panel">
          <p className="backup-card__panel-title">{pending.fileName}</p>
          <p className="backup-card__panel-text">
            {pending.meta.exportedAt
              ? t('settings.backup.exportedon', { date: pending.meta.exportedAt.slice(0, 10) })
              : t('settings.backup.nodate')}
            {pending.meta.exportedFrom ? t('settings.backup.from', { source: pending.meta.exportedFrom }) : ''}
          </p>

          <ul className="backup-card__rows">
            {pending.rows.map((row) => (
              <li key={row.field} className="backup-card__row">
                <span className="backup-card__row-label">{FIELD_LABELS[row.field]}</span>
                <span className="backup-card__row-numbers">
                  <span className="backup-card__row-current">{t('settings.backup.now', { count: row.current })}</span>
                  <span className="backup-card__row-arrow">→</span>
                  <span className="backup-card__row-added">
                    {row.added > 0 ? `+${row.added}` : '—'}
                  </span>
                  {row.skipped > 0 && <span className="backup-card__row-skipped">{t('settings.backup.skipped', { count: row.skipped })}</span>}
                </span>
              </li>
            ))}
          </ul>

          {pending.warnings.length > 0 && (
            <div className="backup-card__warnings">
              <p className="backup-card__panel-text">{t('settings.backup.repaired')}</p>
              <ul>
                {pending.warnings.slice(0, 5).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {pending.warnings.length > 5 && <li>{t('settings.backup.more', { count: pending.warnings.length - 5 })}</li>}
              </ul>
            </div>
          )}

          <button
            type="button"
            className="backup-card__button backup-card__button--primary"
            onClick={() => applyImport('merge')}
            disabled={totalToAdd === 0}
          >
            {totalToAdd > 0 ? t('settings.backup.merge', { count: totalToAdd }) : t('settings.backup.nothing')}
          </button>
          <p className="backup-card__note">
            {t('settings.backup.mergenote')}
          </p>

          <button
            type="button"
            className={`settings-screen__delete${confirmingReplace ? ' settings-screen__delete--confirm' : ''}`}
            onClick={() => (confirmingReplace ? applyImport('replace') : setConfirmingReplace(true))}
          >
            {confirmingReplace ? t('settings.backup.replaceconfirm') : t('settings.backup.replace')}
          </button>

          <button type="button" className="backup-card__cancel" onClick={reset}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {result && (
        <div className="backup-card__panel backup-card__panel--done">
          <p className="backup-card__panel-title">
            {t('settings.backup.done', { mode: t(result.report.mode === 'replace' ? 'settings.backup.modereplace' : 'settings.backup.modemerge') })}
          </p>
          <ul className="backup-card__rows">
            {Object.entries(result.report.collections).map(([field, stats]) => (
              <li key={field} className="backup-card__row">
                <span className="backup-card__row-label">{FIELD_LABELS[field]}</span>
                <span className="backup-card__row-numbers">
                  <span className="backup-card__row-added">+{stats.added}</span>
                  <span className="backup-card__row-current">{t('settings.backup.total', { count: stats.total })}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="backup-card__panel-text">
            {result.autoBackupKey
              ? t('settings.backup.autosaved', { key: result.autoBackupKey })
              : t('settings.backup.autofailed')}
          </p>
          <button type="button" className="backup-card__cancel" onClick={() => setResult(null)}>
            {t('common.close')}
          </button>
        </div>
      )}
    </div>
  )
}
