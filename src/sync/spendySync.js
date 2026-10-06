import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { useAppStore } from '../store/useAppStore.js'
import { createSupabaseRemote } from './supabaseRemote.js'
import { createSyncEngine } from './syncEngine.js'
import { migrateLocalToCloud, migrationStatus } from './migrateLocal.js'
import { GUEST, retireScope, scopeFor } from '../store/scope.js'
import { DELETE_ACCOUNT_MESSAGES, requestAccountDeletion } from '../lib/accountDeletion.js'
import { SIGNUP_ACCEPTANCE_REQUIRED, buildSignUpMetadata, canSignUp } from '../legal/legal.js'
import {
  LEGAL_GATE_MESSAGES, currentLegalVersionKey, getLegalGateState, needsAcceptance, requestLegalAcceptance, setLegalGateState,
} from '../legal/legalGate.js'

// Il punto unico in cui l'app accende la sincronizzazione. Un solo
// motore per tutta la sessione, avviato da App.jsx e comandato dalla
// card in Impostazioni: nessun'altra parte della UI sa che esiste.

let engine = null
let currentUserId = null
let legalCheck = null // { userId, promise }: una sola verifica per volta

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false
const stillCurrent = (userId) => currentUserId === userId && useAppStore.getState().scopeId === scopeFor(userId)

function startFor(userId) {
  // Già aperto, o in attesa dei documenti (verifica in corso o schermata
  // mostrata): un altro evento della stessa sessione non rifà niente.
  if (currentUserId === userId && (engine || legalCheck?.userId === userId || getLegalGateState()?.userId === userId)) return
  engine?.stop()
  engine = null

  // I dati locali cambiano ambito PRIMA di avviare il motore: il motore di un
  // account parte solo nel contenitore di quell'account (engine.start lo
  // verifica), e lo stato in memoria non porta più niente dell'account
  // precedente. Se l'ambito è già quello giusto non succede nulla.
  useAppStore.getState().switchScope(scopeFor(userId))
  currentUserId = userId
  return openAccount(userId)
}

function startEngine(userId) {
  engine?.stop()
  engine = createSyncEngine({ store: useAppStore, remote: createSupabaseRemote(supabase) })
  return engine.start(userId)
}

// --- Termini e Privacy prima del sync ------------------------------------
// Il sync di un account parte SOLO se il server ha registrato che l'utente ha
// accettato i Termini e preso visione della Privacy Policy nella versione
// corrente (legal_acceptances, letta con la sessione dell'utente: la RLS
// mostra solo la sua riga). Altrimenti: LegalGateScreen, e nessun sync.

