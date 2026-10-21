// Fase 3E: Spendy AI conosce la valuta dell'account (EUR, USD, GBP).
// `npm test`, senza rete e senza chiamate a pagamento: l'handler della Edge
// Function gira qui in Node, il "modello" è una funzione finta, la quota è in
// memoria (come in spendyAILocale.test).
//
// Verificato qui:
//   - il client manda la valuta (context.currency), indipendente dalla lingua;
//   - il server la ricontrolla: EUR, USD, GBP, i vecchi simboli; il resto → EUR;
//   - il prompt dice la valuta, e gli esempi usano il suo simbolo;
//   - il controllo rifiuta un'altra valuta o una conversione, sul server e
//     nell'app; una risposta senza simboli passa come prima;
//   - una frase in cache per un'altra valuta non si ripropone;
//   - consenso, quota e log restano come prima (nei log nessun importo).

import { check, section, report } from '../sync/testkit.mjs'
import { createSpendyAIHandler, readConfig } from '../../supabase/functions/spendy-ai/handler.js'
import {
  SPENDY_CURRENCIES, DEFAULT_SPENDY_CURRENCY, normalizeSpendyCurrency, sanitizeSpendyContext, buildSpendyPrompt,
  validateSpendyResponse, currencyProblems, STYLE_EXAMPLES_BY_LOCALE, SPENDY_LOCALES, pickStyleExamples,
} from '../../supabase/functions/_shared/spendyAIRules.js'
import { validateAIResponse } from './spendyAIGuard.js'
import { createRemoteProvider, functionsUrl } from './providers/remoteProvider.js'
import { createMockProvider } from './providers/mockProvider.js'
import { buildSpendyAIContext } from './spendyAIContext.js'
import { decideSpendyVoice } from './spendyVoicePolicy.js'
import { emptyVoiceCache, recordAIVoice } from './spendyVoiceCache.js'
import { CURRENCY_CODES } from '../utils/currency.js'

