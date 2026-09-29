// Supabase Edge Function "spendy-ai" — solo il collegamento dei pezzi.
// La logica sta in handler.js (testata in Node, `npm test`).
//
// Variabili d'ambiente (Supabase → Edge Functions → Secrets):
//   AI_PROVIDER   "anthropic" (unico supportato per ora)
//   AI_MODEL      id del modello, obbligatorio (nessun default nel codice)
//   AI_API_KEY    chiave del provider — SOLO qui, mai nel frontend
//   AI_EFFORT     facoltativo: low | medium | high | xhigh | max
//   AI_TIMEOUT_MS, AI_MAX_TOKENS, ALLOWED_ORIGINS  facoltativi
// SUPABASE_URL e la chiave pubblica sono forniti da Supabase.
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0'
import { createSpendyAIHandler, readConfig, supabasePublicKey } from './handler.js'
import { createAnthropicCaller } from './anthropicModel.js'
import { createSupabaseUserVerifier } from './auth.js'

const getEnv = (name: string) => Deno.env.get(name) ?? undefined
const config = readConfig(getEnv)

const handler = createSpendyAIHandler({
  config,
  verifyUser: createSupabaseUserVerifier({
    supabaseUrl: getEnv('SUPABASE_URL'),
    publicKey: supabasePublicKey(getEnv),
  }),
  callModel: config.provider === 'anthropic' && config.apiKey && config.model
    ? createAnthropicCaller({ Anthropic, apiKey: config.apiKey, config })
    : null,
  log: (entry: Record<string, unknown>) => console.log(JSON.stringify({ fn: 'spendy-ai', ...entry })),
})

Deno.serve(handler)
