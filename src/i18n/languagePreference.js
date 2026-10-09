// La lingua scelta su QUESTO dispositivo, e come si accorda con quella
// dell'account.
//
// La lingua non sta più solo nel contenitore di un account: vale per il
// dispositivo, così uscire dall'account o cambiarlo non riporta l'app in
// un'altra lingua. Segue l'account tramite i metadati di Supabase Auth
// (user_metadata.language / language_updated_at), MAI tramite il sync dei
// dati: la riga delle impostazioni (profiles) porta budget, ciclo e valuta e
// non viene mai scritta per una lingua.
//
// Tutto qui è puro: lo storage si passa da fuori (localStorage nell'app, una
// Map nei test) e nessuna funzione importa lo store o Supabase.
//
//   spendy-language = { language, chosenAt, source }
//     chosenAt  ISO dell'ultima scelta, null se ereditata
//     source    'welcome'   scelta nella schermata di benvenuto
//               'settings'  scelta in Impostazioni (o confermata dall'utente)
//               'account'   presa dall'account dopo l'accesso
//               'inherited' la lingua che il dispositivo usava già prima
import { GUEST_CLAIM_KEY, ACTIVE_SCOPE_KEY, LEGACY_STATE_KEY, STATE_BASE, hasUserData, stateKey } from '../store/scope.js'
import { LEGACY_LANGUAGE, isLanguage } from './languages.js'

export const LANGUAGE_PREFERENCE_KEY = 'spendy-language'

// Lo storage del dispositivo così com'è (non l'adattatore degli ambiti dello
// store): la lingua vale per tutto il dispositivo.
export const deviceStorage = () => {
  try {
    return globalThis.window?.localStorage ?? null
  } catch {
    return null
  }
}
const SOURCES = ['welcome', 'settings', 'account', 'inherited']

// Senza storage utilizzabile (navigazione privata bloccata, spazio esaurito,
// Node) la scelta vive in memoria per la sessione: la schermata di benvenuto
// non deve ripresentarsi a ogni tocco. Una copia per storage, così due
// dispositivi simulati nello stesso processo non si vedono a vicenda.
const memoryByStorage = new WeakMap()
let memoryWithoutStorage = null
const remember = (storage, value) => {
  if (storage && typeof storage === 'object') memoryByStorage.set(storage, value)
  else memoryWithoutStorage = value
}
const remembered = (storage) => (storage && typeof storage === 'object' ? memoryByStorage.get(storage) ?? null : memoryWithoutStorage)
const listeners = new Set()

const safeRead = (storage, key) => {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

const parseState = (raw) => {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed.state ?? null : null
  } catch {
    return null
  }
}

const sanitize = (value) => {
  if (!value || typeof value !== 'object' || !isLanguage(value.language)) return null
  return {
    language: value.language,
    chosenAt: typeof value.chosenAt === 'string' && !Number.isNaN(Date.parse(value.chosenAt)) ? value.chosenAt : null,
    source: SOURCES.includes(value.source) ? value.source : 'inherited',
  }
}

export function readLanguagePreference(storage) {
  const raw = safeRead(storage, LANGUAGE_PREFERENCE_KEY)
  if (raw !== null) {
    try {
      const stored = sanitize(JSON.parse(raw))
      if (stored) return stored
    } catch {
      // illeggibile: vale come assente
    }
  }
  return remembered(storage)
}

export function writeLanguagePreference(storage, value) {
  const next = sanitize(value)
  if (!next) return null
  let saved = false
  try {
    if (storage) {
      storage.setItem(LANGUAGE_PREFERENCE_KEY, JSON.stringify(next))
      saved = true
    }
  } catch {
    saved = false
  }
  // Spazio esaurito o storage bloccato: resta la copia in memoria.
  remember(storage, saved ? null : next)
  listeners.forEach((listener) => listener(next))
  return next
}

// Serve la schermata di benvenuto? Sì finché il dispositivo non ha una lingua
// scelta (o ereditata da chi usava già SPENDY).
export const needsLanguageWelcome = (storage = deviceStorage()) => readLanguagePreference(storage) === null

export const subscribeLanguagePreference = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// --- utenti esistenti -----------------------------------------------------

