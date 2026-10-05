// Spendy AI — la scelta dell'utente fatta rispettare dal SERVER. `npm test`.
//
// La funzione spendy-ai legge profiles.spendy_ai_enabled per l'utente
// verificato (preference.js, con la service_role) PRIMA di toccare quota e
// modello. Qui il lettore vero gira contro una finta API REST di Supabase:
// nessuna rete, nessun account reale.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, section, report } from '../sync/testkit.mjs'
import { createSpendyAIHandler, readConfig } from '../../supabase/functions/spendy-ai/handler.js'
import { createSupabaseAIPreference } from '../../supabase/functions/spendy-ai/preference.js'
import { createRemoteProvider, functionsUrl } from './providers/remoteProvider.js'
import { createSpendyAI } from './spendyAI.js'
import { requestSpendyVoice } from './spendyVoicePolicy.js'
import { emptyVoiceCache } from './spendyVoiceCache.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const URL_FN = functionsUrl('https://progetto.supabase.co')
const ENV = { AI_PROVIDER: 'anthropic', AI_MODEL: 'modello-configurato', AI_API_KEY: 'sk-segreto-lato-server' }
const TOKENS = { 'token-a': 'utente-a', 'token-b': 'utente-b', 'token-c': 'utente-c' }
const context = {
  version: 1, locale: 'it', today: '2026-09-29',
  budget: { monthly: 2000, spent: 160, available: 1840, spentPercent: 8, daysRemaining: 11, band: 'ok', dailyAllowance: 167 },
  spending: { today: 0 },
  primaryEvent: { id: 'category_above_usual', importance: 60, category: 'Ristorante', cycle: { current: 160, usual: 55, difference: 105, changePercent: 191 } },
  otherEvents: [], goal: null, suggestedState: 'ironic',
}
const okAnswer = { message: 'Ristorante a 160 €, la tua media è 55 €. Ciclo speciale?', state: 'ironic', tone: 'playful', layout: 'left', animation: 'playful', priority: 60, shouldShow: true }

// La tabella profiles vista dalla REST API di Supabase (service_role: nessuna RLS).
// utente-a: AI spenta · utente-b: accesa · utente-c: nessuna riga.
function fakeProfilesApi(profiles, { failWith = null } = {}) {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url, init })
    if (failWith) return { ok: false, status: failWith, json: async () => ({ message: 'errore' }) }
    const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(url)?.[1] ?? '')
    const row = profiles[id]
    return { ok: true, status: 200, json: async () => (row ? [{ spendy_ai_enabled: row.spendy_ai_enabled }] : []) }
  }
  return { fetchImpl, requests }
}

function makeServer({ profiles = { 'utente-a': { spendy_ai_enabled: false }, 'utente-b': { spendy_ai_enabled: true } }, failWith = null, withPreference = true } = {}) {
  const api = fakeProfilesApi(profiles, { failWith })
  const quotaOps = []
  const modelCalls = []
  const logs = []
  const handler = createSpendyAIHandler({
    config: readConfig((name) => ENV[name]),
    verifyUser: async (token) => (TOKENS[token] ? { id: TOKENS[token], emailConfirmed: true } : null),
    callModel: async (args) => { modelCalls.push(args); return { text: JSON.stringify(okAnswer), stopReason: 'end_turn', model: 'm', usage: { inputTokens: 10, outputTokens: 5 } } },
    quota: {
      reserve: async (args) => { quotaOps.push({ op: 'reserve', ...args }); return { allowed: true, reason: null, used: 1 } },
      release: async (args) => { quotaOps.push({ op: 'release', ...args }) },
      recordUsage: async (args) => { quotaOps.push({ op: 'recordUsage', ...args }) },
    },
    ...(withPreference ? { aiPreference: createSupabaseAIPreference({ supabaseUrl: 'https://progetto.supabase.co/', serviceKey: 'sb_secret_chiave-di-servizio', fetchImpl: api.fetchImpl }) } : {}),
    now: () => Date.parse('2026-09-29T10:00:00Z'),
    log: (entry) => logs.push(entry),
  })
  return { handler, api, quotaOps, modelCalls, logs }
}

const call = async (server, token, body = { context }) => {
  const res = await server.handler(new Request(URL_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }))
  return { status: res.status, body: await res.json() }
}