const URL_FN = functionsUrl('https://progetto.supabase.co')
const ENV = { AI_PROVIDER: 'anthropic', AI_MODEL: 'modello-configurato', AI_API_KEY: 'sk-segreto-lato-server' }
const DAY1 = Date.parse('2026-10-10T10:00:00Z')
const context = (locale, currency) => ({
  version: 1, locale, currency, today: '2026-10-10',
  budget: { monthly: 2000, spent: 160, available: 1840, spentPercent: 8, daysRemaining: 11, band: 'ok', dailyAllowance: 167 },
  spending: { today: 0 },
  primaryEvent: { id: 'category_above_usual', importance: 60, category: 'Ristorante', cycle: { current: 160, usual: 55, difference: 105, changePercent: 191 } },
  otherEvents: [], goal: null, suggestedState: 'ironic',
})
const answer = (message) => ({ message, state: 'ironic', tone: 'playful', layout: 'left', animation: 'playful', priority: 60, shouldShow: true })
const valid = (message, locale, currency) => validateSpendyResponse(answer(message), sanitizeSpendyContext(context(locale, currency)))
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function memoryQuota() {
  const ops = []
  let used = 0
  return {
    ops,
    async reserve({ limits }) { ops.push('reserve'); await tick(); if (used >= limits.daily) return { allowed: false, reason: 'daily', used }; used += 1; return { allowed: true, reason: null, used } },
    async release() { ops.push('release'); used = Math.max(used - 1, 0) },
    async recordUsage() {},
  }
}
function makeServer({ aiEnabled = true, reply = 'Ristorante a 160, di solito 55. Ciclo speciale?' } = {}) {
  const calls = []
  const logs = []
  const quota = memoryQuota()
  const handler = createSpendyAIHandler({
    aiPreference: async () => aiEnabled,
    config: readConfig((name) => ENV[name]),
    verifyUser: async (token) => (token === 'token-a' ? { id: 'utente-a', emailConfirmed: true } : null),
    callModel: async (args) => { calls.push(args); await tick(); return { text: JSON.stringify(answer(typeof reply === 'function' ? reply(args) : reply)), stopReason: 'end_turn', model: 'm' } },
    quota, now: () => DAY1, log: (entry) => logs.push(entry),
  })
  return { handler, calls, logs, quota }
}
const post = (body, token = 'token-a') => new Request(URL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
async function send(server, body, token) {
  const res = await server.handler(post(body, token))
  return { status: res.status, body: await res.json().catch(() => null) }
}

// =====================================================================
section('1. Le valute del server sono quelle dell\'app')
// =====================================================================
check('EUR, USD, GBP con €, $, £ (come src/utils/currency.js)', JSON.stringify(Object.keys(SPENDY_CURRENCIES)) === JSON.stringify(CURRENCY_CODES) && SPENDY_CURRENCIES.EUR === '€' && SPENDY_CURRENCIES.USD === '$' && SPENDY_CURRENCIES.GBP === '£')
check('default EUR', DEFAULT_SPENDY_CURRENCY === 'EUR')
check('il server accetta EUR, USD, GBP (anche minuscoli)', ['EUR', 'USD', 'GBP', 'usd'].map(normalizeSpendyCurrency).join() === 'EUR,USD,GBP,USD')
check('vecchi simboli: € → EUR, $ → USD, £ → GBP', ['€', '$', '£'].map(normalizeSpendyCurrency).join() === 'EUR,USD,GBP')
check('mancante, vuota, sconosciuta o non testo → EUR (il client non è creduto sulla parola)', [undefined, null, '', 'CHF', 'JPY', 42, { code: 'USD' }, ['GBP']].every((value) => normalizeSpendyCurrency(value) === 'EUR'))
for (const currency of ['EUR', 'USD', 'GBP', '£', 'CHF', undefined]) {
  check(`sanitize: currency ${JSON.stringify(currency)} → "${normalizeSpendyCurrency(currency)}", contesto comunque valido`, sanitizeSpendyContext(context('it', currency))?.currency === normalizeSpendyCurrency(currency))
}

// =====================================================================
section('2. Il client manda la valuta, indipendente dalla lingua')
// =====================================================================
{
  const events = [{ id: 'category_above_usual', key: 'category_above_usual:ristorante', importance: 60, categoryId: 'ristorante', insight: { current: 160, baseline: 55 } }]
  const financialData = { monthlyBudget: 2000, available: 1840, spentRatio: 0.08, spentThisMonth: 160 }
  const built = (locale, currency) => buildSpendyAIContext({ events, coach: { state: 'ironic' }, financialData, expenses: [], today: '2026-10-10', cycleStartDay: 1, goals: [], locale, currency })
  for (const [locale, currency] of [['it', 'USD'], ['en', 'EUR'], ['fr', 'GBP'], ['es', 'USD']]) {
    const { context: ctx } = built(locale, currency)
    check(`${locale} + ${currency}: context.locale "${locale}", context.currency "${currency}"`, ctx.locale === locale && ctx.currency === currency)
  }
  check('valuta legacy "£" → GBP, mancante → EUR', built('it', '£').context.currency === 'GBP' && built('it', undefined).context.currency === 'EUR')
  check('stessi numeri con ogni valuta (nessuna conversione)', JSON.stringify(built('it', 'EUR').context.budget) === JSON.stringify(built('it', 'GBP').context.budget))
  check('cache: i "fatti" cambiano con la valuta, l\'impronta no', built('it', 'EUR').meta.facts !== built('it', 'USD').meta.facts && built('it', 'EUR').meta.fingerprint === built('it', 'USD').meta.fingerprint)
  const sent = []
  const provider = createRemoteProvider({
    url: URL_FN, publicKey: 'chiave-pubblica', getAccessToken: async () => 'token-a',
    fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ response: answer('Ok.') }), { status: 200 }) },
  })
  await provider.generate(built('it', 'GBP').context)
  check('la richiesta al server porta currency "GBP" (con locale "it")', sent[0]?.context?.currency === 'GBP' && sent[0]?.context?.locale === 'it')

  // Una frase AI in cache generata in EUR non si ripropone in USD.
  const coach = { state: 'ironic', reason: 'category_above_usual' }
  const eur = built('it', 'EUR').meta
  const cache = recordAIVoice(emptyVoiceCache(), { fingerprint: eur.fingerprint, day: '2026-10-10', eventKey: eur.eventKey, voice: answer('Ristorante a 160 €.'), now: DAY1, facts: eur.facts })
  check('frase in cache in EUR, valuta ancora EUR: si riusa', decideSpendyVoice({ coach, meta: eur, today: '2026-10-10', cache, now: DAY1 }).action === 'cache')
  const usd = decideSpendyVoice({ coach, meta: built('it', 'USD').meta, today: '2026-10-10', cache, now: DAY1 })
  check('   passata a USD: non si ripropone (stale_facts → frase locale)', usd.action === 'local' && usd.reason === 'stale_facts', JSON.stringify(usd))
}

