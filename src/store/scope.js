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
export const isRetiredScope = (scope) => retiredScopes.has(scope)

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
        rawWrite(`${key}:corrupt:${stamp()}`, raw)
        return null
      }
      return raw
    },
    setItem(name, value) {
      if (writesFrozen) return
      rawWrite(keyFor(name, active), value)
    },
    removeItem(name) {
      if (writesFrozen) return
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

  return {
    storage: adapter,
    migration,
    forgetScope,
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
