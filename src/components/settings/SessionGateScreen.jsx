import { useState, useSyncExternalStore } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { SESSION_ENDED, getSessionGateState, subscribeSessionGate } from '../../sync/sessionGate.js'
import { continueWithoutAccount, forgetGatedAccount } from '../../sync/spendySync.js'
import { SyncCard } from './SyncCard.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'
import './SyncCard.css'
import './PasswordRecoveryScreen.css'
import './SessionGateScreen.css'

// La schermata del "cancello" della sessione (sync/sessionGate.js).
//   'ended'   sessione finita senza un logout da qui: i dati dell'account sono
//             nascosti (App.jsx non disegna la sua schermata) ma intatti.
//             Rientrare con lo stesso account li fa tornare; si può continuare
//             senza account o, su richiesta esplicita, rimuoverli da qui.
//   'deleted' Supabase Auth ha confermato che l'account non esiste più: dati
//             rimossi, oppure (se c'erano modifiche mai sincronizzate) ancora
//             nascosti in attesa di una scelta.
// Sta fuori dalla schermata "a chiave" di App.jsx, come LegalGateScreen.
export function SessionGateScreen() {
  const gate = useSyncExternalStore(subscribeSessionGate, getSessionGateState, getSessionGateState)
  if (!gate) return null
  // Una schermata nuova riparte da zero (niente conferma rimasta a metà).
  return <SessionGateCard key={`${gate.status}:${gate.userId}`} gate={gate} />
}

function SessionGateCard({ gate }) {
  const { t } = useLanguage()
  const [confirming, setConfirming] = useState(false)
  const activeUnsynced = useAppStore((state) => (state.sync?.outbox?.length ?? 0) + (state.sync?.rejected?.length ?? 0))
  const ended = gate.status === SESSION_ENDED
  // Le modifiche mai sincronizzate che una rimozione cancellerebbe.
  const pending = ended ? activeUnsynced : gate.pending

  const pendingText = (oneKey, manyKey) => {
    if (pending === null || pending === undefined) return t('auth.session.pendingunknown')
    return pending === 1 ? t(oneKey) : t(manyKey, { count: pending })
  }

  const forget = confirming ? (
    <div className="session-gate__confirm">
      <p className="settings-screen__hint">{t('auth.session.forgetconfirm')}</p>
      {pending !== 0 && (
        <p className="sync-card__message sync-card__message--error" role="alert">
          {pendingText('auth.session.forgetpendingone', 'auth.session.forgetpendingmany')}
        </p>
      )}
      <button type="button" className="sync-card__signout" onClick={() => forgetGatedAccount()}>
        {t('auth.session.forgetfinal')}
      </button>
      <button type="button" className="sync-card__secondary" onClick={() => setConfirming(false)}>
        {t('auth.session.cancel')}
      </button>
    </div>
  ) : (
    <button type="button" className="sync-card__signout" onClick={() => setConfirming(true)}>
      {t('auth.session.forget')}
    </button>
  )

  if (ended) {
    return (
      <div className="recovery-screen session-gate" role="dialog" aria-modal="true" aria-label={t('auth.session.dialog')}>
        <div className="recovery-screen__card session-gate__stack">
          <div className="settings-screen__card">
            <p className="settings-screen__label">🔒 {t('auth.session.endedtitle')}</p>
            <p className="settings-screen__hint">{t('auth.session.endedtext')}</p>
          </div>
          <SyncCard />
          <div className="settings-screen__card">
            <button type="button" className="sync-card__primary" onClick={() => continueWithoutAccount()}>
              {t('auth.session.continue')}
            </button>
            {forget}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="recovery-screen session-gate" role="dialog" aria-modal="true" aria-label={t('auth.session.dialog')}>
      <div className="recovery-screen__card settings-screen__card">
        <p className="settings-screen__label">🗑️ {t('auth.session.deletedtitle')}</p>
        {gate.removed ? (
          <p className="settings-screen__hint">{t('auth.session.deletedremoved')}</p>
        ) : (
          <>
            <p className="settings-screen__hint">{t('auth.session.deletedkept')}</p>
            <p className="sync-card__message sync-card__message--error" role="alert">
              {pendingText('auth.session.deletedpendingone', 'auth.session.deletedpendingmany')}
            </p>
            {/* Avviso ripreso dopo un refresh: non sa di quale account si tratta
                (non salva l'id). La rimozione è in Impostazioni. */}
            {gate.userId && forget}
            <p className="sync-card__note">{t('auth.session.deletedlater')}</p>
          </>
        )}
        <button type="button" className="sync-card__primary" onClick={() => continueWithoutAccount()}>
          {t('auth.session.close')}
        </button>
      </div>
    </div>
  )
}
