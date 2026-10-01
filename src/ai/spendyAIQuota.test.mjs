// Test della quota giornaliera di Spendy AI, lato server.
// `npm test`, senza rete: l'handler della Edge Function gira qui in Node,
// il "modello" è una funzione finta che conta le chiamate, e la tabella
// ai_usage è una Map che applica le stesse regole delle due funzioni SQL
// di supabase/ai_usage.sql (prenotazione atomica, rilascio mai sotto zero).
//
// Semantica verificata qui (vedi quota.js):
//   - conta una richiesta che la funzione AUTORIZZA a raggiungere il modello;
//   - non contano: non autenticati, corpo non valido, nessun evento;
//   - la chiamata TORNA all'utente solo se è certo che nulla è stato
//     fatturato: errore prima dell'invio, oppure rifiuto esplicito con HTTP
//     400 / 401 / 403 / 404 / 429 / 529;
//   - resta CONSUMATA: risposta valida, risposta rifiutata o scartata,
//     timeout, errore di rete, 5xx, altri errori HTTP, errori non classificati;
//   - database della quota non raggiungibile → nessuna chiamata (fail closed).

import { readFileSync } from 'node:fs'
import { check, section, report } from '../sync/testkit.mjs'
import { createSpendyAIHandler, readConfig, ModelError } from '../../supabase/functions/spendy-ai/handler.js'
import { createAnthropicCaller } from '../../supabase/functions/spendy-ai/anthropicModel.js'
import {
  AI_DAILY_LIMIT, AI_MONTHLY_LIMIT, AI_GLOBAL_DAILY_LIMIT, AI_DAILY_LIMIT_REACHED, AI_MONTHLY_LIMIT_REACHED,
  AI_GLOBAL_LIMIT_REACHED, QUOTA_REASONS, usageDay, createSupabaseQuota, supabaseServiceKey,
} from '../../supabase/functions/spendy-ai/quota.js'
import { createRemoteProvider, functionsUrl, DAILY_LIMIT_ERROR, MONTHLY_LIMIT_ERROR, GLOBAL_LIMIT_ERROR } from './providers/remoteProvider.js'
import { createSpendyAI } from './spendyAI.js'
import { requestSpendyVoice } from './spendyVoicePolicy.js'
import { emptyVoiceCache } from './spendyVoiceCache.js'

const URL_FN = functionsUrl('https://progetto.supabase.co')
const ENV = { AI_PROVIDER: 'anthropic', AI_MODEL: 'modello-configurato', AI_API_KEY: 'sk-segreto-lato-server' }
const TOKENS = { 'token-a': 'utente-a', 'token-b': 'utente-b' }
// Utenti con l'email confermata: tutti, tranne quelli elencati qui.
const UNCONFIRMED = new Set(['utente-non-confermato'])
const DAY1 = Date.parse('2026-09-29T10:00:00Z')
const DAY2 = Date.parse('2026-09-30T10:00:00Z')

const context = {
  version: 1, locale: 'it', today: '2026-09-29',
  budget: { monthly: 2000, spent: 160, available: 1840, spentPercent: 8, daysRemaining: 11, band: 'ok', dailyAllowance: 167 },
  spending: { today: 0 },
  primaryEvent: { id: 'category_above_usual', importance: 60, category: 'Ristorante', cycle: { current: 160, usual: 55, difference: 105, changePercent: 191 } },
  otherEvents: [], goal: null, suggestedState: 'ironic',
}
const okAnswer = { message: 'Ristorante a 160 €, la tua media è 55 €. Ciclo speciale?', state: 'ironic', tone: 'playful', layout: 'left', animation: 'playful', priority: 60, shouldShow: true }

// Un giro di event loop: simula la rete tra funzione e database, così le
// richieste concorrenti si intrecciano davvero.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// ai_usage in memoria. reserve/release sono atomiche come le funzioni SQL:
// la valutazione dei tre limiti e l'incremento avvengono nello stesso passo,
// dopo la "rete". Rispecchia spendy_ai_reserve_v2 (supabase/ai_usage.sql):
// giornaliero, poi mensile (mese di calendario UTC), poi globale del giorno;
// il mese e il totale sono SEMPRE derivati dalle righe, come nell'SQL.
function memoryQuota() {
  const rows = new Map() // `${utente}|${giorno}` → { calls, usageCalls, input, output, models }
  const key = (userId, day) => `${userId}|${day}`
  const ops = []
  const usageRows = []
  const monthOf = (day) => day.slice(0, 7)
  const calls = (userId, day) => rows.get(key(userId, day))?.calls ?? 0
  const monthTotal = (userId, day) => [...rows.entries()]
    .filter(([k]) => k.startsWith(`${userId}|`) && monthOf(k.split('|')[1]) === monthOf(day))
    .reduce((sum, [, row]) => sum + row.calls, 0)
  const dayTotal = (day) => [...rows.entries()].filter(([k]) => k.split('|')[1] === day).reduce((sum, [, row]) => sum + row.calls, 0)
  return {
    rows,
    ops,
    usageRows,
    count: calls,
    monthCount: monthTotal,
    globalCount: dayTotal,
    async reserve({ userId, day, limits }) {
      ops.push({ op: 'reserve', userId, day, limits })
      await tick()
      const daily = calls(userId, day)
      if (daily >= limits.daily) return { allowed: false, reason: 'daily', used: daily }
      if (monthTotal(userId, day) >= limits.monthly) return { allowed: false, reason: 'monthly', used: daily }
      if (dayTotal(day) >= limits.global) return { allowed: false, reason: 'global', used: daily }
      const row = rows.get(key(userId, day)) ?? { calls: 0, usageCalls: 0, input: 0, output: 0, models: {} }
      rows.set(key(userId, day), { ...row, calls: row.calls + 1 })
      return { allowed: true, reason: null, used: daily + 1 }
    },
    async release({ userId, day }) {
      ops.push({ op: 'release', userId, day })
      await tick()
      const row = rows.get(key(userId, day))
      if (row) rows.set(key(userId, day), { ...row, calls: Math.max(row.calls - 1, 0) })
    },
    async recordUsage({ userId, day, model, inputTokens, outputTokens }) {
      ops.push({ op: 'recordUsage', userId, day })
      usageRows.push({ userId, day, model, inputTokens, outputTokens })
      await tick()
      const row = rows.get(key(userId, day)) ?? { calls: 0, usageCalls: 0, input: 0, output: 0, models: {} }
      const m = row.models[model] ?? { calls: 0, input_tokens: 0, output_tokens: 0 }
      rows.set(key(userId, day), {
        ...row,
        usageCalls: row.usageCalls + 1,
        input: row.input + inputTokens,
        output: row.output + outputTokens,
        models: { ...row.models, [model]: { calls: m.calls + 1, input_tokens: m.input_tokens + inputTokens, output_tokens: m.output_tokens + outputTokens } },
      })
    },
  }
}

// Controllo del test di concorrenza: la versione SBAGLIATA (legge, poi
// scrive in un secondo momento). Deve sforare, altrimenti il test non
// saprebbe distinguere un'implementazione atomica da una che non lo è.
function naiveQuota() {
  const rows = new Map()
  return {
    async reserve({ userId, day, limits }) {
      // Legge e conta il totale del giorno, poi scrive DOPO la "rete".
      const current = rows.get(`${userId}|${day}`) ?? 0
      const total = [...rows.entries()].filter(([k]) => k.endsWith(`|${day}`)).reduce((sum, [, n]) => sum + n, 0)
      await tick()
      if (current >= limits.daily) return { allowed: false, reason: 'daily', used: current }
      if (total >= limits.global) return { allowed: false, reason: 'global', used: current }
      rows.set(`${userId}|${day}`, current + 1)
      return { allowed: true, reason: null, used: current + 1 }
    },
    async release() {},
  }
}

function fakeModel(behavior = null) {
  const calls = []
  const callModel = async (args) => {
    calls.push(args)
    await tick()
    if (behavior) return behavior(args)
    return { text: JSON.stringify(okAnswer), stopReason: 'end_turn', model: 'm' }
  }
  return { callModel, calls }
}

