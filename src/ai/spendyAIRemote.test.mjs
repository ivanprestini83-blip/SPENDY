// Test di SPENDY AI — Fase B (vera AI via Supabase Edge Function).
// `npm test`, senza rete e senza chiavi: la Edge Function gira qui in
// Node (handler.js è lo stesso codice che gira su Supabase), il
// "modello" è una funzione finta, e la rete tra app e funzione è un
// fetch finto che consegna la Request direttamente all'handler.
//
//   app (remoteProvider) → fetch → handler (auth, lista bianca, prompt,
//   validazione) → modello finto → handler → app (guard) → voce

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { check, section, report } from '../sync/testkit.mjs'
import { buildFinancialData } from '../utils/budgetCalculations.js'
import { getSpendyCoach } from '../utils/spendyCoach.js'
import { prepareSpendyVoice } from './spendyVoice.js'
import { SPENDY_EVENTS } from './spendyEvents.js'
import { createSpendyAI, chooseSpendyProvider } from './spendyAI.js'
import { VOCABULARY_IN_SYNC } from './spendyAIGuard.js'
import { composeMockResponse } from './providers/mockProvider.js'
import { createRemoteProvider, functionsUrl } from './providers/remoteProvider.js'
import { decideSpendyVoice, requestSpendyVoice, resolveSpendyVoice, VOICE_LIMITS } from './spendyVoicePolicy.js'
import { emptyVoiceCache, recordShown } from './spendyVoiceCache.js'
import { structureProblems, hasStaleStructure } from './spendyPersonality.js'
import {
  createSpendyAIHandler, readConfig, supabasePublicKey, ModelError, MAX_BODY_BYTES,
  sanitizeDiagnosticText, sanitizeDiagnostic,
} from '../../supabase/functions/spendy-ai/handler.js'
import { createAnthropicCaller } from '../../supabase/functions/spendy-ai/anthropicModel.js'
import { createSupabaseUserVerifier } from '../../supabase/functions/spendy-ai/auth.js'
import { sanitizeSpendyContext, SPENDY_PERSONALITY } from '../../supabase/functions/_shared/spendyAIRules.js'

const TODAY = '2026-09-20'
const NOW = Date.parse('2026-09-20T10:00:00Z')
const URL_FN = functionsUrl('https://progetto.supabase.co')
const PUBLIC_KEY = 'sb_publishable_test'
const VALID_TOKEN = 'token-utente'

let seq = 0
const expense = (date, amount, categoryId) => ({ id: `e-${seq++}`, date, amount, categoryId, description: `nota privata ${seq}` })
const threeCycles = (categoryId, values) => ['06', '07', '08'].map((month, i) => expense(`2026-${month}-10`, values[i], categoryId))

// --- La Edge Function, in Node ------------------------------------------

const ENV = { AI_PROVIDER: 'anthropic', AI_MODEL: 'modello-configurato', AI_API_KEY: 'sk-segreto-lato-server' }

// La quota giornaliera ha i suoi test (spendyAIQuota.test.mjs): qui
// resta sempre aperta, così questi test guardano solo il resto del flusso.
const openQuota = () => ({ reserve: async () => ({ allowed: true, used: 1 }), release: async () => {} })

// Il "modello": di default risponde come l'AI finta della Fase A, ma
// in JSON testuale, come un modello vero.
function fakeModel(behavior = 'mock') {
  const calls = []
  const callModel = async ({ system, input, schema }) => {
    calls.push({ system, input, schema })
    if (typeof behavior === 'function') return behavior({ system, input, schema })
    const answer = composeMockResponse(input.context, input.recentMessages, input.previous)
    return { text: JSON.stringify({ ...answer, layout: answer.layout ?? 'left' }), stopReason: 'end_turn', model: 'modello-configurato' }
  }
  return { callModel, calls }
}

function makeServer({ model = fakeModel(), env = ENV } = {}) {
  const logs = []
  const handler = createSpendyAIHandler({
    config: readConfig((name) => env[name]),
    verifyUser: async (token) => (token === VALID_TOKEN ? { id: 'utente-1' } : null),
    callModel: model.callModel,
    quota: openQuota(),
    log: (entry) => logs.push(entry),
  })
  return { handler, logs, model }
}

// fetch finto: consegna la richiesta all'handler e registra cosa è partito.
function wire(server, { override = null } = {}) {
  const sent = []
  const fetchImpl = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    if (override) return override(url, init)
    return server.handler(new Request(url, init))
  }
  return { fetchImpl, sent }
}

function remoteAI({ server = makeServer(), token = VALID_TOKEN, override = null, timeoutMs = null } = {}) {
  const { fetchImpl, sent } = wire(server, { override })
  const provider = createRemoteProvider({ url: URL_FN, publicKey: PUBLIC_KEY, getAccessToken: async () => token, fetchImpl })
  if (timeoutMs) provider.timeoutMs = timeoutMs
  return { ai: createSpendyAI({ provider }), sent, server }
}

