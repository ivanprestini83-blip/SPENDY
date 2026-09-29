// Adattatore Anthropic (Claude Messages API) per la Edge Function.
//
// Riceve la classe dell'SDK ufficiale da fuori (index.ts la importa da
// npm), così i test possono passarne una finta. Restituisce la funzione
// `callModel` che handler.js si aspetta:
//   ({ system, input, schema }) → { text, stopReason, model }
// e traduce gli errori dell'SDK nei codici di handler.js.
//
// - Output strutturati (output_config.format = json_schema): la risposta
//   è JSON conforme allo schema, non testo da interpretare.
// - Un solo tentativo (maxRetries: 0) entro AI_TIMEOUT_MS: l'app mostra
//   già la frase locale, un secondo tentativo lento non serve a nessuno.
// - Sui modelli che li supportano (Claude Opus 5, Claude Fable 5.1), i
//   fallback lato server (`fallbacks: "default"`) fanno rispondere un
//   altro modello se il primo rifiuta per i suoi filtri di sicurezza.
import { ModelError, sanitizeDiagnostic } from './handler.js'

const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1'])
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export function createAnthropicCaller({ Anthropic, apiKey, config }) {
  // Solo la chiave: il workspace lo determina la chiave stessa (creata
  // dentro un workspace). Nessun header anthropic-workspace-id.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: config.timeoutMs })

  // Solo i campi utili a capire cosa è successo, già ripuliti: HTTP
  // status, tipo d'errore dell'API, messaggio dell'API (non quello
  // dell'SDK, che ripete tutto il corpo), request id di Anthropic. Per gli
  // errori senza risposta HTTP (rete, runtime) il nome e la causa.
  function diagnose(error) {
    const apiError = error instanceof Anthropic.APIError ? error : null
    return sanitizeDiagnostic({
      status: apiError?.status,
      type: apiError?.type ?? apiError?.error?.error?.type ?? null,
      name: error?.constructor?.name ?? error?.name,
      message: apiError?.error?.error?.message ?? error?.cause?.message ?? error?.message,
      requestId: apiError?.requestID ?? apiError?.error?.request_id ?? null,
    }, [apiKey])
  }

  function classify(error) {
    const diagnostic = diagnose(error)
    if (error instanceof Anthropic.APIConnectionTimeoutError) return new ModelError('timeout', 'timeout', diagnostic)
    if (error instanceof Anthropic.RateLimitError) return new ModelError('rate_limited', 'rate_limited', diagnostic)
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return new ModelError('provider_auth', 'provider_auth', diagnostic)
    }
    if (error instanceof Anthropic.APIError && error.status === 529) return new ModelError('overloaded', 'overloaded', diagnostic)
    return new ModelError('provider_error', 'provider_error', diagnostic)
  }

  return async function callModel({ system, input, schema }) {
    const params = {
      model: config.model,
      max_tokens: config.maxTokens,
      system,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
      output_config: {
        format: { type: 'json_schema', schema },
        ...(config.effort ? { effort: config.effort } : {}),
      },
    }

    let response
    try {
      response = SERVER_FALLBACK_MODELS.has(config.model)
        ? await client.beta.messages.create({ ...params, betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' })
        : await client.messages.create(params)
    } catch (error) {
      throw classify(error)
    }

    const text = (response.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    return { text, stopReason: response.stop_reason, model: response.model }
  }
}