function makeServer({ quota = memoryQuota(), model = fakeModel(), clock = { now: DAY1 }, env = {}, tokens = TOKENS } = {}) {
  const logs = []
  const handler = createSpendyAIHandler({
    config: readConfig((name) => ({ ...ENV, ...env })[name]),
    verifyUser: async (token) => (tokens[token] ? { id: tokens[token], emailConfirmed: !UNCONFIRMED.has(tokens[token]) } : null),
    callModel: model.callModel,
    quota,
    now: () => clock.now,
    log: (entry) => logs.push(entry),
  })
  return { handler, quota, model, clock, logs }
}

function post(body, { token = 'token-a', raw = null } = {}) {
  return new Request(URL_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ?? JSON.stringify(body),
  })
}

const call = async (server, options = {}, body = { context }) => {
  const res = await server.handler(post(body, options))
  return { status: res.status, body: await res.json() }
}

const day1 = usageDay(DAY1)

// =====================================================================
section('Quota: 3 chiamate al giorno per utente')
// =====================================================================
{
  const server = makeServer()
  check('limite configurato: 3 al giorno', AI_DAILY_LIMIT === 3)

  const first = await call(server)
  check('1. prima chiamata (0 usate) → consentita', first.status === 200 && first.body.response?.message === okAnswer.message)
  check('   contatore a 1', server.quota.count('utente-a', day1) === 1)
  const second = await call(server)
  check('2. seconda chiamata (1 usata) → consentita', second.status === 200 && server.quota.count('utente-a', day1) === 2)
  const third = await call(server)
  check('3. terza chiamata (2 usate) → consentita', third.status === 200 && server.quota.count('utente-a', day1) === 3)
  check('   il modello è stato chiamato 3 volte', server.model.calls.length === 3)

  const fourth = await call(server)
  check('4. quarta chiamata (3 usate) → rifiutata con 429', fourth.status === 429)
  check('   codice stabile AI_DAILY_LIMIT_REACHED', fourth.body.error === AI_DAILY_LIMIT_REACHED && AI_DAILY_LIMIT_REACHED === 'AI_DAILY_LIMIT_REACHED')
  check('   nessun dettaglio interno nella risposta', JSON.stringify(Object.keys(fourth.body)) === '["error"]')
  check('11. quota esaurita → il modello NON viene chiamato', server.model.calls.length === 3)
  check('   il contatore non sale oltre il limite', server.quota.count('utente-a', day1) === 3)

  const fifth = await call(server)
  check('   anche la quinta: 429, nessuna chiamata al modello', fifth.status === 429 && server.model.calls.length === 3)

  const limitLog = server.logs.find((entry) => entry.outcome === 'daily_limit')
  check('   nei log solo esito ed evento (niente importi, frasi, utente)',
    limitLog && JSON.stringify(Object.keys(limitLog).sort()) === '["event","outcome"]')
  check('   nessun importo o testo nei log della quota', !/160|1840|Ristorante|utente-a/.test(JSON.stringify(server.logs.filter((e) => e.outcome === 'daily_limit'))))
}

// =====================================================================
section('Quota: utenti e giorni indipendenti')
// =====================================================================
{
  const server = makeServer()
  for (let i = 0; i < 3; i += 1) await call(server)
  check('utente A esaurito', (await call(server)).status === 429)

  const b = await call(server, { token: 'token-b' })
  check('5. utente B → quota indipendente, consentita', b.status === 200 && server.quota.count('utente-b', day1) === 1)
  check('   il contatore di A non cambia', server.quota.count('utente-a', day1) === 3)

  server.clock.now = DAY2
  const nextDay = await call(server)
  check('6. giorno nuovo → la quota riparte', nextDay.status === 200 && server.quota.count('utente-a', usageDay(DAY2)) === 1)
  check('   il giorno prima resta com\'era', server.quota.count('utente-a', day1) === 3)

  check('giornata = data UTC', usageDay(Date.parse('2026-09-29T23:30:00Z')) === '2026-09-29' && usageDay(Date.parse('2026-09-30T00:10:00Z')) === '2026-09-30')
  check('   (in Italia, 01:30 del 30 = 23:30 UTC del 29: stessa giornata)', usageDay(Date.parse('2026-09-30T01:30:00+02:00')) === '2026-09-29')
}

// =====================================================================
section('Quota: il client non può scegliere l\'utente')
// =====================================================================
{
  const server = makeServer()
  const spoof = { context, user_id: 'utente-b', userId: 'utente-b', call_count: 0, callCount: 0, usage_date: '2000-01-01' }
  for (let i = 0; i < 3; i += 1) await call(server, {}, spoof)
  check('7. user_id nel corpo ignorato: le chiamate vanno all\'utente del token', server.quota.count('utente-a', day1) === 3)
  check('   l\'utente indicato nel corpo non viene toccato', server.quota.count('utente-b', day1) === 0)
  check('   call_count / usage_date del corpo ignorati', server.quota.ops.every((op) => op.userId === 'utente-a' && op.day === day1))
  const fourth = await call(server, {}, spoof)
  check('   quarta chiamata con user_id falso → comunque 429', fourth.status === 429 && server.model.calls.length === 3)
}

// =====================================================================
section('Quota: cosa non viene conteggiato')
// =====================================================================
{
  const server = makeServer()
  const anon = await call(server, { token: null })
  const fake = await call(server, { token: 'token-inventato' })
  check('8. non autenticato → 401', anon.status === 401 && fake.status === 401)
  check('   nessuna prenotazione, nessuna chiamata al modello', server.quota.ops.length === 0 && server.model.calls.length === 0)

  const bad = await server.handler(post(null, { raw: '{non json' }))
  const noContext = await call(server, {}, { context: { nulla: true } })
  const noEvent = await call(server, {}, { context: { ...context, primaryEvent: null } })
  check('corpo non valido / contesto non valido → rifiutati', bad.status === 400 && noContext.status === 400)
  check('nessun evento → risposta silenziosa', noEvent.status === 200 && noEvent.body.response?.shouldShow === false)
  check('   nessuno dei tre consuma quota', server.quota.ops.length === 0 && server.quota.count('utente-a', day1) === 0)
}

// =====================================================================
section('Quota: concorrenza')
// =====================================================================
{
  const server = makeServer()
  const results = await Promise.all(Array.from({ length: 10 }, () => call(server)))
  const ok = results.filter((r) => r.status === 200).length
  const limited = results.filter((r) => r.status === 429 && r.body.error === AI_DAILY_LIMIT_REACHED).length
  check('9. 10 richieste contemporanee → esattamente 3 consentite', ok === 3 && limited === 7)
  check('   il modello è chiamato 3 volte, non di più', server.model.calls.length === 3)
  check('   contatore finale = 3', server.quota.count('utente-a', day1) === 3)

  const mixed = makeServer()
  await Promise.all([...Array.from({ length: 6 }, () => call(mixed)), ...Array.from({ length: 6 }, () => call(mixed, { token: 'token-b' }))])
  check('   due utenti in parallelo: 3 + 3', mixed.quota.count('utente-a', day1) === 3 && mixed.quota.count('utente-b', day1) === 3 && mixed.model.calls.length === 6)

  const naive = makeServer({ quota: naiveQuota() })
  await Promise.all(Array.from({ length: 10 }, () => call(naive)))
  check('   controllo: una quota "leggi e poi scrivi" sforerebbe il limite', naive.model.calls.length > 3)
}

