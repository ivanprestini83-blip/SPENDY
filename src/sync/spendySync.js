import { supabase, isSupabaseConfigured, startupStoredSessionUser, supabaseAnonKey, supabaseUrl } from '../lib/supabase.js'
import { useAppStore } from '../store/useAppStore.js'
import { createSupabaseRemote } from './supabaseRemote.js'
import { createSyncEngine } from './syncEngine.js'
import { migrateLocalToCloud, migrationStatus } from './migrateLocal.js'
import { GUEST, RETIRED_DELETED, RETIRED_REMOVED, RETIRED_SCOPES_KEY, ownerOf, retireScope, scopeFor } from '../store/scope.js'
import { DELETE_ACCOUNT_MESSAGES, requestAccountDeletion } from '../lib/accountDeletion.js'
import {
  ACCOUNT_DELETED, ACCOUNT_UNKNOWN, SESSION_DELETED, SESSION_ENDED, getSessionGateState, isRetryableAuthError, probeAccount, readDeletedNotice,
  readEndedScope, setSessionGateState, writeDeletedNotice, writeEndedScope,
} from './sessionGate.js'
import { LEGAL_MESSAGES, buildSignUpMetadata, canSignUp } from '../legal/legal.js'
import { authErrorMessage } from '../lib/authMessages.js'
import { tr } from '../i18n/currentLanguage.js'
import {
  accountLanguage, accountMetadataFor, deviceStorage, readLanguagePreference, reconcileLanguage, subscribeLanguagePreference,
} from '../i18n/languagePreference.js'
import {
  LEGAL_GATE_MESSAGES, currentLegalVersionKey, getLegalGateState, needsAcceptance, requestLegalAcceptance, setLegalGateState,
} from '../legal/legalGate.js'

// Il punto unico in cui l'app accende la sincronizzazione. Un solo
// motore per tutta la sessione, avviato da App.jsx e comandato dalla
// card in Impostazioni: nessun'altra parte della UI sa che esiste.

let engine = null
let currentUserId = null
let legalCheck = null // { userId, promise }: una sola verifica per volta
// L'ultima sessione vista (id e token), SOLO in memoria: serve a chiedere ad
// Auth se l'account esiste ancora quando la sessione finisce (sessionGate.js).
let lastSession = null
// Chi è l'utente della sessione corrente (null = nessuno) e una "generazione"
// che cambia a ogni cambio di identità (accesso di un altro utente, fine della
// sessione). Una verifica asincrona applica i suoi effetti visibili solo se,
// quando la risposta arriva, generazione e ambito sono ancora quelli di quando
// è partita (L1/L2).
let authIdentity = null
let authGeneration = 0
// > 0 mentre è l'app stessa a chiudere la sessione (logout, eliminazione
// dell'account): quel SIGNED_OUT è voluto, non va trattato come inatteso.
let voluntaryExit = 0
let lastProbeAt = 0
// La verifica "l'account esiste ancora?" (una richiesta a Supabase Auth,
// nessun dato) parte all'avvio, quando la pagina torna attiva (focus,
// pageshow, visibilitychange) e ogni 5 minuti mentre l'app è visibile. Mai
// due insieme (probeFlight) e mai più di una ogni 30 secondi, salvo quelle
// "forzate" (avvio, controllo dei Termini) che riusano comunque quella in volo.
const PROBE_INTERVAL_MS = 5 * 60 * 1000
const PROBE_MIN_GAP_MS = 30 * 1000
let probeFlight = null
// Un SIGNED_OUT non voluto visto prima che ci sia una sessione: in particolare
// quello che la libreria emette mentre si inizializza, quando la sessione
// salvata viene rifiutata dal server (dispositivo rimasto chiuso a lungo,
// account eliminato o sessione revocata nel frattempo). È una prova che la
// sessione dell'ambito attivo c'era ed è FINITA; la sola assenza di sessione no.
let sawUnexpectedSignOut = false
if (isSupabaseConfigured && typeof supabase?.auth?.onAuthStateChange === 'function') {
  // Registrato appena il modulo si carica: l'inizializzazione del client è
  // asincrona (legge lo storage e rinnova il token), quindi arriva dopo.
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) sawUnexpectedSignOut = false
    else if (event === 'SIGNED_OUT' && voluntaryExit === 0) sawUnexpectedSignOut = true
  })
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false
const stillCurrent = (userId) => currentUserId === userId && useAppStore.getState().scopeId === scopeFor(userId)

