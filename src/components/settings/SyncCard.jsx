import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { supabase } from '../../lib/supabase.js'
import { getMigrationStatus, isSupabaseConfigured, runMigration, signIn, signOut, signUp, syncNow } from '../../sync/spendySync.js'
import { ForgotPasswordForm } from './ForgotPasswordForm.jsx'
import { PasswordToggle } from './PasswordToggle.jsx'
import { canSignUp } from '../../legal/legal.js'
import { LegalConsentFields } from './LegalConsentFields.jsx'
import { useLanguage } from '../../i18n/useLanguage.js'
import './SyncCard.css'

const STATUS_TONES = { idle: 'neutral', syncing: 'busy', synced: 'ok', offline: 'warn', error: 'error' }

// Data e ora dell'ultima sincronizzazione nel formato della lingua scelta.
const formatWhen = (iso, t, locale) => {
  if (!iso) return t('auth.never')
  const date = new Date(iso)
  return t('auth.when', { date: date.toLocaleDateString(locale), time: date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })
}

// La card ☁️ in Impostazioni. È l'UNICO punto dell'interfaccia che parla
// di sincronizzazione: le schermate principali restano identiche a prima,
// senza badge, banner o spinner sparsi in giro.
export function SyncCard() {
  const { t, info } = useLanguage()
  const sync = useAppStore((state) => state.sync)
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [forgot, setForgot] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // Solo per "Crea un account": due scelte distinte, mai preselezionate.
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false)
  const acceptance = { termsAccepted, privacyAcknowledged }

  useEffect(() => {
    if (!supabase) return undefined
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => listener?.subscription?.unsubscribe()
  }, [])

  if (!isSupabaseConfigured) {
    return (
      <div className="settings-screen__card">
        <p className="settings-screen__label">☁️ {t('auth.title')}</p>
        <p className="settings-screen__hint">{t('auth.notconfigured')}</p>
      </div>
    )
  }

  // Derivato durante il render invece che in un effetto: e' una funzione
  // pura dello stato, e il componente si ri-renderizza gia' a ogni
  // cambiamento di `sync` (migratedAt, lastSyncAt, coda).
  const migration = session ? getMigrationStatus() : null

  const run = async (action) => {
    setBusy(true)
    setMessage(null)
    try {
      const error = await action()
      if (error) setMessage({ tone: 'error', text: error })
    } finally {
      setBusy(false)
    }
  }

  const handleMigration = () =>
    run(async () => {
      const result = await runMigration()
      if (result.error) return String(result.error)
      setMessage(
        result.migrated
          ? { tone: 'ok', text: t('auth.migration.done', { count: result.total, key: result.backupKey }) }
          : { tone: 'neutral', text: t('auth.migration.nothing') },
      )
      return null
    })

  const statusKey = STATUS_TONES[sync.status] ? sync.status : 'idle'
  const status = { text: t(`auth.status.${statusKey}`), tone: STATUS_TONES[statusKey] }
  const pending = sync.outbox.length

  return (
    <div className="settings-screen__card">
      <p className="settings-screen__label">☁️ {t('auth.title')}</p>

      {!session && forgot ? (
        <ForgotPasswordForm initialEmail={email} onBack={() => setForgot(false)} />
      ) : !session ? (
        <>
          <p className="settings-screen__hint">{t('auth.intro')}</p>
          <div className="sync-card__form">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t('auth.email')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <div className="password-field">
              <input
                id="sync-card-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t('auth.password')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <PasswordToggle visible={showPassword} onToggle={() => setShowPassword((shown) => !shown)} controls="sync-card-password" />
            </div>
            <button type="button" className="sync-card__link" disabled={busy} onClick={() => setForgot(true)}>
              {t('auth.forgot')}
            </button>
          </div>
          <button
            type="button"
            className="sync-card__primary"
            disabled={busy || !email || password.length < 6}
            onClick={() => run(() => signIn(email, password))}
          >
            {busy ? t('auth.wait') : t('auth.signin')}
          </button>
          <LegalConsentFields
            title={t('auth.newaccount')}
            termsAccepted={termsAccepted}
            privacyAcknowledged={privacyAcknowledged}
            onTermsChange={setTermsAccepted}
            onPrivacyChange={setPrivacyAcknowledged}
          />
          <button
            type="button"
            className="sync-card__secondary"
            disabled={busy || !email || password.length < 6 || !canSignUp(acceptance)}
            onClick={() =>
              run(async () => {
                const error = await signUp(email, password, acceptance)
                if (!error) setMessage({ tone: 'ok', text: t('auth.created') })
                return error
              })
            }
          >
            {t('auth.signup')}
          </button>
        </>
      ) : (
        <>
          <div className={`sync-card__status sync-card__status--${status.tone}`}>
            <span className="sync-card__dot" aria-hidden="true" />
            <span>{status.text}</span>
          </div>

          <dl className="sync-card__rows">
            <div>
              <dt>{t('auth.account')}</dt>
              <dd>{session.user.email}</dd>
            </div>
            <div>
              <dt>{t('auth.lastsync')}</dt>
              <dd>{formatWhen(sync.lastSyncAt, t, info.locale)}</dd>
            </div>
            <div>
              <dt>{t('auth.pending')}</dt>
              <dd>{pending === 0 ? t('auth.pendingnone') : t(pending === 1 ? 'auth.pendingone' : 'auth.pendingmany', { count: pending })}</dd>
            </div>
          </dl>

          {sync.error && <p className="sync-card__error">{sync.error}</p>}
          {sync.rejected?.length > 0 && (
            <p className="sync-card__error">
              {t(sync.rejected.length === 1 ? 'auth.rejectedone' : 'auth.rejectedmany', { count: sync.rejected.length })}
            </p>
          )}

          {migration?.needed && (
            <div className="sync-card__migration">
              <p className="sync-card__migration-title">{t('auth.migration.title', { count: migration.total })}</p>
              <p className="sync-card__migration-text">{t('auth.migration.text')}</p>
              <button type="button" className="sync-card__primary" disabled={busy} onClick={handleMigration}>
                {busy ? t('auth.migration.loading') : t('auth.migration.button', { count: migration.total })}
              </button>
            </div>
          )}

          <button
            type="button"
            className="sync-card__secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                // syncNow restituisce un oggetto ({ pushed, pulled } o { error }),
                // non un testo: run() mostra come errore ogni valore "vero".
                const r = await syncNow()
                return r?.error ? String(r.error) : null
              })
            }
          >
            {t('auth.syncnow')}
          </button>
          <button type="button" className="sync-card__signout" disabled={busy} onClick={() => run(signOut)}>
            {t('auth.signout.button')}
          </button>
          <p className="sync-card__note">{t('auth.signout.note')}</p>
        </>
      )}

      {message && <p className={`sync-card__message sync-card__message--${message.tone}`}>{message.text}</p>}
    </div>
  )
}
