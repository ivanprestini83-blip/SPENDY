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
//   - Fase 2B: gli importi della risposta si leggono con la grammatica della
//     sua lingua (1.794 / €1,794 / 1 794): niente importi inventati che
//     passano perché letti come numeri piccoli ("€1,234" → 1).

import { check, section, report } from '../sync/testkit.mjs'
import { createSpendyAIHandler, readConfig, logErrorCodes } from '../../supabase/functions/spendy-ai/handler.js'
import { AI_DAILY_LIMIT } from '../../supabase/functions/spendy-ai/quota.js'
import {
  SPENDY_LOCALES, DEFAULT_SPENDY_LOCALE, normalizeSpendyLocale, sanitizeSpendyContext, buildSpendyPrompt,
  STYLE_EXAMPLES, STYLE_EXAMPLES_BY_LOCALE, SPENDY_PERSONALITY, validateSpendyResponse, passesToneRules, contradictsCyclePhase,
  extractNumbers, allowedNumbers,
} from '../../supabase/functions/_shared/spendyAIRules.js'
import { validateAIResponse } from './spendyAIGuard.js'
import { createSpendyAI } from './spendyAI.js'
import { decideSpendyVoice, requestSpendyVoice } from './spendyVoicePolicy.js'
import { createRemoteProvider, functionsUrl } from './providers/remoteProvider.js'
import { buildSpendyAIContext } from './spendyAIContext.js'
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

// ---------------------------------------------------------------------------
// Fase 2B: importi nella grammatica della lingua della risposta.
//
// Contesto ESPLICITO: si conoscono tutti i numeri consentiti (controllati
// qui sotto). Ci sono di proposito numeri piccoli (1, 9, 10, 40, 60...): sono
// quelli in cui il vecchio parser faceva cadere "€1,234" (→ 1) o "€9,999"
// (→ 10). Ogni importo "accettato" è nel contesto per davvero.
const NB = '\u00a0' // spazio non separabile
const NN = '\u202f' // spazio stretto non separabile (migliaia in francese)
const amountsContext = (locale, { goal = null } = {}) => ({
  version: 1, locale, today: '2026-10-10',
  budget: { monthly: 3000, spent: 1206, available: 1794, spentPercent: 40, daysRemaining: 9, cyclePhase: 'second_half', dayOfCycle: 21, cycleDays: 30, band: 'ok', dailyAllowance: 179 },
  spending: { today: 250 },
  primaryEvent: { id: 'category_above_usual', importance: 60, category: 'Shopping', cycle: { current: 1794, usual: 900, difference: 894, changePercent: 99 } },
  otherEvents: [], goal, suggestedState: 'ironic',
})
const MILLION_GOAL = { label: 'Casa', percent: 12, missing: 1000000 }
const amountVerdict = (locale, message, options) => validateSpendyResponse(answer(message), amountsContext(locale, options))
const errorsOf = (locale, message, options) => amountVerdict(locale, message, options).errors ?? []
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

section('Fase 2B — il contesto dei test: numeri consentiti noti')
{
  const pool = [...allowedNumbers(amountsContext('en'))].sort((a, b) => a - b)
  check('consentiti: 1 9 10 21 30 40 60 99 179 250 894 900 1206 1794 2026 3000', same(pool, [1, 9, 10, 21, 30, 40, 60, 99, 179, 250, 894, 900, 1206, 1794, 2026, 3000]), pool.join(' '))
  check('   con l\'obiettivo: anche 12 e 1.000.000', allowedNumbers(amountsContext('en', { goal: MILLION_GOAL })).has(1000000) && !allowedNumbers(amountsContext('en')).has(1000000))
}