function rememberSession(session) {
  lastSession = session?.user?.id && session.access_token ? { userId: session.user.id, accessToken: session.access_token } : null
}

function noteIdentity(userId) {
  const next = userId ?? null
  if (next === authIdentity) return
  authIdentity = next
  authGeneration += 1
}

// URL del progetto e chiave pubblica: gli stessi del client (nessun segreto).
const probeConfig = () => ({
  url: supabaseUrl,
  apiKey: supabaseAnonKey,
  fetch: typeof globalThis.fetch === 'function' ? (...args) => globalThis.fetch(...args) : null,
})

function startFor(userId) {
  // Un account la cui eliminazione è stata PROVATA su questo dispositivo non si
  // riapre (una sessione salvata con un token ancora valido): si chiude e basta.
  if (useAppStore.getState().retiredReasonFor(userId) === RETIRED_DELETED) {
    closeSessionOf(userId)
    return
  }
  // Una sessione vera dimostra che l'account esiste: un contenitore rimosso a
  // mano (non per eliminazione) torna utilizzabile.
  useAppStore.getState().reinstateAccountScope(userId)
  // Una sessione valida chiude la schermata "sessione terminata": con lo stesso
  // account i dati tornano, con un altro cambia ambito qui sotto.
  if (getSessionGateState()) setSessionGateState(null)
  writeEndedScope(deviceStorage(), null)
  // Chi accede è andato oltre l'account eliminato: l'avviso non si ripropone.
  writeDeletedNotice(deviceStorage(), null)
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
    // La riga manca anche quando l'account è stato eliminato (cascata): prima
    // di chiedere di accettare si aspetta la verifica dell'account.
    if (await accountGone(userId)) return { skipped: 'account-deleted' }
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
  // Come sopra: la riga sparita può voler dire "account eliminato".
  if (await accountGone(userId)) return
  engine?.stop()
  engine = null
  useAppStore.getState().setLegalAcceptedVersion(null)
  setLegalGateState({ status: 'required', userId })
}

