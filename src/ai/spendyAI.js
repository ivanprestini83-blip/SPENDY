// SPENDY AI — l'interfaccia unica verso "chi scrive le frasi".
//
//   contesto → spendyAI.generate(context) → provider → guard → risposta | errore
//
// Il modulo non tocca Zustand, il budget o i dati: riceve un contesto e
// restituisce un risultato. Non lancia MAI: ogni problema (provider
// assente, rete, timeout, limite API, risposta sbagliata) diventa
// { ok: false, error } e chi chiama ripiega sulla frase locale.
//
// Il provider è intercambiabile:
//   - providers/remoteProvider.js — la vera AI, via Supabase Edge Function
//     (la chiave API resta sul server, il frontend non ne vede mai una);
//   - providers/mockProvider.js  — l'AI finta della Fase A, per test e
//     sviluppo.
// Quale usare lo decide spendyAIConfig.js (chooseSpendyProvider).
//
// Contratto di un provider:
//   { name, available?: boolean, timeoutMs?: number,
//     generate(context, { signal, history, previous }) → Promise<rispostaGrezza> }
// Può fallire lanciando un errore con `code` in PROVIDER_ERRORS.
import { validateAIResponse } from './spendyAIGuard.js'
import { createMockProvider } from './providers/mockProvider.js'

export const DEFAULT_TIMEOUT_MS = 4000
export const PROVIDER_ERRORS = ['unavailable', 'rate_limited', 'daily_limit', 'network', 'unauthenticated', 'invalid']
export const SPENDY_PROVIDERS = ['remote', 'mock']

// remote se richiesto (o di default) e se Supabase c'è; altrimenti mock.
export function chooseSpendyProvider({ requested = null, remoteAvailable = false } = {}) {
  const wanted = SPENDY_PROVIDERS.includes(requested) ? requested : remoteAvailable ? 'remote' : 'mock'
  return wanted === 'remote' && !remoteAvailable ? 'mock' : wanted
}

class SpendyAITimeout extends Error {
  constructor() {
    super('Spendy AI timeout')
    this.code = 'timeout'
  }
}

export function createSpendyAI({ provider = null, timeoutMs: defaultTimeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // Un provider remoto dichiara un tempo più lungo del mock.
  const timeoutMs = provider?.timeoutMs ?? defaultTimeoutMs

  // `previous` = l'ultima frase letta dall'utente: il modello la riceve per
  // non ripeterne la struttura, il guard la usa per verificarlo.
  async function generate(context, { history = [], previous = null } = {}) {
    if (!provider || provider.available === false || typeof provider.generate !== 'function') {
      return { ok: false, error: 'unavailable' }
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null
    let timer = null
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort()
        reject(new SpendyAITimeout())
      }, timeoutMs)
    })

    try {
      const raw = await Promise.race([
        Promise.resolve().then(() => provider.generate(context, { signal: controller?.signal, history, previous })),
        timeout,
      ])
      const checked = validateAIResponse(raw, context, { history, previous })
      if (!checked.valid) return { ok: false, error: 'invalid', details: checked.errors }
      return { ok: true, response: checked.response, provider: provider.name ?? null }
    } catch (error) {
      const code = error?.code
      if (code === 'timeout') return { ok: false, error: 'timeout' }
      if (PROVIDER_ERRORS.includes(code)) return { ok: false, error: code }
      return { ok: false, error: 'error', details: String(error?.message ?? error) }
    } finally {
      clearTimeout(timer)
    }
  }

  return { generate, providerName: provider?.name ?? null }
}

// Un'istanza con il mock locale, nessuna rete: per test e strumenti.
// Quella usata dall'app è in spendyAIConfig.js (appSpendyAI).
export const spendyAI = createSpendyAI({ provider: createMockProvider() })
