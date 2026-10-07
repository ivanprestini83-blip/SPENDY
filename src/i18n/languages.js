// Le lingue di Spendy. La lingua è una preferenza dell'esperienza
// dell'utente, non un dato finanziario: vive nel contenitore locale
// dell'account (useAppStore `language`) e non viaggia con il sync.
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

export const DEFAULT_LANGUAGE = 'it'

export const LANGUAGE_CODES = LANGUAGES.map((language) => language.code)

export const isLanguage = (value) => typeof value === 'string' && LANGUAGE_CODES.includes(value)

// Qualunque valore non valido (assente, sconosciuto, di un'altra versione)
// diventa l'italiano.
export const normalizeLanguage = (value) => (isLanguage(value) ? value : DEFAULT_LANGUAGE)

export const languageInfo = (code) => LANGUAGES.find((language) => language.code === normalizeLanguage(code))
