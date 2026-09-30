// Adattatore Anthropic (Claude Messages API) per la Edge Function.
//
// Riceve la classe dell'SDK ufficiale da fuori (index.ts la importa da
// npm), così i test possono passarne una finta. Restituisce la funzione
// `callModel` che handler.js si aspetta:
//   ({ system, input, schema }) → { text, stopReason, model }
// e traduce gli errori dell'SDK nei codici di handler.js, dicendo anche se
// la chiamata prenotata sulla quota va restituita (`refund`, vedi quota.js).
//
// - Output strutturati (output_config.format = json_schema): la risposta
//   è JSON conforme allo schema, non testo da interpretare.
// - Un solo tentativo (maxRetries: 0) entro AI_TIMEOUT_MS: l'app mostra
//   già la frase locale, un secondo tentativo lento non serve a nessuno.
// - Rimborso della quota (refund: true) SOLO se è certo che nulla è stato
//   fatturato: errore prima di messages.create(), oppure rifiuto esplicito
//   con HTTP 400, 401, 403, 404, 429 o 529 (400/404: richiesta o
//   configurazione sbagliata lato nostro, non colpa dell'utente). Timeout,
//   errori di rete, 5xx e ogni altro errore dopo l'invio restano consumati. Si guarda il CODICE HTTP, non la
//   classe dell'eccezione (che può cambiare tra versioni dell'SDK o runtime).
// - Sui modelli che li supportano (Claude Opus 5, Claude Fable 5.1), i
//   fallback lato server (`fallbacks: "default"`) fanno rispondere un
//   altro modello se il primo rifiuta per i suoi filtri di sicurezza.
import { ModelError, sanitizeDiagnostic } from './handler.js'

const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1'])
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01'

// Rifiuti espliciti del provider: rispondono subito e non fatturano.
// 400/404 (richiesta non valida, modello inesistente) restano provider_error.
const REFUNDED_STATUS = {
  400: 'provider_error',
  401: 'provider_auth',
  403: 'provider_auth',
  404: 'provider_error',
  429: 'rate_limited',
  529: 'overloaded',
}

const httpStatus = (error) => {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status
  return Number.isInteger(status) ? status : null
}

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

  // Errore DOPO l'invio di messages.create(). Il criterio è il codice HTTP;
  // la classe dell'eccezione serve solo per il timeout, che non ha codice.
  function classify(error) {
    const diagnostic = diagnose(error)
    const status = httpStatus(error)

    if (status !== null && REFUNDED_STATUS[status]) {
      const code = REFUNDED_STATUS[status]
      return new ModelError(code, code, diagnostic, { refund: true })
    }
    const timedOut = error instanceof Anthropic.APIConnectionTimeoutError
      || ['APIConnectionTimeoutError', 'TimeoutError'].includes(error?.name)
    if (status === null && timedOut) return new ModelError('timeout', 'timeout', diagnostic)
    // Rete, 5xx, altri 4xx e qualunque cosa non riconosciuta: nessun rimborso.
    return new ModelError('provider_error', 'provider_error', diagnostic)
  }

  return async function callModel({ system, input, schema }) {
    // Preparazione della richiesta: se fallisce, nulla è partito → rimborso.
    let params
    try {
      params = {
        model: config.model,
        max_tokens: config.maxTokens,
        system,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        output_config: {
          format: { type: 'json_schema', schema },
          ...(config.effort ? { effort: config.effort } : {}),
        },
      }
    } catch (error) {
      throw new ModelError(
        'provider_error',
        'provider_error',
        sanitizeDiagnostic({ name: error?.name, message: error?.message }, [apiKey]),
        { refund: true },
      )
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
