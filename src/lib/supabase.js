import { createClient } from '@supabase/supabase-js'

// Client Supabase, creato solo se le due variabili d'ambiente ci sono.
//
// Se mancano, `supabase` resta null e l'app continua a funzionare
// ESATTAMENTE come prima: tutto in locale, nessuna schermata di login,
// nessun errore. È voluto — il cloud è una funzione che si accende, non
// un requisito per aprire Spendy. Vale anche per il caso peggiore: se un
// domani il progetto Supabase non fosse raggiungibile, l'app non smette
// di funzionare, smette solo di sincronizzare.
//
// La chiave `anon` è pubblica per definizione e sta nel bundle: è quello
// il suo mestiere. La sicurezza NON dipende da lei ma dalle policy RLS
// (supabase/schema.sql), che al server dicono quali righe quell'utente
// può vedere. La chiave `service_role` invece non deve MAI comparire in
// un file del frontend.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)
// Gli stessi valori pubblici del client (URL del progetto e chiave anon):
// servono alla verifica "l'account esiste ancora?" (sync/sessionGate.js).
export const supabaseUrl = url ?? null
export const supabaseAnonKey = anonKey ?? null

// La chiave in cui il client salva la sessione: ESATTAMENTE quella che
// sceglierebbe da solo (sb-<ref del progetto>-auth-token, un test lo
// verifica), scritta qui per poterla leggere prima che il client parta.
function defaultAuthStorageKey(projectUrl) {
  try {
    return `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`
  } catch {
    return null
  }
}
export const authStorageKey = isSupabaseConfigured ? defaultAuthStorageKey(url) : null

// Di chi era la sessione salvata su questo dispositivo PRIMA che il client si
// avviasse (letto adesso, in modo sincrono). Se all'avvio quella sessione non
// c'è più e non per un problema di rete, il server l'ha rifiutata: è la prova
// che la sessione è FINITA (sync/sessionGate.js), qualunque sia l'ordine in
// cui arrivano gli eventi della libreria. Solo l'id, solo in memoria.
function storedSessionUser(key) {
  try {
    const raw = key ? globalThis.localStorage?.getItem(key) : null
    const id = raw ? JSON.parse(raw)?.user?.id : null
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}
export const startupStoredSessionUser = storedSessionUser(authStorageKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        ...(authStorageKey ? { storageKey: authStorageKey } : {}),
        // La sessione resta in localStorage e si rinnova da sola: si fa
        // login una volta per dispositivo, non una volta al giorno. È
        // anche ciò che permette all'app di sapere chi sei mentre sei
        // offline, e quindi di continuare ad accodare modifiche.
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