const keysOf = (storage) => {
  const keys = []
  try {
    for (let index = 0; index < (storage?.length ?? 0); index += 1) {
      const key = storage.key(index)
      if (typeof key === 'string') keys.push(key)
    }
  } catch {
    // storage non elencabile: nessuna chiave
  }
  return keys
}

const isStateKey = (key) => key === LEGACY_STATE_KEY || key.startsWith(`${STATE_BASE}:`)

// Questo dispositivo usava già SPENDY? Sì se c'è un account (sessione,
// ambito attivo di un account, dati ospite già adottati) o un contenitore con
// dei dati. Un contenitore vuoto (chi ha solo aperto il sito) non conta.
export function isExistingInstall(storage) {
  const keys = keysOf(storage)
  if (keys.some((key) => /^sb-.+-auth-token$/.test(key))) return true
  if (safeRead(storage, GUEST_CLAIM_KEY) !== null) return true
  const active = safeRead(storage, ACTIVE_SCOPE_KEY)
  if (typeof active === 'string' && active.startsWith('u:')) return true
  return keys.filter(isStateKey).some((key) => hasUserData(parseState(safeRead(storage, key))))
}

// La lingua che il dispositivo usava già: quella del contenitore attivo, poi
// quella di un contenitore con dei dati, altrimenti l'italiano (i contenitori
// di prima della scelta della lingua non la salvavano).
export function inheritedLanguage(storage) {
  const active = safeRead(storage, ACTIVE_SCOPE_KEY)
  const activeState = typeof active === 'string' ? parseState(safeRead(storage, stateKey(active))) : null
  if (isLanguage(activeState?.language)) return activeState.language
  const withData = keysOf(storage)
    .filter(isStateKey)
    .map((key) => parseState(safeRead(storage, key)))
    .find((state) => hasUserData(state) && isLanguage(state.language))
  return withData?.language ?? LEGACY_LANGUAGE
}

// All'avvio: se il dispositivo non ha ancora una preferenza ma usava già
// SPENDY, la si crea dalla lingua che stava usando (nessuna schermata di
// benvenuto, nessun cambio di lingua). → la preferenza, oppure null se è un
// primo avvio (serve la schermata di benvenuto).
export function ensureLanguagePreference(storage) {
  const current = readLanguagePreference(storage)
  if (current) return current
  if (!isExistingInstall(storage)) return null
  return writeLanguagePreference(storage, { language: inheritedLanguage(storage), chosenAt: null, source: 'inherited' })
}

// --- dispositivo e account ------------------------------------------------

const time = (iso) => {
  const value = typeof iso === 'string' ? Date.parse(iso) : Number.NaN
  return Number.isNaN(value) ? 0 : value
}

// La lingua salvata nell'account (user_metadata), o null.
export function accountLanguage(user) {
  const meta = user?.user_metadata
  if (!meta || !isLanguage(meta.language)) return null
  return { language: meta.language, updatedAt: typeof meta.language_updated_at === 'string' ? meta.language_updated_at : null }
}

// I metadati da salvare nell'account per una preferenza del dispositivo.
export const accountMetadataFor = (preference) => ({
  language: preference.language,
  language_updated_at: preference.chosenAt ?? null,
})

// La regola, dopo l'accesso (e a ogni aggiornamento della sessione):
//   - l'account ha una lingua → vale quella, TRANNE se su questo dispositivo
//     c'è una scelta fatta in Impostazioni più recente: allora è questa a
//     essere salvata nell'account;
//   - l'account non ha una lingua → gli si salva quella del dispositivo
//     (un utente esistente conserva la lingua che stava già usando).
// La schermata di benvenuto di un nuovo dispositivo NON scavalca la lingua
// dell'account: accedendo da un secondo dispositivo si ritrova la propria.
// → { apply: preferenza da adottare | null, push: metadati da salvare | null }
export function reconcileLanguage(device, account) {
  if (!account) return { apply: null, push: device ? accountMetadataFor(device) : null }
  if (!device) return { apply: { language: account.language, chosenAt: account.updatedAt, source: 'account' }, push: null }
  const deviceIsNewer = device.source === 'settings' && time(device.chosenAt) > time(account.updatedAt)
  if (deviceIsNewer) return { apply: null, push: device.language === account.language ? null : accountMetadataFor(device) }
  if (device.language === account.language) return { apply: null, push: null }
  return { apply: { language: account.language, chosenAt: account.updatedAt, source: 'account' }, push: null }
}