// =====================================================================
section('3. Il prompt dice la valuta; gli esempi usano il suo simbolo')
// =====================================================================
for (const [locale, currency, symbol] of [['it', 'USD', '$'], ['en', 'EUR', '€'], ['fr', 'GBP', '£'], ['es', 'USD', '$'], ['en', 'GBP', '£']]) {
  const prompt = buildSpendyPrompt(sanitizeSpendyContext(context(locale, currency)))
  const others = Object.values(SPENDY_CURRENCIES).filter((s) => s !== symbol)
  check(`${locale} + ${currency}: sezione VALUTA con "${currency}" e simbolo ${symbol}`, prompt.system.includes(`context.currency = "${currency}"`) && prompt.system.includes(`simbolo ${symbol}`))
  check(`   ${locale} + ${currency}: lingua della risposta invariata (context.locale = "${locale}")`, prompt.system.includes(`context.locale = "${locale}"`))
  check(`   ${locale} + ${currency}: nessun altro simbolo in personalità ed esempi`, !others.some((s) => [prompt.system.split('VALUTA')[0], ...prompt.input.styleExamples].some((text) => text.includes(s))))
  // Fase 5A: gli esempi sono i 4 scelti a rotazione dalla raccolta della lingua.
  const expected = pickStyleExamples(STYLE_EXAMPLES_BY_LOCALE[locale], prompt.input.context)
  check(`   ${locale} + ${currency}: gli esempi sono quelli della lingua, con il simbolo nella stessa posizione`, prompt.input.styleExamples.length === expected.length && expected.length === 4
    && prompt.input.styleExamples.every((example, i) => example === expected[i].replaceAll('€', symbol)))
  check(`   ${locale} + ${currency}: tutta la raccolta, con il simbolo riscritto, non contiene altre valute`, STYLE_EXAMPLES_BY_LOCALE[locale].every((example) => !others.some((s) => example.replaceAll('€', symbol).includes(s))))
}
{
  const system = buildSpendyPrompt(sanitizeSpendyContext(context('it', 'USD'))).system
  check('il prompt vieta altre valute, conversioni e tassi di cambio', system.includes('Non usare mai un\'altra valuta, non convertire importi e non citare tassi di cambio'))
  check('il prompt dice che gli importi del contesto sono in quella valuta, qualunque sia la lingua', system.includes('Tutti gli importi del contesto sono in dollari statunitensi, qualunque sia la lingua della risposta'))
}