section('Fase 2B — formati corretti nelle quattro lingue')
{
  const CORRECT = {
    it: [['Restano 1.794 €, oggi 250 €.', [1794, 250]], ['Restano 1.794,50 € di 3.000 €.', [1795, 3000]], ['Restano 1794 € in tutto.', [1794]], ['Oggi 249,5 € di shopping.', [250]]],
    es: [['Quedan 1.794 €, hoy 250 €.', [1794, 250]], ['Quedan 1.794,50 € de 3.000 €.', [1795, 3000]], ['Quedan 1794 € en total.', [1794]], ['Hoy 249,5 € en compras.', [250]]],
    en: [['Still €1,794 left, €250 today.', [1794, 250]], ['Still €1,794.50 left out of €3,000.', [1795, 3000]], ['Still €1794 left overall.', [1794]], ['Today €249.5 on shopping.', [250]]],
    fr: [['Il reste 1 794 €, 250 € aujourd’hui.', [1794, 250]], [`Il reste 1${NB}794,50 € sur 3${NN}000 €.`, [1795, 3000]], [`Il reste 1${NN}794 € au total.`, [1794]], ['Il reste 1794 € au total.', [1794]], ['Aujourd’hui 249,5 € de shopping.', [250]]],
  }
  for (const [locale, cases] of Object.entries(CORRECT)) {
    for (const [message, expected] of cases) {
      const read = extractNumbers(message, locale)
      check(`${locale}: "${message}" → ${expected.join(', ')}, accettata`, same(read, expected) && amountVerdict(locale, message).valid, `${read.join(', ')} ${errorsOf(locale, message).join(',')}`)
    }
  }
  const million = { it: 'Mancano 1.000.000 € per "Casa".', es: 'Faltan 1.000.000 € para "Casa".', en: 'Still €1,000,000 to go for "Casa".', fr: `Il manque 1${NN}000${NN}000 € pour «Casa».` }
  for (const [locale, message] of Object.entries(million)) {
    check(`${locale}: oltre il milione ("${message}") → 1000000, accettata solo se è nel contesto`,
      same(extractNumbers(message, locale), [1000000]) && amountVerdict(locale, message, { goal: MILLION_GOAL }).valid && errorsOf(locale, message).includes('invented_numbers:1000000'))
  }
  check('fr: spazio normale, NBSP e NNBSP danno lo stesso numero', ['1 794 €', `1${NB}794 €`, `1${NN}794 €`].every((text) => same(extractNumbers(text, 'fr'), [1794])))
}

section('Fase 2B — importi inventati in formato inglese: bloccati')
{
  for (const [message, value] of [['You spent €1,234 on shopping.', 1234], ['You spent €9,999 on shopping.', 9999], ['You spent €40,000 on shopping.', 40000], ['You have €1,000,000 left.', 1000000]]) {
    const errors = errorsOf('en', message)
    check(`en: "${message}" → ${value}, rifiutata (invented_numbers:${value})`, same(extractNumbers(message, 'en'), [value]) && errors.includes(`invented_numbers:${value}`), errors.join(','))
    check(`   prima: letta come ${extractNumbers(message).join(', ')} (numeri consentiti) — il bypass che la Fase 2B chiude`, extractNumbers(message).every((n) => [...allowedNumbers(amountsContext('en'))].some((a) => Math.abs(a - n) <= 1)))
  }
  check('en: lo stesso importo vero passa (€1,794), uno vicino inventato no (€1,834)', amountVerdict('en', 'Still €1,794 left.').valid && errorsOf('en', 'Still €1,834 left.').includes('invented_numbers:1834'))
  check('it: "1.234 €" inventato resta rifiutato (come prima)', errorsOf('it', 'Hai 1.234 € da parte.').includes('invented_numbers:1234'))
  check('tolleranza invariata: ±1 dall\'importo vero (1.795 € e 1.793 € sì, 1.796 € no)', amountVerdict('it', 'Restano 1.795 €.').valid && amountVerdict('it', 'Restano 1.793 €.').valid && !amountVerdict('it', 'Restano 1.796 €.').valid)
}

