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

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        // La sessione resta in localStorage e si rinnova da sola: si fa
        // login una volta per dispositivo, non una volta al giorno. È
        // anche ciò che permette all'app di sapere chi sei mentre sei
        // offline, e quindi di continuare ad accodare modifiche.
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