// La riga dei Termini manca: l'account esiste ancora? Riusa la verifica già in
// volo. → true se l'account è stato eliminato o se nel frattempo la scena è
// cambiata (in entrambi i casi la schermata dei Termini non serve più).
async function accountGone(userId) {
  const verdict = await probeCurrentAccount({ force: true })
  return verdict === ACCOUNT_DELETED || !stillCurrent(userId)
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

// --- lingua dell'account ----------------------------------------------------
// La lingua segue l'account nei metadati di Supabase Auth (user_metadata), non
// nel sync dei dati: la riga delle impostazioni (profiles) porta budget, ciclo
// e valuta e non viene mai scritta per una lingua. Niente di qui blocca
// l'accesso, il sync o i documenti: un errore lascia la lingua del dispositivo
// e il salvataggio riparte al prossimo accesso (regola in languagePreference.js).

let languagePush = null // { key, promise }: un solo salvataggio per volta

export function saveLanguageToAccount(metadata) {
  if (!supabase || !metadata || isOffline()) return Promise.resolve(false)
  const key = JSON.stringify(metadata)
  if (languagePush?.key === key) return languagePush.promise
  const promise = (async () => {
    try {
      // `data` aggiunge queste chiavi ai metadati: quelle dei documenti legali restano.
      const { error } = await supabase.auth.updateUser({ data: metadata })
      return !error
    } catch {
      return false
    }
  })().finally(() => {
    if (languagePush?.promise === promise) languagePush = null
  })
  languagePush = { key, promise }
  return promise
}

// Dopo l'accesso e a ogni aggiornamento della sessione: adotta la lingua
// dell'account oppure le salva quella del dispositivo. → la promessa del
// salvataggio, o null se non serviva.
export function reconcileAccountLanguage(user) {
  if (!user) return null
  try {
    const { apply, push } = reconcileLanguage(readLanguagePreference(deviceStorage()), accountLanguage(user))
    if (apply) useAppStore.getState().setLanguage(apply.language, { source: 'account', chosenAt: apply.chosenAt })
    return push ? saveLanguageToAccount(push) : null
  } catch {
    return null
  }
}

// Chiamata una volta da App.jsx. Se Supabase non e' configurato non fa
// niente e l'app resta quella di sempre, tutta locale.
export function bootstrapSync() {
  if (!isSupabaseConfigured) return () => {}

  // Un'altra scheda (o un'apertura precedente) può aver invalidato l'ambito
  // attivo: si esce da lì prima di tutto.
  reactToRetiredActiveScope()
  // Un avviso "Account eliminato" non ancora chiuso torna dopo un refresh.
  showPersistedDeletedNotice()

  supabase.auth.getSession().then(({ data, error }) => {
    if (data?.session) {
      noteIdentity(data.session.user.id)
      rememberSession(data.session)
      startFor(data.session.user.id)
      reconcileAccountLanguage(data.session.user)
      probeCurrentAccount({ force: true })
      return
    }
    // Nessuna sessione. Se è per la rete (token scaduto e rinnovo impossibile
    // offline) la libreria la conserva e la rinnova appena torna la rete: si
    // resta come sempre, utilizzabili offline. Se invece c'è la prova che la
    // sessione dell'ambito attivo è finita, i dati restano nascosti finché non
    // si rientra. Le prove: c'era una sessione salvata di quell'account e la
    // libreria l'ha tolta (rifiutata all'avvio, lib/supabase.js), oppure un
    // SIGNED_OUT non voluto, oppure la schermata era già mostrata prima di un
    // riavvio. La sola assenza di sessione non basta.
    if (isRetryableAuthError(error)) return
    const scope = useAppStore.getState().scopeId
    const storedWasThisAccount = Boolean(startupStoredSessionUser) && scope === scopeFor(startupStoredSessionUser)
    if (sawUnexpectedSignOut || storedWasThisAccount || readEndedScope(deviceStorage()) === scope) lockEndedSession()
  }).catch(() => null)

  // La pagina torna attiva: l'account esiste ancora? (Eliminato da un altro
  // dispositivo nel frattempo.) Il solo cambio di finestra non genera
  // visibilitychange: servono anche focus e pageshow (ritorno dalla cache).
  const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  const onActive = () => {
    if (!isVisible()) return
    if (!reactToRetiredActiveScope()) probeCurrentAccount()
  }
  const doc = typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : null
  doc?.addEventListener('visibilitychange', onActive)
  const periodic = setInterval(() => {
    if (isVisible()) probeCurrentAccount()
  }, PROBE_INTERVAL_MS)
  // Un'altra scheda ha invalidato un ambito (account eliminato o dati rimossi):
  // se è quello aperto qui, si esce subito. È solo per l'interfaccia: le
  // scritture sono già bloccate dallo storage (store/scope.js).
  const onStorage = (event) => {
    if (!event || event.key === null || event.key === RETIRED_SCOPES_KEY) reactToRetiredActiveScope()
  }
  const win = typeof window !== 'undefined' ? window : null
  if (typeof win?.addEventListener === 'function') {
    win.addEventListener('storage', onStorage)
    win.addEventListener('focus', onActive)
    win.addEventListener('pageshow', onActive)
  }

  // Una lingua scelta in Impostazioni con un account aperto: subito anche
  // nell'account (offline riparte al prossimo accesso).
  const stopLanguage = subscribeLanguagePreference((preference) => {
    if (preference.source !== 'settings') return
    supabase.auth.getSession()
      .then(({ data }) => (data?.session ? saveLanguageToAccount(accountMetadataFor(preference)) : null))
      .catch(() => null)
  })

  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      noteIdentity(session.user.id)
      rememberSession(session)
      startFor(session.user.id)
      reconcileAccountLanguage(session.user)
      return
    }
    noteIdentity(null)
    stopEngine()
    // Sessione finita. Qui NON si cambia mai ambito: se l'utente sta uscendo,
    // a decidere è signOut(), che sa se la chiusura è riuscita. (Il client
    // Supabase emette SIGNED_OUT anche quando la chiusura FALLISCE: cancella la
    // sessione locale e poi restituisce l'errore. Passare a guest da qui
    // nascondeva i dati con l'errore ancora in arrivo.)
    // Un SIGNED_OUT che NON viene da qui (rinnovo rifiutato dal server: uscita
    // da un altro dispositivo, cambio password, account eliminato…) nasconde
    // invece i dati dell'account, senza cancellarli (sessionGate.js). La
    // libreria non lo emette per un errore di rete.
    if (event === 'SIGNED_OUT' && voluntaryExit === 0) handleUnexpectedSignOut()
  })

  return () => {
    stopLanguage()
    listener?.subscription?.unsubscribe()
    clearInterval(periodic)
    if (typeof doc?.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onActive)
    if (typeof win?.removeEventListener === 'function') {
      win.removeEventListener('storage', onStorage)
      win.removeEventListener('focus', onActive)
      win.removeEventListener('pageshow', onActive)
    }
  }
}

