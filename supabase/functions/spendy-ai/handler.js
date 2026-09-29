// SPENDY AI — il cuore della Edge Function, senza Deno e senza SDK.
//
//   richiesta dall'app → autenticazione → contesto (lista bianca) →
//   prompt → modello → JSON → validazione (stesse regole dell'app) → risposta
//
// Tutte le dipendenze esterne arrivano da fuori (index.ts): come si legge
// una variabile d'ambiente, come si verifica un utente, come si chiama il
// modello. Così questo file gira identico su Supabase e nei test Node.
//
// Cosa NON fa mai:
//   - rispondere a chi non ha una sessione Supabase valida (401);
//   - passare al modello qualcosa che non sia nella lista bianca del
//     contesto (sanitizeSpendyContext): niente transazioni, descrizioni,
//     note, id, dati di sincronizzazione;
//   - restituire la chiave API o il testo grezzo del modello;
//   - registrare nei log importi, frasi o nomi (solo tipo di evento,
//     campi presenti ed esito).
import {
  sanitizeSpendyContext,
  sanitizeMessages,
  buildSpendyPrompt,
  validateSpendyResponse,
  SPENDY_RESPONSE_SCHEMA,
} from '../_shared/spendyAIRules.js'

export const MAX_BODY_BYTES = 8 * 1024
export const SUPPORTED_PROVIDERS = ['anthropic']
export const DEFAULT_TIMEOUT_MS = 12000
export const DEFAULT_MAX_TOKENS = 2048

// Errori del modello, come li riporta l'adattatore del provider.
export const MODEL_ERROR_STATUS = {
  timeout: 504,
  rate_limited: 429,
  overloaded: 503,
  provider_auth: 502,
  provider_error: 502,
}

// `diagnostic` (facoltativo) finisce SOLO nei log del server, mai nella
// risposta all'app: { status, type, message, requestId, name } già
// ripulito con sanitizeDiagnostic.
export class ModelError extends Error {
  constructor(code, message = code, diagnostic = null) {
    super(message)
    this.code = code
    this.diagnostic = diagnostic
  }
}

// DIAGNOSTICA TEMPORANEA (2026-09-25) per capire i provider_error.
//
// Un messaggio d'errore del provider può, in teoria, contenere qualsiasi
// cosa: questa funzione lo riduce a una riga corta e toglie tutto ciò che
// somiglia a un segreto — la chiave esatta (e ogni suo pezzo lungo), chiavi
// in formato sk-…, token Bearer/JWT, header di autenticazione, email.
// Niente prompt, niente contesto: qui arrivano solo i campi dell'errore.
const MAX_DIAGNOSTIC_MESSAGE = 300
const SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9_-]{6,}/g, '[redacted]'], // chiavi API in stile sk-ant-…
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, '[redacted]'], // JWT
  [/(x-api-key|authorization|api[_-]?key|apikey)(["'\s:=]+)[^\s"',}]+/gi, '$1$2[redacted]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]'],
]

// Qualunque tratto di almeno SECRET_FRAGMENT caratteri consecutivi preso
// dalla chiave viene cancellato per intero, non solo la chiave completa.
const SECRET_FRAGMENT = 8

function redactFragments(text, secret) {
  const grams = new Set()
  for (let i = 0; i + SECRET_FRAGMENT <= secret.length; i += 1) grams.add(secret.slice(i, i + SECRET_FRAGMENT))
  const hidden = new Array(text.length).fill(false)
  for (let i = 0; i + SECRET_FRAGMENT <= text.length; i += 1) {
    if (grams.has(text.slice(i, i + SECRET_FRAGMENT))) hidden.fill(true, i, i + SECRET_FRAGMENT)
  }
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    if (!hidden[i]) out += text[i]
    else if (i === 0 || !hidden[i - 1]) out += '[redacted]'
  }
  return out
}

export function sanitizeDiagnosticText(value, secrets = []) {
  if (value === undefined || value === null) return null
  let text = String(value).replace(/\s+/g, ' ').trim()
  for (const secret of secrets.filter((item) => typeof item === 'string' && item.length >= SECRET_FRAGMENT)) {
    text = redactFragments(text, secret)
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement)
  return text.length > MAX_DIAGNOSTIC_MESSAGE ? `${text.slice(0, MAX_DIAGNOSTIC_MESSAGE)}…` : text
}

// Solo campi noti, ognuno ripulito: nient'altro dell'errore arriva ai log.
export function sanitizeDiagnostic(diagnostic, secrets = []) {
  if (!diagnostic || typeof diagnostic !== 'object') return null
  const clean = (value, max = 80) => {
    const text = sanitizeDiagnosticText(value, secrets)
    return text ? text.slice(0, max) : null
  }
  return {
    status: Number.isInteger(diagnostic.status) ? diagnostic.status : null,
    type: clean(diagnostic.type),
    name: clean(diagnostic.name),
    message: sanitizeDiagnosticText(diagnostic.message, secrets),
    requestId: clean(diagnostic.requestId),
  }
}

// La configurazione, solo da variabili d'ambiente del server. Nessun
// modello di default: quale modello usare lo decide chi configura il
// progetto (AI_MODEL), non il codice.
export function readConfig(getEnv) {
  const provider = (getEnv('AI_PROVIDER') ?? 'anthropic').trim().toLowerCase()
  const model = getEnv('AI_MODEL')?.trim() || null
  const apiKey = getEnv('AI_API_KEY')?.trim() || null
  const missing = []
  if (!SUPPORTED_PROVIDERS.includes(provider)) missing.push('AI_PROVIDER')
  if (!model) missing.push('AI_MODEL')
  if (!apiKey) missing.push('AI_API_KEY')

  const positive = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
  }
  const effort = getEnv('AI_EFFORT')?.trim().toLowerCase() || null

  return {
    provider,
    model,
    apiKey,
    effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort) ? effort : null,
    timeoutMs: positive(getEnv('AI_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS),
    maxTokens: positive(getEnv('AI_MAX_TOKENS'), DEFAULT_MAX_TOKENS),
    allowedOrigins: (getEnv('ALLOWED_ORIGINS') ?? '*').split(',').map((o) => o.trim()).filter(Boolean),
    missing,
  }
}

