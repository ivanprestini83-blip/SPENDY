import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { useAppStore } from '../store/useAppStore.js'
import { createSupabaseRemote } from './supabaseRemote.js'
import { createSyncEngine } from './syncEngine.js'
import { migrateLocalToCloud, migrationStatus } from './migrateLocal.js'
import { GUEST, scopeFor } from '../store/scope.js'

// Il punto unico in cui l'app accende la sincronizzazione. Un solo
// motore per tutta la sessione, avviato da App.jsx e comandato dalla
// card in Impostazioni: nessun'altra parte della UI sa che esiste.

let engine = null
let currentUserId = null

function startFor(userId) {
  if (currentUserId === userId && engine) return
  engine?.stop()

  // I dati locali cambiano ambito PRIMA di avviare il motore: il motore di un
  // account parte solo nel contenitore di quell'account (engine.start lo
  // verifica), e lo stato in memoria non porta più niente dell'account
  // precedente. Se l'ambito è già quello giusto non succede nulla.
  useAppStore.getState().switchScope(scopeFor(userId))

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
    if (session) {
      startFor(session.user.id)
      return
    }
    stopEngine()
    // Sessione finita. Qui NON si cambia mai ambito: se è scaduta resta quello
    // di A; se l'utente sta uscendo, a decidere è signOut(), che sa se la
    // chiusura è riuscita. (Il client Supabase emette SIGNED_OUT anche quando
    // la chiusura FALLISCE: cancella la sessione locale e poi restituisce
    // l'errore. Passare a guest da qui nascondeva i dati con l'errore ancora
    // in arrivo.)
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

// Esce dall'account da QUESTO dispositivo, spegne il motore e passa all'ambito
// guest: l'app torna a mostrare uno stato vuoto, come un primo avvio, e chi
// entra dopo non vede niente di chi è uscito. NON cancella niente, né dal cloud
// né dal dispositivo: i dati restano nel contenitore locale dell'account e
// rientrando si ritrovano tutti, coda di invio compresa.
//
// scope 'local': chiude solo la sessione di questo dispositivo. Il default del
// client è 'global', che chiuderebbe anche quella degli altri dispositivi.
//
// Se la chiusura non riesce (per esempio senza rete) NON si cambia ambito e si
// restituisce l'errore. Il client, in quel caso, ha già cancellato la sessione
// locale: la si ripristina con i token salvati prima, così l'account resta
// attivo. Se nemmeno il ripristino riesce l'ambito resta comunque quello
// dell'account (come per una sessione scaduta): i dati restano e basta
// rientrare con lo stesso account.
export const SIGNOUT_OFFLINE_MESSAGE = 'Sei offline: per uscire serve la connessione. Sei ancora nell\u2019account su questo dispositivo, riprova quando torna la rete.'
export const SIGNOUT_FAILED_MESSAGE = 'Non è stato possibile chiudere la sessione. Sei ancora nell\u2019account su questo dispositivo, riprova quando c\u2019è connessione.'
export const SIGNOUT_RELOGIN_MESSAGE = 'Non è stato possibile chiudere la sessione e l\u2019accesso non è più attivo. I tuoi dati su questo dispositivo sono intatti: rientra con lo stesso account.'

export async function signOut() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return SIGNOUT_OFFLINE_MESSAGE

  let saved = null
  try {
    const { data } = await supabase.auth.getSession()
    if (data?.session?.access_token && data.session.refresh_token) {
      saved = { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
    }
  } catch {
    saved = null
  }

  let failure = null
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    failure = error ?? null
  } catch (error) {
    failure = error ?? new Error('signOut')
  }

  if (failure) {
    if (!saved) return SIGNOUT_RELOGIN_MESSAGE
    try {
      const { data, error } = await supabase.auth.setSession(saved)
      if (!error && data?.session) return SIGNOUT_FAILED_MESSAGE
    } catch {
      // il ripristino richiede rete: vedi sotto
    }
    return SIGNOUT_RELOGIN_MESSAGE
  }

  stopEngine()
  useAppStore.getState().switchScope(GUEST)
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