section('Fase 2B — formati della lingua sbagliata: rifiutati, mai reinterpretati')
{
  const WRONG = [
    ['en', 'Still €1.794 left.'], ['en', 'Still 1.794,50 € left.'], ['en', 'Still €1,79 left.'], ['en', 'Still €1,794.505 left.'], ['en', 'Still €9 250 left.'], [`en`, `Still €1${NN}794 left.`],
    ['it', 'Restano 1,794 €.'], ['it', 'Restano 1 794 €.'], ['it', 'Restano 1.79 €.'], ['it', 'Restano 1.794.5 €.'],
    ['es', 'Quedan €1,794.'], ['es', 'Quedan 1 794 €.'],
    ['fr', 'Il reste 1.794 €.'], ['fr', 'Il reste 1,794 €.'], ['fr', 'Il reste 1 79 4 €.'], ['fr', 'Il reste 1\u2009794 €.'],
    ['it', 'Restano 1\'794 €.'], ['en', 'Still €1’794 left.'],
  ]
  for (const [locale, message] of WRONG) {
    const errors = errorsOf(locale, message)
    check(`${locale}: "${message}" → malformed_number, nessun importo letto al suo posto`, errors.includes('malformed_number') && extractNumbers(message, locale).some(Number.isNaN), errors.join(','))
  }
  check('l\'errore non riporta le cifre (i log del server ricevono solo "malformed_number")', errorsOf('en', 'Still €1.794 left.').every((error) => !/\d/.test(error)))
  check('"€9 250" in inglese: 9 e 250 sono consentiti, ma il testo non si legge come due numeri', allowedNumbers(amountsContext('en')).has(9) && allowedNumbers(amountsContext('en')).has(250) && !amountVerdict('en', 'Still €9 250 left.').valid)
  check('"1,794" in italiano: né 1,794 → 2 né 1794', !amountVerdict('it', 'Restano 1,794 €.').valid)
}

section('Fase 2B — cifre Unicode non ASCII: mai ignorate')
{
  for (const [locale, message] of [['it', 'Restano １７９４ €.'], ['en', 'Still ١٧٩٤ € left.'], ['fr', 'Il reste १७९४ €.'], ['en', 'Still €1７94 left.']]) {
    const errors = errorsOf(locale, message)
    check(`${locale}: "${message}" → rifiutata (malformed_number), anche se 1794 è consentito`, errors.includes('malformed_number'), errors.join(','))
  }
  check('   prima: queste cifre venivano ignorate (nessun numero letto)', extractNumbers('Restano １７９４ €.').length === 0)
}

section('Fase 2B — più importi nella stessa frase')
{
  check('en: "€250 today, €1,794 left, 9 days to go" → 250, 1794, 9: accettata', same(extractNumbers('€250 today, €1,794 left, 9 days to go.', 'en'), [250, 1794, 9]) && amountVerdict('en', '€250 today, €1,794 left, 9 days to go.').valid)
  check('en: un solo importo inventato tra quelli veri basta a rifiutare', same(errorsOf('en', '€250 today, €2,500 left.').filter((e) => e.startsWith('invented')), ['invented_numbers:2500']))
  check('fr: "250 € aujourd’hui, 1 794 € restants" → 250, 1794', same(extractNumbers(`250 € aujourd’hui, 1${NN}794 € restants.`, 'fr'), [250, 1794]) && amountVerdict('fr', `250 € aujourd’hui, 1${NN}794 € restants.`).valid)
  check('it: "9, 250" con lo spazio dopo la virgola restano due numeri', same(extractNumbers('Giorni 9, 250 € oggi.', 'it'), [9, 250]))
  check('en: un numero ben scritto e uno fuori grammatica → rifiutata', errorsOf('en', '€250 today, €1.794 left.').includes('malformed_number'))
}

