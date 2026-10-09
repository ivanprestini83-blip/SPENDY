// Fase 4B-3: Spendy AI risponde nella lingua scelta nell'app.
// `npm test`, senza rete e senza chiamate a pagamento: l'handler della Edge
// Function gira qui in Node, il "modello" è una funzione finta che risponde
// nella lingua chiesta, la quota è in memoria (come in spendyAIQuota.test).
//
// Verificato qui:
//   - il client manda la lingua dell'app (context.locale);
//   - il server accetta solo it / en / es / fr; mancante o non valida → it,
//     senza rompere la chiamata;
//   - il prompt chiede di rispondere SOLO in quella lingua, con esempi in quella lingua;
//   - la lingua non tocca consenso (AI_DISABLED), quota (3 al giorno) né modello;
//   - il guard di tono e tempo funziona anche in inglese, spagnolo e francese;
//   - una frase AI in cache in un'altra lingua non viene riproposta.

import { check, section, report } from '../sync/testkit.mjs'
import { createSpendyAIHandler, readConfig } from '../../supabase/functions/spendy-ai/handler.js'
import { AI_DAILY_LIMIT } from '../../supabase/functions/spendy-ai/quota.js'
import {
  SPENDY_LOCALES, DEFAULT_SPENDY_LOCALE, normalizeSpendyLocale, sanitizeSpendyContext, buildSpendyPrompt,
  STYLE_EXAMPLES, STYLE_EXAMPLES_BY_LOCALE, SPENDY_PERSONALITY, validateSpendyResponse, passesToneRules, contradictsCyclePhase,
} from '../../supabase/functions/_shared/spendyAIRules.js'
import { createRemoteProvider, functionsUrl } from './providers/remoteProvider.js'
import { buildSpendyAIContext } from './spendyAIContext.js'
import { decideSpendyVoice } from './spendyVoicePolicy.js'
import { emptyVoiceCache } from './spendyVoiceCache.js'
import { LANGUAGE_CODES } from '../i18n/languages.js'

const URL_FN = functionsUrl('https://progetto.supabase.co')
const ENV = { AI_PROVIDER: 'anthropic', AI_MODEL: 'modello-configurato', AI_API_KEY: 'sk-segreto-lato-server' }
const DAY1 = Date.parse('2026-09-29T10:00:00Z')

const baseContext = {
  version: 1, today: '2026-09-29',
  budget: { monthly: 2000, spent: 160, available: 1840, spentPercent: 8, daysRemaining: 11, band: 'ok', dailyAllowance: 167 },
  spending: { today: 0 },
  primaryEvent: { id: 'category_above_usual', importance: 60, category: 'Ristorante', cycle: { current: 160, usual: 55, difference: 105, changePercent: 191 } },
  otherEvents: [], goal: null, suggestedState: 'ironic',
}
const withLocale = (locale) => (locale === undefined ? { ...baseContext } : { ...baseContext, locale })

// La risposta del "modello" nella lingua che il prompt gli chiede.
const ANSWERS = {
  it: 'Ristorante a 160 €, la tua media è 55 €. Ciclo speciale?',
  en: 'Restaurants at 160 €, your usual is 55 €. Special cycle?',
  es: 'Restaurantes a 160 €, lo habitual son 55 €. ¿Ciclo especial?',
  fr: 'Restaurants à 160 €, d’habitude 55 €. Un cycle spécial ?',
}
const answer = (message) => ({ message, state: 'ironic', tone: 'playful', layout: 'left', animation: 'playful', priority: 60, shouldShow: true })
const localeOfPrompt = (system) => SPENDY_LOCALES.find((code) => system.includes(`context.locale = "${code}"`))

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function memoryQuota() {
  const rows = new Map()
  const ops = []
  return {
    ops,
    count: (userId, day) => rows.get(`${userId}|${day}`) ?? 0,
    async reserve({ userId, day, limits }) {
      ops.push({ op: 'reserve', userId, day, limits })
      await tick()
      const used = rows.get(`${userId}|${day}`) ?? 0
      if (used >= limits.daily) return { allowed: false, reason: 'daily', used }
      rows.set(`${userId}|${day}`, used + 1)
      return { allowed: true, reason: null, used: used + 1 }
    },
    async release({ userId, day }) {
      ops.push({ op: 'release', userId, day })
      rows.set(`${userId}|${day}`, Math.max((rows.get(`${userId}|${day}`) ?? 0) - 1, 0))
    },
    async recordUsage() {},
  }
}