// --- sessione finita / account eliminato altrove (sessionGate.js) ----------

// Nasconde i dati dell'account attivo (ambito u:<id>) senza toccarli: la
// schermata dell'account non viene disegnata finché non si rientra.
function lockEndedSession() {
  const owner = ownerOf(useAppStore.getState().scopeId)
  if (!owner) return null
  setLegalGateState(null) // senza sessione non c'è niente da accettare
  setSessionGateState({ status: SESSION_ENDED, userId: owner })
  writeEndedScope(deviceStorage(), scopeFor(owner))
  return owner
}

function handleUnexpectedSignOut() {
  const owner = lockEndedSession()
  const known = owner && lastSession?.userId === owner ? lastSession : null
  lastSession = null
  // Se il token di quell'account è ancora valido si può chiedere ad Auth se
  // l'account esiste ancora (scaduto: niente prova, i dati restano nascosti).
  if (known) verifyAccount(owner, known.accessToken)
}

// La verifica. Le sue conseguenze riguardano SOLO userId (il token è suo, lo
// controlla probeAccount). Se nel frattempo la scena è cambiata (un altro
// utente è entrato, la sessione è finita, l'ambito attivo è un altro), la
// pulizia dei dati di userId si fa comunque, ma senza toccare la sessione
// corrente e senza mostrare niente a chi sta usando l'app (L1/L2).
async function verifyAccount(userId, accessToken) {
  if (!supabase || isOffline()) return ACCOUNT_UNKNOWN
  const generation = authGeneration
  const scope = useAppStore.getState().scopeId
  const verdict = await probeAccount(probeConfig(), { userId, accessToken })
  if (verdict === ACCOUNT_DELETED) {
    const unchanged = generation === authGeneration && useAppStore.getState().scopeId === scope
    await settleDeletedAccount(userId, { interactive: unchanged })
  }
  return verdict
}

// Con la sessione corrente: all'avvio, quando la pagina torna attiva, ogni 5
// minuti e prima di chiedere di accettare i Termini. Una sola alla volta (chi
// arriva mentre una è in volo riceve la stessa promessa); quelle non forzate
// al massimo una ogni PROBE_MIN_GAP_MS. → l'esito (ACCOUNT_*)
function probeCurrentAccount({ force = false } = {}) {
  if (probeFlight) return probeFlight
  if (!supabase || isOffline()) return Promise.resolve(ACCOUNT_UNKNOWN)
  const now = Date.now()
  if (!force && now - lastProbeAt < PROBE_MIN_GAP_MS) return Promise.resolve(ACCOUNT_UNKNOWN)
  lastProbeAt = now
  const flight = (async () => {
    let session = null
    try {
      const { data } = await supabase.auth.getSession()
      session = data?.session ?? null
    } catch {
      return ACCOUNT_UNKNOWN
    }
    const userId = session?.user?.id
    if (!userId || useAppStore.getState().scopeId !== scopeFor(userId)) return ACCOUNT_UNKNOWN
    return verifyAccount(userId, session.access_token)
  })().catch(() => ACCOUNT_UNKNOWN).finally(() => {
    if (probeFlight === flight) probeFlight = null
  })
  probeFlight = flight
  return flight
}

