// AMBITI LOCALI — chi vede quali dati su questo dispositivo.
//
// Ogni account ha il suo contenitore locale, e uno ce l'ha chi non ha mai
// fatto login:
//
//   guest        chi usa l'app senza account
//   u:<userId>   un account (dati, budget, coda di invio, cursori, cronologia
//                battute, preferenze: tutto ciò che sta nello stato persistito)
//
// Così, se A esce e sullo stesso telefono entra B, B parte da un contenitore
// suo e non vede niente di A; e se A rientra ritrova tutto, coda compresa.
// Niente viene cancellato: né dal cloud né dal dispositivo.
//
// Chiavi di localStorage:
//   spendy-storage-v2:<scope>     lo stato dell'app di quell'ambito
//   spendy-ai-voice:<scope>       la memoria di Spendy AI di quell'ambito
//   spendy-active-scope           l'ambito attivo all'avvio
//   spendy-guest-claimed-by       l'account che ha già adottato i dati guest
//   spendy-storage-v2-migration   marcatore della migrazione dal vecchio storage
//   spendy-storage                IL VECCHIO STORAGE: dopo la migrazione non si
//                                 legge più e NON SI TOCCA MAI (archivio di
//                                 sola lettura). Fa eccezione un solo caso, la
//                                 "modalità legacy" qui sotto.
//
// Questo file non importa niente dallo store: è un gestore (factory), con uno
// stato suo per ogni istanza. È ciò che permette ai test di simulare più
// dispositivi nello stesso processo senza che si contaminino.

export const GUEST = 'guest'
export const scopeFor = (userId) => `u:${userId}`
export const isUserScope = (scope) => typeof scope === 'string' && scope.startsWith('u:') && scope.length > 2
export const ownerOf = (scope) => (isUserScope(scope) ? scope.slice(2) : null)
export const isValidScope = (scope) => scope === GUEST || isUserScope(scope)

export const LEGACY_STATE_KEY = 'spendy-storage'
export const STATE_BASE = 'spendy-storage-v2'
export const VOICE_BASE = 'spendy-ai-voice'
export const ACTIVE_SCOPE_KEY = 'spendy-active-scope'
export const GUEST_CLAIM_KEY = 'spendy-guest-claimed-by'
export const MIGRATION_KEY = 'spendy-storage-v2-migration'

export const stateKey = (scope) => `${STATE_BASE}:${scope}`
export const voiceKey = (scope) => `${VOICE_BASE}:${scope}`

// Account eliminati durante questa sessione dell'app (vedi
// spendySync.deleteAccount). Una risposta arrivata dopo l'eliminazione —
// per esempio una frase di Spendy AI partita prima — non deve ricreare sul
// dispositivo niente che appartenga a quell'account: chi scrive in una
// chiave legata a un ambito controlla qui. Solo in memoria: dopo un riavvio
// non esiste più nessuna richiesta in volo da fermare.
const retiredScopes = new Set()
export const retireScope = (scope) => {
  if (isUserScope(scope)) retiredScopes.add(scope)
}

// Ambiti INVALIDATI su questo dispositivo, per tutte le schede e anche dopo un
// riavvio (sync/sessionGate.js). Il solo elenco in memoria non basta: una
// seconda scheda aperta sullo stesso account non lo vede, e riscriverebbe il
// contenitore appena rimosso. Questo elenco sta nello storage condiviso e si
// controlla PRIMA di ogni scrittura persistente legata a un ambito (adattatore
// di zustand qui sotto, memoria di Spendy AI): una scrittura tardiva — di una
// risposta di sync, di Spendy AI, di un'altra scheda — viene semplicemente
// scartata. Mai il guest.
//   'deleted'  account eliminato, PROVATO da Supabase Auth: definitivo.
//   'removed'  contenitore rimosso su richiesta esplicita, senza prova che
//              l'account non esista più: torna valido se quell'account rientra
//              con una sessione vera (reinstate).
// L'elenco NON contiene l'id dell'account: solo un'impronta dell'ambito
// calcolata con un sale casuale di questo dispositivo, il motivo e la data.
// Basta a riconoscere l'ambito prima di una scrittura; dopo la rimozione dei
// dati, nel localStorage non resta niente che nomini l'account.
export const RETIRED_SCOPES_KEY = 'spendy-retired-scopes'
export const RETIRED_SALT_KEY = 'spendy-retired-salt'
export const RETIRED_DELETED = 'deleted'
export const RETIRED_REMOVED = 'removed'

