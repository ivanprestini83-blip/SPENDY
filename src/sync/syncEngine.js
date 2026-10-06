import { COLLECTION_KEYS, SETTINGS_TABLE, SYNC_COLLECTIONS, collectionForTable, settingsToRemote, toLocalRow, toRemoteRow } from './mappers.js'
import { SETTINGS_KEY, groupByCollection, pendingIds } from './outbox.js'
import { isUserScope, ownerOf, scopeFor } from '../store/scope.js'

// Il motore: spinge la coda locale verso il cloud (push), riporta a casa
// quello che hanno scritto gli altri dispositivi (pull incrementale),
// e resta in ascolto per ricevere le modifiche in tempo reale.
//
// Non conosce Supabase: parla con un oggetto `remote` che espone quattro
// metodi. Questo permette ai test di farlo girare contro un database
// finto in memoria — con le stesse regole del vero, trigger LWW incluso —
// e quindi di verificare offline, conflitti e Samsung ↔ Mac senza rete.

// Errori DEFINITIVI del database per una riga: non passerà mai così com'è.
//   22xxx  dati non validi (es. 22003 numeric overflow: importo oltre numeric(12,2))
//   23xxx  vincoli violati (not null, check…)
//   42501  RLS: la riga appartiene a un altro utente
// Tutto il resto (rete, timeout, 5xx, colonna non ancora creata…) è
// temporaneo: le operazioni restano in coda e si riprova.
export const isPermanentRejection = (code) => typeof code === 'string' && (/^2[23][0-9A-Z]{3}$/.test(code) || code === '42501')

export const EPOCH = '1970-01-01T00:00:00.000Z'

// Il cursore torna indietro di un secondo rispetto all'ultimo
// updated_at visto. Due scritture nello stesso istante possono diventare
// visibili in momenti diversi: senza questa sovrapposizione, una riga
// scritta "a cavallo" del cursore verrebbe saltata per sempre. Il piccolo
// ri-scaricamento che ne deriva è innocuo, perché applicare due volte la
// stessa riga dà lo stesso risultato.
export function cursorFrom(rows, previous = EPOCH) {
  let max = null
  for (const row of rows) if (row.updated_at && (max === null || row.updated_at > max)) max = row.updated_at
  // Nessuna riga: il cursore resta esattamente dov'era. Spostarlo (anche
  // solo indietro di un secondo) a ogni pull a vuoto lo farebbe scivolare
  // all'infinito e riscaricherebbe sempre le stesse righe.
  if (max === null) return previous ?? EPOCH
  return new Date(new Date(max).getTime() - 1000).toISOString()
}

const hasLocalRows = (snapshot) => COLLECTION_KEYS.some((key) => (snapshot[key]?.length ?? 0) > 0)

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
const pinnedFirst = (a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1)

const SORTERS = {
  expenses: byDateDesc,
  incomes: byDateDesc,
  emergencyFundContributions: byDateDesc,
  goalContributions: byDateDesc,
  customCategories: pinnedFirst,
}