async function readLegalAcceptance(userId) {
  const { data, error } = await supabase
    .from('legal_acceptances')
    .select('terms_version, privacy_version')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

function openAccount(userId) {
  // Già confermato dal server su QUESTO dispositivo, per queste versioni:
  // l'account si apre subito, anche offline. Il server viene comunque
  // ricontrollato, e se la riga non c'è più la schermata torna.
  if (useAppStore.getState().legalAcceptedVersion === currentLegalVersionKey()) {
    setLegalGateState(null)
    const started = startEngine(userId)
    recheckInBackground(userId)
    return started
  }
  return checkLegal(userId)
}

function checkLegal(userId) {
  if (legalCheck?.userId === userId) return legalCheck.promise
  const promise = runLegalCheck(userId).finally(() => {
    if (legalCheck?.promise === promise) legalCheck = null
  })
  legalCheck = { userId, promise }
  return promise
}

async function runLegalCheck(userId) {
  setLegalGateState({ status: 'checking', userId })
  if (isOffline()) {
    setLegalGateState({ status: 'unavailable', userId, message: LEGAL_GATE_MESSAGES.offline })
    return { skipped: 'legal-unavailable' }
  }
  let row
  try {
    row = await readLegalAcceptance(userId)
  } catch {
    if (stillCurrent(userId)) {
      setLegalGateState({ status: 'unavailable', userId, message: isOffline() ? LEGAL_GATE_MESSAGES.offline : LEGAL_GATE_MESSAGES.unavailable })
    }
    return { skipped: 'legal-unavailable' }
  }
  if (!stillCurrent(userId)) return { skipped: 'scope-changed' }
  if (needsAcceptance(row)) {
    setLegalGateState({ status: 'required', userId })
    return { skipped: 'legal-required' }
  }
  useAppStore.getState().setLegalAcceptedVersion(currentLegalVersionKey())
  setLegalGateState(null)
  return startEngine(userId)
}

async function recheckInBackground(userId) {
  if (isOffline()) return
  let row
  try {
    row = await readLegalAcceptance(userId)
  } catch {
    return // nessuna risposta: resta valida la conferma già ricevuta
  }
  if (!stillCurrent(userId) || !needsAcceptance(row)) return
  engine?.stop()
  engine = null
  useAppStore.getState().setLegalAcceptedVersion(null)
  setLegalGateState({ status: 'required', userId })
}

// "Riprova" della schermata quando la verifica non è stata possibile.
export function retryLegalCheck() {
  return currentUserId ? checkLegal(currentUserId) : Promise.resolve({ skipped: 'nessun utente' })
}

// "Accetto e continuo". Registra l'accettazione SOLO lato server (Edge Function
// accept-legal, orario del server); il sync parte solo dopo { accepted: true }.
// Un secondo tocco riceve la stessa operazione. → null se riuscita, altrimenti
// il messaggio d'errore (e la schermata resta).
let acceptInFlight = null

export function acceptLegalDocuments(acceptance) {
  if (acceptInFlight) return acceptInFlight
  acceptInFlight = (async () => {
    const userId = currentUserId
    if (!supabase || !userId) return LEGAL_GATE_MESSAGES.unauthenticated
    if (!canSignUp(acceptance)) return LEGAL_GATE_MESSAGES.required
    if (isOffline()) {
      setLegalGateState({ status: 'required', userId, error: LEGAL_GATE_MESSAGES.offline })
      return LEGAL_GATE_MESSAGES.offline
    }
    setLegalGateState({ status: 'submitting', userId })
    const result = await requestLegalAcceptance(supabase)
    if (!stillCurrent(userId)) return LEGAL_GATE_MESSAGES.failed
    if (!result.ok) {
      setLegalGateState({ status: 'required', userId, error: result.message })
      return result.message
    }
    useAppStore.getState().setLegalAcceptedVersion(currentLegalVersionKey())
    setLegalGateState(null)
    startEngine(userId)
    return null
  })().finally(() => {
    acceptInFlight = null
  })
  return acceptInFlight
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

// La registrazione parte solo con Termini accettati e Privacy Policy presa
// visione (due scelte distinte, vedi legal/legal.js): la UI disabilita il
// pulsante, e qui lo si rifiuta comunque, senza nessuna chiamata.
export async function signUp(email, password, acceptance) {
  const metadata = buildSignUpMetadata(acceptance)
  if (!metadata) return SIGNUP_ACCEPTANCE_REQUIRED
  const { error } = await supabase.auth.signUp({ email, password, options: { data: metadata } })
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
  setLegalGateState(null)
  return null
}

// Elimina DEFINITIVAMENTE l'account attivo. Ordine voluto:
//   1. il server cancella l'utente (Edge Function delete-account; i dati sul
//      cloud spariscono a cascata). Se fallisce, qui non si tocca NIENTE:
//      sessione, ambito e dati locali restano come prima e torna l'errore;
//   2. solo dopo il successo: motore spento, sessione chiusa su questo
//      dispositivo, ambito guest, e via i dati locali di QUELL'account
//      (nessun altro account, niente guest, niente vecchio 'spendy-storage').
// Una sola richiesta per volta: un secondo tocco riceve la stessa promessa.
// → null se riuscita, altrimenti il messaggio d'errore.
let deletionInFlight = null

export function deleteAccount() {
  if (deletionInFlight) return deletionInFlight
  deletionInFlight = (async () => {
    if (!supabase) return DELETE_ACCOUNT_MESSAGES.noSession
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return DELETE_ACCOUNT_MESSAGES.offline

    let userId = null
    try {
      const { data } = await supabase.auth.getSession()
      userId = data?.session?.user?.id ?? null
    } catch {
      userId = null
    }
    if (!userId) return DELETE_ACCOUNT_MESSAGES.noSession

    const result = await requestAccountDeletion(supabase)
    if (!result.ok) return result.message

    // Da qui l'account non esiste più: niente di ciò che arriva dopo (una
    // frase di Spendy AI già partita, per esempio) può riscrivere i suoi dati.
    retireScope(scopeFor(userId))
    stopEngine()
    try {
      // L'utente non esiste più sul server: la chiusura può rispondere con un
      // errore, ma il client toglie comunque la sessione da questo dispositivo.
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      // vedi sopra: niente da recuperare, l'account è già stato eliminato
    }
    useAppStore.getState().switchScope(GUEST)
    useAppStore.getState().forgetAccountData(userId)
    setLegalGateState(null)
    return null
  })().finally(() => {
    deletionInFlight = null
  })
  return deletionInFlight
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