section('Fase 2B — date, giorni e percentuali: come prima')
{
  const UNCHANGED = ['Oggi è il 2026-10-10.', 'Oggi è il 10/10/2026.', 'Restano 9 giorni.', 'Sei al 40% del budget.', 'Giorno 21 di 30.', 'Alle 12:30 di oggi.']
  for (const locale of SPENDY_LOCALES) {
    check(`${locale}: stessi numeri della lettura di prima (date con - e /, giorni, %, ore)`, UNCHANGED.every((text) => same(extractNumbers(text, locale).filter((n) => !Number.isNaN(n)), extractNumbers(text)) && !extractNumbers(text, locale).some(Number.isNaN)))
  }
  check('date e giorni nel contesto: accettate in ogni lingua ("2026-10-10", "9 days", "40%")', SPENDY_LOCALES.every((locale) => amountVerdict(locale, 'On 2026-10-10: 9 days, 40%.').valid))
  check('it: "12,5%" resta 13 (rifiutato: non è nel contesto), come prima', errorsOf('it', 'Il 12,5% in più.').includes('invented_numbers:13'))
  check('cambio voluto: una data con i punti ("10.10.2026") non è più letta come 10 e 2026 → rifiutata', errorsOf('it', 'Il 10.10.2026 restano 250 €.').includes('malformed_number'))
}

section('Fase 2B — extractNumbers(text) senza lingua: identico a prima')
{
  const LEGACY = [['1.179', [1179]], ['1.179,50', [1180]], ['66', [66]], ['12,5', [13]], ['Vacanze 2027', [2027]], ['2026-10-10', [2026, 10, 10]], ['€1,794', [2]], ['1 794 €', [1, 794]], ['Restano １７９４ €.', []]]
  check('lettura all\'italiana di sempre (anche "€1,794" → 2: serve solo ai testi del contesto)', LEGACY.every(([text, expected]) => same(extractNumbers(text), expected)), LEGACY.map(([text]) => extractNumbers(text).join('/')).join(' | '))
  check('allowedNumbers invariato: numeri dentro i nomi e la data ("Vacanze 2027", "2026-10-10")', ['2027', '2026', '10'].every((n) => allowedNumbers({ today: '2026-10-10', goal: { label: 'Vacanze 2027' } }).has(Number(n))))
  check('una lingua sconosciuta vale l\'italiano (come per il resto di Spendy AI)', same(extractNumbers('1.794,50 €', 'de'), [1795]) && extractNumbers('€1,794', 'de').some(Number.isNaN))
  check('contesto senza lingua: si legge in italiano (prima la validazione era sempre all\'italiana)', validateSpendyResponse(answer('Restano 1.794 €.'), { ...amountsContext('it'), locale: undefined }).valid
    && validateSpendyResponse(answer('Still €1,234 left.'), { ...amountsContext('it'), locale: undefined }).errors.includes('malformed_number'))
}

section('Fase 2B — stessi testi, stesso contesto: stesso verdetto su server, guard e client')
{
  const SAMPLES = [
    ['en', 'Still €1,794 left, €250 today.'], ['en', 'You spent €9,999 on shopping.'], ['en', 'Still €1.794 left.'], ['en', 'Still ١٧٩٤ € left.'],
    ['it', 'Restano 1.794,50 €.'], ['it', 'Hai speso 1,234 € oggi.'], ['es', 'Quedan 1.794 €.'], ['fr', `Il reste 1${NN}794 €.`], ['fr', 'Il reste 1.794 €.'],
  ]
  const outcomes = []
  for (const [locale, message] of SAMPLES) {
    const context = amountsContext(locale)
    const direct = validateSpendyResponse(answer(message), context)
    const guard = validateAIResponse(answer(message), context)
    const client = await createSpendyAI({ provider: { name: 'test', generate: async () => answer(message) } }).generate(context)
    const handler = createSpendyAIHandler({
      aiPreference: async () => true, config: readConfig((name) => ENV[name]),
      verifyUser: async () => ({ id: 'utente-b', emailConfirmed: true }),
      callModel: async () => ({ text: JSON.stringify(answer(message)), stopReason: 'end_turn', model: 'm' }),
      quota: memoryQuota(), now: () => DAY1, log: () => {},
    })
    const res = await handler(post({ context }))
    const server = { status: res.status, body: await res.json() }
    const serverValid = server.status === 200
    const serverErrors = server.body?.details ?? []
    const agree = direct.valid === guard.valid && guard.valid === client.ok && client.ok === serverValid
      && same(direct.errors ?? [], guard.errors ?? []) && same(guard.errors ?? [], client.details ?? []) && same(client.details ?? [], serverErrors)
    outcomes.push(direct.valid)
    check(`${locale}: "${message}" → ${direct.valid ? 'accettata' : `rifiutata (${direct.errors.join(',')})`} ovunque`, agree, JSON.stringify({ direct: direct.errors, guard: guard.errors, client: client.details, server: serverErrors }))
  }
  check('nel campione ci sono sia risposte accettate sia rifiutate', outcomes.includes(true) && outcomes.includes(false))
}