// Il modello finto risponde nella lingua indicata dal prompt di sistema.
function fakeModel() {
  const calls = []
  const callModel = async (args) => {
    calls.push(args)
    await tick()
    const locale = localeOfPrompt(args.system) ?? 'it'
    return { text: JSON.stringify(answer(ANSWERS[locale])), stopReason: 'end_turn', model: 'm' }
  }
  return { callModel, calls }
}

function makeServer({ aiEnabled = true } = {}) {
  const quota = memoryQuota()
  const model = fakeModel()
  const handler = createSpendyAIHandler({
    aiPreference: async () => aiEnabled,
    config: readConfig((name) => ENV[name]),
    verifyUser: async (token) => (token === 'token-a' ? { id: 'utente-a', emailConfirmed: true } : null),
    callModel: model.callModel,
    quota,
    now: () => DAY1,
    log: () => {},
  })
  return { handler, quota, model }
}

function post(body) {
  return new Request(URL_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
    body: JSON.stringify(body),
  })
}
async function send(server, body) {
  const res = await server.handler(post(body))
  return { status: res.status, body: await res.json().catch(() => null) }
}

// ---------------------------------------------------------------------------
section('Lingue ammesse e validazione del locale (server)')
check('le lingue di Spendy AI sono esattamente quelle dell\'app', JSON.stringify(SPENDY_LOCALES) === JSON.stringify(LANGUAGE_CODES), SPENDY_LOCALES.join())
check('fallback: italiano', DEFAULT_SPENDY_LOCALE === 'it' && normalizeSpendyLocale(undefined) === 'it')
for (const locale of SPENDY_LOCALES) {
  check(`sanitize: "${locale}" resta "${locale}"`, sanitizeSpendyContext(withLocale(locale)).locale === locale)
}
check('sanitize: locale mancante → "it" (contesto comunque valido)', sanitizeSpendyContext(withLocale(undefined))?.locale === 'it')
for (const bad of ['de', 'EN', 'en-US', '', ' it', 42, null, true, { code: 'en' }, ['fr']]) {
  check(`sanitize: locale non valido ${JSON.stringify(bad)} → "it", contesto comunque valido`, sanitizeSpendyContext(withLocale(bad))?.locale === 'it')
}

// ---------------------------------------------------------------------------
section('Prompt: risposta solo nella lingua richiesta')
const LANGUAGE_WORD = { it: 'italiano', en: 'inglese', es: 'spagnolo', fr: 'francese' }
for (const locale of SPENDY_LOCALES) {
  const prompt = buildSpendyPrompt(sanitizeSpendyContext(withLocale(locale)))
  check(`${locale}: il prompt chiede di rispondere esclusivamente in ${LANGUAGE_WORD[locale]}`,
    prompt.system.includes(`Rispondi esclusivamente in ${LANGUAGE_WORD[locale]}`) && localeOfPrompt(prompt.system) === locale)
  check(`${locale}: personalità e regole di sempre (stesso testo di base)`, prompt.system.startsWith(SPENDY_PERSONALITY))
  check(`${locale}: esempi di stile nella stessa lingua`, JSON.stringify(prompt.input.styleExamples) === JSON.stringify(STYLE_EXAMPLES_BY_LOCALE[locale]))
  check(`${locale}: il contesto passato al modello dice la lingua`, prompt.input.context.locale === locale)
}
check('esempi: stesse dimensioni in ogni lingua, nessuna lingua con gli esempi italiani', SPENDY_LOCALES.every((l) => STYLE_EXAMPLES_BY_LOCALE[l].length === STYLE_EXAMPLES.length)
  && ['en', 'es', 'fr'].every((l) => STYLE_EXAMPLES_BY_LOCALE[l].every((example) => !STYLE_EXAMPLES.includes(example))))
check('italiano: gli esempi di sempre', STYLE_EXAMPLES_BY_LOCALE.it === STYLE_EXAMPLES)
check('prompt senza lingua → istruzioni italiane', localeOfPrompt(buildSpendyPrompt({ ...baseContext }).system) === 'it')
check('esempi passati esplicitamente: hanno ancora la precedenza', buildSpendyPrompt(withLocale('en'), { styleExamples: ['x'] }).input.styleExamples.join() === 'x')
check('gli esempi in altre lingue rispettano le regole di Spendy (tono, lunghezza)',
  ['en', 'es', 'fr'].every((l) => STYLE_EXAMPLES_BY_LOCALE[l].every((e) => passesToneRules(e) && e.length <= 220)))