// Chiude su QUESTO dispositivo la sessione di userId, solo se è proprio la sua
// (mai quella di un altro utente entrato nel frattempo).
async function closeSessionOf(userId) {
  voluntaryExit += 1
  try {
    const { data } = await supabase.auth.getSession()
    if (data?.session?.user?.id === userId) await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // la sessione di un account che non esiste più: niente da recuperare
  } finally {
    voluntaryExit -= 1
  }
}

// L'account NON esiste più (provato da Auth).
//   1. l'ambito viene invalidato per tutte le schede: da qui nessuna scrittura;
//   2. motore spento; la sessione di quell'account chiusa qui (solo se la scena
//      non è cambiata nel frattempo e la sessione è proprio la sua);
//   3. se era aperto qui, si passa all'ambito guest;
//   4. il contenitore si cancella solo se non contiene modifiche mai
//      sincronizzate (memoria e storage, vedi unsyncedWritesFor); altrimenti
//      resta, nascosto e bloccato, e la scelta resta in Impostazioni ("Dati
//      di account eliminati") anche dopo un riavvio (M1).
//   5. la schermata "Account eliminato" solo a chi stava guardando
//      quell'account (L1).
async function settleDeletedAccount(userId, { interactive }) {
  const store = useAppStore.getState
  const scope = scopeFor(userId)
  const showing = store().scopeId === scope || getSessionGateState()?.userId === userId
  const at = new Date().toISOString()
  // Ogni passaggio è indipendente: uno che non riesce non ferma gli altri e,
  // soprattutto, non fa perdere l'esito già verificato.
  const step = (name, fn) => {
    try {
      return fn()
    } catch {
      console.warn(`[spendy] account eliminato: passaggio "${name}" non riuscito`)
      return undefined
    }
  }
  // 1. L'esito, prima di tutto: ambito invalidato (nessuna scrittura da qui
  //    in poi, da nessuna scheda) e avviso salvato (sopravvive a un refresh).
  retireScope(scope)
  step('invalida', () => store().retireAccountScope(userId, RETIRED_DELETED))
  if (showing) {
    writeDeletedNotice(deviceStorage(), { at, removed: false, pending: null })
    setSessionGateState({ status: SESSION_DELETED, userId, pending: null, removed: false })
  }
  step('motore', () => { if (currentUserId === userId) stopEngine() })
  if (interactive) await closeSessionOf(userId)
  const pending = step('conteggio', () => store().unsyncedWritesFor(userId)) ?? null
  step('guest', () => {
    if (store().scopeId === scope) {
      store().switchScope(GUEST)
      setLegalGateState(null)
    }
  })
  let removed = false
  if (pending === 0) {
    step('rimozione', () => {
      store().forgetAccountData(userId)
      removed = !store().hasAccountContainer(userId)
    })
  }
  step('marcatore', () => writeEndedScope(deviceStorage(), null, { onlyIf: scope }))
  if (showing) {
    writeDeletedNotice(deviceStorage(), { at, removed, pending })
    setSessionGateState({ status: SESSION_DELETED, userId, pending, removed })
  }
}

// Un avviso "Account eliminato" salvato e non ancora chiuso: si mostra di
// nuovo (dopo un refresh, o se la pulizia era stata interrotta). Solo a chi è
// nell'ambito guest: chi ha già un account aperto è andato oltre.
function showPersistedDeletedNotice() {
  if (getSessionGateState()) return
  const notice = readDeletedNotice(deviceStorage())
  if (!notice) return
  if (ownerOf(useAppStore.getState().scopeId)) return
  setSessionGateState({ status: SESSION_DELETED, userId: null, pending: notice.pending, removed: notice.removed })
}