// Il flusso della Home, identico a spendyAI.test.mjs, con l'AI remota.
async function runHome({ expenses = [], goals = [], monthlyBudget = 1000, cache = emptyVoiceCache(), ai, limits = VOICE_LIMITS } = {}) {
  const financialData = buildFinancialData({ today: TODAY, monthlyBudget, expenses, incomes: [], goals, cycleStartDay: 1 })
  const coach = getSpendyCoach(financialData, { expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals, jokeHistory: [], financialData })
  const { events, context, meta } = prepareSpendyVoice({ coach, financialData, expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals })
  const first = decideSpendyVoice({ coach, meta, today: TODAY, cache, now: NOW, limits })
  let nextCache = cache
  let result = null
  if (first.action === 'ai') ({ cache: nextCache, result } = await requestSpendyVoice({ ai, context, meta, cache, today: TODAY, now: NOW }))
  const after = decideSpendyVoice({ coach, meta, today: TODAY, cache: nextCache, now: NOW, limits })
  const voice = resolveSpendyVoice({ decision: after, coach, cache: nextCache })
  return { coach, events, context, first, result, cache: nextCache, voice }
}

const categoryRise = () => [...threeCycles('ristoranti', [50, 60, 55]), expense('2026-09-05', 80, 'ristoranti'), expense('2026-09-12', 80, 'ristoranti')]
const bigExpense = () => [expense(TODAY, 150, 'shopping')]

function post(body, { token = VALID_TOKEN, raw = null } = {}) {
  return new Request(URL_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ?? JSON.stringify(body),
  })
}

const baseContext = {
  version: 1, locale: 'it', today: TODAY,
  budget: { monthly: 2000, spent: 160, available: 1840, spentPercent: 8, daysRemaining: 11, band: 'ok', dailyAllowance: 167 },
  spending: { today: 0 },
  primaryEvent: { id: 'category_above_usual', importance: 60, category: 'Ristorante', cycle: { current: 160, usual: 55, difference: 105, changePercent: 191 } },
  otherEvents: [], goal: null, suggestedState: 'ironic',
}
const modelSays = (answer) => fakeModel(async () => ({ text: JSON.stringify(answer), stopReason: 'end_turn', model: 'm' }))
const okAnswer = { message: 'Ristorante a 160 €, la tua media è 55 €. Ciclo speciale?', state: 'ironic', tone: 'playful', layout: 'left', animation: 'playful', priority: 60, shouldShow: true }

// =====================================================================
section('Edge Function: autenticazione')
// =====================================================================
{
  const { handler, model } = makeServer()
  const missing = await handler(post({ context: baseContext }, { token: null }))
  check('senza token → 401', missing.status === 401)
  const wrong = await handler(post({ context: baseContext }, { token: 'chiave-pubblica-usata-come-token' }))
  check('token non valido (es. chiave anonima) → 401', wrong.status === 401)
  check('il modello non viene mai chiamato', model.calls.length === 0)

  const unconfigured = makeServer({ env: { AI_PROVIDER: 'anthropic', AI_API_KEY: 'k' } })
  const res = await unconfigured.handler(post({ context: baseContext }))
  check('utente valido ma AI_MODEL mancante → 503 not_configured', res.status === 503 && (await res.json()).error === 'not_configured')
  const anon503 = await unconfigured.handler(post({ context: baseContext }, { token: null }))
  check('chi non è autenticato non scopre nemmeno la configurazione (401, non 503)', anon503.status === 401)

  const opt = await handler(new Request(URL_FN, { method: 'OPTIONS', headers: { origin: 'https://spendy.app' } }))
  check('preflight CORS → 204 con header', opt.status === 204 && opt.headers.get('access-control-allow-headers')?.includes('authorization'))
  check('GET → 405', (await handler(new Request(URL_FN))).status === 405)
}