// =====================================================================
section('Quota: rimborso, classificazione degli errori del provider')
// =====================================================================
{
  // Un SDK finto con le STESSE classi d'errore dell'SDK Anthropic: l'handler
  // e l'adattatore veri girano interi, solo la rete è finta.
  class APIError extends Error {
    constructor(status, message = 'api error') { super(message); this.status = status; this.error = { type: 'error', error: { type: 'x', message } } }
  }
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class APIConnectionError extends Error {}
  class APIConnectionTimeoutError extends APIConnectionError {}

  function anthropicServer(onCreate) {
    const created = []
    class FakeAnthropic {
      constructor() {
        const create = async (params) => { created.push(params); return onCreate(params) }
        this.messages = { create }
        this.beta = { messages: { create } }
      }
    }
    Object.assign(FakeAnthropic, { APIError, RateLimitError, AuthenticationError, PermissionDeniedError, APIConnectionTimeoutError })
    const config = readConfig((name) => ({ ...ENV, AI_MODEL: 'claude-opus-5' })[name])
    const quota = memoryQuota()
    const logs = []
    const handler = createSpendyAIHandler({
      config,
      verifyUser: async (token) => (TOKENS[token] ? { id: TOKENS[token], emailConfirmed: true } : null),
      callModel: createAnthropicCaller({ Anthropic: FakeAnthropic, apiKey: config.apiKey, config }),
      quota,
      now: () => DAY1,
      log: (entry) => logs.push(entry),
    })
    return { handler, quota, logs, created, FakeAnthropic, config }
  }

  const okResponse = () => ({ content: [{ type: 'text', text: JSON.stringify(okAnswer) }], stop_reason: 'end_turn', model: 'claude-opus-5' })
  const releasesOf = (server) => server.quota.ops.filter((op) => op.op === 'release').length

  // [descrizione, errore lanciato da messages.create, codice app, HTTP app, quota restituita?]
  const CASES = [
    // Rifiuti espliciti, mai fatturati → la chiamata torna all'utente
    ['HTTP 429', () => new RateLimitError(429), 'rate_limited', 429, true],
    ['HTTP 529', () => new APIError(529), 'overloaded', 503, true],
    ['HTTP 400', () => new APIError(400), 'provider_error', 502, true],
    ['HTTP 404', () => new APIError(404), 'provider_error', 502, true],
    ['HTTP 401', () => new AuthenticationError(401), 'provider_auth', 502, true],
    ['HTTP 403', () => new PermissionDeniedError(403), 'provider_auth', 502, true],
    // Il codice HTTP conta, non la classe: stessi codici, eccezioni "sconosciute"
    ['429 con classe non riconosciuta', () => Object.assign(new Error('x'), { status: 429 }), 'rate_limited', 429, true],
    ['529 con classe non riconosciuta', () => Object.assign(new Error('x'), { status: 529 }), 'overloaded', 503, true],
    ['401 con classe non riconosciuta', () => Object.assign(new Error('x'), { status: 401 }), 'provider_auth', 502, true],
    ['403 con classe non riconosciuta', () => Object.assign(new Error('x'), { status: 403 }), 'provider_auth', 502, true],
    ['429 letto da response.status', () => Object.assign(new Error('x'), { response: { status: 429 } }), 'rate_limited', 429, true],
    ['400 con classe non riconosciuta', () => Object.assign(new Error('x'), { status: 400 }), 'provider_error', 502, true],
    ['404 con classe non riconosciuta', () => Object.assign(new Error('x'), { status: 404 }), 'provider_error', 502, true],
    ['404 letto da response.status', () => Object.assign(new Error('x'), { response: { status: 404 } }), 'provider_error', 502, true],
    ['APIError generico con status 429', () => new APIError(429), 'rate_limited', 429, true],
    // Dopo l'invio, possibile costo → la chiamata resta consumata
    ['timeout', () => new APIConnectionTimeoutError('Request timed out.'), 'timeout', 504, false],
    ['timeout riconosciuto dal nome', () => Object.assign(new Error('t'), { name: 'APIConnectionTimeoutError' }), 'timeout', 504, false],
    ['errore di rete', () => new APIConnectionError('fetch failed'), 'provider_error', 502, false],
    ['errore di rete generico', () => Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNRESET') }), 'provider_error', 502, false],
    ['HTTP 500', () => new APIError(500), 'provider_error', 502, false],
    ['HTTP 502', () => new APIError(502), 'provider_error', 502, false],
    ['HTTP 503', () => new APIError(503), 'provider_error', 502, false],
    ['HTTP 504', () => new APIError(504), 'provider_error', 502, false],
    ['HTTP 422 (fuori dalla lista dei rimborsi)', () => new APIError(422), 'provider_error', 502, false],
    ['HTTP 413 (fuori dalla lista dei rimborsi)', () => new APIError(413), 'provider_error', 502, false],
    ['errore non classificato', () => new Error('boom'), 'provider_error', 502, false],
  ]

  for (const [label, makeError, code, httpStatus, refunded] of CASES) {
    const server = anthropicServer(() => { throw makeError() })
    const res = await call(server)
    check(`${label} → ${code}/${httpStatus}, quota ${refunded ? 'RESTITUITA' : 'CONSUMATA'}`,
      res.status === httpStatus && res.body.error === code
      && server.created.length === 1
      && server.quota.count('utente-a', day1) === (refunded ? 0 : 1)
      && releasesOf(server) === (refunded ? 1 : 0)
      && server.logs.some((entry) => entry.outcome === code && entry.quotaReleased === refunded))
  }

  // Un 429 del provider non è la quota del server: codici diversi.
  const rate = anthropicServer(() => { throw new RateLimitError(429) })
  const rateRes = await call(rate)
  check('429 del provider ≠ AI_DAILY_LIMIT_REACHED (l\'app li distingue)', rateRes.body.error === 'rate_limited' && rateRes.body.error !== AI_DAILY_LIMIT_REACHED)

  // Errore PRIMA dell'invio: la richiesta non parte, la chiamata torna.
  const circular = {}
  circular.self = circular
  const built = anthropicServer(() => okResponse())
  const caller = createAnthropicCaller({ Anthropic: built.FakeAnthropic, apiKey: built.config.apiKey, config: built.config })
  const prepError = await caller({ system: 's', input: circular, schema: {} }).then(() => null, (error) => error)
  check('errore prima dell\'invio: messages.create() non viene chiamato', prepError instanceof ModelError && built.created.length === 0)
  check('   l\'adattatore lo marca come rimborsabile (refund: true)', prepError?.refund === true && prepError?.code === 'provider_error')

  const before = makeServer({ model: fakeModel(() => { throw new ModelError('provider_error', 'provider_error', null, { refund: true }) }) })
  const beforeRes = await call(before)
  check('errore prima dell\'invio (ModelError refund) → quota restituita',
    beforeRes.status === 502 && before.quota.count('utente-a', day1) === 0 && before.logs.some((entry) => entry.quotaReleased === true))

  // Il default di ModelError è "consumata": nel dubbio conta.
  check('ModelError senza refund → non rimborsabile di default', new ModelError('timeout').refund === false)
  const noFlag = makeServer({ model: fakeModel(() => { throw new ModelError('timeout') }) })
  await call(noFlag)
  check('   timeout dichiarato senza refund → quota consumata', noFlag.quota.count('utente-a', day1) === 1 && releasesOf(noFlag) === 0)
  const unknown = makeServer({ model: fakeModel(() => { throw new Error('boom') }) })
  await call(unknown)
  check('   eccezione non-ModelError dal modello → quota consumata', unknown.quota.count('utente-a', day1) === 1 && releasesOf(unknown) === 0)

  // Risposta OK → consumata.
  const ok = anthropicServer(() => okResponse())
  const okRes = await call(ok)
  check('risposta OK → 200, quota CONSUMATA', okRes.status === 200 && ok.quota.count('utente-a', day1) === 1 && releasesOf(ok) === 0)
  check('   nei log quotaReleased non c\'è (nessun errore)', !ok.logs.some((entry) => 'quotaReleased' in entry))

  // Il modello ha risposto ma la risposta non serve: il costo c'è stato.
  const refusal = makeServer({ model: fakeModel(() => ({ text: '', stopReason: 'refusal', model: 'm' })) })
  await call(refusal)
  check('il modello ha risposto ma ha rifiutato → quota CONSUMATA', refusal.quota.count('utente-a', day1) === 1 && releasesOf(refusal) === 0)
  const garbage = makeServer({ model: fakeModel(() => ({ text: 'non è json', stopReason: 'end_turn', model: 'm' })) })
  const g = await call(garbage)
  check('risposta scartata (422) → quota CONSUMATA', g.status === 422 && garbage.quota.count('utente-a', day1) === 1 && releasesOf(garbage) === 0)

  // Effetto sul limite giornaliero.
  const refusedOften = anthropicServer(() => { throw new RateLimitError(429) })
  for (let i = 0; i < 5; i += 1) await call(refusedOften)
  check('5 rifiuti 429 di fila non bruciano nessuna delle 3 chiamate', refusedOften.quota.count('utente-a', day1) === 0)

  const slow = anthropicServer(() => { throw new APIConnectionTimeoutError('Request timed out.') })
  for (let i = 0; i < 3; i += 1) await call(slow)
  const fourth = await call(slow)
  check('3 timeout bruciano le 3 chiamate: la quarta è 429 AI_DAILY_LIMIT_REACHED', fourth.status === 429 && fourth.body.error === AI_DAILY_LIMIT_REACHED)
  check('   e la quarta NON raggiunge il provider (3 richieste in tutto)', slow.created.length === 3)

  // Se il rilascio stesso fallisce, la chiamata resta consumata.
  const releaseBroken = memoryQuota()
  releaseBroken.release = async () => { throw new Error('db giù') }
  const stuck = makeServer({ quota: releaseBroken, model: fakeModel(() => { throw new ModelError('rate_limited', 'rate_limited', null, { refund: true }) }) })
  const s = await call(stuck)
  check('rifiuto rimborsabile ma rilascio fallito → resta consumata (mai sotto il vero uso)',
    s.body.error === 'rate_limited' && releaseBroken.count('utente-a', day1) === 1 && stuck.logs.some((entry) => entry.quotaReleased === false))

  // Nessuna chiave nei log di questi errori.
  const leak = anthropicServer(() => { throw Object.assign(new APIError(500, `errore con chiave ${ENV.AI_API_KEY}`), { requestID: 'req_1' }) })
  await call(leak)
  check('la chiave del server non compare nei log', !JSON.stringify(leak.logs).includes(ENV.AI_API_KEY))
}

// =====================================================================
section('Quota: database non disponibile o non configurato')
// =====================================================================
{
  const down = memoryQuota()
  down.reserve = async () => { throw new Error('quota_rpc_500') }
  const server = makeServer({ quota: down })
  const res = await call(server)
  check('database della quota giù → 503, il modello NON viene chiamato', res.status === 503 && res.body.error === 'quota_unavailable' && server.model.calls.length === 0)

  const noQuota = makeServer({ quota: null })
  const nq = await call(noQuota)
  check('funzione senza quota configurata → 503 not_configured, niente modello', nq.status === 503 && nq.body.error === 'not_configured' && noQuota.model.calls.length === 0)
  check('   nei log: manca "quota"', noQuota.logs.some((entry) => entry.outcome === 'not_configured' && entry.missing.includes('quota')))
}

// =====================================================================
section('Quota: adattatore Supabase (RPC con service_role)')
// =====================================================================
{
  const sent = []
  const responses = [
    [{ allowed: true, reason: null, daily_used: 1, monthly_used: 1, global_used: 1 }],
    [{ allowed: false, reason: 'monthly', daily_used: 1, monthly_used: 30, global_used: 40 }],
    null,
  ]
  const quota = createSupabaseQuota({
    supabaseUrl: 'https://progetto.supabase.co/',
    serviceKey: 'eyJservice.role.jwt',
    fetchImpl: async (url, init) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body) })
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    },
  })
  const limitsArg = { daily: 3, monthly: 30, global: 300 }
  const r1 = await quota.reserve({ userId: 'utente-a', day: '2026-09-29', limits: limitsArg })
  const r2 = await quota.reserve({ userId: 'utente-a', day: '2026-09-29', limits: limitsArg })
  await quota.release({ userId: 'utente-a', day: '2026-09-29' })
  check('prenotazione → /rest/v1/rpc/spendy_ai_reserve_v2 (la funzione vecchia non viene più chiamata)', sent[0].url === 'https://progetto.supabase.co/rest/v1/rpc/spendy_ai_reserve_v2')
  check('   argomenti: utente verificato, giorno, i tre limiti', JSON.stringify(sent[0].body) === '{"p_user_id":"utente-a","p_usage_date":"2026-09-29","p_daily_limit":3,"p_monthly_limit":30,"p_global_daily_limit":300}')
  check('   esito e motivo del rifiuto letti dalla risposta', r1.allowed === true && r1.reason === null && r1.used === 1 && r2.allowed === false && r2.reason === 'monthly')
  check('rilascio → /rest/v1/rpc/spendy_ai_release', sent[2].url.endsWith('/rest/v1/rpc/spendy_ai_release'))
  check('si presenta con la service_role, non con il token dell\'utente',
    sent.every((s) => s.headers.apikey === 'eyJservice.role.jwt' && s.headers.Authorization === 'Bearer eyJservice.role.jwt'))

  const secret = []
  const newKeys = createSupabaseQuota({
    supabaseUrl: 'https://progetto.supabase.co',
    serviceKey: 'sb_secret_test',
    fetchImpl: async (url, init) => { secret.push(init.headers); return new Response('[{"allowed":true,"daily_used":1}]', { status: 200 }) },
  })
  await newKeys.reserve({ userId: 'u', day: '2026-09-29', limits: limitsArg })
  check('nuove chiavi segrete: solo apikey, nessun Bearer', secret[0].apikey === 'sb_secret_test' && !('Authorization' in secret[0]))

  const failing = createSupabaseQuota({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'k', fetchImpl: async () => new Response('{}', { status: 500 }) })
  check('database in errore → l\'adattatore lancia (fail closed)', await failing.reserve({ userId: 'u', day: 'd', limits: limitsArg }).then(() => false, () => true))
  const weird = createSupabaseQuota({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'k', fetchImpl: async () => new Response('[]', { status: 200 }) })
  check('risposta senza esito → lancia, non consente', await weird.reserve({ userId: 'u', day: 'd', limits: limitsArg }).then(() => false, () => true))

  check('service key: legacy SUPABASE_SERVICE_ROLE_KEY', supabaseServiceKey((n) => ({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' })[n]) === 'legacy')
  check('service key: nuove SUPABASE_SECRET_KEYS (JSON)', supabaseServiceKey((n) => ({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' })[n]) === 'sb_secret_x')
  check('service key assente → null', supabaseServiceKey(() => undefined) === null)
}

// =====================================================================
section('Quota: SQL (supabase/ai_usage.sql)')
// =====================================================================
{
  const sql = readFileSync(new URL('../../supabase/ai_usage.sql', import.meta.url), 'utf8').toLowerCase()
  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  check('una riga per (user_id, usage_date)', /primary key \(user_id, usage_date\)/.test(code))
  check('colonne richieste', ['user_id', 'usage_date', 'call_count', 'created_at', 'updated_at'].every((c) => code.includes(c)))
  check('call_count mai negativo', code.includes('check (call_count >= 0)'))
  check('RLS attiva', code.includes('alter table public.ai_usage enable row level security'))
  check('policy solo in lettura, solo le proprie righe', /for select to authenticated using \(auth\.uid\(\) = user_id\)/.test(code) && !/for (insert|update|delete|all)/.test(code))
  check('scritture revocate ad anon e authenticated', code.includes('revoke insert, update, delete, truncate on public.ai_usage from anon, authenticated'))
  check('controllo e incremento in UNA istruzione (on conflict … where call_count < limite)',
    /on conflict \(user_id, usage_date\) do update\s+set call_count = u\.call_count \+ 1,[\s\S]*?where u\.call_count < p_limit/.test(code))
  check('nessuna funzione security definer', !code.includes('security definer'))
  check('RPC non eseguibili dall\'app',
    code.includes('revoke all on function public.spendy_ai_reserve(uuid, date, integer) from public, anon, authenticated') &&
    code.includes('revoke all on function public.spendy_ai_release(uuid, date) from public, anon, authenticated'))
  check('RPC eseguibili dalla service_role', code.includes('to service_role'))
  check('rilascio mai sotto zero', code.includes('greatest(call_count - 1, 0)'))
  check('schema.sql non toccato: ai_usage vive nel suo file', !readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8').includes('ai_usage'))
}

// =====================================================================
section('Quota: l\'app distingue quota, provider e autenticazione')
// =====================================================================
{
  const provider = (status, body) => createRemoteProvider({
    url: URL_FN, publicKey: 'pk', getAccessToken: async () => 'token-a',
    fetchImpl: async () => new Response(JSON.stringify(body), { status }),
  })
  const run = (status, body) => createSpendyAI({ provider: provider(status, body) }).generate(context)

  check('stesso codice di app e server', DAILY_LIMIT_ERROR === AI_DAILY_LIMIT_REACHED)
  check('429 AI_DAILY_LIMIT_REACHED → daily_limit', (await run(429, { error: AI_DAILY_LIMIT_REACHED })).error === 'daily_limit')
  check('429 del provider → rate_limited (come prima)', (await run(429, { error: 'rate_limited' })).error === 'rate_limited')
  check('401 → unauthenticated (come prima)', (await run(401, { error: 'unauthenticated' })).error === 'unauthenticated')
  check('503 quota_unavailable → unavailable', (await run(503, { error: 'quota_unavailable' })).error === 'unavailable')
  check('502 errore provider → errore generico (come prima)', (await run(502, { error: 'provider_error' })).error === 'error')

  // Il limite dell'app resta com'era: la quota del server non consuma una
  // delle sue 3 chiamate (il modello non è stato raggiunto) e l'app mostra
  // la frase locale per quella situazione.
  const ai = createSpendyAI({ provider: provider(429, { error: AI_DAILY_LIMIT_REACHED }) })
  const meta = { fingerprint: 'f-1', eventKey: 'category_above_usual:ristoranti', importance: 60 }
  const { cache, result } = await requestSpendyVoice({ ai, context, meta, cache: emptyVoiceCache(), today: '2026-09-29', now: DAY1 })
  check('app: quota del server esaurita → nessuna chiamata contata in locale', result.error === 'daily_limit' && (cache.calls?.count ?? 0) === 0)
  check('app: la situazione resta sulla frase locale', cache.failure?.error === 'daily_limit' && cache.failure?.fingerprint === 'f-1')
}


// =====================================================================
section('Limiti configurabili (secret), non scolpiti nella funzione')
// =====================================================================
{
  const defaults = readConfig((name) => ENV[name])
  check('predefiniti: 3 al giorno, 30 al mese, 300 globali', defaults.dailyLimit === 3 && defaults.monthlyLimit === 30 && defaults.globalDailyLimit === 300
    && AI_DAILY_LIMIT === 3 && AI_MONTHLY_LIMIT === 30 && AI_GLOBAL_DAILY_LIMIT === 300)
  const custom = readConfig((name) => ({ ...ENV, AI_DAILY_LIMIT: '2', AI_MONTHLY_LIMIT: '10', AI_GLOBAL_DAILY_LIMIT: '1000' })[name])
  check('AI_DAILY_LIMIT / AI_MONTHLY_LIMIT / AI_GLOBAL_DAILY_LIMIT letti dai secret', custom.dailyLimit === 2 && custom.monthlyLimit === 10 && custom.globalDailyLimit === 1000)
  for (const bad of ['', 'abc', '0', '-5', 'NaN', undefined]) {
    const c = readConfig((name) => ({ ...ENV, AI_DAILY_LIMIT: bad, AI_MONTHLY_LIMIT: bad, AI_GLOBAL_DAILY_LIMIT: bad })[name])
    check(`valore non valido (${JSON.stringify(bad)}) → predefinito prudente, mai "nessun limite"`, c.dailyLimit === 3 && c.monthlyLimit === 30 && c.globalDailyLimit === 300)
  }
  const server = makeServer({ env: { AI_DAILY_LIMIT: '2', AI_MONTHLY_LIMIT: '10', AI_GLOBAL_DAILY_LIMIT: '1000' } })
  await call(server)
  check('i limiti dei secret arrivano alla prenotazione', JSON.stringify(server.quota.ops[0].limits) === '{"daily":2,"monthly":10,"global":1000}')
  await call(server); const third = await call(server)
  check('AI_DAILY_LIMIT=2: la terza chiamata del giorno è rifiutata', third.status === 429 && third.body.error === AI_DAILY_LIMIT_REACHED && server.model.calls.length === 2)
  const handlerSource = readFileSync(new URL('../../supabase/functions/spendy-ai/handler.js', import.meta.url), 'utf8')
  check('la funzione legge i tre secret e i predefiniti vengono da quota.js (nessun numero scolpito)',
    ["getEnv('AI_DAILY_LIMIT')", "getEnv('AI_MONTHLY_LIMIT')", "getEnv('AI_GLOBAL_DAILY_LIMIT')"].every((c) => handlerSource.includes(c))
    && !/(daily|monthly|global)\w*\s*[:=]\s*\d+\s*[,;\n]/i.test(handlerSource))
}

// =====================================================================
section('Quota mensile: 30 chiamate per mese di calendario UTC')
// =====================================================================
{
  const server = makeServer()
  const dayOf = (n) => Date.parse(`2026-09-${String(n).padStart(2, '0')}T10:00:00Z`)
  let allowed = 0
  for (let d = 1; d <= 10; d += 1) {
    server.clock.now = dayOf(d)
    for (let i = 0; i < 3; i += 1) if ((await call(server)).status === 200) allowed += 1
  }
  check('10 giorni x 3 chiamate = 30 chiamate consentite', allowed === 30 && server.quota.monthCount('utente-a', '2026-09-10') === 30)
  server.clock.now = dayOf(11)
  const over = await call(server)
  check('la 31ª chiamata del mese → 429 AI_MONTHLY_LIMIT_REACHED', over.status === 429 && over.body.error === AI_MONTHLY_LIMIT_REACHED && AI_MONTHLY_LIMIT_REACHED === 'AI_MONTHLY_LIMIT_REACHED')
  check('   il modello NON viene chiamato e il contatore non sale', server.model.calls.length === 30 && server.quota.count('utente-a', '2026-09-11') === 0)
  check('   risposta senza dettagli interni; nei log solo esito ed evento', JSON.stringify(Object.keys(over.body)) === '["error"]'
    && JSON.stringify(Object.keys(server.logs.find((e) => e.outcome === 'monthly_limit')).sort()) === '["event","outcome"]')
  const other = await call(server, { token: 'token-b' })
  check('un altro utente non è toccato dal mensile di A', other.status === 200)

  server.clock.now = Date.parse('2026-10-01T00:05:00Z')
  const nextMonth = await call(server)
  check('cambio mese (1 ottobre UTC) → la quota mensile riparte', nextMonth.status === 200 && server.quota.monthCount('utente-a', '2026-10-01') === 1)
  check('   il mese prima resta com\'era', server.quota.monthCount('utente-a', '2026-09-30') === 30)
  server.clock.now = Date.parse('2026-09-30T23:59:00Z')
  check('   30 settembre 23:59 UTC è ancora settembre', usageDay(server.clock.now) === '2026-09-30' && (await call(server)).body.error === AI_MONTHLY_LIMIT_REACHED)

  // Il rimborso riporta indietro ANCHE il mensile (è derivato dalle righe).
  const refunding = makeServer({ model: fakeModel(() => { throw new ModelError('rate_limited', 'rate_limited', null, { refund: true }) }) })
  for (let d = 1; d <= 10; d += 1) { refunding.clock.now = dayOf(d); for (let i = 0; i < 3; i += 1) await call(refunding) }
  check('rimborsi: 30 chiamate rifiutate dal provider non consumano né giorno né mese', refunding.quota.monthCount('utente-a', '2026-09-10') === 0)
  const consumed = makeServer()
  for (let d = 1; d <= 10; d += 1) { consumed.clock.now = dayOf(d); for (let i = 0; i < 3; i += 1) await call(consumed) }
  consumed.clock.now = dayOf(11)
  check('31ª rifiutata prima del rimborso…', (await call(consumed)).status === 429)
  await consumed.quota.release({ userId: 'utente-a', day: '2026-09-10' })
  check('…dopo un rimborso la mensile si libera di UNA chiamata e la successiva passa', consumed.quota.monthCount('utente-a', '2026-09-11') === 29 && (await call(consumed)).status === 200 && (await call(consumed)).status === 429)

  // timeout e risposte scartate restano consumate anche nel mese
  const timeouts = makeServer({ model: fakeModel(() => { throw new ModelError('timeout') }) })
  await call(timeouts)
  check('un timeout consuma anche il conteggio mensile', timeouts.quota.monthCount('utente-a', day1) === 1)
}

// =====================================================================
section('Tetto globale giornaliero (tutti gli utenti)')
// =====================================================================
{
  const tokens = { 'token-a': 'utente-a', 'token-b': 'utente-b', 'token-c': 'utente-c', 'token-d': 'utente-d' }
  const server = makeServer({ tokens, env: { AI_GLOBAL_DAILY_LIMIT: '5' } })
  const outcomes = []
  for (const token of ['token-a', 'token-a', 'token-b', 'token-b', 'token-c']) outcomes.push((await call(server, { token })).status)
  check('5 chiamate di utenti diversi: tutte consentite (nessun utente oltre il suo limite)', outcomes.every((s) => s === 200) && server.quota.globalCount(day1) === 5)
  const blocked = await call(server, { token: 'token-d' })
  check('la 6ª della giornata, di un utente che non ha usato niente → 429 AI_GLOBAL_LIMIT_REACHED', blocked.status === 429 && blocked.body.error === AI_GLOBAL_LIMIT_REACHED && AI_GLOBAL_LIMIT_REACHED === 'AI_GLOBAL_LIMIT_REACHED')
  check('   il modello NON viene chiamato; nei log solo esito ed evento', server.model.calls.length === 5
    && JSON.stringify(Object.keys(server.logs.find((e) => e.outcome === 'global_limit')).sort()) === '["event","outcome"]')
  server.clock.now = DAY2
  check('giorno nuovo → il tetto globale riparte', (await call(server, { token: 'token-d' })).status === 200)

  // utenti diversi in concorrenza sullo stesso tetto
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`t${i}`, `u${i}`]))
  const race = makeServer({ tokens: many, env: { AI_GLOBAL_DAILY_LIMIT: '4' } })
  const results = await Promise.all(Object.keys(many).map((token) => call(race, { token })))
  const ok = results.filter((r) => r.status === 200).length
  check('12 utenti diversi contemporaneamente su un tetto di 4 → esattamente 4 passano', ok === 4 && results.filter((r) => r.body.error === AI_GLOBAL_LIMIT_REACHED).length === 8 && race.model.calls.length === 4)
  const naive = makeServer({ quota: naiveQuota(), tokens: many, env: { AI_GLOBAL_DAILY_LIMIT: '4' } })
  await Promise.all(Object.keys(many).map((token) => call(naive, { token })))
  check('controllo: una prenotazione "leggi e poi scrivi" sforerebbe il tetto globale', naive.model.calls.length > 4)

  // Richieste concorrenti dello stesso utente sul mensile
  const monthly = makeServer({ env: { AI_DAILY_LIMIT: '100', AI_MONTHLY_LIMIT: '5' } })
  const burst = await Promise.all(Array.from({ length: 15 }, () => call(monthly)))
  check('15 richieste contemporanee con mensile 5 → esattamente 5', burst.filter((r) => r.status === 200).length === 5 && burst.filter((r) => r.body.error === AI_MONTHLY_LIMIT_REACHED).length === 10)

  // Ordine dei motivi: se ne scattano più d'uno, prima l'utente, poi il globale.
  const both = makeServer({ env: { AI_DAILY_LIMIT: '1', AI_MONTHLY_LIMIT: '1', AI_GLOBAL_DAILY_LIMIT: '1' } })
  await call(both)
  check('daily, monthly e global scattano insieme → il motivo è "daily"', (await call(both)).body.error === AI_DAILY_LIMIT_REACHED)
  const monthlyFirst = makeServer({ env: { AI_DAILY_LIMIT: '9', AI_MONTHLY_LIMIT: '1', AI_GLOBAL_DAILY_LIMIT: '1' } })
  await call(monthlyFirst)
  check('monthly e global insieme → il motivo è "monthly"', (await call(monthlyFirst)).body.error === AI_MONTHLY_LIMIT_REACHED)
  check('i tre codici sono distinti e stabili', new Set(Object.values(QUOTA_REASONS).map((r) => r.error)).size === 3)
}

// =====================================================================
section('Email non confermata, guest')
// =====================================================================
{
  const tokens = { ...TOKENS, 'token-nc': 'utente-non-confermato' }
  const server = makeServer({ tokens })
  const nc = await call(server, { token: 'token-nc' })
  check('email non confermata → 403 email_not_confirmed', nc.status === 403 && nc.body.error === 'email_not_confirmed')
  check('   nessuna prenotazione (non consuma quota) e nessuna chiamata al modello', server.quota.ops.length === 0 && server.model.calls.length === 0)
  check('   nei log solo l\'esito', JSON.stringify(server.logs.at(-1)) === '{"outcome":"email_not_confirmed"}')
  const missingField = createSpendyAIHandler({
    config: readConfig((name) => ENV[name]), verifyUser: async () => ({ id: 'utente-a' }), callModel: fakeModel().callModel, quota: memoryQuota(),
  })
  check('un verificatore che non dice se l\'email è confermata → rifiutato (mai "nel dubbio sì")', (await missingField(post({ context }))).status === 403)
  const confirmed = await call(server)
  check('email confermata → consentito', confirmed.status === 200)
  const guest = await call(server, { token: null })
  check('guest (nessun token) → 401, niente quota, niente modello', guest.status === 401 && server.quota.ops.length === 1 && server.model.calls.length === 1)
  const anon = await call(server, { token: 'token-anonimo-della-chiave-pubblica' })
  check('token che non è di nessun utente → 401', anon.status === 401)

  // L'adattatore reale di Auth legge email_confirmed_at.
  const { createSupabaseUserVerifier } = await import('../../supabase/functions/spendy-ai/auth.js')
  const verifier = (body, ok = true) => createSupabaseUserVerifier({
    supabaseUrl: 'https://progetto.supabase.co', publicKey: 'pk',
    fetchImpl: async () => new Response(JSON.stringify(body), { status: ok ? 200 : 401 }),
  })
  check('Auth: email_confirmed_at valorizzato → emailConfirmed true', (await verifier({ id: 'u1', email_confirmed_at: '2026-09-01T10:00:00Z' })('t')).emailConfirmed === true)
  check('Auth: email_confirmed_at assente o null → emailConfirmed false', (await verifier({ id: 'u1' })('t')).emailConfirmed === false && (await verifier({ id: 'u1', email_confirmed_at: null })('t')).emailConfirmed === false)
  check('Auth: sessione non valida → nessun utente', (await verifier({}, false)('t')) === null)
  check('Auth: dell\'utente passa solo id e conferma (niente email)', JSON.stringify(Object.keys(await verifier({ id: 'u1', email: 'a@b.it', email_confirmed_at: 'x' })('t'))) === '["id","emailConfirmed"]')
}

// =====================================================================
section('Token usage: registrati, con il modello che ha risposto')
// =====================================================================
{
  // L'adattatore Anthropic vero con un SDK finto che restituisce `usage`.
  const makeAnthropic = (respond) => {
    class FakeAnthropic {
      constructor() {
        const create = async () => respond()
        this.messages = { create }
        this.beta = { messages: { create } }
      }
    }
    Object.assign(FakeAnthropic, { APIError: class extends Error {}, APIConnectionTimeoutError: class extends Error {} })
    return FakeAnthropic
  }
  const answer = (extra = {}) => ({ content: [{ type: 'text', text: JSON.stringify(okAnswer) }], stop_reason: 'end_turn', model: 'modello-che-ha-risposto', usage: { input_tokens: 1234, output_tokens: 56 }, ...extra })
  const build = (respond, env = {}) => {
    const config = readConfig((name) => ({ ...ENV, ...env })[name])
    const quota = memoryQuota()
    const logs = []
    const handler = createSpendyAIHandler({
      config,
      verifyUser: async (token) => (TOKENS[token] ? { id: TOKENS[token], emailConfirmed: true } : null),
      callModel: createAnthropicCaller({ Anthropic: makeAnthropic(respond), apiKey: config.apiKey, config }),
      quota, now: () => DAY1, log: (entry) => logs.push(entry),
    })
    return { handler, quota, logs }
  }
  const run = async (server) => ({ status: (await server.handler(post({ context }))).status })

  const server = build(() => answer())
  const res = await run(server)
  check('risposta valida → 200', res.status === 200)
  check('usage registrato: input_tokens e output_tokens fatturati', server.quota.usageRows.length === 1 && server.quota.usageRows[0].inputTokens === 1234 && server.quota.usageRows[0].outputTokens === 56)
  check('   registrato il modello che ha DAVVERO risposto, non quello configurato', server.quota.usageRows[0].model === 'modello-che-ha-risposto' && server.quota.usageRows[0].model !== ENV.AI_MODEL)
  check('   per l\'utente verificato e per la giornata UTC', server.quota.usageRows[0].userId === 'utente-a' && server.quota.usageRows[0].day === day1)
  const row = server.quota.rows.get(`utente-a|${day1}`)
  check('   righe: call_count 1, usage_calls 1, token e modello aggregati', row.calls === 1 && row.usageCalls === 1 && row.input === 1234 && row.output === 56
    && row.models['modello-che-ha-risposto']?.calls === 1 && row.models['modello-che-ha-risposto'].input_tokens === 1234)

  await run(server)
  const row2 = server.quota.rows.get(`utente-a|${day1}`)
  check('seconda chiamata: i token si sommano e le chiamate con usage sono 2', row2.usageCalls === 2 && row2.input === 2468 && row2.output === 112 && row2.models['modello-che-ha-risposto'].calls === 2)

  const okLog = server.logs.find((e) => e.outcome === 'ok')
  check('log: solo numeri (tokensIn, tokensOut) e id del modello', okLog.tokensIn === 1234 && okLog.tokensOut === 56 && okLog.model === 'modello-che-ha-risposto' && okLog.usageRecorded === true)

  // Chiamata SENZA usage: la risposta arriva, niente numeri inventati.
  const noUsage = build(() => answer({ usage: undefined }))
  const nu = await run(noUsage)
  check('chiamata senza usage → risposta 200, quota consumata', nu.status === 200 && noUsage.quota.count('utente-a', day1) === 1)
  check('   NESSUN token inventato: niente registrazione', noUsage.quota.usageRows.length === 0 && noUsage.logs.find((e) => e.outcome === 'ok').noUsage === true)
  const r3 = noUsage.quota.rows.get(`utente-a|${day1}`)
  check('   si distingue: call_count 1, usage_calls 0 (chiamata da stimare, non fatturata nei numeri)', r3.calls === 1 && (r3.usageCalls ?? 0) === 0)
  for (const [label, usage] of [['negativo', { input_tokens: -1, output_tokens: 5 }], ['testo', { input_tokens: '12', output_tokens: 5 }], ['mancante', { input_tokens: 12 }], ['frazione', { input_tokens: 1.5, output_tokens: 5 }]]) {
    const odd = build(() => answer({ usage }))
    await run(odd)
    check(`usage non valido (${label}) → trattato come "senza usage"`, odd.quota.usageRows.length === 0)
  }

  // La misura non deve mai rompere la risposta.
  const broken = build(() => answer())
  broken.quota.recordUsage = async () => { throw new Error('db giù') }
  const bres = await run(broken)
  check('registrazione fallita → la risposta all\'utente è la stessa (200)', bres.status === 200)
  check('   la chiamata resta nella quota e il log dice usageRecorded false', broken.quota.count('utente-a', day1) === 1 && broken.logs.find((e) => e.outcome === 'ok').usageRecorded === false)
  const noRecorder = createSpendyAIHandler({ config: readConfig((n) => ENV[n]), verifyUser: async () => ({ id: 'utente-a', emailConfirmed: true }), callModel: async () => ({ text: JSON.stringify(okAnswer), stopReason: 'end_turn', model: 'm', usage: { inputTokens: 1, outputTokens: 1 } }), quota: { reserve: async () => ({ allowed: true, reason: null }), release: async () => {} }, now: () => DAY1 })
  check('una quota senza recordUsage (versione vecchia dell\'adattatore) non rompe niente', (await noRecorder(post({ context }))).status === 200)

  // Il modello ha risposto ma la risposta non serve: i token sono stati fatturati.
  const refusal = build(() => answer({ stop_reason: 'refusal', content: [] }))
  await run(refusal)
  check('rifiuto del modello: i token fatturati vengono comunque registrati', refusal.quota.usageRows.length === 1 && refusal.quota.count('utente-a', day1) === 1)
  const garbage = build(() => answer({ content: [{ type: 'text', text: 'non è json' }] }))
  const g = await run(garbage)
  check('risposta scartata (422): i token fatturati vengono comunque registrati', g.status === 422 && garbage.quota.usageRows.length === 1)

  // Errori del provider: nessuna risposta, nessun usage.
  const failing = build(() => { throw Object.assign(new Error('x'), { status: 500 }) })
  await run(failing)
  check('5xx → nessun usage registrato, quota consumata', failing.quota.usageRows.length === 0 && failing.quota.count('utente-a', day1) === 1)
  const refunded = build(() => { throw Object.assign(new Error('x'), { status: 429 }) })
  await run(refunded)
  check('429 del provider → nessun usage, quota restituita (comportamento invariato)', refunded.quota.usageRows.length === 0 && refunded.quota.count('utente-a', day1) === 0)

  // Niente di sensibile nei log né nei dati registrati.
  const sensitive = build(() => answer())
  await run(sensitive)
  const dump = JSON.stringify([sensitive.logs, sensitive.quota.usageRows])
  check('nei log e nei dati registrati: niente testo, importi, utente, chiave', !/Ristorante|160|1840|ironic|Ciclo speciale|utente-a|sk-segreto/.test(JSON.stringify(sensitive.logs)))
  check('   i dati registrati sono solo numeri e l\'id del modello', sensitive.quota.usageRows.every((r) => Object.keys(r).sort().join() === 'day,inputTokens,model,outputTokens,userId' && Number.isInteger(r.inputTokens) && Number.isInteger(r.outputTokens)))
  void dump

  // Database non disponibile: nessuna chiamata al modello, anche con i nuovi limiti.
  let modelCalled = 0
  const down = createSpendyAIHandler({
    config: readConfig((n) => ENV[n]), verifyUser: async () => ({ id: 'utente-a', emailConfirmed: true }),
    callModel: async () => { modelCalled += 1; return { text: '{}', stopReason: 'end_turn', model: 'm' } },
    quota: { reserve: async () => { throw new Error('quota_rpc_500') }, release: async () => {}, recordUsage: async () => {} },
  })
  const downRes = await down(post({ context }))
  check('database non disponibile (nuova prenotazione) → 503 e nessuna chiamata al modello', downRes.status === 503 && modelCalled === 0)

  // Adattatore Supabase: record usage
  const sent = []
  const quota = createSupabaseQuota({
    supabaseUrl: 'https://progetto.supabase.co', serviceKey: 'eyJservice.role.jwt',
    fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }) },
  })
  await quota.recordUsage({ userId: 'utente-a', day: '2026-09-29', model: 'modello-x', inputTokens: 10, outputTokens: 2 })
  check('record usage → /rest/v1/rpc/spendy_ai_record_usage', sent[0].url === 'https://progetto.supabase.co/rest/v1/rpc/spendy_ai_record_usage')
  check('   argomenti: utente, giorno, modello, token (solo numeri)', JSON.stringify(sent[0].body) === '{"p_user_id":"utente-a","p_usage_date":"2026-09-29","p_model":"modello-x","p_input_tokens":10,"p_output_tokens":2}')
  const unknownReason = createSupabaseQuota({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'k', fetchImpl: async () => new Response('[{"allowed":false,"reason":"boh","daily_used":1}]', { status: 200 }) })
  const ur = await unknownReason.reserve({ userId: 'u', day: '2026-09-29', limits: { daily: 3, monthly: 30, global: 300 } })
  check('rifiuto con motivo sconosciuto → resta un rifiuto', ur.allowed === false && ur.reason === 'daily')
}

// =====================================================================
section('SQL: versione 2 (supabase/ai_usage.sql)')
// =====================================================================
{
  const raw = readFileSync(new URL('../../supabase/ai_usage.sql', import.meta.url), 'utf8')
  const code = raw.toLowerCase().split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  check('la funzione precedente è ancora intatta (compatibilità e rollback)',
    code.includes('create or replace function public.spendy_ai_reserve(p_user_id uuid, p_usage_date date, p_limit integer)')
    && code.includes('where u.call_count < p_limit') && code.includes('create or replace function public.spendy_ai_release(p_user_id uuid, p_usage_date date)'))
  check('   e i suoi permessi non sono cambiati', code.includes('grant execute on function public.spendy_ai_reserve(uuid, date, integer) to service_role'))
  check('spendy_ai_reserve_v2 esiste con i tre limiti', /create or replace function public\.spendy_ai_reserve_v2\(\s*p_user_id uuid,\s*p_usage_date date,\s*p_daily_limit integer,\s*p_monthly_limit integer,\s*p_global_daily_limit integer\s*\)/.test(code))
  check('   restituisce allowed e il motivo del rifiuto', /returns table \(allowed boolean, reason text,/.test(code) && ['\'daily\'', '\'monthly\'', '\'global\''].every((r) => code.includes(`${r}::text`)))
  check('   serializza le prenotazioni con un lock di transazione (concorrenza)', code.includes('pg_advisory_xact_lock('))
  check('   il lock viene preso PRIMA di leggere i contatori', code.indexOf('pg_advisory_xact_lock(') < code.indexOf('select coalesce(sum(u.call_count), 0)::integer into v_global'))
  check('   il mese deriva dalle righe di ai_usage (somma per utente nel mese di calendario)', /select coalesce\(sum\(u\.call_count\), 0\)::integer into v_monthly[\s\S]*?u\.usage_date >= v_first and u\.usage_date < v_next/.test(code))
  check('   il globale è la somma di TUTTI gli utenti nella giornata', /into v_global\s+from public\.ai_usage u\s+where u\.usage_date = p_usage_date/.test(code))
  check('   il mese è in aritmetica di date, senza fusi orari (niente date_trunc su date)', !code.includes('date_trunc(') && code.includes('extract(day from p_usage_date)'))
  check('   i tre controlli rifiutano, ciascuno con il suo motivo e senza toccare niente',
    /if v_daily >= p_daily_limit then\s+return query select false, 'daily'::text[^;]*;\s+return;/.test(code)
    && /if v_monthly >= p_monthly_limit then\s+return query select false, 'monthly'::text[^;]*;\s+return;/.test(code)
    && /if v_global >= p_global_daily_limit then\s+return query select false, 'global'::text[^;]*;\s+return;/.test(code))
  check('   l\'incremento è dopo i tre controlli', code.indexOf('v_monthly >= p_monthly_limit') < code.indexOf('on conflict (user_id, usage_date) do update\n    set call_count = u.call_count + 1,\n        updated_at = now();'))
  check('   argomenti non validi → eccezione (limiti < 1, nulli)', /p_daily_limit < 1/.test(code) && /p_monthly_limit < 1/.test(code) && /p_global_daily_limit < 1/.test(code))
  check('colonne nuove aggiunte in modo idempotente', ['input_tokens  bigint', 'output_tokens bigint', 'usage_calls   integer', 'models        jsonb'].every((c) => code.includes(`add column if not exists ${c}`)))
  check('   mai negativi (vincolo, creato solo se manca)', code.includes('ai_usage_usage_nonnegative') && code.includes('input_tokens >= 0 and output_tokens >= 0 and usage_calls >= 0'))
  check('   indice sulla giornata, idempotente', code.includes('create index if not exists ai_usage_usage_date_idx on public.ai_usage (usage_date)'))
  check('nessuna colonna per testo, prompt, risposte, email o importi: solo numeri e id del modello',
    !/\b(prompt|response|message|email|amount|description)\b/.test(code.slice(code.indexOf('add column if not exists input_tokens'), code.indexOf('revoke all on function public.spendy_ai_reserve_v2'))
      .replace(/p_user_id|user_id/g, '')))
  check('spendy_ai_record_usage: solo numeri e modello, ripulito e accorciato, con tetto sui valori',
    code.includes('create or replace function public.spendy_ai_record_usage(') && code.includes("[^a-za-z0-9._:/-]") && code.includes('left(') && code.includes('p_input_tokens > 100000000'))
  check('   aggiorna token, usage_calls e il dettaglio per modello', code.includes('usage_calls   = u.usage_calls + 1') && code.includes('jsonb_set('))
  check('nessuna funzione security definer (nemmeno le nuove)', !code.includes('security definer'))
  check('le funzioni nuove non sono eseguibili dall\'app', code.includes('revoke all on function public.spendy_ai_reserve_v2(uuid, date, integer, integer, integer) from public, anon, authenticated')
    && code.includes('revoke all on function public.spendy_ai_record_usage(uuid, date, text, bigint, bigint) from public, anon, authenticated'))
  check('   solo la service_role può eseguirle', code.includes('grant execute on function public.spendy_ai_reserve_v2(uuid, date, integer, integer, integer) to service_role')
    && code.includes('grant execute on function public.spendy_ai_record_usage(uuid, date, text, bigint, bigint) to service_role'))
  check('la tabella resta protetta (RLS, nessuna scrittura per l\'app)', code.includes('enable row level security') && code.includes('revoke insert, update, delete, truncate on public.ai_usage from anon, authenticated'))
  check('la funzione Edge chiama la v2 e la funzione di registrazione, non la vecchia prenotazione', (() => {
    const quotaJs = readFileSync(new URL('../../supabase/functions/spendy-ai/quota.js', import.meta.url), 'utf8')
    return quotaJs.includes("rpc('spendy_ai_reserve_v2'") && quotaJs.includes("rpc('spendy_ai_record_usage'") && !quotaJs.includes("rpc('spendy_ai_reserve',")
  })())
}

// =====================================================================
section('App: i tre limiti del server, senza consumare niente in locale')
// =====================================================================
{
  const provider = (status, body) => createRemoteProvider({
    url: URL_FN, publicKey: 'pk', getAccessToken: async () => 'token-a',
    fetchImpl: async () => new Response(JSON.stringify(body), { status }),
  })
  const run = (status, body) => createSpendyAI({ provider: provider(status, body) }).generate(context)
  check('stessi codici di app e server', MONTHLY_LIMIT_ERROR === AI_MONTHLY_LIMIT_REACHED && GLOBAL_LIMIT_ERROR === AI_GLOBAL_LIMIT_REACHED)
  check('429 AI_MONTHLY_LIMIT_REACHED → monthly_limit', (await run(429, { error: AI_MONTHLY_LIMIT_REACHED })).error === 'monthly_limit')
  check('429 AI_GLOBAL_LIMIT_REACHED → global_limit', (await run(429, { error: AI_GLOBAL_LIMIT_REACHED })).error === 'global_limit')
  check('429 AI_DAILY_LIMIT_REACHED → daily_limit (invariato)', (await run(429, { error: AI_DAILY_LIMIT_REACHED })).error === 'daily_limit')
  check('429 del provider → rate_limited (invariato)', (await run(429, { error: 'rate_limited' })).error === 'rate_limited')
  check('403 email_not_confirmed → trattato come non autenticato (nessun costo, frase locale)', (await run(403, { error: 'email_not_confirmed' })).error === 'unauthenticated')

  for (const [name, code] of [['mensile', AI_MONTHLY_LIMIT_REACHED], ['globale', AI_GLOBAL_LIMIT_REACHED]]) {
    const ai = createSpendyAI({ provider: provider(429, { error: code }) })
    const meta = { fingerprint: 'f-2', eventKey: 'category_above_usual:ristoranti', importance: 60 }
    const { cache, result } = await requestSpendyVoice({ ai, context, meta, cache: emptyVoiceCache(), today: '2026-09-29', now: DAY1 })
    check(`limite ${name} del server: nessuna chiamata contata in locale`, result.error === (name === 'mensile' ? 'monthly_limit' : 'global_limit') && (cache.calls?.count ?? 0) === 0)
    check('   la situazione resta sulla frase locale', cache.failure?.error === result.error && cache.failure?.fingerprint === 'f-2')
  }
}

report('Spendy AI (quota server)')