// L'ambito aperto qui è stato invalidato altrove (un'altra scheda ha provato
// l'eliminazione o rimosso i dati, oppure un'apertura precedente): si esce
// all'ambito guest senza scrivere niente. → true se è successo
function reactToRetiredActiveScope() {
  const store = useAppStore.getState
  const owner = ownerOf(store().scopeId)
  if (!owner) return false
  const reason = store().retiredReasonFor(owner)
  if (!reason) return false
  retireScope(scopeFor(owner))
  if (currentUserId === owner) stopEngine()
  // Account eliminato, contenitore già rimosso da un'altra scheda, ma qui in
  // memoria ci sono modifiche mai sincronizzate (l'altra scheda non le vedeva,
  // o le ha sovrascritte salvando il suo stato): si salvano, invece di
  // perderle. Restano bloccate e compaiono in Impostazioni.
  const inMemory = (store().sync?.outbox?.length ?? 0) + (store().sync?.rejected?.length ?? 0)
  let exists = store().hasAccountContainer(owner)
  if (!exists && reason === RETIRED_DELETED && inMemory > 0) exists = store().preserveRetiredContainer(owner)
  const pending = exists ? store().unsyncedWritesFor(owner) : 0
  store().switchScope(GUEST)
  setLegalGateState(null)
  writeEndedScope(deviceStorage(), null, { onlyIf: scopeFor(owner) })
  if (reason === RETIRED_DELETED) {
    writeDeletedNotice(deviceStorage(), { at: new Date().toISOString(), removed: !exists, pending })
    setSessionGateState({ status: SESSION_DELETED, userId: owner, pending, removed: !exists })
  } else if (getSessionGateState()?.userId === owner) setSessionGateState(null)
  return true
}

// "Continua senza account" / "Chiudi" dalla schermata. Per una sessione
// finita si passa all'ambito guest (come un logout: i dati dell'account
// restano nel suo contenitore e tornano rientrando). Per un account eliminato
// con dati ancora presenti la scelta resta in Impostazioni.
export function continueWithoutAccount() {
  const gate = getSessionGateState()
  if (!gate) return
  const store = useAppStore.getState()
  // Dopo "Chiudi" si usa SPENDY come guest: anche se la pulizia di un account
  // eliminato non era riuscita a lasciare il suo ambito.
  if (gate.userId && store.scopeId === scopeFor(gate.userId)) {
    store.switchScope(GUEST)
    setLegalGateState(null)
  }
  if (gate.userId) writeEndedScope(deviceStorage(), null, { onlyIf: scopeFor(gate.userId) })
  if (gate.status === SESSION_DELETED) writeDeletedNotice(deviceStorage(), null)
  setSessionGateState(null)
}

// "Rimuovi da questo dispositivo i dati di questo account" dalla schermata:
// SOLO su richiesta esplicita (conferma e avviso sulle modifiche non
// sincronizzate sono nella UI). Tocca solo il contenitore dell'id della
// schermata, e lo invalida per tutte le schede: 'removed' se l'eliminazione
// non è provata (torna valido se quell'account rientra), altrimenti resta
// 'deleted'.
export function forgetGatedAccount() {
  const gate = getSessionGateState()
  const userId = gate?.userId
  if (!userId) return false
  const store = useAppStore.getState
  const scope = scopeFor(userId)
  if (gate.status === SESSION_ENDED) store().retireAccountScope(userId, RETIRED_REMOVED)
  store().markAccountCleared(userId)
  if (currentUserId === userId) stopEngine()
  if (store().scopeId === scope) {
    store().switchScope(GUEST)
    setLegalGateState(null)
  }
  store().forgetAccountData(userId)
  writeEndedScope(deviceStorage(), null, { onlyIf: scope })
  if (gate.status === SESSION_DELETED) writeDeletedNotice(deviceStorage(), null)
  setSessionGateState(null)
  return true
}

