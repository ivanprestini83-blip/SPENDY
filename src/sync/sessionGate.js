// Il "cancello" della sessione: cosa succede ai dati locali di un account
// quando la sua sessione finisce senza che l'utente sia uscito da qui.
//
// Il caso da coprire: l'account viene eliminato da un ALTRO dispositivo. Qui
// la sessione smette di funzionare, ma il contenitore locale u:<userId> resta
// con tutti i dati. Prima restavano anche a schermo; ora:
//
//   sessione finita (rifiuto del server, uscita da un altro dispositivo,
//   cambio password, account eliminato…)  → 'ended': i dati NON si vedono
//       più (App.jsx non disegna la schermata dell'account) ma restano nel
//       contenitore. Rientrando con lo stesso account tornano tutti, coda di
//       invio compresa; con un altro account non si vedono mai.
//   PROVA che l'account non esiste più → 'deleted': l'ambito viene
//       invalidato per tutte le schede (store/scope.js, nessuna scrittura
//       dopo) e il contenitore si cancella, solo quello di quell'id, solo se
//       non contiene modifiche mai sincronizzate. Altrimenti resta nascosto e
//       la scelta resta disponibile in Impostazioni, anche dopo un riavvio.
//
// La prova è una sola: Supabase Auth che risponde `user_not_found` a una
// richiesta firmata con un token ANCORA VALIDO il cui `sub` è proprio quell'id
// (il server controlla la firma: un token valido l'ha emesso il progetto).
// Tutto il resto — rete assente, 5xx, 401, token scaduto, sessione revocata
// (`session_not_found`), risposta strana — è ambiguo e non cancella niente.
// Nessun registro sul server e nessuna richiesta senza token: sul dispositivo
// resta solo l'elenco degli ambiti invalidati (store/scope.js).
//
// Qui solo i pezzi senza effetti collaterali: lo stato condiviso della
// schermata (fuori da React, come legal/legalGate.js) e la verifica. Chi
// decide QUANDO verificare e cosa fare è sync/spendySync.js; la schermata è
// components/settings/SessionGateScreen.jsx.

export const SESSION_ENDED = 'ended'
export const SESSION_DELETED = 'deleted'

export const ACCOUNT_PRESENT = 'present'
export const ACCOUNT_DELETED = 'deleted'
export const ACCOUNT_UNKNOWN = 'unknown'

// --- stato della schermata ----------------------------------------------
// null                                         → nessuna schermata
// { status: 'ended', userId }                  → sessione finita: dati nascosti
// { status: 'deleted', userId, pending, removed } → account eliminato (provato):
//     removed true  = contenitore cancellato (non c'era niente di non sincronizzato)
//     removed false = contenitore nascosto e conservato: `pending` modifiche mai
//                     sincronizzate (null = non leggibile), decide l'utente
let state = null
const listeners = new Set()
export const getSessionGateState = () => state
export const subscribeSessionGate = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function setSessionGateState(next) {
  state = next
  listeners.forEach((listener) => listener())
}

// --- marcatore sul dispositivo ----------------------------------------------
// La schermata 'ended' deve restare anche dopo un riavvio: senza sessione,
// all'avvio l'app non saprebbe più che quella dell'ambito attivo è FINITA (e
// non semplicemente "mai aperta"). Il marcatore nomina l'ambito (u:<userId>),
// come già fa spendy-guest-claimed-by; si toglie a ogni accesso e a ogni scelta
// fatta dalla schermata.
export const SESSION_ENDED_KEY = 'spendy-session-ended'

export function readEndedScope(storage) {
  try {
    const value = storage?.getItem(SESSION_ENDED_KEY)
    return typeof value === 'string' && value ? value : null
  } catch {
    return null
  }
}

// scope → lo segna; null → lo toglie (solo se nomina `onlyIf`, quando indicato).
export function writeEndedScope(storage, scope, { onlyIf = null } = {}) {
  try {
    if (scope) storage?.setItem(SESSION_ENDED_KEY, scope)
    else if (!onlyIf || readEndedScope(storage) === onlyIf) storage?.removeItem(SESSION_ENDED_KEY)
  } catch {
    // storage bloccato: la schermata vale comunque per questa apertura dell'app
  }
}

// --- avviso "Account eliminato" persistente --------------------------------
// Appena l'eliminazione è PROVATA si salva l'esito, prima della pulizia: un
// refresh, la chiusura dell'app o un passaggio della pulizia che non riesce
// non lo fanno sparire. Resta finché l'utente non lo chiude (o non accede con
// un account). Contiene solo data, esito della rimozione e numero di modifiche
// mai sincronizzate: nessun id, email o token.
export const DELETED_NOTICE_KEY = 'spendy-account-deleted-notice'