section('Fase 2B — risposta scartata → frase locale')
{
  const meta = built('en').meta
  const ai = createSpendyAI({ provider: { name: 'test', generate: async () => answer('You spent €9,999 on restaurants.') } })
  const { cache, result } = await requestSpendyVoice({ ai, context: built('en').context, meta, cache: emptyVoiceCache(), today: TODAY, now: DAY1 })
  check('l\'AI inventa "€9,999": scartata (invalid, invented_numbers:9999)', result.ok === false && result.error === 'invalid' && result.details.includes('invented_numbers:9999'), JSON.stringify(result))
  const next = decideSpendyVoice({ coach, meta, today: TODAY, cache, now: DAY1 })
  check('   l\'utente vede la frase locale (ai_failed:invalid), nessun nuovo tentativo', next.action === 'local' && next.reason === 'ai_failed:invalid', JSON.stringify(next))
  const malformed = await createSpendyAI({ provider: { name: 'test', generate: async () => answer('Still €1.840 left.') } }).generate(built('en').context)
  check('formato fuori grammatica ("€1.840" in inglese): scartata allo stesso modo', malformed.ok === false && malformed.error === 'invalid' && malformed.details.includes('malformed_number'))
}

section('Fase 2B — moltiplicatori e abbreviazioni: rifiutati in ogni lingua')
{
  const MULTIPLIED = [
    ['en', 'You spent €40k on shopping.'], ['en', 'You spent €40K on shopping.'], ['en', 'You spent €1.2k on shopping.'], ['en', 'You spent €9.9k on shopping.'],
    ['en', 'You spent €1M on shopping.'], ['en', 'You spent €2bn on shopping.'], ['en', 'You spent 2 grand on shopping.'], ['en', 'You spent 40 thousand euros.'],
    ['it', 'Hai speso 40 mila € oggi.'], ['it', 'Hai speso 1,2 mila € oggi.'], ['it', 'Hai speso 2 milioni di euro.'], ['it', 'Hai speso 3 migliaia di euro.'],
    ['es', 'Has gastado 40 mil € hoy.'], ['es', 'Has gastado 2 mil € hoy.'], ['es', 'Has gastado 3 millones de euros.'], ['es', 'Has gastado 40k € hoy.'],
    ['fr', 'Vous avez dépensé 40 k€.'], ['fr', 'Vous avez dépensé 40 k€.'], ['fr', 'Vous avez dépensé 1,2 million €.'], ['fr', 'Vous avez dépensé 2 milliers d’euros.'], ['fr', 'Vous avez dépensé 1,5 Md€.'],
  ]
  for (const [locale, message] of MULTIPLIED) {
    const errors = errorsOf(locale, message)
    check(`${locale}: "${message}" → rifiutata (malformed_number), mai letta come numero piccolo`, errors.includes('malformed_number') && extractNumbers(message, locale).every(Number.isNaN), errors.join(','))
  }
  check('   prima della correzione: letti come 40 / 1 / 10 / 2 (numeri consentiti) → accettati: il bypass chiuso qui era preesistente',
    ['You spent €40k on shopping.', 'You spent €1.2k on shopping.', 'You spent €9.9k on shopping.', 'Has gastado 2 mil € hoy.'].every((text) => extractNumbers(text).every((n) => [...allowedNumbers(amountsContext('en'))].some((a) => Math.abs(a - n) <= 1))))
  check('rifiutati anche quando il valore vero sarebbe nel contesto ("€1.794k" no, "€1,794" sì): l\'abbreviazione non si confronta', !amountVerdict('en', 'Still €1.794k left.').valid && amountVerdict('en', 'Still €1,794 left.').valid)
  check('NON coperti: i numeri scritti in lettere ("two thousand euros", "duemila euro") non contengono cifre — serve un controllo separato',
    amountVerdict('en', 'You spent two thousand euros.').valid && amountVerdict('it', 'Hai speso duemila euro.').valid)
}