const sharedStorage = () => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

// cyrb53: hash sincrono, non crittografico, sufficiente a distinguere gli
// ambiti (due semi → 106 bit). Serve sincrono: si calcola a ogni scrittura.
function cyrb53(text, seed) {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

function readSalt(storage) {
  try {
    const salt = storage?.getItem(RETIRED_SALT_KEY)
    return typeof salt === 'string' && salt.length >= 16 ? salt : null
  } catch {
    return null
  }
}

// Il sale del dispositivo, creato alla prima invalidazione. → stringa o null
export function ensureRetiredSalt(storage = sharedStorage()) {
  const existing = readSalt(storage)
  if (existing || !storage) return existing
  let salt = ''
  try {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    salt = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    salt = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`
  }
  try {
    storage.setItem(RETIRED_SALT_KEY, salt)
    return storage.getItem(RETIRED_SALT_KEY) === salt ? salt : null
  } catch {
    return null
  }
}

// L'impronta di un ambito su questo dispositivo (null senza sale).
export function scopeFingerprint(scope, storage = sharedStorage()) {
  const salt = readSalt(storage)
  if (!salt || !isUserScope(scope)) return null
  const text = `${salt}|${scope}`
  return `${cyrb53(text, 1)}${cyrb53(text, 2)}`
}

// → [{ fp, reason, at }] (solo voci valide)
export function readRetiredScopes(storage = sharedStorage()) {
  try {
    const list = JSON.parse(storage?.getItem(RETIRED_SCOPES_KEY) ?? '[]')
    return Array.isArray(list)
      ? list.filter((entry) => entry && typeof entry.fp === 'string' && (entry.reason === RETIRED_DELETED || entry.reason === RETIRED_REMOVED))
      : []
  } catch {
    return []
  }
}

// La voce di un ambito invalidato ({ fp, reason, at, cleared? }), oppure null.
export function retiredEntry(scope, storage = sharedStorage()) {
  const fp = scopeFingerprint(scope, storage)
  if (!fp) return null
  return readRetiredScopes(storage).find((entry) => entry.fp === fp) ?? null
}

// Il motivo per cui un ambito è invalidato, oppure null.
export function retiredReason(scope, storage = sharedStorage()) {
  return retiredEntry(scope, storage)?.reason ?? null
}

export const isRetiredScope = (scope, storage = sharedStorage()) =>
  isUserScope(scope) && (retiredScopes.has(scope) || retiredReason(scope, storage) !== null)

const LISTS = ['expenses', 'incomes', 'goals', 'goalContributions', 'emergencyFundContributions', 'customCategories']

// C'è qualcosa che valga la pena adottare? Un contenitore guest "vuoto" non
// si adotta (e non si archivia): non c'è niente da proteggere.
export function hasUserData(state) {
  if (!state || typeof state !== 'object') return false
  return (
    LISTS.some((key) => Array.isArray(state[key]) && state[key].length > 0)
    || Number(state.monthlyBudget) > 0
    || state.cycleStartDay != null
    || Number(state.emergencyFundSaved) > 0
    || (Array.isArray(state.sync?.outbox) && state.sync.outbox.length > 0)
  )
}

// getStorage → l'oggetto tipo localStorage (letto UNA volta, come fa zustand).
// Non lancia mai: senza storage (Node, navigazione privata bloccata) tutto
// diventa un no-op e l'app lavora solo in memoria.
export function createScopeManager({ getStorage, now = () => new Date() }) {
  let storage = null
  try {
    storage = getStorage() ?? null
  } catch {
    storage = null
  }

  const read = (key) => {
    try {
      return storage ? storage.getItem(key) : null
    } catch {
      return null
    }
  }
  const rawWrite = (key, value) => {
    try {
      storage?.setItem(key, value)
    } catch {
      // quota piena o storage bloccato: niente da fare, lo stato resta in memoria
    }
  }
  // Scrive e RILEGGE: per le operazioni una tantum (migrazione, adozione) dove
  // "scritto" deve voler dire davvero scritto.
  const write = (key, value) => {
    try {
      if (!storage) return false
      storage.setItem(key, value)
      return storage.getItem(key) === value
    } catch {
      return false
    }
  }
  const remove = (key) => {
    try {
      storage?.removeItem(key)
    } catch {
      // niente da cancellare
    }
  }
  const stamp = () => now().toISOString().replace(/[:.]/g, '-')

  let writesFrozen = false
  // Modalità legacy: SOLO se la migrazione dal vecchio storage non si è potuta
  // completare (es. spazio esaurito). L'ambito guest usa allora il vecchio
  // contenitore, così l'app continua a funzionare senza perdere niente, e la
  // migrazione si ritenta al prossimo avvio. L'isolamento, in quel caso, è
  // sospeso finché non riesce.
  let legacyMode = false

  const keyFor = (base, scope) => (legacyMode && scope === GUEST ? LEGACY_STATE_KEY : `${base}:${scope}`)

  // ------------------------------------------------ migrazione una tantum

  // Vecchio storage ('spendy-storage') → contenitore del suo proprietario.
  // Copia, non sposta: il vecchio resta com'è. Idempotente (marcatore), non
  // sovrascrive mai un contenitore v2 esistente, non tocca un JSON corrotto.
  function migrateLegacy() {
    if (!storage) return { status: 'no-storage' }
    const marker = read(MIGRATION_KEY)
    if (marker !== null) return { status: 'already-done' }

    const done = (info) => {
      write(MIGRATION_KEY, JSON.stringify({ at: now().toISOString(), ...info }))
      return info
    }

    const legacyRaw = read(LEGACY_STATE_KEY)
    if (legacyRaw === null) return done({ status: 'nothing-to-migrate' })

    let parsed
    try {
      parsed = JSON.parse(legacyRaw)
    } catch {
      return done({ status: 'legacy-corrupt' })
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.state || typeof parsed.state !== 'object') {
      return done({ status: 'legacy-unrecognized' })
    }

    const owner = typeof parsed.state.sync?.userId === 'string' && parsed.state.sync.userId ? parsed.state.sync.userId : null
    const scope = owner ? scopeFor(owner) : GUEST
    const target = stateKey(scope)

    if (read(target) !== null) {
      // Non si sovrascrive MAI un contenitore v2: resta com'è. Se l'ambito attivo
      // non era ancora stato deciso, l'app si apre sui dati del proprietario.
      if (owner && read(ACTIVE_SCOPE_KEY) === null) write(ACTIVE_SCOPE_KEY, scope)
      if (owner && read(GUEST_CLAIM_KEY) === null) write(GUEST_CLAIM_KEY, owner)
      return done({ status: 'v2-already-exists', scope })
    }

    if (!write(target, legacyRaw)) {
      // Scrittura non verificata: si ritira SOLO la copia appena tentata (era
      // una chiave nuova) e si resta col vecchio contenitore come guest.
      if (read(target) !== null) remove(target)
      legacyMode = true
      return { status: 'failed', scope }
    }

    // La memoria di Spendy AI segue i dati (best effort: non contiene dati finanziari).
    const legacyVoice = read(VOICE_BASE)
    if (legacyVoice !== null && read(voiceKey(scope)) === null) write(voiceKey(scope), legacyVoice)

    if (owner) {
      // Quei dati appartengono già a un account: è lui il "primo", e i dati
      // guest futuri non saranno adottabili da nessun altro.
      write(GUEST_CLAIM_KEY, owner)
      write(ACTIVE_SCOPE_KEY, scope)
    }
    return done({ status: 'migrated', scope })
  }

  const migration = migrateLegacy()

  const pointer = read(ACTIVE_SCOPE_KEY)
  let active = isValidScope(pointer) ? pointer : GUEST

  // ---------------------------------------------- adozione dei dati guest

  // Chiamata PRIMA di entrare in uno scope account. Solo il PRIMO account che
  // entra su questo dispositivo può adottare i dati guest; dopo, mai più.
  //   - i dati guest vengono COPIATI nel contenitore dell'account, così com'è
  //     (coda, cursori, righe storiche senza updatedAt: la migrazione esplicita
  //     "Carica N righe" resta quella di sempre);
  //   - il guest viene prima ARCHIVATO (chiave ':adopted:<data>') e poi liberato,
  //     perché dopo il logout non deve mostrare i dati di quell'account;
  //   - se qualcosa non riesce, si annulla tutto: niente claim, niente perdita.
  function enterUserScope(userId) {
    // Un ambito invalidato non si ricrea, nemmeno adottando i dati guest.
    if (blocked(scopeFor(userId))) return { adopted: false, reason: 'retired' }
    if (read(GUEST_CLAIM_KEY) !== null) return { adopted: false, reason: 'already-claimed' }
    if (legacyMode) return { adopted: false, reason: 'legacy-mode' }

    const target = stateKey(scopeFor(userId))
    const guestKey = stateKey(GUEST)
    const guestRaw = read(guestKey)
    let result = { adopted: false, reason: 'no-guest-data' }

    if (guestRaw !== null && read(target) === null) {
      try {
        const parsed = JSON.parse(guestRaw)
        if (hasUserData(parsed?.state)) {
          // I cursori NON si adottano: segnano fin dove un ALTRO contesto
          // aveva già letto, e trascinati qui farebbero saltare all'account
          // tutte le sue righe più vecchie. Il primo sync parte dall'inizio.
          const adoptedRaw = JSON.stringify({
            ...parsed,
            state: { ...parsed.state, sync: { ...(parsed.state.sync ?? {}), userId, cursors: {} } },
          })
          if (!write(target, adoptedRaw)) {
            if (read(target) !== null) remove(target)
            return { adopted: false, reason: 'write-failed' }
          }
          if (!write(`${guestKey}:adopted:${stamp()}`, guestRaw)) {
            // Senza archivio non si libera il guest: si annulla l'adozione.
            remove(target)
            return { adopted: false, reason: 'archive-failed' }
          }
          remove(guestKey)
          result = { adopted: true, reason: 'first-account' }
        }
      } catch {
        // guest illeggibile: non si adotta, non si tocca
        result = { adopted: false, reason: 'guest-unreadable' }
      }
    }

    write(GUEST_CLAIM_KEY, userId)
    return result
  }

  // ------------------------------------------- archivio per zustand/persist

  // Invalidato (vedi RETIRED_SCOPES_KEY): letto dallo storage condiviso a OGNI
  // scrittura, così vale subito anche per le altre schede e per le scritture
  // già partite (una risposta di sync o di Spendy AI che arriva dopo).
  const blocked = (scope) => isRetiredScope(scope, storage)

  const adapter = {
    getItem(name) {
      const key = keyFor(name, active)
      const raw = read(key)
      if (raw === null) return null
      try {
        JSON.parse(raw)
      } catch {
        // JSON corrotto: si conserva una copia PRIMA che il prossimo salvataggio
        // lo sovrascriva, e l'ambito riparte vuoto.
        if (!blocked(active)) rawWrite(`${key}:corrupt:${stamp()}`, raw)
        return null
      }
      return raw
    },
    setItem(name, value) {
      if (writesFrozen || blocked(active)) return
      rawWrite(keyFor(name, active), value)
    },
    removeItem(name) {
      if (writesFrozen || blocked(active)) return
      remove(keyFor(name, active))
    },
  }

  // Dimentica su QUESTO dispositivo i dati locali di un account (dopo
  // l'eliminazione dell'account): il suo contenitore, le sue copie ':corrupt:',
  // la memoria di Spendy AI e le chiavi con i prefissi indicati da chi chiama
  // (i backup automatici di quell'account). Mai l'ambito attivo, mai il guest,
  // mai il vecchio 'spendy-storage', mai gli altri account. → chiavi rimosse
  function forgetScope(scope, extraPrefixes = []) {
    if (!isUserScope(scope) || scope === active || !storage) return []
    const exact = new Set([stateKey(scope), voiceKey(scope)])
    const prefixes = [`${stateKey(scope)}:`, ...extraPrefixes.filter((p) => typeof p === 'string' && p.length > 0)]
    let keys = []
    try {
      keys = typeof storage.length === 'number' && typeof storage.key === 'function'
        ? Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean)
        : Object.keys(storage)
    } catch {
      keys = []
    }
    const doomed = keys.filter((key) => exact.has(key) || prefixes.some((prefix) => key.startsWith(prefix)))
    for (const key of exact) if (!doomed.includes(key) && read(key) !== null) doomed.push(key)
    doomed.forEach(remove)

    // Le chiavi globali che possono contenere l'id di quell'account.
    const owner = ownerOf(scope)
    if (read(GUEST_CLAIM_KEY) === owner) {
      remove(GUEST_CLAIM_KEY)
      doomed.push(GUEST_CLAIM_KEY)
    }
    // Il marcatore della migrazione NON si cancella (la migrazione ripartirebbe
    // e ricreerebbe il contenitore): si toglie solo l'ambito che lo nomina.
    try {
      const marker = JSON.parse(read(MIGRATION_KEY) ?? 'null')
      if (marker && typeof marker === 'object' && marker.scope === scope) {
        const { scope: _forgotten, ...rest } = marker
        if (write(MIGRATION_KEY, JSON.stringify(rest))) doomed.push(`${MIGRATION_KEY} (ambito rimosso)`)
      }
    } catch {
      // marcatore illeggibile: non nomina nessuno in modo utilizzabile, si lascia
    }
    return doomed
  }

  // Quante modifiche di un account non sono mai arrivate sul server (coda di
  // invio + operazioni rifiutate), lette dal suo contenitore. Serve a non
  // perderle in silenzio quando il contenitore si dovrebbe cancellare.
  // → numero (0 se il contenitore non c'è), null se illeggibile.
  function unsyncedWrites(scope) {
    if (!isUserScope(scope)) return null
    const raw = read(stateKey(scope))
    if (raw === null) return 0
    try {
      const sync = JSON.parse(raw)?.state?.sync ?? {}
      const count = (list) => (Array.isArray(list) ? list.length : 0)
      return count(sync.outbox) + count(sync.rejected)
    } catch {
      return null
    }
  }

  // Invalida un ambito per tutte le schede (vedi RETIRED_SCOPES_KEY). Un
  // 'deleted' non viene mai declassato a 'removed'. → true se registrato
  function retire(scope, reason, at = now().toISOString()) {
    if (!isUserScope(scope) || (reason !== RETIRED_DELETED && reason !== RETIRED_REMOVED)) return false
    retireScope(scope)
    if (!ensureRetiredSalt(storage)) return false
    const fp = scopeFingerprint(scope, storage)
    const list = readRetiredScopes(storage)
    const current = list.find((entry) => entry.fp === fp)
    if (current?.reason === RETIRED_DELETED || current?.reason === reason) return true
    const next = [...list.filter((entry) => entry.fp !== fp), { fp, reason, at }]
    return write(RETIRED_SCOPES_KEY, JSON.stringify(next))
  }

  // Una sessione VERA di quell'account dimostra che esiste: un ambito rimosso
  // a mano torna utilizzabile. Mai un 'deleted' (provato da Auth).
  function reinstate(scope) {
    const fp = scopeFingerprint(scope, storage)
    const list = readRetiredScopes(storage)
    const current = fp ? list.find((entry) => entry.fp === fp) : null
    if (current?.reason !== RETIRED_REMOVED) return false
    retiredScopes.delete(scope)
    const next = list.filter((entry) => entry.fp !== fp)
    return next.length > 0 ? write(RETIRED_SCOPES_KEY, JSON.stringify(next)) : (remove(RETIRED_SCOPES_KEY), true)
  }

  // L'utente ha scelto ESPLICITAMENTE di rimuovere i dati di quell'ambito:
  // nessuna scheda li ricreerà più, nemmeno per salvare modifiche (preserve).
  function markCleared(scope) {
    const fp = scopeFingerprint(scope, storage)
    const list = readRetiredScopes(storage)
    if (!fp || !list.some((entry) => entry.fp === fp)) return false
    return write(RETIRED_SCOPES_KEY, JSON.stringify(list.map((entry) => (entry.fp === fp ? { ...entry, cleared: true } : entry))))
  }

  // L'unica scrittura ammessa in un ambito invalidato. Una scheda scopre che il
  // suo account è stato eliminato e che il contenitore è stato rimosso (da
  // un'altra scheda, che non vedeva le sue modifiche), ma ha in memoria
  // modifiche mai sincronizzate: le salva, una volta, perché non vadano perse
  // in silenzio. Solo se il contenitore NON c'è, solo per un account eliminato
  // e mai dopo una rimozione scelta dall'utente. Il contenitore resta bloccato
  // per tutte le altre scritture e compare in Impostazioni. → true se salvato
  function preserve(scope, raw) {
    if (!isUserScope(scope) || typeof raw !== 'string' || read(stateKey(scope)) !== null) return false
    const entry = retiredEntry(scope, storage)
    if (entry?.reason !== RETIRED_DELETED || entry.cleared) return false
    return write(stateKey(scope), raw)
  }

  // Gli account eliminati (provato) il cui contenitore è ancora sul
  // dispositivo, perché conteneva modifiche mai sincronizzate o perché non si
  // è potuto leggerlo: restano finché l'utente non sceglie (Impostazioni).
  function deletedAccountsWithData() {
    const deleted = new Map(readRetiredScopes(storage).filter((entry) => entry.reason === RETIRED_DELETED).map((entry) => [entry.fp, entry]))
    if (deleted.size === 0 || !storage) return []
    let keys = []
    try {
      keys = typeof storage.length === 'number' && typeof storage.key === 'function'
        ? Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean)
        : Object.keys(storage)
    } catch {
      keys = []
    }
    const prefix = `${STATE_BASE}:`
    return keys
      .filter((key) => key.startsWith(prefix) && isUserScope(key.slice(prefix.length)))
      .map((key) => key.slice(prefix.length))
      .map((scope) => ({ scope, entry: deleted.get(scopeFingerprint(scope, storage)) }))
      .filter(({ entry }) => entry)
      .map(({ scope, entry }) => ({ userId: ownerOf(scope), scope, at: entry.at ?? null, unsynced: unsyncedWrites(scope) }))
  }

  // Lo stato salvato di un ambito, per scaricarne una copia. → oggetto o null
  function containerState(scope) {
    if (!isUserScope(scope)) return null
    try {
      const state = JSON.parse(read(stateKey(scope)) ?? 'null')?.state
      return state && typeof state === 'object' ? state : null
    } catch {
      return null
    }
  }

  return {
    storage: adapter,
    migration,
    forgetScope,
    unsyncedWrites,
    retire,
    reinstate,
    markCleared,
    preserve,
    deletedAccountsWithData,
    containerState,
    hasContainer: (scope) => isUserScope(scope) && read(stateKey(scope)) !== null,
    getActive: () => active,
    setActive(scope) {
      active = scope
      rawWrite(ACTIVE_SCOPE_KEY, scope)
    },
    // Mentre si cambia ambito lo stato in memoria viene svuotato e riletto:
    // niente di tutto questo deve finire scritto in un contenitore.
    withWritesFrozen(fn) {
      const previous = writesFrozen
      writesFrozen = true
      try {
        return fn()
      } finally {
        writesFrozen = previous
      }
    },
    enterUserScope,
    isLegacyMode: () => legacyMode,
  }
}
