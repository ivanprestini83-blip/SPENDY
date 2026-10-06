import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { supabase } from '../../lib/supabase.js'
import { getMigrationStatus, isSupabaseConfigured, runMigration, signIn, signOut, signUp, syncNow } from '../../sync/spendySync.js'
import { ForgotPasswordForm } from './ForgotPasswordForm.jsx'
import { PasswordToggle } from './PasswordToggle.jsx'
import { canSignUp } from '../../legal/legal.js'
import { LegalConsentFields } from './LegalConsentFields.jsx'
import './SyncCard.css'

const STATUS_LABELS = {
  idle: { text: 'In attesa', tone: 'neutral' },
  syncing: { text: 'Sincronizzazione…', tone: 'busy' },
  synced: { text: 'Sincronizzato', tone: 'ok' },
  offline: { text: 'Offline — le modifiche partiranno da sole', tone: 'warn' },
  error: { text: 'Errore di sincronizzazione', tone: 'error' },
}

const formatWhen = (iso) => {
  if (!iso) return 'mai'
  const date = new Date(iso)
  return `${date.toLocaleDateString('it-IT')} alle ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
}

// La card ☁️ in Impostazioni. È l'UNICO punto dell'interfaccia che parla
// di sincronizzazione: le schermate principali restano identiche a prima,
// senza badge, banner o spinner sparsi in giro.
export function SyncCard() {
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
        <p className="settings-screen__label">☁️ Sincronizzazione</p>
        <p className="settings-screen__hint">
          Non configurata: Spendy sta salvando tutto solo su questo dispositivo. Per attivarla servono
          l&apos;indirizzo del progetto Supabase e la chiave pubblica in un file <code>.env.local</code>.
        </p>
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
          ? { tone: 'ok', text: `Caricate ${result.total} righe sul cloud. Copia di sicurezza in "${result.backupKey}".` }
          : { tone: 'neutral', text: 'Niente da caricare: i dati di questo dispositivo sono già sul cloud.' },
      )
      return null
    })

  const status = STATUS_LABELS[sync.status] ?? STATUS_LABELS.idle
  const pending = sync.outbox.length

  return (
    <div className="settings-screen__card">
      <p className="settings-screen__label">☁️ Sincronizzazione</p>

      {!session && forgot ? (
        <ForgotPasswordForm initialEmail={email} onBack={() => setForgot(false)} />
      ) : !session ? (
        <>
          <p className="settings-screen__hint">
            Accedi per ritrovare le stesse spese su telefono e computer. I dati già presenti su questo
            dispositivo restano dove sono: non viene cancellato niente.
          </p>
          <div className="sync-card__form">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Email"
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
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <PasswordToggle visible={showPassword} onToggle={() => setShowPassword((shown) => !shown)} controls="sync-card-password" />
            </div>
            <button type="button" className="sync-card__link" disabled={busy} onClick={() => setForgot(true)}>
              Password dimenticata?
            </button>
          </div>
          <button
            type="button"
            className="sync-card__primary"
            disabled={busy || !email || password.length < 6}
            onClick={() => run(() => signIn(email, password))}
          >
            {busy ? 'Attendi…' : 'Accedi'}
          </button>
          <LegalConsentFields
            title="Per creare un nuovo account:"
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
                if (!error) setMessage({ tone: 'ok', text: 'Account creato. Se richiesto, conferma l\'email e poi accedi.' })
                return error
              })
            }
          >
            Crea un account
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
              <dt>Account</dt>
              <dd>{session.user.email}</dd>
            </div>
            <div>
              <dt>Ultima sincronizzazione</dt>
              <dd>{formatWhen(sync.lastSyncAt)}</dd>
            </div>
            <div>
              <dt>In attesa di invio</dt>
              <dd>{pending === 0 ? 'niente' : `${pending} modifiche`}</dd>
            </div>
          </dl>

          {sync.error && <p className="sync-card__error">{sync.error}</p>}
          {sync.rejected?.length > 0 && (
            <p className="sync-card__error">
              {sync.rejected.length === 1 ? '1 modifica non è stata accettata' : `${sync.rejected.length} modifiche non sono state accettate`} dal
              server (per esempio un importo troppo grande): {sync.rejected.length === 1 ? 'è rimasta' : 'sono rimaste'} solo su questo dispositivo.
            </p>
          )}

          {migration?.needed && (
            <div className="sync-card__migration">
              <p className="sync-card__migration-title">
                {migration.total} righe di questo dispositivo non sono ancora sul cloud
              </p>
              <p className="sync-card__migration-text">
                Sono i dati salvati prima di attivare la sincronizzazione. Caricandoli non viene
                cancellato né sovrascritto niente, né qui né sul cloud: prima dell&apos;operazione viene
                salvata anche una copia di sicurezza.
              </p>
              <button type="button" className="sync-card__primary" disabled={busy} onClick={handleMigration}>
                {busy ? 'Caricamento…' : `Carica ${migration.total} righe sul cloud`}
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
            Sincronizza ora
          </button>
          <button type="button" className="sync-card__signout" disabled={busy} onClick={() => run(signOut)}>
            Esci dall&apos;account
          </button>
          <p className="sync-card__note">Uscendo, i tuoi dati restano salvati sul cloud e per questo account su questo dispositivo: li ritrovi rientrando.</p>
        </>
      )}

      {message && <p className={`sync-card__message sync-card__message--${message.tone}`}>{message.text}</p>}
    </div>
  )
}