section('Fase 2B — le stesse lettere e parole quando non sono moltiplicatori: accettate')
{
  const NOT_MULTIPLIERS = [
    ['it', 'Restano 9 giorni: 9 km a piedi e 250 €.', [9, 9, 250]], ['en', '9 days, 2 kg of coffee, €250.', [9, 2, 250]], ['en', 'Day 1 Monday: €250.', [1, 250]],
    ['en', '9 miles away, €250.', [9, 250]], ['it', '9 milanesi a cena, 250 €.', [9, 250]], ['es', '9 meses y 9 millas, 250 €.', [9, 9, 250]],
    ['fr', '9 mois, 250 €.', [9, 250]], ['en', '40 minutes for €250.', [40, 250]], ['it', 'Restano 250 €. Mila ringrazia.', [250]], ['fr', '250 €. Mille mercis.', [250]],
  ]
  for (const [locale, message, expected] of NOT_MULTIPLIERS) {
    check(`${locale}: "${message}" → ${expected.join(', ')}, accettata`, same(extractNumbers(message, locale), expected) && amountVerdict(locale, message).valid, errorsOf(locale, message).join(','))
  }
  check('scelta prudente, documentata: "4K", "40 mila persone", "1 grand café" contano come moltiplicatori (rifiutate)',
    !amountVerdict('en', 'A 4K screen for €250.').valid && !amountVerdict('it', '40 mila persone, 250 €.').valid && !amountVerdict('fr', '1 grand café, 250 €.').valid)
}

section('Fase 2B — formati legittimi che ora vengono respinti (cambio voluto, prudente)')
{
  const NOW_REJECTED = [
    ['it', 'Il 10.10.2026 restano 250 €.', 'data con i punti'], ['fr', 'Le 10.10.2026, 250 €.', 'data con i punti'],
    ['it', 'Alle 21.30 restano 250 €.', 'orario con il punto'], ['es', 'A las 21.30 quedan 250 €.', 'orario con il punto'],
    ['it', 'Giorno 9 250 € spesi.', 'numeri adiacenti (9 e 250)'], ['en', 'In 2026 250 euros more.', 'numeri adiacenti (2026 e 250)'],
    ['es', 'Quedan 10 000 €.', 'migliaia con lo spazio in spagnolo (l\'app scrive 10.000)'], ['en', 'Days 9,10 and 21.', 'elenco senza spazio dopo la virgola'],
  ]
  for (const [locale, message, why] of NOW_REJECTED) {
    check(`${locale}: "${message}" (${why}) → rifiutata con malformed_number → frase locale`, errorsOf(locale, message).includes('malformed_number'))
  }
  check('   prima della Fase 2B queste frasi passavano (date e orari letti come 10 / 21, numeri adiacenti come due numeri)',
    ['Il 10.10.2026 restano 250 €.', 'Alle 21.30 restano 250 €.', 'Giorno 9 250 € spesi.'].every((text) => extractNumbers(text).every((n) => [...allowedNumbers(amountsContext('it'))].some((a) => Math.abs(a - n) <= 1))))
  check('fr: "9 250 €" si legge 9250 (migliaia francesi), non 9 e 250 → rifiutata come importo inventato', errorsOf('fr', 'Il reste 9 250 €.').includes('invented_numbers:9250'))
  check('le date con / e - e gli orari con : restano come prima', SPENDY_LOCALES.every((locale) => amountVerdict(locale, 'On 2026-10-10 (10/10/2026) at 21:30: 250 €.').valid))
}