// =====================================================================
section('4. Il controllo delle risposte: solo la valuta dell\'account')
// =====================================================================
{
  const OK = [
    ['en', 'USD', 'Restaurants at $160, your usual is $55. Special cycle?'],
    ['it', 'USD', 'Ristorante a 160 $, di solito 55 $. Ciclo speciale?'],
    ['fr', 'GBP', 'Restaurants à 160 £, d’habitude 55 £. Un cycle spécial ?'],
    ['es', 'GBP', 'Restaurantes a 160 £, lo habitual son 55 libras. ¿Ciclo especial?'],
    ['en', 'EUR', 'Restaurants at €160, your usual is 55 euros.'],
    ['it', 'GBP', 'Ristorante a 160, di solito 55. Ciclo speciale?'],
    ['fr', 'GBP', 'Un livre de cuisine et 160 £ au restaurant ?'],
    ['it', 'EUR', 'In giro per l’Europa: 160 € al ristorante.'],
  ]
  for (const [locale, currency, message] of OK) {
    const result = valid(message, locale, currency)
    check(`${locale} + ${currency}: "${message}" → accettata`, result.valid, result.errors?.join(','))
  }
  const WRONG = [
    ['en', 'USD', 'Restaurants at €160, your usual is €55.', 'wrong_currency'],
    ['it', 'GBP', 'Ristorante a 160 €, di solito 55 €.', 'wrong_currency'],
    ['it', 'GBP', 'Ristorante a 160 dollari, di solito 55.', 'wrong_currency'],
    ['fr', 'EUR', 'Restaurants à 160 £ ?', 'wrong_currency'],
    ['es', 'EUR', 'Restaurantes a 160 dólares.', 'wrong_currency'],
    ['en', 'GBP', 'Restaurants at £160 (about $160).', 'wrong_currency'],
    ['en', 'EUR', 'Restaurants at €160, about 160 USD.', 'wrong_currency'],
    ['it', 'EUR', 'Ristorante a 160 €: al tasso di cambio di oggi è poco.', 'currency_conversion'],
    ['en', 'USD', 'At today’s exchange rate, $160 is not much.', 'currency_conversion'],
    ['fr', 'GBP', 'Au taux de change actuel, 160 £ c’est peu.', 'currency_conversion'],
    ['es', 'USD', 'Con el tipo de cambio de hoy, 160 $ es poco.', 'currency_conversion'],
  ]
  for (const [locale, currency, message, error] of WRONG) {
    const result = valid(message, locale, currency)
    check(`${locale} + ${currency}: "${message}" → rifiutata (${error})`, !result.valid && result.errors.includes(error), result.errors?.join(','))
  }
  check('nessun importo inventato in più: i numeri restano controllati come prima (987 $ → invented_numbers)', valid('Ristorante a 987 $.', 'it', 'USD').errors.some((e) => e.startsWith('invented_numbers')))
  check('i codici di errore della valuta non riportano testo né importi', currencyProblems('160 € al tasso di cambio, 170 $', 'GBP').every((code) => !/\d/.test(code)))
  check('contesto senza valuta (versioni precedenti dell\'app): vale EUR, "€" accettato', validateSpendyResponse(answer('Ristorante a 160 €.'), sanitizeSpendyContext(context('it', undefined))).valid)
  check('nell\'app (validateAIResponse) le stesse regole: € rifiutato con USD, $ accettato',
    !validateAIResponse(answer('Restaurants at €160.'), context('en', 'USD')).valid && validateAIResponse(answer('Restaurants at $160.'), context('en', 'USD')).valid)
  check('risposta senza importi: passa come prima, in ogni valuta', ['EUR', 'USD', 'GBP'].every((currency) => valid('Oggi il portafoglio può dormire tranquillo.', 'it', currency).valid))
  check('Spendy che tace (shouldShow false): sempre valido', validateSpendyResponse({ ...answer(''), shouldShow: false }, sanitizeSpendyContext(context('it', 'USD'))).valid)
}