{
  const calls = []
  const verify = createSupabaseUserVerifier({
    supabaseUrl: 'https://progetto.supabase.co/',
    publicKey: PUBLIC_KEY,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return init.headers.Authorization === `Bearer ${VALID_TOKEN}`
        ? new Response(JSON.stringify({ id: 'u-1' }), { status: 200 })
        : new Response('{}', { status: 401 })
    },
  })
  check('verifica chiesta a Supabase Auth /auth/v1/user', (await verify(VALID_TOKEN))?.id === 'u-1' && calls[0].url === 'https://progetto.supabase.co/auth/v1/user')
  check('con apikey pubblica e Bearer', calls[0].init.headers.apikey === PUBLIC_KEY)
  check('token rifiutato da Auth → nessun utente', (await verify('altro')) === null)
  check('chiave pubblica: legacy anon', supabasePublicKey((n) => ({ SUPABASE_ANON_KEY: 'anon' })[n]) === 'anon')
  check('chiave pubblica: nuove publishable (JSON)',
    supabasePublicKey((n) => ({ SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_x"}' })[n]) === 'sb_publishable_x')
}

// =====================================================================
section('Edge Function: configurazione')
// =====================================================================
{
  const none = readConfig(() => undefined)
  check('nessun modello di default nel codice', none.model === null && none.missing.includes('AI_MODEL'))
  check('AI_API_KEY obbligatoria', none.missing.includes('AI_API_KEY'))
  check('provider sconosciuto segnalato', readConfig((n) => ({ AI_PROVIDER: 'altro', AI_MODEL: 'm', AI_API_KEY: 'k' })[n]).missing.includes('AI_PROVIDER'))
  const full = readConfig((n) => ({ ...ENV, AI_EFFORT: 'low', AI_TIMEOUT_MS: '9000' })[n])
  check('config completa', full.missing.length === 0 && full.effort === 'low' && full.timeoutMs === 9000)
}

// =====================================================================
section('Edge Function: il modello riceve solo il contesto sintetico')
// =====================================================================
{
  const server = makeServer()
  const polluted = {
    ...baseContext,
    expenses: [{ id: 'e-1', description: 'regalo per Giulia', amount: 160 }],
    sync: { outbox: ['x'], token: 'segreto' },
    primaryEvent: { ...baseContext.primaryEvent, transaction: { id: 'e-1', description: 'cena con Marco' } },
    goal: { label: 'Viaggio Giappone', percent: 40, missing: 1800, saved: 1200, target: 3000, id: 'g-1' },
  }
  const res = await server.handler(post({ context: polluted, previous: 'Frase di prima.', history: ['a', 'b'], extra: 'x' }))
  check('risposta 200', res.status === 200, res.status)
  const input = JSON.stringify(server.model.calls[0].input)
  check('niente transazioni', !input.includes('expenses') && !input.includes('transaction'))
  check('niente descrizioni', !input.includes('Giulia') && !input.includes('Marco'))
  check('niente dati di sync', !input.includes('outbox') && !input.includes('segreto'))
  check("dell'obiettivo solo nome, percentuale, quanto manca",
    JSON.stringify(server.model.calls[0].input.context.goal) === JSON.stringify({ label: 'Viaggio Giappone', percent: 40, missing: 1800 }))
  check('arrivano la frase precedente e le ultime dette',
    server.model.calls[0].input.previous === 'Frase di prima.' && server.model.calls[0].input.recentMessages.length === 2)
  check('system = personalità di Spendy', server.model.calls[0].system === SPENDY_PERSONALITY)
  check('schema JSON della risposta passato al modello', server.model.calls[0].schema?.required?.includes('shouldShow'))
  const logText = JSON.stringify(server.logs)
  check('i log non contengono frasi, importi o nomi', !logText.includes('Giappone') && !logText.includes('160') && !logText.includes('€'))
  check('ma dicono quali campi del contesto sono arrivati', server.logs.some((l) => l.contextFields?.includes('budget')))
}

// =====================================================================
section('Edge Function: validazione della risposta del modello')
// =====================================================================
async function serverAnswer(answer, extra = {}) {
  const server = makeServer({ model: typeof answer === 'function' ? fakeModel(answer) : modelSays(answer) })
  const res = await server.handler(post({ context: baseContext, ...extra }))
  return { status: res.status, body: await res.json(), server }
}
{
  const ok = await serverAnswer(okAnswer)
  check('risposta valida → 200', ok.status === 200 && ok.body.response.message === okAnswer.message)
  const fenced = await serverAnswer(() => ({ text: '```json\n' + JSON.stringify(okAnswer) + '\n```', stopReason: 'end_turn' }))
  check('JSON dentro ```json … ``` accettato', fenced.status === 200)
  const invented = await serverAnswer({ ...okAnswer, message: 'Ristorante a 987 €, record assoluto.' })
  check('numero inventato → 422', invented.status === 422 && invented.body.details.some((d) => d.startsWith('invented_numbers')))
  const long = await serverAnswer({ ...okAnswer, message: 'Ristorante '.repeat(30) })
  check('testo troppo lungo → 422', long.status === 422 && long.body.details.includes('too_long'))
  const state = await serverAnswer({ ...okAnswer, state: 'euforico' })
  check('state non valido → 422', state.status === 422 && state.body.details.includes('invalid_state'))
  const md = await serverAnswer({ ...okAnswer, message: '**Ristorante** a 160 €.' })
  check('markdown → 422', md.status === 422 && md.body.details.includes('markdown'))
  const prose = await serverAnswer(() => ({ text: 'Certo! Ecco una frase per te: ...', stopReason: 'end_turn' }))
  check('testo fuori dal JSON → 422 not_json', prose.status === 422 && prose.body.details.includes('not_json'))
  const advice = await serverAnswer({ ...okAnswer, message: 'Investi i 105 € in borsa.' })
  check('consiglio di investimento → 422', advice.status === 422 && advice.body.details.includes('risky_advice'))
  const judge = await serverAnswer({ ...okAnswer, message: 'Hai sbagliato, 160 € sono troppi.' })
  check('giudizio → 422', judge.status === 422)
  const stale = await serverAnswer({ ...okAnswer, message: 'Ecco una categoria che non si vedeva da un po’.' })
  check('schema logoro → 422', stale.status === 422 && stale.body.details.includes('stale_structure'))
  const repeated = await serverAnswer(okAnswer, { previous: 'Svago a 90 €, la tua media è 40 €. Nuova routine?' })
  check('stessa struttura della frase precedente → 422', repeated.status === 422 && repeated.body.details.some((d) => d.startsWith('repeated_structure')))
  const refusal = await serverAnswer(() => ({ text: '', stopReason: 'refusal' }))
  check('rifiuto del modello → 200 silenzioso', refusal.status === 200 && refusal.body.response.shouldShow === false)
  const priorityString = await serverAnswer({ ...okAnswer, priority: '72' })
  check('priority come stringa "72" accettata', priorityString.status === 200 && priorityString.body.response.priority === 72)
}

// =====================================================================
section('Edge Function: errori del modello e richieste sbagliate')
// =====================================================================
{
  for (const [code, status] of [['timeout', 504], ['rate_limited', 429], ['overloaded', 503], ['provider_auth', 502]]) {
    const r = await serverAnswer(() => { throw new ModelError(code) })
    check(`modello: ${code} → ${status}`, r.status === status && r.body.error === code)
  }
  const unknown = await serverAnswer(() => { throw new Error('boom') })
  check('errore sconosciuto → 502 senza dettagli interni', unknown.status === 502 && !JSON.stringify(unknown.body).includes('boom'))

  const { handler, model } = makeServer()
  check('JSON rotto → 400', (await handler(post(null, { raw: '{non json' }))).status === 400)
  check('corpo troppo grande → 413', (await handler(post(null, { raw: 'x'.repeat(MAX_BODY_BYTES + 1) }))).status === 413)
  check('contesto senza budget → 400', (await handler(post({ context: { primaryEvent: baseContext.primaryEvent } }))).status === 400)
  const minimal = await handler(post({ context: { ...baseContext, primaryEvent: null } }))
  const minimalBody = await minimal.json()
  check('contesto minimale senza evento → 200 silenzioso', minimal.status === 200 && minimalBody.response.shouldShow === false)
  check('…e il modello non viene pagato per niente', model.calls.length === 0)
}

// =====================================================================
section('Adattatore Anthropic (SDK finto)')
// =====================================================================
{
  class APIError extends Error { constructor(status) { super(`status ${status}`); this.status = status } }
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class APIConnectionTimeoutError extends Error {}
  const created = []
  let nextError = null
  const reply = { content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', model: 'claude-opus-5' }
  class FakeAnthropic {
    constructor(options) { created.push(options) }
    messages = { create: async (params) => { created.push({ path: 'messages', params }); if (nextError) throw nextError; return reply } }
    beta = { messages: { create: async (params) => { created.push({ path: 'beta', params }); if (nextError) throw nextError; return reply } } }
  }
  Object.assign(FakeAnthropic, { APIError, RateLimitError, AuthenticationError, PermissionDeniedError, APIConnectionTimeoutError })

  const opus = readConfig((n) => ({ ...ENV, AI_MODEL: 'claude-opus-5', AI_EFFORT: 'low' })[n])
  const call = createAnthropicCaller({ Anthropic: FakeAnthropic, apiKey: opus.apiKey, config: opus })
  const out = await call({ system: 'S', input: { context: baseContext }, schema: { type: 'object' } })
  const req = created.find((c) => c.path)
  check('client creato con la chiave dal server, niente retry', created[0].apiKey === 'sk-segreto-lato-server' && created[0].maxRetries === 0)
  check('modello da AI_MODEL', req.params.model === 'claude-opus-5')
  check('output strutturato json_schema + effort', req.params.output_config.format.type === 'json_schema' && req.params.output_config.effort === 'low')
  check('contesto nel messaggio utente', JSON.parse(req.params.messages[0].content).context.budget.band === 'ok')
  check('Claude Opus 5: fallback lato server attivi', req.path === 'beta' && req.params.fallbacks === 'default' && req.params.betas.includes('server-side-fallback-2026-07-01'))
  check('testo e stop_reason restituiti', out.text === '{"ok":true}' && out.stopReason === 'end_turn')

  const other = readConfig((n) => ({ ...ENV, AI_MODEL: 'un-altro-modello' })[n])
  created.length = 0
  await createAnthropicCaller({ Anthropic: FakeAnthropic, apiKey: 'k', config: other })({ system: 'S', input: {}, schema: {} })
  const plain = created.find((c) => c.path)
  check('altri modelli: endpoint normale, niente fallbacks', plain.path === 'messages' && plain.params.fallbacks === undefined)

  const mapped = async (error) => {
    nextError = error
    try { await call({ system: 'S', input: {}, schema: {} }) } catch (e) { return e.code } finally { nextError = null }
    return null
  }
  check('timeout SDK → timeout', await mapped(new APIConnectionTimeoutError()) === 'timeout')
  check('429 → rate_limited', await mapped(new RateLimitError(429)) === 'rate_limited')
  check('chiave sbagliata → provider_auth', await mapped(new AuthenticationError(401)) === 'provider_auth')
  check('529 → overloaded', await mapped(new APIError(529)) === 'overloaded')
  check('altro → provider_error', await mapped(new APIError(500)) === 'provider_error')
}

// =====================================================================
section('App → Edge Function → modello: il flusso completo')
// =====================================================================
{
  // Spesa grande
  const big = remoteAI()
  const run = await runHome({ ai: big.ai, monthlyBudget: 2500, expenses: bigExpense() })
  check('spesa grande: evento big_expense', run.events[0].id === SPENDY_EVENTS.BIG_EXPENSE)
  check('una sola richiesta alla funzione', big.sent.length === 1 && big.sent[0].url === URL_FN)
  check('con la sessione utente e la chiave pubblica, nessuna chiave del modello',
    big.sent[0].headers.Authorization === `Bearer ${VALID_TOKEN}` && big.sent[0].headers.apikey === PUBLIC_KEY
    && !JSON.stringify(big.sent[0]).includes('sk-'))
  check('il payload porta importo e categoria della spesa',
    big.sent[0].body.context.primaryEvent.expense.amount === 150 && big.sent[0].body.context.primaryEvent.expense.category === 'Shopping')
  check('la voce arriva dalla vera AI', run.voice.source === 'ai' && /150 €/.test(run.voice.message), run.voice.message)
  const payload = JSON.stringify(big.sent[0].body)
  check('privacy: niente descrizioni, id, date delle spese', !payload.includes('nota privata') && !/"e-\d+"/.test(payload)
    && (payload.match(/\d{4}-\d{2}-\d{2}/g) ?? []).every((d) => d === TODAY))
  check('privacy: il payload è esattamente il contesto ripulito', JSON.stringify(big.sent[0].body.context) === JSON.stringify(sanitizeSpendyContext(run.context)))

  // Budget quasi esaurito
  const near = await runHome({ ai: remoteAI().ai, expenses: [expense('2026-09-10', 900, 'spesa')] })
  check('budget quasi esaurito: Spendy preoccupato', near.voice.source === 'ai' && near.voice.state === 'concerned', near.voice.message)

  // Obiettivo presente
  const goalAI = remoteAI()
  const goal = await runHome({
    ai: goalAI.ai,
    goals: [{ id: 'g-9', label: 'Viaggio Giappone', saved: 2700, target: 3000 }],
    expenses: [expense('2026-09-05', 100, 'spesa')],
  })
  check('obiettivo: nome, percentuale, mancante — non saved/target',
    JSON.stringify(goalAI.sent[0]?.body.context.goal) === JSON.stringify({ label: 'Viaggio Giappone', percent: 90, missing: 300 }),
    JSON.stringify(goalAI.sent[0]?.body.context.goal))
  check('obiettivo: la frase lo usa', goal.voice.message.includes('Viaggio Giappone'), goal.voice.message)

  // Categoria riapparsa
  const reappeared = await runHome({
    ai: remoteAI().ai,
    monthlyBudget: 2000,
    expenses: [...threeCycles('spesa', [300, 300, 300]), expense('2026-09-05', 300, 'spesa'), expense('2026-09-06', 64, 'svago')],
  })
  const reEvent = reappeared.events.find((e) => e.id === SPENDY_EVENTS.UNUSUAL_PURCHASE)
  check('categoria riapparsa rilevata', Boolean(reEvent), reappeared.events.map((e) => e.id).join(','))
  check('nessuno schema "è tornata"', !hasStaleStructure(reappeared.voice.message), reappeared.voice.message)

  // Prevenzione della ripetizione: la frase precedente viaggia fino al modello
  const prevAI = remoteAI()
  const cache = recordShown(emptyVoiceCache(), { message: 'Ristorante a 160 € contro i soliti 55 €: ciclo speciale o nuovo ritmo?', day: TODAY })
  const rep = await runHome({ ai: prevAI.ai, monthlyBudget: 2000, expenses: categoryRise(), cache })
  check('la frase precedente arriva al server…', prevAI.sent[0].body.previous === cache.lastShown.message)
  check('…e al modello', prevAI.server.model.calls[0].input.previous === cache.lastShown.message)
  check('la nuova frase non ne ricalca la struttura', structureProblems(rep.voice.message, { previous: cache.lastShown.message }).length === 0, rep.voice.message)
}

// =====================================================================
section('Fallback locale: la Home non mostra mai un errore')
// =====================================================================
async function fallbackCase(label, options, expectedError) {
  const { ai, sent } = remoteAI(options)
  const run = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise() })
  check(`${label}: errore "${expectedError}"`, run.result?.error === expectedError, run.result?.error)
  check(`${label}: frase locale del coach`, run.voice.source === 'local' && run.voice.message === run.coach.message)
  return { run, sent }
}
{
  await fallbackCase('timeout', { override: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })))), timeoutMs: 40 }, 'timeout')
  await fallbackCase('errore HTTP 500', { override: async () => new Response('{}', { status: 500 }) }, 'error')
  await fallbackCase('rete assente', { override: async () => { throw new TypeError('Failed to fetch') } }, 'network')
  await fallbackCase('rate limit (429)', { override: async () => new Response('{"error":"rate_limited"}', { status: 429 }) }, 'rate_limited')
  await fallbackCase('funzione non configurata (503)', { override: async () => new Response('{}', { status: 503 }) }, 'unavailable')
  await fallbackCase('risposta non JSON', { override: async () => new Response('<html>oops</html>', { status: 200 }) }, 'invalid')
  await fallbackCase('numero inventato (bloccato dal server)', { server: makeServer({ model: modelSays({ ...okAnswer, message: 'Ristorante a 987 €.' }) }) }, 'invalid')
  // Un server che, per un bug, lasciasse passare una risposta sbagliata:
  // il guard dell'app la ferma comunque.
  await fallbackCase('testo troppo lungo (bloccato dall\'app)', { override: async () => new Response(JSON.stringify({ response: { ...okAnswer, message: 'Ristorante '.repeat(30) } }), { status: 200 }) }, 'invalid')
  await fallbackCase('state invalido (bloccato dall\'app)', { override: async () => new Response(JSON.stringify({ response: { ...okAnswer, state: 'euforico' } }), { status: 200 }) }, 'invalid')

  const { run, sent } = await fallbackCase('autenticazione mancante', { token: null }, 'unauthenticated')
  check('senza sessione non parte nessuna richiesta', sent.length === 0)
  check('e il limite giornaliero non viene consumato', run.cache.calls.count === 0)
  const expired = await fallbackCase('sessione scaduta (401)', { override: async () => new Response('{}', { status: 401 }) }, 'unauthenticated')
  check('il fallimento è ricordato: niente tentativi a raffica', expired.run.cache.failure?.error === 'unauthenticated')
}