// --- Impostazioni → "Dati di account eliminati" (M1) ----------------------

// Gli account eliminati (provato) il cui contenitore è ancora qui. → [{ userId, at, unsynced }]
export function deletedAccountsOnDevice() {
  const active = useAppStore.getState().scopeId
  return useAppStore.getState().deletedAccountsWithData().filter((entry) => entry.scope !== active)
}

// Rimozione esplicita dalla sezione in Impostazioni: solo un account la cui
// eliminazione è provata, mai l'ambito attivo. → true se rimosso
export function forgetDeletedAccount(userId) {
  const store = useAppStore.getState
  if (store().retiredReasonFor(userId) !== RETIRED_DELETED || store().scopeId === scopeFor(userId)) return false
  store().markAccountCleared(userId)
  store().forgetAccountData(userId)
  if (getSessionGateState()?.userId === userId) setSessionGateState(null)
  return !store().hasAccountContainer(userId)
}

export const syncNow = () => engine?.syncNow() ?? Promise.resolve({ skipped: 'sync non attivo' })

// → null se riuscito, altrimenti un messaggio nella lingua dell'app (mai il
// testo tecnico di Supabase).
export async function signIn(email, password) {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? authErrorMessage(error) : null
  } catch (error) {
    return authErrorMessage(error)
  }
}

// La registrazione parte solo con Termini accettati e Privacy Policy presa
// visione (due scelte distinte, vedi legal/legal.js): la UI disabilita il
// pulsante, e qui lo si rifiuta comunque, senza nessuna chiamata.
// La lingua scelta sul dispositivo parte con la registrazione: è quella
// dell'account fin da subito (e delle email, se i modelli la usano).
export async function signUp(email, password, acceptance) {
  const metadata = buildSignUpMetadata(acceptance)
  if (!metadata) return LEGAL_MESSAGES.acceptanceRequired
  const device = readLanguagePreference(deviceStorage())
  const language = accountMetadataFor(device ?? { language: useAppStore.getState().language, chosenAt: null })
  try {
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { ...metadata, ...language } } })
    return error ? authErrorMessage(error) : null
  } catch (error) {
    return authErrorMessage(error)
  }
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
// Nella lingua dell'app, letti nel momento in cui servono.
export const SIGNOUT_MESSAGES = {
  get offline() { return tr('auth.signout.offline') },
  get failed() { return tr('auth.signout.failed') },
  get relogin() { return tr('auth.signout.relogin') },
}

export async function signOut() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return SIGNOUT_MESSAGES.offline

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
  voluntaryExit += 1
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    failure = error ?? null
  } catch (error) {
    failure = error ?? new Error('signOut')
  } finally {
    voluntaryExit -= 1
  }

  if (failure) {
    if (!saved) return SIGNOUT_MESSAGES.relogin
    try {
      const { data, error } = await supabase.auth.setSession(saved)
      if (!error && data?.session) return SIGNOUT_MESSAGES.failed
    } catch {
      // il ripristino richiede rete: vedi sotto
    }
    return SIGNOUT_MESSAGES.relogin
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
    // Anche per le altre schede aperte sullo stesso account: nessuna scrittura
    // in quell'ambito da qui in poi (store/scope.js).
    useAppStore.getState().retireAccountScope(userId, RETIRED_DELETED)
    stopEngine()
    voluntaryExit += 1
    try {
      // L'utente non esiste più sul server: la chiusura può rispondere con un
      // errore, ma il client toglie comunque la sessione da questo dispositivo.
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      // vedi sopra: niente da recuperare, l'account è già stato eliminato
    } finally {
      voluntaryExit -= 1
    }
    useAppStore.getState().switchScope(GUEST)
    useAppStore.getState().forgetAccountData(userId)
    setLegalGateState(null)
    setSessionGateState(null)
    writeEndedScope(deviceStorage(), null, { onlyIf: scopeFor(userId) })
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