// =====================================================================
section('4b. Simboli alternativi, parole colloquiali, nomi dell\'utente')
// =====================================================================
{
  // Contesto con importi veri (1234.56 disponibili, 123 oggi) e nomi scelti
  // dall'utente che contengono parole di valuta.
  const ctxWith = (locale, currency) => sanitizeSpendyContext({
    ...context(locale, currency),
    budget: { ...context(locale, currency).budget, available: 1234.56 },
    // Fase 2B.4: 1234.56 anche come spesa media di un ciclo, che il modello può
    // scrivere (il disponibile lo scrive solo l'app).
    spending: { today: 123, usualCycle: 1234.56 },
    primaryEvent: { id: 'category_above_usual', importance: 60, category: 'Dollar Store', cycle: { current: 123, usual: 55 } },
    goal: { label: 'Euro Disney', percent: 12, missing: 1000 },
  })
  const check4b = (locale, currency, message) => validateSpendyResponse(answer(message), ctxWith(locale, currency))
  const ACCEPTED = [
    // simboli alternativi della valuta giusta
    ['en', 'USD', 'You spent ＄123 today.', 'simbolo a larghezza piena della valuta giusta'],
    ['en', 'GBP', 'You spent ￡123 today.', '￡ con GBP'],
    ['it', 'GBP', 'Oggi 123 ₤.', '₤ con GBP'],
    // parole colloquiali della valuta giusta
    ['it', 'EUR', 'Oggi 123 euri, niente di grave.', 'euri con EUR'],
    ['en', 'USD', 'You spent 123 bucks today.', 'bucks con USD'],
    ['en', 'GBP', 'You spent 123 quid today.', 'quid con GBP'],
    ['es', 'GBP', 'Hoy 123 libras.', 'libras con GBP'],
    // nomi dell'utente e parole con un altro significato
    ['en', 'USD', '"Euro Disney" is at 12%.', 'obiettivo "Euro Disney" con USD'],
    ['it', 'EUR', 'Il "Dollar Store" oggi ti è costato 123 €.', 'categoria "Dollar Store" con EUR'],
    ['en', 'EUR', 'I lost two pounds this week.', '"two pounds" (peso, senza cifre)'],
    ['it', 'EUR', 'Sei del segno della Bilancia, in spagnolo Libra.', '"Libra" segno zodiacale'],
    ['fr', 'EUR', 'Un livre et 123 € de dépenses.', '"un livre" è un libro'],
    ['en', 'EUR', 'This cycle bucks the trend: only €123.', '"bucks the trend" non è denaro'],
    ['en', 'EUR', 'A quid pro quo with your budget: €123 today.', '"quid pro quo" non è denaro'],
    // formati delle quattro lingue, valuta giusta
    ['it', 'USD', 'Di solito un ciclo costa 1.234,56 $.', 'it 1.234,56 $'],
    ['en', 'USD', 'A cycle usually costs $1,234.56.', 'en $1,234.56'],
    ['es', 'GBP', 'Un ciclo cuesta de media 1.234,56 £.', 'es 1.234,56 £'],
    ['fr', 'EUR', 'Un cycle coûte d’habitude 1 234,56 €.', 'fr 1 234,56 €'],
    // senza importi
    ['fr', 'GBP', 'Aujourd’hui, le portefeuille peut dormir tranquille.', 'nessun importo'],
  ]
  for (const [locale, currency, message, why] of ACCEPTED) {
    const result = check4b(locale, currency, message)
    check(`${locale} + ${currency}: ${why} → accettata`, result.valid, `${message} → ${result.errors?.join(',')}`)
  }
  // Fase 2B.1: un peso resta un peso (nessun wrong_currency), ma la sua cifra
  // non è più autorizzata da un numero qualsiasi del contesto: "2" non c'è,
  // "1" c'era solo come version. Prima passavano grazie a quei numeri (±1).
  for (const [message, why, value] of [['I lost 2 pounds this week and spent €123.', '"lost 2 pounds" è un peso', 2], ['1 pound of apples and €123 at the shop.', '"1 pound of" è un peso', 1]]) {
    const result = check4b('en', 'EUR', message)
    check(`en + EUR: ${why} → nessun problema di valuta; la cifra ${value} non è nel contesto (invented_numbers:${value})`,
      !result.errors.includes('wrong_currency') && JSON.stringify(result.errors) === JSON.stringify([`invented_numbers:${value}`]), result.errors?.join(','))
  }
  // Fase 2B.4: lo stesso importo come DISPONIBILE ("restano 1.234,56") è una cifra
  // del budget: la scrive l'app, qualunque sia la valuta.
  for (const [locale, currency, message] of [['it', 'USD', 'Restano 1.234,56 $.'], ['en', 'USD', 'Still $1,234.56 left.'], ['es', 'GBP', 'Quedan 1.234,56 £.'], ['fr', 'EUR', 'Il reste 1 234,56 €.']]) {
    const errors = check4b(locale, currency, message).errors ?? []
    check(`${locale} + ${currency}: "${message}" → rifiutata (incoherent_budget), nessun errore di valuta`, errors.includes('incoherent_budget') && !errors.includes('wrong_currency'), errors.join(','))
  }
  const REJECTED = [
    ['en', 'EUR', 'You spent ＄123 today.', '＄ (larghezza piena) con EUR'],
    ['en', 'EUR', 'You spent ￡123 today.', '￡ con EUR'],
    ['it', 'EUR', 'Oggi 123 ₤.', '₤ con EUR'],
    ['it', 'USD', 'Oggi 123 euri.', 'euri con USD'],
    ['en', 'EUR', 'You spent 123 bucks today.', 'bucks con EUR'],
    ['en', 'EUR', 'You spent 123 quid today.', 'quid con EUR'],
    ['es', 'USD', 'Hoy 123 libras.', 'libras con USD'],
    ['en', 'USD', 'You spent 123 pounds sterling.', 'pounds sterling con USD'],
    ['es', 'EUR', 'Hoy 123 libras esterlinas.', 'libras esterlinas con EUR'],
    // accanto ai nomi dell'utente l'importo resta controllato
    ['it', 'USD', 'Mancano 1000 € per "Euro Disney".', '€ accanto a "Euro Disney" con USD'],
    ['it', 'EUR', 'Il "Dollar Store" ti è costato 123 $.', '$ accanto a "Dollar Store" con EUR'],
    ['en', 'GBP', 'Euro Disney is 1,000 euros away.', '"euros" accanto al nome dell\'obiettivo con GBP'],
  ]
  for (const [locale, currency, message, why] of REJECTED) {
    const result = check4b(locale, currency, message)
    check(`${locale} + ${currency}: ${why} → rifiutata (wrong_currency)`, !result.valid && result.errors.includes('wrong_currency'), `${message} → ${result.errors?.join(',')}`)
  }
  check('la normalizzazione serve solo al controllo della valuta: cifre a larghezza piena ancora rifiutate dai numeri (malformed_number)', check4b('en', 'USD', 'You spent $１２３.').errors.includes('malformed_number'))
  check('il testo mostrato non cambia (il controllo lavora su una copia)', validateSpendyResponse(answer('Oggi ＄123.'), ctxWith('it', 'USD')).response?.message === 'Oggi ＄123.')
  check('currencyProblems con due argomenti (come prima): stessi risultati senza nomi', JSON.stringify(currencyProblems('160 € e 170 $', 'GBP')) === JSON.stringify(['wrong_currency']) && currencyProblems('160 £', 'GBP').length === 0)
}