// =====================================================================
section('Cache e limiti con la vera AI')
// =====================================================================
{
  const { ai, sent } = remoteAI()
  const first = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise() })
  const second = await runHome({ ai, monthlyBudget: 2000, expenses: categoryRise(), cache: first.cache })
  check('stessa impronta: nessuna seconda richiesta', sent.length === 1 && second.first.action === 'cache')
  check('stessa frase dalla cache', second.voice.message === first.voice.message && second.voice.source === 'ai')

  const busy = { ...emptyVoiceCache(), calls: { day: TODAY, count: 3, lastAt: NOW - 3 * 3600000 } }
  const capped = remoteAI()
  const c = await runHome({ ai: capped.ai, monthlyBudget: 2000, expenses: categoryRise(), cache: busy })
  check('3 chiamate oggi: niente rete, frase locale', capped.sent.length === 0 && c.first.reason === 'daily_limit' && c.voice.source === 'local')

  const recent = { ...emptyVoiceCache(), calls: { day: TODAY, count: 1, lastAt: NOW - 5 * 60000 } }
  const soon = remoteAI()
  await runHome({ ai: soon.ai, monthlyBudget: 2000, expenses: categoryRise(), cache: recent })
  check('meno di 30 minuti dall\'ultima: niente rete', soon.sent.length === 0)
  const urgent = remoteAI()
  await runHome({ ai: urgent.ai, expenses: [expense('2026-09-10', 1200, 'spesa')], cache: recent })
  check('budget sforato: passa lo stesso', urgent.sent.length === 1)

  const noEvent = remoteAI()
  const quiet = await runHome({ ai: noEvent.ai, expenses: [...threeCycles('spesa', [100, 110, 105]), expense('2026-09-05', 100, 'spesa')] })
  check('nessun evento: nessuna richiesta, frase locale', noEvent.sent.length === 0 && quiet.voice.source === 'local')
}

