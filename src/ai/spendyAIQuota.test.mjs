// Test della quota giornaliera di Spendy AI, lato server.
// `npm test`, senza rete: l'handler della Edge Function gira qui in Node,
// il "modello" è una funzione finta che conta le chiamate, e la tabella
// ai_usage è una Map che applica le stesse regole delle due funzioni SQL
// di supabase/ai_usage.sql (prenotazione atomica, rilascio mai sotto zero).
//
// Semantica verificata qui (vedi quota.js):
//   - conta una richiesta che la funzione AUTORIZZA a raggiungere il modello;
//   - non contano: non autenticati, corpo non valido, nessun evento;
//   - provider che non risponde (timeout, 5xx, rate limit, rete) → la
//     chiamata viene restituita; risposta del modello rifiutata o scartata
//     → resta consumata (il costo c'è stato);
//   - database della quota non raggiungibile → nessuna chiamata (fail closed).

import { readFileSync } from 'node:fs'
import { check, section, report } from '../sync/testkit.mjs'
import { createSpendyAIHandler, readConfig, ModelError } from '../../supabase/functions/spendy-ai/handler.js'
import {
  AI_DAILY_LIMIT, AI_DAILY_LIMIT_REACHED, usageDay, createSupabaseQuota, supabaseServiceKey,
} from '../../supabase/functions/spendy-ai/quota.js'
import { createRemoteProvider, functionsUrl, DAILY_LIMIT_ERROR } from './providers/remoteProvider.js'
import { createSpendyAI } from './spendyAI.js'
import { requestSpendyVoice } from './spendyVoicePolicy.js'
import { emptyVoiceCache } from './spendyVoiceCache.js'

const URL_FN = functionsUrl('https://progetto.supabase.co')
const ENV = { AI_PROVIDER: 'anthropic', AI_MODEL: 'modello-configurato', AI_API_KEY: 'sk-segreto-lato-server' }
const TOKENS = { 'token-a': 'utente-a', 'token-b': 'utente-b' }
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
// controllo e incremento avvengono nello stesso passo, dopo la "rete".
function memoryQuota() {
  const rows = new Map()
  const key = (userId, day) => `${userId}|${day}`
  const ops = []
  return {
    rows,
    ops,
    count: (userId, day) => rows.get(key(userId, day)) ?? 0,
    async reserve({ userId, day, limit }) {
      ops.push({ op: 'reserve', userId, day, limit })
      await tick()
      const current = rows.get(key(userId, day)) ?? 0
      if (current >= limit) return { allowed: false, used: current }
      rows.set(key(userId, day), current + 1)
      return { allowed: true, used: current + 1 }
    },
    async release({ userId, day }) {
      ops.push({ op: 'release', userId, day })
      await tick()
      rows.set(key(userId, day), Math.max((rows.get(key(userId, day)) ?? 0) - 1, 0))
    },
  }
}