// ---------------------------------------------------------------------------
section('1–4. Edge Function: la risposta nella lingua scelta (modello finto)')
for (const locale of SPENDY_LOCALES) {
  const server = makeServer()
  const res = await send(server, { context: withLocale(locale) })
  const call = server.model.calls[0]
  check(`${locale}: 200, risposta in ${LANGUAGE_WORD[locale]}`, res.status === 200 && res.body?.response?.message === ANSWERS[locale], JSON.stringify(res.body))
  check(`   ${locale}: il modello ha ricevuto la lingua nel prompt e nel contesto`, localeOfPrompt(call?.system) === locale && call?.input?.context?.locale === locale)
  check(`   ${locale}: una sola prenotazione della quota, nessun rilascio`, server.quota.ops.filter((o) => o.op === 'reserve').length === 1 && !server.quota.ops.some((o) => o.op === 'release'))
}

section('5–6. Locale mancante o non valido: italiano, la chiamata funziona')
for (const [label, locale] of [['mancante', undefined], ['"de"', 'de'], ['"EN"', 'EN'], ['numero', 7], ['oggetto', { locale: 'fr' }]]) {
  const server = makeServer()
  const res = await send(server, { context: withLocale(locale) })
  check(`locale ${label}: 200, risposta italiana, prompt italiano`, res.status === 200 && res.body?.response?.message === ANSWERS.it
    && localeOfPrompt(server.model.calls[0]?.system) === 'it' && server.model.calls[0]?.input?.context?.locale === 'it', JSON.stringify(res.body))
}

section('7. Consenso spento: AI_DISABLED in ogni lingua')
for (const locale of [...SPENDY_LOCALES, 'de', undefined]) {
  const server = makeServer({ aiEnabled: false })
  const res = await send(server, { context: withLocale(locale) })
  check(`${locale ?? 'mancante'}: 403 AI_DISABLED, niente modello, niente quota`, res.status === 403 && res.body?.code === 'AI_DISABLED'
    && server.model.calls.length === 0 && server.quota.ops.length === 0, JSON.stringify(res.body))
}

section('8. Quota giornaliera invariata: la lingua non dà chiamate in più')
{
  const server = makeServer()
  check('limite giornaliero: sempre 3', AI_DAILY_LIMIT === 3)
  const results = []
  for (const locale of ['it', 'en', 'es', 'fr', 'de', undefined]) results.push(await send(server, { context: withLocale(locale) }))
  check('3 chiamate servite (it, en, es), poi 429 per fr, "de" e senza lingua', results.slice(0, 3).every((r) => r.status === 200) && results.slice(3).every((r) => r.status === 429), results.map((r) => r.status).join())
  check('il modello è stato chiamato solo 3 volte', server.model.calls.length === 3)
  check('ogni prenotazione usa il limite giornaliero di 3, qualunque sia la lingua', server.quota.ops.filter((o) => o.op === 'reserve').every((o) => o.limits.daily === 3) && server.quota.count('utente-a', '2026-09-29') === 3)
}