section('PREESISTENTE (non Fase 2B) — un solo insieme di numeri consentiti per importi, giorni e percentuali')
{
  // Il guard sa quali numeri sono nel contesto, non COSA rappresentano.
  check('"Hai speso 9 €": 9 sono i giorni rimasti, ma la frase passa', amountVerdict('it', 'Hai speso 9 € oggi.').valid)
  check('"You spent €40": 40 è la percentuale spesa, ma la frase passa', amountVerdict('en', 'You spent €40 today.').valid)
  check('"Only 1,794 days left": 1794 è un importo, ma la frase passa', amountVerdict('en', 'Only 1,794 days left.').valid)
  check('   comportamento uguale prima della Fase 2B per "9 €" e "€40" (stessa lettura)', same(extractNumbers('Hai speso 9 € oggi.'), [9]) && same(extractNumbers('You spent €40 today.'), [40]))
  check('   "1,794 days": prima passava per caso (letto 2), ora perché 1794 è nel contesto', same(extractNumbers('Only 1,794 days left.'), [2]) && same(extractNumbers('Only 1,794 days left.', 'en'), [1794]))
}

section('Fase 2B — server 422 → remoteProvider → client → frase locale, senza retry')
{
  for (const [message, reason] of [['Still €1.840 left.', 'malformed_number'], ['You spent €9,999 on restaurants.', 'invented_numbers'], ['You spent €40k on restaurants.', 'malformed_number']]) {
    let modelCalls = 0
    const logs = []
    const handler = createSpendyAIHandler({
      aiPreference: async () => true, config: readConfig((name) => ENV[name]),
      verifyUser: async (token) => (token === 'token-a' ? { id: 'utente-a', emailConfirmed: true } : null),
      callModel: async () => { modelCalls += 1; return { text: JSON.stringify(answer(message)), stopReason: 'end_turn', model: 'm' } },
      quota: memoryQuota(), now: () => DAY1, log: (entry) => logs.push(entry),
    })
    const statuses = []
    const provider = createRemoteProvider({
      url: URL_FN, publicKey: 'chiave-pubblica', getAccessToken: async () => 'token-a',
      fetchImpl: async (url, init) => { const res = await handler(new Request(url, init)); statuses.push(res.status); return res },
    })
    const ai = createSpendyAI({ provider })
    const { context, meta } = built('en')
    const first = await requestSpendyVoice({ ai, context, meta, cache: emptyVoiceCache(), today: TODAY, now: DAY1 })
    const later = decideSpendyVoice({ coach, meta, today: TODAY, cache: first.cache, now: DAY1 + 30 * 60 * 1000 })
    check(`"${message}": il server risponde 422 (${reason}), il client riceve invalid`, same(statuses, [422]) && first.result.ok === false && first.result.error === 'invalid' && logs.some((entry) => entry.outcome === 'invalid' && entry.errors.includes(reason)), JSON.stringify({ statuses, result: first.result }))
    check('   frase locale (ai_failed:invalid) anche mezz\'ora dopo: un solo modello chiamato, nessun retry', later.action === 'local' && later.reason === 'ai_failed:invalid' && modelCalls === 1 && first.cache.failure?.error === 'invalid', JSON.stringify(later))
    check('   in memoria sul dispositivo solo il codice dell\'errore, nessuna cifra', !/\d/.test(JSON.stringify({ error: first.cache.failure.error })) && !('details' in first.result))
  }
}