// =====================================================================
section('5. L\'handler (server) con il modello finto, senza crediti')
// =====================================================================
{
  const server = makeServer({ reply: 'Restaurants at $160, your usual is $55.' })
  const ok = await send(server, { context: context('en', 'USD') })
  check('en + USD: il modello riceve la valuta (VALUTA, USD) e la risposta in $ passa (200)', ok.status === 200 && server.calls[0].input.context.currency === 'USD' && server.calls[0].system.includes('context.currency = "USD"'), JSON.stringify(ok.body))
  check('   nessun "€" nel prompt mandato al modello per USD', !JSON.stringify(server.calls[0]).includes('€'))
  const wrong = makeServer({ reply: 'Restaurants at €160, your usual is €55.' })
  const rejected = await send(wrong, { context: context('en', 'USD') })
  // Fase 2B.1: il 422 è generico (nessun dettaglio all'app); il motivo è nei log.
  check('modello che scrive in € per un account USD: 422, motivo wrong_currency (nei log)', rejected.status === 422 && rejected.body.details === undefined && wrong.logs.some((e) => e.outcome === 'invalid' && e.errors.includes('wrong_currency')))
  const entry = wrong.logs.find((e) => e.outcome === 'invalid')
  check('   nei log solo il codice ("wrong_currency"), nessun importo, nessun testo', JSON.stringify(entry?.errors) === JSON.stringify(['wrong_currency']) && !/160|55|Restaurants|€|\$/.test(JSON.stringify(wrong.logs)), JSON.stringify(wrong.logs))
  const hostile = makeServer({ reply: 'Ristorante a 160 €.' })
  const forged = await send(hostile, { context: { ...context('it', 'BTC') } })
  check('valuta inventata dal client ("BTC"): il server usa EUR (prompt in euro, € accettato)', forged.status === 200 && hostile.calls[0].input.context.currency === 'EUR' && hostile.calls[0].system.includes('context.currency = "EUR"'))
  const legacy = makeServer({ reply: 'Ristorante a 160 €.' })
  const withoutCurrency = { ...context('it', 'USD') }
  delete withoutCurrency.currency
  const old = await send(legacy, { context: withoutCurrency })
  check('client vecchio senza currency: EUR, come prima', old.status === 200 && legacy.calls[0].input.context.currency === 'EUR')
}