// Controllo del test di concorrenza: la versione SBAGLIATA (legge, poi
// scrive in un secondo momento). Deve sforare, altrimenti il test non
// saprebbe distinguere un'implementazione atomica da una che non lo è.
function naiveQuota() {
  const rows = new Map()
  return {
    async reserve({ userId, day, limit }) {
      const current = rows.get(`${userId}|${day}`) ?? 0
      await tick()
      if (current >= limit) return { allowed: false, used: current }
      rows.set(`${userId}|${day}`, current + 1)
      return { allowed: true, used: current + 1 }
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

function makeServer({ quota = memoryQuota(), model = fakeModel(), clock = { now: DAY1 } } = {}) {
  const logs = []
  const handler = createSpendyAIHandler({
    config: readConfig((name) => ENV[name]),
    verifyUser: async (token) => (TOKENS[token] ? { id: TOKENS[token] } : null),
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
section('Quota: errori del provider')
// =====================================================================
{
  // Policy: se il provider NON risponde, la chiamata torna all'utente.
  for (const code of ['timeout', 'rate_limited', 'overloaded', 'provider_error']) {
    const server = makeServer({ model: fakeModel(() => { throw new ModelError(code) }) })
    const res = await call(server)
    check(`10. provider "${code}" → errore del provider, quota restituita`,
      res.body.error === code && res.body.error !== AI_DAILY_LIMIT_REACHED && server.quota.count('utente-a', day1) === 0)
  }

  let failing = true
  const flaky = makeServer({ model: fakeModel(() => {
    if (failing) throw new ModelError('overloaded')
    return { text: JSON.stringify(okAnswer), stopReason: 'end_turn', model: 'm' }
  }) })
  for (let i = 0; i < 5; i += 1) await call(flaky)
  check('   5 errori temporanei non bruciano nessuna delle 3 chiamate', flaky.quota.count('utente-a', day1) === 0)
  failing = false
  const after = await Promise.all([call(flaky), call(flaky), call(flaky)])
  check('   dopo, l\'utente ha ancora tutte e 3 le chiamate', after.every((r) => r.status === 200) && (await call(flaky)).status === 429)
  check('   nei log: quota restituita', flaky.logs.some((entry) => entry.outcome === 'overloaded' && entry.quotaReleased === true))

  const unknownError = makeServer({ model: fakeModel(() => { throw new Error('boom') }) })
  await call(unknownError)
  check('   errore imprevisto del provider → quota restituita', unknownError.quota.count('utente-a', day1) === 0)

  const refusal = makeServer({ model: fakeModel(() => ({ text: '', stopReason: 'refusal', model: 'm' })) })
  await call(refusal)
  check('   il modello ha risposto ma ha rifiutato → la chiamata conta', refusal.quota.count('utente-a', day1) === 1)
  const garbage = makeServer({ model: fakeModel(() => ({ text: 'non è json', stopReason: 'end_turn', model: 'm' })) })
  const g = await call(garbage)
  check('   risposta del modello scartata (422) → la chiamata conta', g.status === 422 && garbage.quota.count('utente-a', day1) === 1)

  const releaseBroken = memoryQuota()
  releaseBroken.release = async () => { throw new Error('db giù') }
  const stuck = makeServer({ quota: releaseBroken, model: fakeModel(() => { throw new ModelError('timeout') }) })
  const s = await call(stuck)
  check('   se anche il rilascio fallisce: resta consumata (mai sotto il vero uso)',
    s.body.error === 'timeout' && releaseBroken.count('utente-a', day1) === 1)
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
  const responses = [[{ allowed: true, used: 1 }], [{ allowed: false, used: 3 }], null]
  const quota = createSupabaseQuota({
    supabaseUrl: 'https://progetto.supabase.co/',
    serviceKey: 'eyJservice.role.jwt',
    fetchImpl: async (url, init) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body) })
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    },
  })
  const r1 = await quota.reserve({ userId: 'utente-a', day: '2026-09-29', limit: 3 })
  const r2 = await quota.reserve({ userId: 'utente-a', day: '2026-09-29', limit: 3 })
  await quota.release({ userId: 'utente-a', day: '2026-09-29' })
  check('prenotazione → /rest/v1/rpc/spendy_ai_reserve', sent[0].url === 'https://progetto.supabase.co/rest/v1/rpc/spendy_ai_reserve')
  check('   argomenti: utente verificato, giorno, limite', JSON.stringify(sent[0].body) === '{"p_user_id":"utente-a","p_usage_date":"2026-09-29","p_limit":3}')
  check('   esito letto dalla risposta', r1.allowed === true && r1.used === 1 && r2.allowed === false && r2.used === 3)
  check('rilascio → /rest/v1/rpc/spendy_ai_release', sent[2].url.endsWith('/rest/v1/rpc/spendy_ai_release'))
  check('si presenta con la service_role, non con il token dell\'utente',
    sent.every((s) => s.headers.apikey === 'eyJservice.role.jwt' && s.headers.Authorization === 'Bearer eyJservice.role.jwt'))

  const secret = []
  const newKeys = createSupabaseQuota({
    supabaseUrl: 'https://progetto.supabase.co',
    serviceKey: 'sb_secret_test',
    fetchImpl: async (url, init) => { secret.push(init.headers); return new Response('[{"allowed":true,"used":1}]', { status: 200 }) },
  })
  await newKeys.reserve({ userId: 'u', day: '2026-09-29', limit: 3 })
  check('nuove chiavi segrete: solo apikey, nessun Bearer', secret[0].apikey === 'sb_secret_test' && !('Authorization' in secret[0]))

  const failing = createSupabaseQuota({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'k', fetchImpl: async () => new Response('{}', { status: 500 }) })
  check('database in errore → l\'adattatore lancia (fail closed)', await failing.reserve({ userId: 'u', day: 'd', limit: 3 }).then(() => false, () => true))
  const weird = createSupabaseQuota({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'k', fetchImpl: async () => new Response('[]', { status: 200 }) })
  check('risposta senza esito → lancia, non consente', await weird.reserve({ userId: 'u', day: 'd', limit: 3 }).then(() => false, () => true))

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

report('Spendy AI (quota server)')