// Fonde le righe arrivate dal server dentro l'array locale.
//
// Tre regole, in quest'ordine:
//  1. se la riga ha una modifica locale in attesa nella coda, si IGNORA
//     quella del server (la mia è più recente, sta per partire);
//  2. se arriva con deleted_at, si toglie dall'array locale — i soft
//     delete degli altri dispositivi si propagano così;
//  3. altrimenti sostituisce quella locale, o si aggiunge se non c'era.
//
// Le righe cancellate NON restano nell'array: BehaviorEngine, i totali e
// il Radar leggono `state.expenses` così com'è, e una spesa cancellata
// che restasse lì continuerebbe a essere contata.
export function mergeRemoteRows(collection, localRows, remoteRows, pending = new Set()) {
  const index = new Map(localRows.map((row) => [row.id, row]))
  let changed = false

  for (const remoteRow of remoteRows) {
    if (pending.has(remoteRow.id)) continue

    if (remoteRow.deleted_at) {
      if (index.delete(remoteRow.id)) changed = true
      continue
    }

    index.set(remoteRow.id, toLocalRow(collection, remoteRow))
    changed = true
  }

  if (!changed) return localRows
  const merged = [...index.values()]
  const sorter = SORTERS[collection]
  return sorter ? merged.sort(sorter) : merged
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

// Ogni operazione asincrona ricorda l'AMBITO dei dati locali in cui è partita
// (guest o account, vedi store/scope.js) e, prima di scrivere QUALUNQUE cosa
// nello store, controlla di essere ancora lì. Se nel frattempo si è cambiato
// account, il risultato arrivato in ritardo viene scartato: non si applica,
// non conferma la coda, non sposta cursori né stato. Le operazioni già accettate
// dal server ma non confermate in locale verranno semplicemente rimandate al
// rientro di quell'account (l'upsert è idempotente).
const SCOPE_CHANGED = 'scope-cambiato'

export function createSyncEngine({ store, remote, autoFlushMs = 1200, onStatus = null }) {
  let unsubscribeStore = null
  let unsubscribeRealtime = null
  let flushTimer = null
  let running = false
  let startedScope = null
  let onOnline = null
  let onOffline = null
  // Una sincronizzazione per volta PER AMBITO.
  const flights = new Map()

  const state = () => store.getState()
  const sameScope = (scope) => state().scopeId === scope

  const setStatus = (patch, scope = state().scopeId) => {
    if (!sameScope(scope)) return
    state().setSyncStatus(patch)
    onStatus?.(state().sync)
  }

  // Lo userId dello stato deve essere quello dell'ambito: un contenitore
  // account non può mai inviare con l'identità di un altro.
  const identityError = (scope, userId) => (isUserScope(scope) && ownerOf(scope) !== userId ? 'ambito non coerente con l\'account' : null)

  // ------------------------------------------------------------- push

  // Invia un gruppo di operazioni della stessa tabella. Se il database le
  // rifiuta con un errore DEFINITIVO (isPermanentRejection), il gruppo viene
  // diviso a metà finché si isolano le sole righe non valide: quelle escono
  // dalla coda e finiscono in sync.rejected, tutte le altre partono. Un errore
  // temporaneo invece ferma l'invio: le operazioni restano in coda e ripartono.
  // → { pushed, rejected, error?, aborted? }
  async function sendOps(table, ops, toRow, scope) {
    const { error, code } = await remote.upsert(table, ops.map(toRow))
    if (!sameScope(scope)) return { pushed: 0, rejected: 0, aborted: true }
    if (!error) {
      // Le operazioni escono dalla coda SOLO ora, dopo la conferma del
      // server. Se la rete cade a metà, restano dove sono e ripartono.
      state().ackOps(ops)
      return { pushed: ops.length, rejected: 0 }
    }
    if (!isPermanentRejection(code)) return { pushed: 0, rejected: 0, error }
    if (ops.length === 1) {
      state().rejectOps(ops, error)
      return { pushed: 0, rejected: 1 }
    }
    const middle = Math.ceil(ops.length / 2)
    const first = await sendOps(table, ops.slice(0, middle), toRow, scope)
    if (first.aborted || first.error) return first
    const second = await sendOps(table, ops.slice(middle), toRow, scope)
    return {
      pushed: first.pushed + second.pushed,
      rejected: first.rejected + second.rejected,
      ...(second.error ? { error: second.error } : {}),
      ...(second.aborted ? { aborted: true } : {}),
    }
  }

  async function pushPending(scope = state().scopeId) {
    if (!sameScope(scope)) return { pushed: 0, aborted: SCOPE_CHANGED }

    const { outbox } = state().sync
    if (outbox.length === 0) return { pushed: 0 }

    const userId = state().sync.userId
    if (!userId) return { pushed: 0, error: 'nessun utente' }
    const mismatch = identityError(scope, userId)
    if (mismatch) return { pushed: 0, error: mismatch }

    let pushed = 0
    let rejected = 0
    for (const [collection, ops] of groupByCollection(outbox)) {
      if (!sameScope(scope)) return { pushed, rejected, aborted: SCOPE_CHANGED }

      if (collection === SETTINGS_KEY) {
        const op = ops[ops.length - 1]
        const remoteRow = settingsToRemote(op.row, userId)
        let { error, code } = await remote.upsert(SETTINGS_TABLE, [remoteRow])
        // La colonna spendy_ai_enabled non esiste ancora (migration
        // privacy_consent.sql non eseguita): le impostazioni partono senza,
        // invece di bloccare tutto il sync. La scelta resta su questo
        // dispositivo e ripartirà con il prossimo cambio di impostazioni.
        if (error && 'spendy_ai_enabled' in remoteRow && /spendy_ai_enabled/.test(String(error)) && sameScope(scope)) {
          const { spendy_ai_enabled: _notYetOnServer, ...withoutPreference } = remoteRow
          ;({ error, code } = await remote.upsert(SETTINGS_TABLE, [withoutPreference]))
        }
        if (!sameScope(scope)) return { pushed, rejected, aborted: SCOPE_CHANGED }
        if (error && !isPermanentRejection(code)) return { pushed, rejected, error }
        if (error) {
          // Impostazioni che il database non accetterà mai (es. uno
          // stipendio oltre numeric(12,2)): fuori dalla coda, non bloccano.
          state().rejectOps(ops, error)
          rejected += ops.length
          continue
        }
        state().ackOps(ops)
        pushed += 1
        continue
      }

      const table = SYNC_COLLECTIONS[collection].table
      const result = await sendOps(table, ops, (op) => toRemoteRow(collection, op.row, userId), scope)
      pushed += result.pushed
      rejected += result.rejected
      if (result.aborted) return { pushed, rejected, aborted: SCOPE_CHANGED }
      if (result.error) return { pushed, rejected, error: result.error }
    }

    return { pushed, rejected }
  }

  // ------------------------------------------------------------- pull

  async function pullAll(scope = state().scopeId) {
    if (!sameScope(scope)) return { pulled: 0, aborted: SCOPE_CHANGED }

    const userId = state().sync.userId
    if (!userId) return { pulled: 0, error: 'nessun utente' }
    const mismatch = identityError(scope, userId)
    if (mismatch) return { pulled: 0, error: mismatch }

    let pulled = 0
    for (const collection of COLLECTION_KEYS) {
      const table = SYNC_COLLECTIONS[collection].table
      const since = state().sync.cursors[table] ?? EPOCH
      const { rows, error } = await remote.pull(table, since)
      if (!sameScope(scope)) return { pulled, aborted: SCOPE_CHANGED }
      if (error) return { pulled, error }
      if (rows.length > 0) {
        state().applyRemote(collection, rows)
        state().setCursor(table, cursorFrom(rows, since))
        pulled += rows.length
      }
    }

    const { rows, error } = await remote.pull(SETTINGS_TABLE, state().sync.cursors[SETTINGS_TABLE] ?? EPOCH)
    if (!sameScope(scope)) return { pulled, aborted: SCOPE_CHANGED }
    if (error) return { pulled, error }
    if (rows.length > 0) {
      state().applyRemoteSettings(rows[0])
      state().setCursor(SETTINGS_TABLE, cursorFrom(rows, state().sync.cursors[SETTINGS_TABLE]))
      pulled += 1
    }

    return { pulled }
  }

  // ---------------------------------------------------------- syncNow

  async function syncNow() {
    const scope = state().scopeId
    if (!state().sync.userId) return { skipped: 'nessun utente' }
    if (!isOnline()) {
      setStatus({ status: 'offline', error: null }, scope)
      return { skipped: 'offline' }
    }
    // Una sola sincronizzazione per volta (per ambito): due push concorrenti
    // toglierebbero dalla coda operazioni che l'altro sta ancora inviando.
    if (flights.has(scope)) return flights.get(scope)

    const flight = (async () => {
      setStatus({ status: 'syncing', error: null }, scope)
      try {
        // Prima si spinge, poi si tira: così le modifiche locali sono già
        // sul server quando si chiede cosa c'è di nuovo, e il pull non
        // torna indietro con una versione vecchia della riga appena
        // toccata qui.
        const push = await pushPending(scope)
        if (push.aborted) return { skipped: SCOPE_CHANGED }
        // Anche se l'invio non è riuscito, si scarica comunque: le modifiche
        // degli altri dispositivi devono arrivare. È sicuro, perché le righe
        // con una modifica locale ancora in coda vengono saltate dal pull
        // (mergeRemoteRows) e restano quelle locali.
        const pull = await pullAll(scope)
        if (pull.aborted) return { skipped: SCOPE_CHANGED }
        const error = push.error ?? pull.error ?? null
        if (error) {
          setStatus({ status: 'error', error: String(error) }, scope)
          return { ...push, ...pull, error }
        }
        setStatus({ status: 'synced', error: null, lastSyncAt: new Date().toISOString() }, scope)
        return { ...push, ...pull }
      } finally {
        flights.delete(scope)
      }
    })()

    flights.set(scope, flight)
    return flight
  }

  // ------------------------------------------------------- avvio/stop

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      if (startedScope !== null && sameScope(startedScope)) syncNow()
    }, autoFlushMs)
  }

  function start(userId) {
    if (running) stop()

    // Il motore di un account parte solo dentro il contenitore di quell'account.
    // Con un ambito diverso (per esempio i dati di A mentre entra B) non si
    // parte: niente di A può essere inviato come B.
    if (state().scopeId !== scopeFor(userId)) return Promise.resolve({ skipped: 'scope-diverso' })

    const previous = state().sync.userId
    if (previous && previous !== userId) {
      // Difesa in più: con i contenitori separati non dovrebbe più succedere
      // che lo stato di un account porti l'identità di un altro.
      if (state().sync.outbox.length > 0) {
        setStatus({
          status: 'error',
          error: `Ci sono ${state().sync.outbox.length} modifiche non ancora inviate dell'account precedente. Rientra con quell'account per sincronizzarle, poi cambia account.`,
        })
        return Promise.resolve({ skipped: 'coda-di-un-altro-utente' })
      }
      // Cursori da azzerare: sono i segnaposto della cronologia di un
      // altro utente, e riusarli nasconderebbe tutte le righe piu'
      // vecchie di quel timestamp. I dati locali non si toccano.
      state().setSyncStatus({ cursors: {}, migratedAt: null })
    }

    // Contenitore senza nemmeno una riga locale ma con cursori già avanzati
    // (per esempio dati locali persi o mai arrivati, o cursori ereditati):
    // il pull incrementale chiederebbe solo le righe più nuove del cursore e
    // l'account resterebbe a 0 pur avendo i suoi dati sul cloud, con il sync
    // dato per riuscito. Senza righe locali non c'è niente che un pull
    // completo possa duplicare: si riparte dall'inizio. La coda non si tocca.
    if (!hasLocalRows(state()) && Object.keys(state().sync.cursors ?? {}).length > 0) {
      state().setSyncStatus({ cursors: {} })
    }

    running = true
    startedScope = state().scopeId
    state().setSyncUser(userId)

    // Ogni volta che la coda si allunga (cioè a ogni spesa inserita) si
    // programma un invio, raggruppando le modifiche ravvicinate invece di
    // fare una richiesta per tasto premuto.
    let lastOutboxLength = state().sync.outbox.length
    unsubscribeStore = store.subscribe((next) => {
      if (next.scopeId !== startedScope) return
      const length = next.sync.outbox.length
      if (length > lastOutboxLength) scheduleFlush()
      lastOutboxLength = length
    })

    unsubscribeRealtime = remote.subscribe?.(userId, ({ table, row }) => {
      if (startedScope === null || !sameScope(startedScope)) return
      const collection = collectionForTable(table)
      if (collection) {
        state().applyRemote(collection, [row])
        return
      }
      if (table === SETTINGS_TABLE) state().applyRemoteSettings(row)
    })

    if (typeof window !== 'undefined') {
      const scope = startedScope
      onOnline = () => {
        if (sameScope(scope)) syncNow()
      }
      onOffline = () => setStatus({ status: 'offline' }, scope)
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
    }

    return syncNow()
  }

  function stop() {
    running = false
    startedScope = null
    unsubscribeStore?.()
    unsubscribeRealtime?.()
    unsubscribeStore = null
    unsubscribeRealtime = null
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    if (typeof window !== 'undefined') {
      if (onOnline) window.removeEventListener('online', onOnline)
      if (onOffline) window.removeEventListener('offline', onOffline)
    }
    onOnline = null
    onOffline = null
  }

  return { start, stop, syncNow, pushPending, pullAll }
}

export { pendingIds }