// =====================================================================
section('1–3. AI spenta: niente modello, niente quota, AI_DISABLED')
// =====================================================================
{
  const server = makeServer()
  const res = await call(server, 'token-a')
  check('3. risposta AI_DISABLED (403, ok:false)', res.status === 403 && res.body.ok === false && res.body.code === 'AI_DISABLED', JSON.stringify(res))
  check('1. Anthropic non viene chiamata', server.modelCalls.length === 0)
  check('2. la quota non viene toccata (nessuna prenotazione, nessun consumo)', server.quotaOps.length === 0)
  check('   nei log solo l\'esito', server.logs.some((l) => l.outcome === 'ai_disabled') && !JSON.stringify(server.logs).includes('utente-a'))
  check('   la preferenza è letta per l\'utente del TOKEN, con la chiave di servizio',
    server.api.requests.length === 1 && server.api.requests[0].url === 'https://progetto.supabase.co/rest/v1/profiles?select=spendy_ai_enabled&id=eq.utente-a&limit=1'
    && server.api.requests[0].init.headers.apikey === 'sb_secret_chiave-di-servizio')

  // Il client non può accenderla da sé, in nessuna forma.
  const forged = await call(server, 'token-a', { context, spendy_ai_enabled: true, spendyAIEnabled: true, aiEnabled: true, user_id: 'utente-b' })
  check('parametri del client (spendy_ai_enabled:true, user_id di B): ignorati', forged.status === 403 && forged.body.code === 'AI_DISABLED' && server.modelCalls.length === 0 && server.quotaOps.length === 0)
  check('   letta ancora e solo la riga di A', server.api.requests.every((r) => r.url.includes('id=eq.utente-a')))

  const silent = await call(server, 'token-a', { context: { ...context, primaryEvent: null } })
  check('anche senza evento: AI_DISABLED prima di tutto il resto', silent.status === 403 && silent.body.code === 'AI_DISABLED')
}

// =====================================================================
section('4. AI accesa: comportamento di prima')
// =====================================================================
{
  const server = makeServer()
  const res = await call(server, 'token-b')
  check('200 con la frase del modello', res.status === 200 && res.body.response?.message === okAnswer.message, JSON.stringify(res))
  check('   una prenotazione di quota, una chiamata al modello', server.quotaOps.filter((o) => o.op === 'reserve').length === 1 && server.modelCalls.length === 1)
  check('   quota prenotata per B', server.quotaOps[0]?.userId === 'utente-b')
  const reference = createSpendyAIHandler({
    config: readConfig((name) => ENV[name]),
    verifyUser: async () => ({ id: 'utente-b', emailConfirmed: true }),
    callModel: async () => ({ text: JSON.stringify(okAnswer), stopReason: 'end_turn', model: 'm', usage: { inputTokens: 10, outputTokens: 5 } }),
    quota: { reserve: async () => ({ allowed: true, reason: null, used: 1 }), release: async () => {}, recordUsage: async () => {} },
    aiPreference: async () => true,
    now: () => Date.parse('2026-09-29T10:00:00Z'),
  })
  const same = await (await reference(new Request(URL_FN, { method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify({ context }) }))).json()
  check('   stessa risposta di un utente con AI attiva qualsiasi', JSON.stringify(same) === JSON.stringify(res.body))
}

// =====================================================================
section('5. A spenta non influenza B accesa (e viceversa)')
// =====================================================================
{
  const server = makeServer()
  const a1 = await call(server, 'token-a')
  const b1 = await call(server, 'token-b')
  const a2 = await call(server, 'token-a')
  const b2 = await call(server, 'token-b')
  check('A sempre rifiutata, B sempre servita', [a1, a2].every((r) => r.body.code === 'AI_DISABLED') && [b1, b2].every((r) => r.status === 200))
  check('   la quota consumata è solo di B', server.quotaOps.filter((o) => o.op === 'reserve').every((o) => o.userId === 'utente-b') && server.quotaOps.filter((o) => o.op === 'reserve').length === 2)
  check('   due chiamate al modello, entrambe per B', server.modelCalls.length === 2)
}