export function readDeletedNotice(storage) {
  try {
    const notice = JSON.parse(storage?.getItem(DELETED_NOTICE_KEY) ?? 'null')
    if (!notice || typeof notice !== 'object') return null
    return {
      at: typeof notice.at === 'string' ? notice.at : null,
      removed: notice.removed === true,
      pending: typeof notice.pending === 'number' && notice.pending >= 0 ? notice.pending : null,
    }
  } catch {
    return null
  }
}

// notice → lo salva ({ at, removed, pending }); null → lo toglie.
export function writeDeletedNotice(storage, notice) {
  try {
    if (!notice) {
      storage?.removeItem(DELETED_NOTICE_KEY)
      return
    }
    const value = {
      at: typeof notice.at === 'string' ? notice.at : new Date().toISOString(),
      removed: notice.removed === true,
      pending: typeof notice.pending === 'number' ? notice.pending : null,
    }
    storage?.setItem(DELETED_NOTICE_KEY, JSON.stringify(value))
  } catch {
    // storage bloccato: l'avviso vale comunque per questa apertura dell'app
  }
}

// --- verifica ---------------------------------------------------------------

// Le rivendicazioni di un JWT, SENZA verificarne la firma (lo fa il server):
// servono solo a sapere a chi appartiene il token e se è ancora valido, prima
// di chiedere. → { sub, exp } oppure null
export function tokenClaims(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded))
    return claims && typeof claims === 'object' ? claims : null
  } catch {
    return null
  }
}

// L'account `userId` esiste ancora? Una richiesta GET /auth/v1/user
// all'API pubblica di Supabase Auth, firmata con il token indicato.
//
// NON usa supabase.auth.getUser(jwt): con una risposta `session_not_found`
// auth-js toglie la sessione CORRENTE del client (anche se il token passato è
// di un altro account), e una verifica partita con il token di A potrebbe
// chiudere la sessione di B entrato nel frattempo. Questa richiesta non tocca
// né la sessione né lo storage: legge soltanto la risposta.
//
// config: { url, apiKey, fetch }  (URL del progetto e chiave pubblica: gli
//   stessi del client; nessun segreto)
// → ACCOUNT_DELETED solo con la prova descritta in alto; ACCOUNT_PRESENT se
//   Auth restituisce proprio quell'utente; ACCOUNT_UNKNOWN in ogni altro caso.
export async function probeAccount(config, { userId, accessToken, now = Date.now() } = {}) {
  const fetchImpl = config?.fetch
  if (typeof userId !== 'string' || !userId || typeof fetchImpl !== 'function' || !config?.url || !config?.apiKey) return ACCOUNT_UNKNOWN
  const claims = tokenClaims(accessToken)
  if (!claims || claims.sub !== userId) return ACCOUNT_UNKNOWN
  // Token scaduto: il server risponderebbe "token non valido", non "utente
  // inesistente". Non si chiede nemmeno.
  if (!(typeof claims.exp === 'number' && claims.exp * 1000 > now)) return ACCOUNT_UNKNOWN
  let response
  try {
    response = await fetchImpl(`${String(config.url).replace(/\/$/, '')}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: config.apiKey,
        Authorization: `Bearer ${accessToken}`,
        // Lo stesso formato degli errori che chiede auth-js: { code: '<codice>' }
        'X-Supabase-Api-Version': '2024-01-01',
      },
    })
  } catch {
    return ACCOUNT_UNKNOWN
  }
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (response.ok) return body?.id === userId ? ACCOUNT_PRESENT : ACCOUNT_UNKNOWN
  if (response.status !== 403 && response.status !== 404) return ACCOUNT_UNKNOWN
  // Formato nuovo { code: 'user_not_found' }; vecchio { code: 403, error_code: 'user_not_found' }
  // (la stessa lettura di auth-js).
  const code = typeof body?.code === 'string' ? body.code : body?.error_code
  return code === 'user_not_found' ? ACCOUNT_DELETED : ACCOUNT_UNKNOWN
}

// Errore "ritentabile" di Supabase Auth (rete assente, 5xx): la libreria, in
// quel caso, NON toglie la sessione salvata. Non è un motivo per nascondere
// niente: l'app resta utilizzabile offline come sempre.
export const isRetryableAuthError = (error) =>
  error?.name === 'AuthRetryableFetchError' || error?.status === 0 || (typeof error?.status === 'number' && error.status >= 500)