// =====================================================================
section('Scelta del provider e coerenza')
// =====================================================================
{
  check('Supabase configurato → remote', chooseSpendyProvider({ remoteAvailable: true }) === 'remote')
  check('senza Supabase → mock', chooseSpendyProvider({ remoteAvailable: false }) === 'mock')
  check('forzato mock', chooseSpendyProvider({ requested: 'mock', remoteAvailable: true }) === 'mock')
  check('remote chiesto ma impossibile → mock', chooseSpendyProvider({ requested: 'remote', remoteAvailable: false }) === 'mock')
  check('provider remoto non disponibile senza URL', createRemoteProvider({ url: null, publicKey: 'k', getAccessToken: async () => 't' }).available === false)
  check('vocabolari condivisi = stati e layout dell\'app', VOCABULARY_IN_SYNC)
}

// =====================================================================
section('Nessuna chiave del modello nel frontend')
// =====================================================================
{
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(jsx?|mjs|css|html)$/.test(name) && !/\.test\.mjs$/.test(name)) files.push(path)
    }
  }
  walk(new URL('..', import.meta.url).pathname)
  walk(new URL('../../supabase/functions/_shared', import.meta.url).pathname)
  const offenders = files.filter((file) => /AI_API_KEY|x-api-key|api\.anthropic\.com|VITE_AI_|ANTHROPIC_API_KEY|ANTHROPIC_WORKSPACE_ID|anthropic-workspace-id/.test(readFileSync(file, 'utf8')))
  check(`${files.length} file dell'app controllati: nessun riferimento a chiavi o endpoint del modello`, offenders.length === 0, offenders.join(', '))
}

