// Le lingue di Spendy. La lingua è una preferenza dell'esperienza
// dell'utente, non un dato finanziario: vale per il dispositivo
// (i18n/languagePreference.js) e segue l'account tramite i metadati di
// Supabase Auth, mai tramite il sync dei dati.
//
// Ogni lingua ha il suo nome scritto nella lingua stessa (come si fa nei
// selettori di lingua: chi cerca l'italiano cerca "Italiano") e il locale
// per Intl, pronto per le fasi successive.
export const LANGUAGES = [
  { code: 'it', name: 'Italiano', flag: '🇮🇹', locale: 'it-IT' },
  { code: 'en', name: 'English', flag: '🇬🇧', locale: 'en-GB' },
  { code: 'es', name: 'Español', flag: '🇪🇸', locale: 'es-ES' },
  { code: 'fr', name: 'Français', flag: '🇫🇷', locale: 'fr-FR' },
]

// La lingua dei nuovi utenti.
export const DEFAULT_LANGUAGE = 'en'

// La lingua di chi usava SPENDY prima che esistesse la scelta: i contenitori
// salvati senza lingua (o con un valore non valido) restano in italiano, così
// nessun utente esistente si ritrova l'app in un'altra lingua.
export const LEGACY_LANGUAGE = 'it'

// L'ordine della schermata di benvenuto: la lingua predefinita per prima.
export const WELCOME_LANGUAGE_ORDER = ['en', 'it', 'es', 'fr']

export const LANGUAGE_CODES = LANGUAGES.map((language) => language.code)

export const isLanguage = (value) => typeof value === 'string' && LANGUAGE_CODES.includes(value)

// Qualunque valore non valido (assente, sconosciuto, di un'altra versione)
// diventa `fallback`: la lingua predefinita, salvo dove serve quella legacy.
export const normalizeLanguage = (value, fallback = DEFAULT_LANGUAGE) => (isLanguage(value) ? value : fallback)

export const languageInfo = (code) => LANGUAGES.find((language) => language.code === normalizeLanguage(code))
