import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { deletedAccountsOnDevice, forgetDeletedAccount } from '../../sync/spendySync.js'
import { downloadBackup } from '../../sync/backup.js'
import { scopeFor } from '../../store/scope.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './SyncCard.css'
import './SessionGateScreen.css'

// "Dati di account eliminati" in Impostazioni (sync/sessionGate.js, M1).
// Un account la cui eliminazione è stata PROVATA da Supabase Auth, ma il cui
// contenitore è rimasto su questo dispositivo perché conteneva modifiche mai
// sincronizzate (o non si è potuto leggere). Il contenitore è nascosto e
// bloccato (nessuna scrittura); qui si può scaricarne una copia o rimuoverlo,
// uno per uno, con l'avviso su quello che andrebbe perso. Visibile solo se ce
// n'è almeno uno: per tutti gli altri la card non esiste.
export function DeletedAccountsCard() {
  const { t, info } = useLanguage()
  // Si rilegge dallo storage a ogni apertura e dopo ogni rimozione.
  const [entries, setEntries] = useState(() => deletedAccountsOnDevice())
  const [confirming, setConfirming] = useState(null)

  if (entries.length === 0) return null

  const pendingText = (unsynced) => {
    if (unsynced === null || unsynced === undefined) return t('auth.session.pendingunknown')
    if (unsynced === 0) return null
    return unsynced === 1 ? t('auth.session.forgetpendingone') : t('auth.session.forgetpendingmany', { count: unsynced })
  }
  const when = (at) => {
    const date = at ? new Date(at) : null
    return date && !Number.isNaN(date.getTime())
      ? t('auth.orphans.item', { date: date.toLocaleDateString(info?.locale ?? undefined, { day: 'numeric', month: 'long', year: 'numeric' }) })
      : t('auth.orphans.itemnodate')
  }
  const download = (userId) => {
    const state = useAppStore.getState().accountContainerState(userId)
    if (state) downloadBackup({ ...state, scopeId: scopeFor(userId) })
  }
  const remove = (userId) => {
    forgetDeletedAccount(userId)
    setConfirming(null)
    setEntries(deletedAccountsOnDevice())
  }

  return (
    <div className="settings-screen__card">
      <p className="settings-screen__label">🗂️ {t('auth.orphans.title')}</p>
      <p className="settings-screen__hint">{t('auth.orphans.text')}</p>
      {entries.map(({ userId, at, unsynced }) => (
        <div key={userId} className="session-gate__confirm">
          <p className="settings-screen__hint">{when(at)}</p>
          {pendingText(unsynced) && (
            <p className="sync-card__message sync-card__message--error">{pendingText(unsynced)}</p>
          )}
          <button type="button" className="sync-card__secondary" onClick={() => download(userId)}>
            {t('auth.orphans.download')}
          </button>
          {confirming === userId ? (
            <>
              <p className="settings-screen__hint">{t('auth.orphans.confirm')}</p>
              <button type="button" className="sync-card__signout" onClick={() => remove(userId)}>
                {t('auth.session.forgetfinal')}
              </button>
              <button type="button" className="sync-card__secondary" onClick={() => setConfirming(null)}>
                {t('auth.session.cancel')}
              </button>
            </>
          ) : (
            <button type="button" className="sync-card__signout" onClick={() => setConfirming(userId)}>
              {t('auth.orphans.remove')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