// =====================================================================
section('Diagnostica degli errori del provider (solo log, mai la chiave)')
// =====================================================================
{
  const API_KEY = 'sk-ant-test-FAKE-Qx7Mv2Kp9Rt4Wz6Nb8Hc1Jd3Lf5Gs0Yu-DUMMY-NOT-A-REAL-KEY-001'
  const fragments = (key) => Array.from({ length: key.length - 7 }, (_, i) => key.slice(i, i + 8))
  const leaksKey = (text) => fragments(API_KEY).some((fragment) => text.includes(fragment))

  // Un SDK finto con la stessa forma degli errori di @anthropic-ai/sdk
  // (status, type, error = corpo JSON, requestID).
  class APIError extends Error {
    constructor(status, body, requestID) {
      super(`${status} ${JSON.stringify(body)}`)
      this.status = status
      this.error = body
      this.type = body?.error?.type
      this.requestID = requestID
    }
  }
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class APIConnectionTimeoutError extends Error {}
  let failWith = null
  class FakeAnthropic {
    messages = { create: async () => { throw failWith } }
    beta = { messages: { create: async () => { throw failWith } } }
  }
  Object.assign(FakeAnthropic, { APIError, RateLimitError, AuthenticationError, PermissionDeniedError, APIConnectionTimeoutError })

  async function failingCall(error) {
    failWith = error
    const env = { ...ENV, AI_MODEL: 'claude-opus-5', AI_API_KEY: API_KEY }
    const config = readConfig((name) => env[name])
    const logs = []
    const handler = createSpendyAIHandler({
      config,
      verifyUser: async () => ({ id: 'u-1' }),
      callModel: createAnthropicCaller({ Anthropic: FakeAnthropic, apiKey: API_KEY, config }),
      quota: openQuota(),
      log: (entry) => logs.push(entry),
    })
    const context = { ...baseContext, goal: { label: 'Viaggio Giappone', percent: 40, missing: 1800 } }
    const res = await handler(post({ context, previous: 'Frase di prima.' }))
    return { status: res.status, body: await res.json(), logs, logText: JSON.stringify(logs) }
  }

  // Il caso peggiore: un errore che ripete chiave, header e prompt.
  const hostile = new APIError(400, {
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: `fallbacks: not enabled for this key ${API_KEY} (x-api-key: ${API_KEY.slice(5, 40)}) Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.c2lnbmF0dXJl contact ivan@example.com`,
    },
    request_id: 'req_011CZ7pY',
  }, 'req_011CZ7pY')
  const bad = await failingCall(hostile)
  const diag = bad.logs.find((entry) => entry.outcome === 'provider_error')?.providerError
  check('risposta all\'app invariata: 502 { error: "provider_error" }', bad.status === 502 && JSON.stringify(bad.body) === '{"error":"provider_error"}')
  check('nei log: HTTP status', diag?.status === 400)
  check('nei log: tipo d\'errore del provider', diag?.type === 'invalid_request_error')
  check('nei log: request id del provider', diag?.requestId === 'req_011CZ7pY')
  check('nei log: messaggio utile ma ripulito', diag?.message?.startsWith('fallbacks: not enabled for this key [redacted]'), diag?.message)
  check('la API key non compare nei log, né intera né a pezzi', !leaksKey(bad.logText))
  check('nessun token Bearer/JWT nei log', !/Bearer\s+\S/.test(bad.logText) && !bad.logText.includes('eyJhbGci'))
  check('nessuna email nei log', !bad.logText.includes('ivan@example.com'))
  check('niente prompt né contesto nei log', !bad.logText.includes('Sei Spendy') && !bad.logText.includes('Giappone')
    && !bad.logText.includes('Frase di prima') && !bad.logText.includes('1800'))
  check('solo i campi previsti', JSON.stringify(Object.keys(diag ?? {})) === JSON.stringify(['status', 'type', 'name', 'message', 'requestId']))

  const network = new Error('Connection error.')
  network.cause = new TypeError(`fetch failed: header x-api-key=${API_KEY}`)
  const net = await failingCall(network)
  const netDiag = net.logs.find((entry) => entry.outcome === 'provider_error')?.providerError
  check('errore senza HTTP: nome e causa, status null', netDiag?.status === null && netDiag?.message?.startsWith('fetch failed'), JSON.stringify(netDiag))
  check('…e anche qui la chiave non passa', !leaksKey(net.logText))
  check('risposta invariata anche qui', net.status === 502 && net.body.error === 'provider_error')

  const rate = await failingCall(new RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'Too many requests' } }, 'req_rl'))
  check('rate limit: 429 all\'app, diagnostica nei log', rate.status === 429
    && rate.logs.some((entry) => entry.outcome === 'rate_limited' && entry.providerError?.requestId === 'req_rl'))

  // La ripulitura da sola.
  check('chiave intera → [redacted]', sanitizeDiagnosticText(`k=${API_KEY}`, [API_KEY]) === 'k=[redacted]')
  check('pezzo di chiave (≥ 8 caratteri) → [redacted]', !leaksKey(sanitizeDiagnosticText(`frammento ${API_KEY.slice(20, 29)} fine`, [API_KEY])))
  check('chiavi sk-… anche senza conoscerle', sanitizeDiagnosticText('usa sk-ant-test-FAKE-SCONOSCIUTA123', []) === 'usa [redacted]')
  check('messaggio lungo accorciato', sanitizeDiagnosticText('x'.repeat(1000)).length <= 301)
  check('campi sconosciuti scartati', !('headers' in sanitizeDiagnostic({ status: 400, headers: { 'x-api-key': API_KEY } }, [API_KEY])))
}