// =====================================================================
section('6. Consenso e quota: come prima, in ogni valuta')
// =====================================================================
{
  for (const currency of ['EUR', 'USD', 'GBP']) {
    const off = makeServer({ aiEnabled: false })
    const res = await send(off, { context: context('it', currency) })
    check(`${currency}: consenso spento → 403 AI_DISABLED, nessuna quota, nessun modello`, res.status === 403 && res.body.code === 'AI_DISABLED' && off.quota.ops.length === 0 && off.calls.length === 0)
    const anon = makeServer()
    const unauth = await send(anon, { context: context('it', currency) }, null)
    check(`${currency}: senza sessione → 401, nessun modello`, unauth.status === 401 && anon.calls.length === 0)
  }
  const server = makeServer()
  const statuses = []
  for (let i = 0; i < 5; i += 1) statuses.push((await send(server, { context: context('it', ['EUR', 'USD', 'GBP'][i % 3]) })).status)
  check('limite giornaliero invariato: cambiare valuta non dà chiamate in più (1 × 200, poi 429)', JSON.stringify(statuses) === JSON.stringify([200, 429, 429, 429, 429]) && server.calls.length === 1, statuses.join(','))
}

// =====================================================================
section('7. L\'AI finta (sviluppo) usa il simbolo della valuta')
// =====================================================================
{
  const mock = createMockProvider({ latencyMs: 0 })
  // Più situazioni (budget sano, stretto, superato): il mock non scrive sempre importi.
  const variants = [
    context('it', 'X'),
    { ...context('it', 'X'), budget: { ...context('it', 'X').budget, available: 120, spentPercent: 94, band: 'high', dailyAllowance: 10 } },
    { ...context('it', 'X'), budget: { ...context('it', 'X').budget, available: -50, spentPercent: 103, band: 'exceeded' }, primaryEvent: { id: 'budget_exceeded', importance: 90 } },
  ]
  for (const [currency, symbol] of [['USD', '$'], ['GBP', '£']]) {
    const messages = []
    for (const variant of variants) messages.push((await mock.generate(sanitizeSpendyContext({ ...variant, currency }), { history: [] })).message ?? '')
    const withAmounts = messages.filter((message) => /\d\s?[€$£]/.test(message))
    check(`${currency}: nessun "€"; gli importi del mock usano "${symbol}" (${withAmounts.length} frasi con importi)`, messages.every((m) => !m.includes('€')) && withAmounts.length > 0 && withAmounts.every((m) => [...m.matchAll(/\d\s?([€$£])/g)].every((match) => match[1] === symbol)), messages.join(' | '))
    check(`   ${currency}: le frasi del mock passano il controllo della valuta`, messages.every((m) => currencyProblems(m, currency).length === 0))
  }
}

check('quattro lingue × tre valute: nessuna combinazione forzata (la lingua non decide la valuta)', SPENDY_LOCALES.every((locale) => ['EUR', 'USD', 'GBP'].every((currency) => sanitizeSpendyContext(context(locale, currency)).currency === currency && sanitizeSpendyContext(context(locale, currency)).locale === locale)))

report('Spendy AI e valuta (Fase 3E)')