section('Log del server: mai importi né parole della risposta del modello')
{
  const run = async (message, { previous = null } = {}) => {
    const logs = []
    const handler = createSpendyAIHandler({
      aiPreference: async () => true, config: readConfig((name) => ENV[name]),
      verifyUser: async () => ({ id: 'utente-a', emailConfirmed: true }),
      callModel: async () => ({ text: JSON.stringify(answer(message)), stopReason: 'end_turn', model: 'm' }),
      quota: memoryQuota(), now: () => DAY1, log: (entry) => logs.push(entry),
    })
    const res = await handler(post({ context: amountsContext('en'), previous }))
    return { status: res.status, body: await res.json(), logs, logText: JSON.stringify(logs) }
  }
  const invented = await run('You spent €9,999 and €4,321 on shopping.')
  const entry = invented.logs.find((e) => e.outcome === 'invalid')
  check('importi inventati: nel log solo "invented_numbers", senza valori', same(entry?.errors, ['invented_numbers']), JSON.stringify(entry?.errors))
  check('   nessuna cifra dell\'importo inventato nel log (né 9999 / 9,999 né 4321)', !/9,?999|4,?321/.test(invented.logText))
  check('   la risposta 422 all\'app resta com\'è (dettagli per il client, che non li registra)', invented.status === 422 && invented.body.details.includes('invented_numbers:9999,4321'))
  const repeated = await run('Shopping galore: €250 today.', { previous: 'Shopping galore: €1,794 left.' })
  const repeatedErrors = repeated.logs.find((e) => e.outcome === 'invalid')?.errors ?? []
  check('struttura ripetuta: nel log "repeated_structure", senza le parole della risposta ("shopping galore")', repeatedErrors.includes('repeated_structure') && !/galore/i.test(repeated.logText), JSON.stringify(repeatedErrors))
  const malformed = await run('Still €1.794 left.')
  check('formato non valido: "malformed_number", senza cifre', same(malformed.logs.find((e) => e.outcome === 'invalid')?.errors, ['malformed_number']) && !/1\.?794/.test(malformed.logText))
  check('logErrorCodes: solo i codici, senza doppioni', same(logErrorCodes(['invented_numbers:1,2', 'repeated_structure:open:shopping galore', 'markdown', 'invented_numbers:3']), ['invented_numbers', 'repeated_structure', 'markdown']))
  const ok = await run('Still €1,794 left.')
  check('risposta valida: nel log nessun importo né testo', ok.status === 200 && !/1,?794|Still/.test(ok.logText))
}

section('Fase 2B — prompt: esempi inglesi con il simbolo davanti')
check('en: "€150 of shopping today", "€120 left for 9 days"', STYLE_EXAMPLES_BY_LOCALE.en[0].startsWith('€150 of shopping today') && STYLE_EXAMPLES_BY_LOCALE.en[4].startsWith('€120 left for 9 days'))
check('   nessun esempio inglese con "€" dopo il numero', STYLE_EXAMPLES_BY_LOCALE.en.every((example) => !/\d\s?€/.test(example)))
check('italiano, spagnolo e francese invariati ("150 €", "120 €")', ['it', 'es', 'fr'].every((locale) => STYLE_EXAMPLES_BY_LOCALE[locale][0].startsWith('150 €') && STYLE_EXAMPLES_BY_LOCALE[locale].some((example) => example.includes('120 €'))))
check('gli esempi passano il proprio guard di lingua (numeri ben scritti)', SPENDY_LOCALES.every((locale) => STYLE_EXAMPLES_BY_LOCALE[locale].every((example) => !extractNumbers(example, locale).some(Number.isNaN))))

report('Spendy AI multilingua — Fase 4B-3')
