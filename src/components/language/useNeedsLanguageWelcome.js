import { useSyncExternalStore } from 'react'
import { needsLanguageWelcome, subscribeLanguagePreference } from '../../i18n/languagePreference.js'

// Serve la schermata di benvenuto? Sì finché il dispositivo non ha una lingua
// (scelta, o ereditata da chi usava già SPENDY): si chiude da sola appena
// "Continua" la salva.
export function useNeedsLanguageWelcome() {
  return useSyncExternalStore(subscribeLanguagePreference, () => needsLanguageWelcome(), () => false)
}
