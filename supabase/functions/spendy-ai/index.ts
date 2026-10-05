// Supabase Edge Function "spendy-ai" — solo il collegamento dei pezzi.
// La logica sta in handler.js (testata in Node, `npm test`).
//
// Variabili d'ambiente (Supabase → Edge Functions → Secrets):
//   AI_PROVIDER   "anthropic" (unico supportato per ora)
//   AI_MODEL      id del modello, obbligatorio (nessun default nel codice)
//   AI_API_KEY    chiave del provider — SOLO qui, mai nel frontend
//   AI_EFFORT     facoltativo: low | medium | high | xhigh | max
//   AI_TIMEOUT_MS, AI_MAX_TOKENS, ALLOWED_ORIGINS  facoltativi
//   AI_DAILY_LIMIT (3), AI_MONTHLY_LIMIT (30), AI_GLOBAL_DAILY_LIMIT (300)
//                 facoltativi: limiti della quota, vedi quota.js
// SUPABASE_URL, la chiave pubblica e la service_role (usata SOLO per la
// quota giornaliera, tabella ai_usage) sono forniti da Supabase.
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0'
import { createSpendyAIHandler, readConfig, supabasePublicKey } from './handler.js'
import { createAnthropicCaller } from './anthropicModel.js'
import { createSupabaseUserVerifier } from './auth.js'
import { createSupabaseQuota, supabaseServiceKey } from './quota.js'
import { createSupabaseAIPreference } from './preference.js'

const getEnv = (name: string) => Deno.env.get(name) ?? undefined
const config = readConfig(getEnv)
const supabaseUrl = getEnv('SUPABASE_URL')
const serviceKey = supabaseServiceKey(getEnv)

const handler = createSpendyAIHandler({
  config,
  verifyUser: createSupabaseUserVerifier({
    supabaseUrl: getEnv('SUPABASE_URL'),
    publicKey: supabasePublicKey(getEnv),
  }),
  callModel: config.provider === 'anthropic' && config.apiKey && config.model
    ? createAnthropicCaller({ Anthropic, apiKey: config.apiKey, config })
    : null,
  // Senza URL o service_role la quota non c'è e l'handler rifiuta ogni
  // chiamata AI (503 not_configured): mai modello senza limite.
  quota: supabaseUrl && serviceKey ? createSupabaseQuota({ supabaseUrl, serviceKey }) : null,
  // La scelta dell'utente su Spendy AI, letta dal database. Senza, nessuna
  // chiamata passa (fail closed).
  aiPreference: supabaseUrl && serviceKey ? createSupabaseAIPreference({ supabaseUrl, serviceKey }) : null,
  log: (entry: Record<string, unknown>) => console.log(JSON.stringify({ fn: 'spendy-ai', ...entry })),
})

Deno.serve(handler)