// =====================================================================
section('Nessun header anthropic-workspace-id (la chiave basta)')
// =====================================================================
{
  const API_KEY = 'sk-ant-test-FAKE-Pw3Ez8Tn1Uk6Io4Ya9Sr2Dm7Gv5Hb0Lc-DUMMY-NOT-A-REAL-KEY-002'
  const OLD_WORKSPACE = 'wrkspc_00FAKETESTWORKSPACE0000'
  const fragments = (value) => Array.from({ length: value.length - 7 }, (_, i) => value.slice(i, i + 8))
  const leaks = (text, value) => fragments(value).some((fragment) => text.includes(fragment))

  class APIError extends Error {
    constructor(status, body) { super(`${status}`); this.status = status; this.error = body; this.type = body?.error?.type }
  }
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class APIConnectionTimeoutError extends Error {}

  // Registra tutto ciò che il provider passa all'SDK: opzioni del client,
  // parametri e opzioni di ogni richiesta. Se ricevesse un workspace
  // risponderebbe come l'API reale ha risposto: 404.
  const seen = []
  class RecordingAnthropic {
    constructor(options) {
      seen.push({ kind: 'client', options })
      const create = async (params, requestOptions) => {
        seen.push({ kind: 'request', params, requestOptions })
        const everything = JSON.stringify([options, params, requestOptions ?? null]).toLowerCase()
        if (everything.includes('workspace')) {
          throw new APIError(404, { type: 'error', error: { type: 'not_found_error', message: 'Workspace `00000000-fake-4000-8000-000000000000` not found.' } })
        }
        return { content: [{ type: 'text', text: JSON.stringify(okAnswer) }], stop_reason: 'end_turn', model: 'claude-opus-5' }
      }
      this.messages = { create }
      this.beta = { messages: { create } }
    }
  }
  Object.assign(RecordingAnthropic, { APIError, RateLimitError, AuthenticationError, PermissionDeniedError, APIConnectionTimeoutError })

  // Il vecchio secret è ancora impostato su Supabase: deve essere ignorato.
  const env = { ...ENV, AI_MODEL: 'claude-opus-5', AI_API_KEY: API_KEY, ANTHROPIC_WORKSPACE_ID: OLD_WORKSPACE }
  const config = readConfig((name) => env[name])
  check('ANTHROPIC_WORKSPACE_ID non entra nella configurazione', !JSON.stringify(config).includes(OLD_WORKSPACE) && !('workspaceId' in config))

  const logs = []
  const handler = createSpendyAIHandler({
    config,
    verifyUser: async () => ({ id: 'u-1' }),
    callModel: createAnthropicCaller({ Anthropic: RecordingAnthropic, apiKey: config.apiKey, config }),
    quota: openQuota(),
    log: (entry) => logs.push(entry),
  })
  const res = await handler(post({ context: baseContext }))
  const client = seen.find((entry) => entry.kind === 'client')
  const request = seen.find((entry) => entry.kind === 'request')
  const everything = JSON.stringify(seen)

  check('client Anthropic senza defaultHeaders', client.options.defaultHeaders === undefined)
  check('richiesta senza header anthropic-workspace-id', !everything.toLowerCase().includes('anthropic-workspace-id'))
  check('nessun workspace ID nella richiesta, in nessun formato',
    !everything.includes(OLD_WORKSPACE) && !everything.includes('00000000-fake'))
  check('la richiesta resta quella di prima (claude-opus-5, endpoint beta con fallbacks)',
    request.params.model === 'claude-opus-5' && request.params.fallbacks === 'default')
  check('la chiamata riesce (200)', res.status === 200 && (await res.json()).response?.message === okAnswer.message)
  check('la API key è passata solo al client, non come header extra', client.options.apiKey === API_KEY && !JSON.stringify(request).includes(API_KEY))
  check('la API key non compare nei log', !leaks(JSON.stringify(logs), API_KEY))

  // Il codice del server non imposta più quell'header da nessuna parte.
  const serverDir = new URL('../../supabase/functions/', import.meta.url).pathname
  const serverFiles = ['spendy-ai/anthropicModel.js', 'spendy-ai/handler.js', 'spendy-ai/index.ts', 'spendy-ai/auth.js', '_shared/spendyAIRules.js']
  const code = serverFiles
    .map((file) => readFileSync(join(serverDir, file), 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n'))
    .join('\n')
  check('nessun file del server legge ANTHROPIC_WORKSPACE_ID o invia anthropic-workspace-id',
    !code.includes('ANTHROPIC_WORKSPACE_ID') && !code.toLowerCase().includes('anthropic-workspace-id'))
}

report('Spendy AI (Fase B)')