// La chiave pubblica del progetto serve solo a chiedere ad Auth "di chi
// è questo token?". Supabase la espone con nomi diversi a seconda del
// tipo di chiavi del progetto (legacy anon / nuove publishable).
export function supabasePublicKey(getEnv) {
  const direct = getEnv('SUPABASE_ANON_KEY') ?? getEnv('SUPABASE_PUBLISHABLE_KEY')
  if (direct) return direct
  try {
    const keys = JSON.parse(getEnv('SUPABASE_PUBLISHABLE_KEYS') ?? '{}')
    return keys.default ?? Object.values(keys)[0] ?? null
  } catch {
    return null
  }
}

function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.get('origin')
  const allowAll = allowedOrigins.includes('*')
  const allowed = allowAll ? '*' : allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? 'null'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    ...(allowAll ? {} : { Vary: 'Origin' }),
  }
}

// Quando non c'è niente da dire, o il modello rifiuta: Spendy tace e
// l'app mostra la sua frase locale.
function silentResponse(context) {
  return {
    message: '',
    state: context?.suggestedState ?? 'happy',
    tone: 'friendly',
    layout: null,
    animation: 'gentle',
    priority: 0,
    shouldShow: false,
  }
}

// Il modello deve restituire solo JSON; per sicurezza toglie eventuali
// recinti ```json.
export function parseModelJson(text) {
  if (typeof text !== 'string') return null
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function bearerToken(request) {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

// → (request: Request) => Promise<Response>
//   config      readConfig(...)
//   verifyUser  async (token) => { id } | null
//   callModel   async ({ system, input, schema }) => { text, stopReason, model }
//               (lancia ModelError con un code di MODEL_ERROR_STATUS)
//   log         (entry) => void — riceve solo metadati
export function createSpendyAIHandler({ config, verifyUser, callModel, log = () => {} }) {
  return async function handle(request) {
    const cors = corsHeaders(request, config.allowedOrigins)
    const json = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    // 1. Solo utenti autenticati: prima di tutto il resto, così chi non
    //    lo è non scopre nemmeno come è configurato il server.
    const token = bearerToken(request)
    const user = token ? await verifyUser(token).catch(() => null) : null
    if (!user?.id) return json(401, { error: 'unauthenticated' })

    if (config.missing.length > 0 || typeof callModel !== 'function') {
      log({ outcome: 'not_configured', missing: config.missing })
      return json(503, { error: 'not_configured' })
    }

    // 2. Il corpo: piccolo, JSON, con un contesto riconoscibile.
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' })
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return json(400, { error: 'bad_request' })
    }
    const context = sanitizeSpendyContext(body?.context)
    if (!context) return json(400, { error: 'bad_context' })
    const previous = sanitizeMessages([body?.previous], 1)[0] ?? null
    const history = sanitizeMessages(body?.history)

    const eventId = context.primaryEvent?.id ?? null
    if (!eventId) {
      log({ outcome: 'no_event' })
      return json(200, { response: silentResponse(context), provider: config.provider, model: null })
    }

    // 3. Il modello riceve SOLO il contesto ripulito + le frasi precedenti.
    const prompt = buildSpendyPrompt(context, { previous, history })
    const started = Date.now()
    let result
    try {
      result = await callModel({ system: prompt.system, input: prompt.input, schema: SPENDY_RESPONSE_SCHEMA })
    } catch (error) {
      const code = error instanceof ModelError ? error.code : 'provider_error'
      // La diagnostica va solo nei log, ripulita un'altra volta anche qui
      // (e con la chiave del server tra i segreti da cancellare).
      const diagnostic = sanitizeDiagnostic(
        error instanceof ModelError ? error.diagnostic : { name: error?.name, message: error?.message },
        [config.apiKey],
      )
      log({ outcome: code, event: eventId, ms: Date.now() - started, ...(diagnostic ? { providerError: diagnostic } : {}) })
      return json(MODEL_ERROR_STATUS[code] ?? 502, { error: code })
    }

    if (result.stopReason === 'refusal') {
      log({ outcome: 'refusal', event: eventId, ms: Date.now() - started })
      return json(200, { response: silentResponse(context), provider: config.provider, model: result.model ?? null })
    }

    // 4. Stesse regole dell'app: se non passa qui, non arriva nemmeno.
    const parsed = parseModelJson(result.text)
    if (!parsed) {
      log({ outcome: 'invalid', event: eventId, errors: ['not_json'], stopReason: result.stopReason })
      return json(422, { error: 'invalid', details: ['not_json'] })
    }
    const checked = validateSpendyResponse(parsed, context, { history, previous })
    if (!checked.valid) {
      log({ outcome: 'invalid', event: eventId, errors: checked.errors })
      return json(422, { error: 'invalid', details: checked.errors })
    }

    log({
      outcome: 'ok',
      event: eventId,
      contextFields: Object.keys(context).filter((key) => context[key] !== null && context[key] !== undefined),
      shouldShow: checked.response.shouldShow,
      ms: Date.now() - started,
      model: result.model ?? config.model,
    })
    return json(200, { response: checked.response, provider: config.provider, model: result.model ?? config.model })
  }
}