// ---------------------------------------------------------------------------
section('Guard: tono e tempo anche in inglese, spagnolo e francese')
const ctx = (locale, cyclePhase = 'mid') => sanitizeSpendyContext({ ...withLocale(locale), budget: { ...baseContext.budget, cyclePhase, dayOfCycle: 15, cycleDays: 30 } })
const verdict = (message, locale, phase) => validateSpendyResponse(answer(message), ctx(locale, phase))
for (const locale of SPENDY_LOCALES) {
  check(`${locale}: la risposta normale passa`, verdict(ANSWERS[locale], locale).valid === true, JSON.stringify(verdict(ANSWERS[locale], locale).errors))
}
const REJECTED = [
  ['en', 'You should invest the 55 € in crypto.', 'risky_advice'],
  ['en', 'Another loan for the restaurant?', 'risky_advice'],
  ['en', 'What a disaster, you should feel ashamed.', 'offensive_or_judgmental'],
  ['en', 'Only a stupid move at 160 €.', 'offensive_or_judgmental'],
  ['es', 'Deberías invertir esos 55 € en bolsa.', 'risky_advice'],
  ['es', '¿Una apuesta con 160 €?', 'risky_advice'],
  ['es', 'Qué desastre, deberías sentirte mal.', 'offensive_or_judgmental'],
  ['es', 'Eres un idiota con 160 €.', 'offensive_or_judgmental'],
  ['fr', 'Investissez ces 55 € en bourse.', 'risky_advice'],
  ['fr', 'Un emprunt pour le restaurant ?', 'risky_advice'],
  ['fr', 'Quel désastre, c’est ta faute.', 'offensive_or_judgmental'],
  ['fr', 'Vraiment stupide, 160 €.', 'offensive_or_judgmental'],
]
for (const [locale, message, error] of REJECTED) {
  const result = verdict(message, locale)
  check(`${locale}: rifiutata (${error}): "${message}"`, result.valid === false && result.errors.includes(error), JSON.stringify(result.errors))
}
const PHASE = [
  ['en', 'last_day', 'Still a long way to go, 160 € at the restaurant.'],
  ['en', 'last_day', '1840 € for the next few days.'],
  ['en', 'start', 'Last days of the cycle: 160 € at the restaurant.'],
  ['en', 'mid', 'The cycle has just started and already 160 €.'],
  ['es', 'last_day', 'Todavía queda mucho, 160 € en restaurantes.'],
  ['es', 'start', 'Últimos días del ciclo: 160 € en restaurantes.'],
  ['fr', 'last_day', 'Encore un long chemin, 160 € au restaurant.'],
  ['fr', 'start', 'Derniers jours du cycle : 160 € au restaurant.'],
  ['fr', 'second_half', 'Le cycle vient de commencer et déjà 160 €.'],
]
for (const [locale, phase, message] of PHASE) {
  check(`${locale} (${phase}): contraddice la fase del ciclo → rifiutata`, contradictsCyclePhase(message, phase) && verdict(message, locale, phase).errors.includes('incoherent_cycle_phase'), JSON.stringify(verdict(message, locale, phase).errors))
}
check('stesse frasi nella fase giusta: nessuna contraddizione', !contradictsCyclePhase('Last days of the cycle: 160 € at the restaurant.', 'last_day') && !contradictsCyclePhase('Le cycle vient de commencer et déjà 160 €.', 'start'))
check('italiano: le regole di sempre', !passesToneRules('Dovresti investire in borsa') && passesToneRules(ANSWERS.it) && contradictsCyclePhase('La strada è ancora lunga', 'last_day'))
check('parole innocue con lettere accentate non fanno scattare il guard', passesToneRules('Café, pâtisserie et dîner : 160 €.') && passesToneRules('Cena en el restaurante, 160 €.') && passesToneRules('Dinner at the restaurant, 160 €.'))

// ---------------------------------------------------------------------------
section('Client: il contesto porta la lingua dell\'app')
const TODAY = '2026-09-29'
const coach = { state: 'ironic', reason: 'category_above_usual' }
const events = [{ id: 'category_above_usual', key: 'category_above_usual:ristorante', importance: 60, categoryId: 'ristorante', insight: { current: 160, baseline: 55 } }]
const financialData = { monthlyBudget: 2000, available: 1840, spentRatio: 0.08, spentThisMonth: 160 }
const built = (locale) => buildSpendyAIContext({ events, coach, financialData, expenses: [], today: TODAY, cycleStartDay: 1, goals: [], locale })
for (const locale of SPENDY_LOCALES) check(`buildSpendyAIContext: lingua "${locale}" → context.locale "${locale}"`, built(locale).context.locale === locale)
check('buildSpendyAIContext: senza lingua o con una lingua sconosciuta → "it"', built(undefined).context.locale === 'it' && built('de').context.locale === 'it')
check('stessa situazione in un\'altra lingua: stessa impronta (cooldown dell\'evento invariato)', built('it').meta.fingerprint === built('en').meta.fingerprint)
check('   ma "fatti" diversi: la lingua fa parte di ciò che l\'AI ha ricevuto', built('it').meta.facts !== built('en').meta.facts)
{
  const it = built('it').meta
  const cache = { ...emptyVoiceCache(), current: { fingerprint: it.fingerprint, facts: it.facts, day: TODAY, voice: { message: ANSWERS.it } } }
  const decide = (meta) => decideSpendyVoice({ coach, meta, today: TODAY, cache })
  check('frase AI italiana in cache, app ancora in italiano: si riusa (nessuna chiamata)', decide(it).action === 'cache')
  const en = decide(built('en').meta)
  check('frase AI italiana in cache, app passata all\'inglese: non si ripropone (stale_facts → frase locale, nessuna chiamata)', en.action === 'local' && en.reason === 'stale_facts', JSON.stringify(en))
}

section('Client → server: remoteProvider manda la lingua')
for (const locale of [...SPENDY_LOCALES, 'de']) {
  const sent = []
  const provider = createRemoteProvider({
    url: URL_FN, publicKey: 'chiave-pubblica', getAccessToken: async () => 'token-a',
    fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ response: answer(ANSWERS.it) }), { status: 200 }) },
  })
  await provider.generate(built(locale).context)
  const expected = locale === 'de' ? 'it' : locale
  check(`app in "${locale}": la richiesta porta locale "${expected}"`, sent[0]?.context?.locale === expected, JSON.stringify(sent[0]?.context?.locale))
}

report('Spendy AI multilingua — Fase 4B-3')
