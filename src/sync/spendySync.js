import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { useAppStore } from '../store/useAppStore.js'
import { createSupabaseRemote } from './supabaseRemote.js'
import { createSyncEngine } from './syncEngine.js'
import { migrateLocalToCloud, migrationStatus } from './migrateLocal.js'

// Il punto unico in cui l'app accende la sincronizzazione. Un solo
// motore per tutta la sessione, avviato da App.jsx e comandato dalla
// card in Impostazioni: nessun'altra parte della UI sa che esiste.

let engine = null
let currentUserId = null

function startFor(userId) {
  if (currentUserId === userId && engine) return
  engine?.stop()

  // Il cambio di account (cursori da azzerare, coda del vecchio utente da
  // non spedire al nuovo) e' gestito dentro engine.start().
  engine = createSyncEngine({ store: useAppStore, remote: createSupabaseRemote(supabase) })
  currentUserId = userId
  return engine.start(userId)
}

function stopEngine() {
  engine?.stop()
  engine = null
  currentUserId = null
  useAppStore.getState().setSyncStatus({ status: 'idle', error: null })
}

// Chiamata una volta da App.jsx. Se Supabase non e' configurato non fa
// niente e l'app resta quella di sempre, tutta locale.
export function bootstrapSync() {
  if (!isSupabaseConfigured) return () => {}

  supabase.auth.getSession().then(({ data }) => {
    if (data.session) startFor(data.session.user.id)
  })

  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session) startFor(session.user.id)
    else stopEngine()
  })

  return () => listener?.subscription?.unsubscribe()
}

export const syncNow = () => engine?.syncNow() ?? Promise.resolve({ skipped: 'sync non attivo' })

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error?.message ?? null
}

export async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password })
  return error?.message ?? null
}

// Esce dall'account e spegne il motore. NON cancella niente in locale:
// le spese restano sul dispositivo (e nel cloud), e rientrando si
// ritrovano tutte. Un logout che svuota i dati e' esattamente il tipo di
// scorciatoia che fa perdere il lavoro di settimane.
export async function signOut() {
  await supabase.auth.signOut()
  stopEngine()
  return null
}

export function getMigrationStatus() {
  return migrationStatus(useAppStore.getState(), currentUserId)
}

// Esplicita: la lancia l'utente dalla card, mai l'app da sola.
export async function runMigration() {
  if (!engine || !currentUserId) return { migrated: false, error: 'sync non attivo' }
  return migrateLocalToCloud({ store: useAppStore, engine, userId: currentUserId })
}

export { isSupabaseConfigured }