// =====================================================================
section('6. Senza riga, senza valore o senza lettore: spenta')
// =====================================================================
{
  const noRow = makeServer()
  const res = await call(noRow, 'token-c')
  check('nessuna riga profiles: AI_DISABLED, niente quota né modello', res.body.code === 'AI_DISABLED' && noRow.quotaOps.length === 0 && noRow.modelCalls.length === 0)

  for (const value of [null, 'true', 1, undefined]) {
    const server = makeServer({ profiles: { 'utente-b': { spendy_ai_enabled: value } } })
    const r = await call(server, 'token-b')
    check(`valore ${JSON.stringify(value) ?? 'assente'}: spenta`, r.body.code === 'AI_DISABLED' && server.modelCalls.length === 0)
  }

  const unwired = makeServer({ withPreference: false })
  const r2 = await call(unwired, 'token-b')
  check('funzione senza lettore della preferenza: spenta (fail closed)', r2.body.code === 'AI_DISABLED' && unwired.modelCalls.length === 0 && unwired.quotaOps.length === 0)

  const down = makeServer({ failWith: 500 })
  const r3 = await call(down, 'token-b')
  check('database non raggiungibile: 503, niente quota né modello', r3.status === 503 && down.modelCalls.length === 0 && down.quotaOps.length === 0)
  const noColumn = makeServer({ failWith: 400 })
  const r4 = await call(noColumn, 'token-b')
  check('colonna non ancora creata (migration non eseguita): 503, niente modello', r4.status === 503 && noColumn.modelCalls.length === 0)
}

// =====================================================================
section('L\'app: AI_DISABLED dal server non conta una chiamata')
// =====================================================================
{
  const server = makeServer()
  const provider = createRemoteProvider({
    url: URL_FN,
    publicKey: 'sb_publishable_x',
    getAccessToken: async () => 'token-a',
    fetchImpl: (url, init) => server.handler(new Request(url, init)),
  })
  const ai = createSpendyAI({ provider, timeoutMs: 2000 })
  const cache = emptyVoiceCache()
  const meta = { fingerprint: 'f-1', eventKey: 'category_above_usual:ristoranti', importance: 60, facts: '{}' }
  const { cache: next, result } = await requestSpendyVoice({ ai, context, meta, cache, today: '2026-09-29', now: Date.parse('2026-09-29T10:00:00Z') })
  check('l\'app riceve un rifiuto, non una frase', result.ok === false)
  check('   nessuna chiamata contata nella giornata', next.calls.count === 0 && next.calls.day === null)
  check('   nessuna frase in cache, cronologia e facts invariati', next.current === null && next.history.length === 0)
  check('   e il modello non è mai stato raggiunto', server.modelCalls.length === 0 && server.quotaOps.length === 0)
}

// =====================================================================
section('Collegamento nella funzione deployata')
// =====================================================================
{
  const index = readFileSync(join(ROOT, 'supabase/functions/spendy-ai/index.ts'), 'utf8')
  check('index.ts passa aiPreference = createSupabaseAIPreference(...) con URL e chiave di servizio',
    /aiPreference: supabaseUrl && serviceKey \? createSupabaseAIPreference\(\{ supabaseUrl, serviceKey \}\) : null/.test(index))
  const handler = readFileSync(join(ROOT, 'supabase/functions/spendy-ai/handler.js'), 'utf8')
  const order = ['aiPreference(user.id)', 'request.text()', 'quota.reserve(', 'callModel({'].map((s) => handler.indexOf(s))
  check('nel codice: preferenza → corpo → quota → modello', order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), order.join(','))
}

// =====================================================================
section('Nessun segreto nel frontend')
// =====================================================================
{
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
  const sources = walk(join(ROOT, 'src')).filter((p) => ['.js', '.jsx'].includes(extname(p)) && !p.includes('.test.'))
  const leaks = sources.filter((p) => /sk-ant-[A-Za-z0-9_-]{8,}|AI_API_KEY|ANTHROPIC_API_KEY/.test(readFileSync(p, 'utf8')))
  check('sorgenti del frontend: nessuna chiave Anthropic né nome della variabile segreta', leaks.length === 0, leaks.join(','))
  const dist = join(ROOT, 'dist/assets')
  if (existsSync(dist)) {
    const bundle = readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, f), 'utf8')).join('\n')
    check('bundle: nessuna chiave Anthropic, nessuna chiave segreta Supabase', !/sk-ant-[A-Za-z0-9_-]{8,}/.test(bundle) && !/sb_secret_[A-Za-z0-9]{8,}/.test(bundle) && !/AI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(bundle))
  } else {
    check('bundle non presente: controllo rinviato a `npm run build`', true)
  }
}

report('Spendy AI: consenso lato server')
