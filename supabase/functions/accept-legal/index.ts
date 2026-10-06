// Supabase Edge Function "accept-legal" — solo il collegamento dei pezzi.
// La logica sta in handler.js (testata in Node, `npm test`).
//
// Variabili d'ambiente, tutte fornite da Supabase (nessun secret nuovo):
//   SUPABASE_URL, la chiave pubblica (per verificare l'utente) e la
//   service_role / chiave segreta (per scrivere legal_acceptances).
//   ALLOWED_ORIGINS facoltativo.
import { createAcceptLegalHandler } from './handler.js'
import { createSupabaseLegalAcceptanceWriter } from './store.js'
import { createSupabaseUserVerifier } from '../spendy-ai/auth.js'
import { supabasePublicKey } from '../spendy-ai/handler.js'
import { supabaseServiceKey } from '../spendy-ai/quota.js'
import { LEGAL_VERSIONS } from '../_shared/legalVersions.js'

const getEnv = (name: string) => Deno.env.get(name) ?? undefined
const supabaseUrl = getEnv('SUPABASE_URL')
const serviceKey = supabaseServiceKey(getEnv)

const handler = createAcceptLegalHandler({
  verifyUser: createSupabaseUserVerifier({ supabaseUrl, publicKey: supabasePublicKey(getEnv) }),
  // Senza URL o service_role la funzione risponde 503: mai un falso successo.
  recordAcceptance: supabaseUrl && serviceKey ? createSupabaseLegalAcceptanceWriter({ supabaseUrl, serviceKey }) : null,
  currentVersions: LEGAL_VERSIONS,
  allowedOrigins: (getEnv('ALLOWED_ORIGINS') ?? '*').split(',').map((o) => o.trim()).filter(Boolean),
  log: (entry: Record<string, unknown>) => console.log(JSON.stringify({ fn: 'accept-legal', ...entry })),
})

Deno.serve(handler)
