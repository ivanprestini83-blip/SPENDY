// Il "cancello" legale dopo l'accesso: un account può usare SPENDY (e
// sincronizzare) solo dopo aver accettato i Termini e preso visione della
// Privacy Policy nella versione CORRENTE.
//
// Qui solo i pezzi senza effetti collaterali:
//   - needsAcceptance(): il confronto, esatto, con le versioni correnti;
//   - lo stato condiviso della schermata (fuori da React, come
//     lib/passwordRecovery.js): sopravvive al cambio di ambito dei dati;
//   - requestLegalAcceptance(): la chiamata alla Edge Function accept-legal.
// Chi decide QUANDO controllare e quando avviare il sync è
// sync/spendySync.js; la schermata è components/legal/LegalGateScreen.jsx.
import { LEGAL_DOCUMENTS } from './legal.js'

export const ACCEPT_LEGAL_FUNCTION = 'accept-legal'

// Quello che si salva nel contenitore locale dell'account dopo una conferma
// del server: le DUE versioni, così un cambio di una sola delle due basta a
// richiedere una nuova accettazione.
export const currentLegalVersionKey = () =>
  `terms:${LEGAL_DOCUMENTS.terms.version}|privacy:${LEGAL_DOCUMENTS.privacy.version}`

// La riga di legal_acceptances di quell'utente (o null) → serve una nuova
// accettazione? Sì se manca, o se anche una sola versione è diversa da quella
// corrente: nessun confronto "maggiore/minore", solo uguaglianza esatta.
export function needsAcceptance(row) {
  return !(
    row
    && row.terms_version === LEGAL_DOCUMENTS.terms.version
    && row.privacy_version === LEGAL_DOCUMENTS.privacy.version
  )
}

export const LEGAL_GATE_MESSAGES = {
  required: 'Per continuare devi accettare i Termini di utilizzo e prendere visione della Privacy Policy.',
  offline: 'Serve la connessione per verificare e confermare i documenti. Riprova quando sei online.',
  unavailable: 'Non è stato possibile verificare i documenti. Riprova tra poco.',
  failed: 'Non è stato possibile registrare la conferma: non è stato salvato niente. Riprova tra poco.',
  unauthenticated: 'La sessione non è più valida. Esci e rientra con il tuo account.',
}

// --- stato della schermata ----------------------------------------------
// null                                → nessuna schermata
// { status: 'checking', userId }      → verifica in corso
// { status: 'required', userId, error? } → deve accettare
// { status: 'submitting', userId }    → conferma in invio
// { status: 'unavailable', userId, message } → verifica impossibile (offline, errore)
let state = null
const listeners = new Set()
export const getLegalGateState = () => state
export const subscribeLegalGate = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function setLegalGateState(next) {
  state = next
  listeners.forEach((listener) => listener())
}

// --- la richiesta al server -----------------------------------------------
const statusOf = (error) => error?.context?.status ?? error?.status ?? null

// → { ok: true } solo se il server risponde { accepted: true } con ESATTAMENTE
//   le versioni correnti; altrimenti { ok: false, message }.
export async function requestLegalAcceptance(client) {
  if (!client?.functions?.invoke) return { ok: false, message: LEGAL_GATE_MESSAGES.failed }
  try {
    const { data, error } = await client.functions.invoke(ACCEPT_LEGAL_FUNCTION, {
      method: 'POST',
      body: { terms_version: LEGAL_DOCUMENTS.terms.version, privacy_version: LEGAL_DOCUMENTS.privacy.version },
    })
    if (error) {
      if (statusOf(error) === 401) return { ok: false, message: LEGAL_GATE_MESSAGES.unauthenticated }
      if (error?.name === 'FunctionsFetchError') return { ok: false, message: LEGAL_GATE_MESSAGES.offline }
      return { ok: false, message: LEGAL_GATE_MESSAGES.failed }
    }
    const confirmed = data?.accepted === true
      && data?.terms_version === LEGAL_DOCUMENTS.terms.version
      && data?.privacy_version === LEGAL_DOCUMENTS.privacy.version
    return confirmed ? { ok: true } : { ok: false, message: LEGAL_GATE_MESSAGES.failed }
  } catch {
    return { ok: false, message: LEGAL_GATE_MESSAGES.failed }
  }
}
