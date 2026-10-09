// Documenti legali di SPENDY e accettazione alla registrazione.
//
// Un solo posto per gli indirizzi delle pagine pubbliche (public/*.html) e
// per gli identificativi di versione registrati quando un utente crea
// l'account. Cambiando il testo di un documento si cambia anche la sua
// versione (in _shared/legalVersions.js): chi si registra dopo risulterà aver
// accettato quella nuova, e chi aveva accettato la precedente dovrà
// riaccettare (legal/legalGate.js).
//
// Le due azioni restano separate: accettare i Termini e prendere visione
// dell'Informativa privacy. Nessuna delle due vale per l'altra, nessuna è
// preselezionata. La base giuridica del trattamento non è decisa qui: va
// definita da un legale (vedi privacy.html).

import { LEGAL_VERSIONS } from '../../supabase/functions/_shared/legalVersions.js'
import { tr } from '../i18n/currentLanguage.js'

// Le versioni vengono da supabase/functions/_shared/legalVersions.js, la stessa
// fonte usata dalla Edge Function accept-legal: app e server non possono
// divergere.
export const LEGAL_DOCUMENTS = {
  terms: { url: '/termini.html', version: LEGAL_VERSIONS.terms },
  privacy: { url: '/privacy.html', version: LEGAL_VERSIONS.privacy },
}

// Nella lingua dell'app, letto nel momento in cui serve.
export const LEGAL_MESSAGES = {
  get acceptanceRequired() { return tr('legal.acceptancerequired') },
}

// Entrambe le caselle, esplicitamente vere: niente valori "quasi veri".
export const canSignUp = (acceptance) =>
  acceptance?.termsAccepted === true && acceptance?.privacyAcknowledged === true

// I metadati che viaggiano con la registrazione (supabase.auth.signUp →
// options.data). Il server li copia in legal_acceptances con il SUO orario
// (supabase/privacy_consent.sql): gli orari qui sotto sono solo quelli del
// dispositivo, utili come riscontro. → null se l'accettazione manca.
export function buildSignUpMetadata(acceptance, now = new Date()) {
  if (!canSignUp(acceptance)) return null
  const at = now.toISOString()
  return {
    terms_version: LEGAL_DOCUMENTS.terms.version,
    terms_accepted_at: at,
    privacy_version: LEGAL_DOCUMENTS.privacy.version,
    privacy_acknowledged_at: at,
  }
}
