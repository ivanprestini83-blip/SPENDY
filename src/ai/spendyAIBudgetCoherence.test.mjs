// Fase 2B.5: correzioni della verifica conclusiva 2B.4.
// `npm test`, senza rete e senza chiamate a pagamento.
//
// Verificato qui:
//   A  "nascondi gli importi" (store.amountHidden, la stessa preferenza della
//      BudgetCard) maschera anche la riga di fatti sotto la frase dell'IA;
//   B  coerenza con il budget: disponibile positivo, zero, negativo (anche di
//      pochi centesimi), spesa troppo rapida, ultimo giorno di un ciclo
//      personalizzato — permessi di spesa, budget "sano", mascotte festosa;
//   C  precisione della riga di fatti: centesimi come la BudgetCard, sforamento
//      sotto l'unità, niente quota giornaliera nell'ultimo giorno, "Disponibile";
//   D  collisioni numeriche e falsi positivi ("rimasta impressa", "You left");
//   e: rifiuto → frase locale, contratti HTTP invariati, valute invariate.

import { readFileSync } from 'node:fs'
import { check, section, report } from '../sync/testkit.mjs'
import {
  validateSpendyResponse, sanitizeSpendyContext, budgetCondition, isOverBudget,
  normalizeSpendyCurrency, currencyProblems, SPENDY_LOCALES, SPENDY_RESPONSE_SCHEMA,
} from '../../supabase/functions/_shared/spendyAIRules.js'
import { createSpendyAIHandler, readConfig } from '../../supabase/functions/spendy-ai/handler.js'
import { buildSpendyAIContext } from './spendyAIContext.js'
import { createSpendyAI } from './spendyAI.js'
import { budgetFactLine, voiceFromAI, decideSpendyVoice, requestSpendyVoice, resolveSpendyVoice } from './spendyVoicePolicy.js'
import { emptyVoiceCache } from './spendyVoiceCache.js'
import { functionsUrl } from './providers/remoteProvider.js'
import { formatCurrency, maskedCurrency } from '../utils/format.js'
import { getSpendyCoach } from '../utils/spendyCoach.js'
import { evaluateExpenseReaction } from '../utils/expenseReactionEngine.js'
import { translate } from '../i18n/translate.js'

const TODAY = '2026-10-11'
const T0 = Date.parse('2026-10-11T10:00:00Z')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// Fase 2B.7: nella riga di fatti gli spazi DENTRO un importo sono non separabili
// ("0,40 €" non va a capo). I confronti di testo qui sotto li leggono come spazi
// normali; lo spazio non separabile è verificato a parte (Fase 2B.7).
const NB = '\u00a0'
const nbspToSpace = (text) => (typeof text === 'string' ? text.replaceAll(NB, ' ') : text)
const facts = (...args) => nbspToSpace(budgetFactLine(...args))
const answer = (message, state = 'attentive', extra = {}) => ({ message, state, tone: 'friendly', layout: 'left', animation: 'gentle', priority: 60, shouldShow: true, ...extra })

// Il contesto come lo costruisce l'app (spendyAIContext.js), dai dati finanziari
// che usa anche la BudgetCard. Ciclo dal 7: l'11/10 è il giorno 5 di 31.
const fin = (available, monthly = 1500) => ({ monthlyBudget: monthly, available, spentRatio: ((monthly - available) / monthly) * 100, spentThisMonth: monthly - available })
const built = (available, { locale = 'it', currency = 'EUR', today = TODAY, cycleStartDay = 7, events = [], expenses = [], goals = [] } = {}) => buildSpendyAIContext({
  events, coach: { state: 'attentive' }, financialData: fin(available), expenses, today, cycleStartDay, goals, locale, currency,
})
const ctx = (available, options) => built(available, options).context
const errorsOf = (message, context, state = 'attentive', extra) => validateSpendyResponse(answer(message, state, extra), context).errors ?? []
const accepted = (message, context, state = 'attentive', extra) => validateSpendyResponse(answer(message, state, extra), context).valid === true
const rejectedFor = (code, message, context, state, extra) => errorsOf(message, context, state, extra).some((e) => e === code || e.startsWith(`${code}:`))

// ---------------------------------------------------------------------------
section('A — "nascondi gli importi": la riga di fatti non mostra importi in chiaro')
{
  const CASES = [['disponibile', 493.6], ['zero', 0], ['sforato', -120.4], ['sforato di pochi centesimi', -0.4]]
  for (const locale of SPENDY_LOCALES) {
    for (const currency of ['EUR', 'USD', 'GBP']) {
      for (const [what, available] of CASES) {
        const context = ctx(available, { locale, currency })
        const hidden = facts(context, { hideAmounts: true })
        const visible = facts(context)
        const mask = maskedCurrency(locale, currency)
        check(`${locale} + ${currency}, ${what}: nascosti → "${hidden}" (nessuna cifra, maschera della card)`, typeof hidden === 'string' && !/\d/.test(hidden) && hidden.includes(mask), hidden)
        check(`   visibili → "${visible}" (importo esatto, come la card)`, typeof visible === 'string' && visible.includes(formatCurrency(Math.abs(available), locale, currency)), visible)
      }
    }
  }
  const context = ctx(493.6)
  const response = answer('Ristorante a 160 €: ciclo speciale?', 'ironic')
  check('voiceFromAI: con la preferenza attiva gli importi della riga sono mascherati, la frase resta', nbspToSpace(voiceFromAI(response, context, { hideAmounts: true }).secondaryText) === 'Disponibile: •••• €, circa •••• € al giorno.' && voiceFromAI(response, context, { hideAmounts: true }).message === response.message)
  check('   senza preferenza (default) l\'importo è visibile', nbspToSpace(voiceFromAI(response, context).secondaryText) === 'Disponibile: 493,60 €, circa 18 € al giorno.', voiceFromAI(response, context).secondaryText)
  const cache = { ...emptyVoiceCache(), current: { fingerprint: 'f', day: TODAY, voice: { ...response, layout: 'left' }, facts: 'x' } }
  const decision = { action: 'cache', reason: 'cached' }
  check('resolveSpendyVoice (frase dalla cache): hideAmounts maschera, senza no', !/\d/.test(resolveSpendyVoice({ decision, coach: {}, cache, context, hideAmounts: true }).secondaryText) && /493,60/.test(resolveSpendyVoice({ decision, coach: {}, cache, context }).secondaryText))
  const hook = readFileSync(new URL('./useSpendyVoice.js', import.meta.url), 'utf8')
  check('useSpendyVoice legge la stessa preferenza della BudgetCard (store.amountHidden) e la passa', /useAppStore\(\(state\) => state\.amountHidden === true\)/.test(hook) && /resolveSpendyVoice\(\{[^}]*hideAmounts: amountHidden/.test(hook))
  check('   e non la modifica (nessun toggleAmountHidden / setState nel hook)', !/toggleAmountHidden|amountHidden\s*:/.test(hook.replace(/hideAmounts: amountHidden/, '')))
  const home = readFileSync(new URL('../pages/HomePage.jsx', import.meta.url), 'utf8')
  check('la BudgetCard continua a usare la stessa preferenza (hidden={amountHidden})', /hidden=\{amountHidden\}/.test(home))
}

// ---------------------------------------------------------------------------
section('B — coerenza con il budget: positivo, zero, negativo, spesa rapida, ultimo giorno')
{
  check('condizioni dai dati verificati: ok / exhausted / over (anche -0,40) / fast', budgetCondition(ctx(1200)) === 'ok' && budgetCondition(ctx(0)) === 'exhausted'
    && budgetCondition(ctx(-120)) === 'over' && budgetCondition(ctx(-0.4)) === 'over' && budgetCondition(ctx(360)) === 'fast' && budgetCondition(ctx(75)) === 'fast',
    [ctx(1200), ctx(0), ctx(-120), ctx(-0.4), ctx(360), ctx(75)].map(budgetCondition).join(' '))
  check('   -0,40 € resta negativo nel contesto (prima Math.round lo portava a 0)', ctx(-0.4).budget.available === -0.4 && isOverBudget(ctx(-0.4)))

  const OPTIMISM = {
    it: ['Tutto sotto controllo, il budget regge alla grande!', 'Il budget regge.', 'Va tutto bene col budget.'],
    en: ['Everything is under control, the budget is holding up!', 'You are on track.'],
    es: ['Todo bajo control, el presupuesto aguanta.', 'Vas muy bien.'],
    fr: ['Tout est sous contrôle, le budget tient bon.', 'Tout va bien.'],
  }
  const PERMISSION = {
    it: ['Puoi ancora spendere tranquillo questo ciclo.', 'Hai ancora margine, goditela.'],
    en: ['You can still spend a bit this cycle.'],
    es: ['Todavía puedes gastar un poco.'],
    fr: ['Tu peux encore dépenser un peu.'],
  }
  const EMPATHY = {
    it: ['Capita a tutti: da qui conta ogni piccola spesa.', 'Un passo alla volta, ci rimettiamo in carreggiata.'],
    en: ['It happens to everyone: every small expense counts from here.'],
    es: ['Le pasa a todo el mundo: desde aquí cuenta cada gasto pequeño.'],
    fr: ['Ça arrive à tout le monde : chaque petite dépense compte à partir de maintenant.'],
  }
  const STATES = [['zero', 0], ['negativo', -120], ['negativo di 0,40', -0.4]]
  for (const [what, available] of STATES) {
    for (const locale of SPENDY_LOCALES) {
      const context = ctx(available, { locale })
      for (const message of OPTIMISM[locale]) check(`${what}, ${locale}: budget "sano" ("${message}") → incoherent_budget`, rejectedFor('incoherent_budget', message, context), errorsOf(message, context).join(','))
      for (const message of PERMISSION[locale]) check(`${what}, ${locale}: permesso di spesa ("${message}") → incoherent_budget`, rejectedFor('incoherent_budget', message, context), errorsOf(message, context).join(','))
      for (const message of EMPATHY[locale]) check(`${what}, ${locale}: empatico e motivazionale ("${message}") → accettata`, accepted(message, context, 'concerned'), errorsOf(message, context, 'concerned').join(','))
    }
    const context = ctx(available)
    check(`${what}: mascotte festosa o rassicurante → incoherent_state (stato happy, celebrating; tono celebratory; animazione celebrate)`,
      rejectedFor('incoherent_state', 'Un passo alla volta.', context, 'happy') && rejectedFor('incoherent_state', 'Un passo alla volta.', context, 'celebrating')
      && rejectedFor('incoherent_state', 'Un passo alla volta.', context, 'attentive', { tone: 'celebratory' }) && rejectedFor('incoherent_state', 'Un passo alla volta.', context, 'attentive', { animation: 'celebrate' }))
    check(`${what}: attentive, concerned, advisor, ironic restano possibili`, ['attentive', 'concerned', 'advisor', 'ironic'].every((state) => accepted('Un passo alla volta.', context, state)))
  }
  // Spesa troppo rapida (76% al giorno 5, oppure 95%): niente "budget sano" né permessi; la festa resta possibile
  // (un obiettivo raggiunto si festeggia anche in un ciclo veloce).
  for (const available of [360, 75]) {
    const context = ctx(available)
    check(`spesa rapida (${context.budget.spentPercent}% al giorno ${context.budget.dayOfCycle}): "Tutto sotto controllo" e "Puoi ancora spendere" → rifiutate`, rejectedFor('incoherent_budget', 'Tutto sotto controllo, il budget regge.', context) && rejectedFor('incoherent_budget', 'Puoi ancora spendere tranquillo.', context))
    check('   "rallenta un po\'" e la percentuale vera → accettate; stato celebrating non vietato', accepted(`Sei al ${context.budget.spentPercent}% del budget: rallentiamo un po'.`, context) && accepted('Obiettivo raggiunto, che soddisfazione!', context, 'celebrating'))
  }
  check('budget sano: ottimismo, permessi e festa restano leciti (comportamento invariato)', ['Tutto sotto controllo, il budget regge!', 'Puoi ancora spendere tranquillo questo ciclo.'].every((m) => accepted(m, ctx(1200), 'happy')) && accepted('Che ciclo! Festeggiamo.', ctx(1200), 'celebrating'))

  // Ultimo giorno di un ciclo personalizzato (inizio il 7: il 6/11 è l'ultimo giorno).
  const last = ctx(493.6, { today: '2026-11-06', cycleStartDay: 7 })
  check('ultimo giorno (ciclo dal 7): fase last_day, nessuna quota giornaliera nella riga', last.budget.cyclePhase === 'last_day' && facts(last) === 'Disponibile: 493,60 €.', facts(last))
  check('   "restano 5 giorni" nell\'ultimo giorno → incoherent_cycle_phase; "domani si riparte" → accettata', rejectedFor('incoherent_cycle_phase', 'Restano 5 giorni, con calma.', last) && accepted('Ultimo giorno del ciclo: domani si riparte.', last))
  check('   ciclo dal 31 a febbraio (mese corto): stessa fonte dell\'app (getCycleTiming), riga coerente', typeof facts(ctx(300, { today: '2026-02-28', cycleStartDay: 31 })) === 'string' && facts(ctx(300, { today: '2026-02-28', cycleStartDay: 31 })).startsWith('Disponibile: 300,00 €'))
}

// ---------------------------------------------------------------------------
section('C — precisione della riga di fatti: gli stessi importi della BudgetCard')
{
  const EXPECTED = {
    it: 'Disponibile: 493,60 €, circa 18 € al giorno.',
    en: 'Available: €493.60, about €18 a day.',
    es: 'Disponible: 493,60 €, unos 18 € al día.',
    fr: 'Disponible : 493,60 €, environ 18 € par jour.',
  }
  for (const [locale, expected] of Object.entries(EXPECTED)) {
    const line = facts(ctx(493.6, { locale }))
    check(`${locale}: 493,60 resta 493,60 (non 494): "${line}"`, line.replace(/\s/g, ' ') === expected.replace(/\s/g, ' ') && line.includes(formatCurrency(493.6, locale, 'EUR')), line)
  }
  check('sforato di 0,40 €: "Budget superato di 0,40 €." (prima: nessuna riga)', facts(ctx(-0.4)) === 'Budget superato di 0,40 €.', facts(ctx(-0.4)))
  check('sforato di 120,40 €: "Budget superato di 120,40 €."', facts(ctx(-120.4)) === 'Budget superato di 120,40 €.', facts(ctx(-120.4)))
  check('stesso dato della card, nessun secondo calcolo: disponibile del contesto = financialData.available', ctx(493.6).budget.available === 493.6 && ctx(1234.56).budget.available === 1234.56)
  check('quota giornaliera: Math.floor del disponibile sui giorni compreso oggi (come prima), mostrata intera', ctx(493.6).budget.dailyAllowance === Math.floor(493.6 / 27))
  check('italiano: "Disponibile", come la card (prima "Disponibili")', facts(ctx(0)) === 'Disponibile: 0,00 €.')
  check('valute: USD e GBP nel formato dell\'app', facts(ctx(493.6, { locale: 'en', currency: 'USD' })) === 'Available: $493.60, about $18 a day.' && facts(ctx(-0.4, { locale: 'en', currency: 'GBP' })) === 'Over budget by £0.40.',
    [facts(ctx(493.6, { locale: 'en', currency: 'USD' })), facts(ctx(-0.4, { locale: 'en', currency: 'GBP' }))].join(' | '))
  check('il modello non può scrivere il disponibile con i centesimi (cifra riservata)', rejectedFor('reserved_amount', 'Oggi 493,60 € ancora a disposizione.', ctx(493.6)) && rejectedFor('reserved_amount', 'Ecco 493,60 € per te.', ctx(493.6)))
  check('a budget sforato di 0,40 € nessun importo dal modello (contratto 2B.3)', rejectedFor('money_when_over_budget', 'Sei sotto di 0,40 €.', ctx(-0.4)))
}

// ---------------------------------------------------------------------------
section('D — collisioni numeriche e falsi positivi')
{
  // La spesa di oggi vale 1.500 € come il budget del ciclo.
  const collision = ctx(494, { expenses: [{ id: 'e1', date: TODAY, amount: 1500, categoryId: 'viaggi' }] })
  check('collisione: la frase corretta sulla spesa (1.500 € = budget) passa', accepted('Oggi 1.500 € in un colpo solo: si fa notare.', collision))
  check('collisione: "Hai in cassa 1.500 €" / "Il tuo saldo è 1.500 €" restano rifiutate', rejectedFor('incoherent_budget', 'Hai in cassa 1.500 €.', collision) && rejectedFor('incoherent_budget', 'Il tuo saldo è 1.500 €.', collision))
  check('senza collisione "Il tuo tesoretto: 1.500 €" è rifiutata (cifra riservata)', rejectedFor('reserved_amount', 'Il tuo tesoretto: 1.500 €.', ctx(494)))
  // Compromesso documentato (Fase 2B.5): con una collisione numerica, un saldo con
  // una parola fuori elenco ("tesoretto") passa. Distinguerlo richiederebbe di
  // indovinare il ruolo dell'importo dalle parole (fragile): se cambia, il test lo dice.
  check('LIMITE NOTO: con la collisione, "Il tuo tesoretto: 1.500 €" passa', accepted('Il tuo tesoretto: 1.500 €.', collision))
  const healthy = ctx(300)
  const LEGIT = [
    ['it', 'Ti è rimasta impressa la spesa di oggi, eh?'], ['it', 'Ci sono rimasto male: 150 € in un colpo.'],
    ['en', 'You left €150 at the travel agency today.'], ['en', 'I’ve left the best for last: €150 of shopping.'],
  ]
  const withToday = (locale) => ctx(300, { locale, expenses: [{ id: 'e2', date: TODAY, amount: 150, categoryId: 'shopping' }] })
  for (const [locale, message] of LEGIT) check(`${locale}: "${message}" (non dice quanto resta) → accettata`, accepted(message, withToday(locale)), errorsOf(message, withToday(locale)).join(','))
  const CLAIMS = [
    ['it', 'Ti sono rimasti 150 €.'], ['it', 'Restano 150 € per il ciclo.'],
    ['en', '€150 left.'], ['en', 'You have €150 left.'], ['en', '€150 left to spend.'],
  ]
  for (const [locale, message] of CLAIMS) check(`${locale}: "${message}" (afferma quanto resta) → rifiutata`, rejectedFor('incoherent_budget', message, withToday(locale)), errorsOf(message, withToday(locale)).join(','))
  check('   (budget sano senza spese di oggi: invariato)', accepted('Il ritmo conta più della cifra.', healthy))
}

// ---------------------------------------------------------------------------
section('Rifiuto → frase locale; contratti HTTP; valute')
{
  const coach = { state: 'concerned', reason: 'budget_near_limit', message: 'Budget finito: rallentiamo un attimo.', secondaryInsightText: null }
  const { context, meta } = built(0, { events: [{ id: 'budget_near_limit', key: 'budget_near_limit', importance: 90 }] })
  const lying = createSpendyAI({ provider: { name: 't', generate: async () => answer('Puoi ancora spendere tranquillo questo ciclo!', 'happy') } })
  const { cache, result } = await requestSpendyVoice({ ai: lying, context, meta, cache: emptyVoiceCache(), today: TODAY, now: T0 })
  check('disponibile zero, il modello dice "puoi ancora spendere" (stato happy): scartata', result.ok === false && result.error === 'invalid' && result.details.includes('incoherent_budget') && result.details.includes('incoherent_state'), JSON.stringify(result))
  const decision = decideSpendyVoice({ coach, meta, today: TODAY, cache, now: T0 + 60000 })
  const voice = resolveSpendyVoice({ decision, coach, cache, context, hideAmounts: true })
  check('   frase locale, stato del coach, nessuna riga di fatti dell\'IA, niente in cache', decision.reason === 'ai_failed:invalid' && voice.source === 'local' && voice.message === coach.message && voice.state === 'concerned' && voice.secondaryText === null && cache.current === null)

  const handlerFor = (message, logs) => createSpendyAIHandler({
    aiPreference: async () => true, config: readConfig((name) => ({ AI_PROVIDER: 'anthropic', AI_MODEL: 'm', AI_API_KEY: 'k' })[name]),
    verifyUser: async () => ({ id: 'u', emailConfirmed: true }),
    callModel: async () => ({ text: JSON.stringify(answer(message)), stopReason: 'end_turn', model: 'm' }),
    quota: { reserve: async () => ({ allowed: true }), release: async () => {}, recordUsage: async () => {} }, now: () => T0, log: (entry) => logs.push(entry),
  })
  const post = (body) => new Request(functionsUrl('https://p.supabase.co'), { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  // Con un evento principale: senza, il server risponde 200 silenzioso senza chiamare il modello.
  const withEvent = (available) => built(available, { events: [{ id: 'budget_near_limit', key: 'budget_near_limit', importance: 90 }] }).context
  const okLogs = []
  const ok = await handlerFor('Il ritmo conta più della cifra.', okLogs)(post({ context: withEvent(493.6) }))
  const okBody = await ok.json()
  check('HTTP 200: stessa forma di prima ({ response: message, state, tone, layout, animation, priority, shouldShow }, provider, model), nessuna riga di fatti nel server',
    ok.status === 200 && okBody.response.shouldShow === true && okLogs.some((e) => e.outcome === 'ok') && same(Object.keys(okBody).sort(), ['model', 'provider', 'response']) && same(Object.keys(okBody.response).sort(), ['animation', 'layout', 'message', 'priority', 'shouldShow', 'state', 'tone']) && !JSON.stringify(okBody).includes('Disponibile'), JSON.stringify(okBody))
  const badLogs = []
  const bad = await handlerFor('Tutto sotto controllo, puoi ancora spendere!', badLogs)(post({ context: withEvent(0) }))
  check('HTTP 422 generico invariato; nei log solo i codici', bad.status === 422 && same(await bad.json(), { error: 'invalid', message: 'response_rejected' }) && same(badLogs.find((e) => e.outcome === 'invalid')?.errors, ['incoherent_budget']))
  check('schema JSON della risposta del modello invariato (nessun campo nuovo)', same(Object.keys(SPENDY_RESPONSE_SCHEMA.properties).sort(), ['animation', 'layout', 'message', 'priority', 'shouldShow', 'state', 'tone']))
  check('il server conserva i centesimi del disponibile (sanitizer) e la stessa condizione del client', sanitizeSpendyContext(ctx(-0.4)).budget.available === -0.4 && budgetCondition(sanitizeSpendyContext(ctx(-0.4))) === 'over' && budgetCondition(sanitizeSpendyContext(ctx(0))) === 'exhausted')
  check('valute invariate: normalizeSpendyCurrency, currencyProblems, wrong_currency', normalizeSpendyCurrency('£') === 'GBP' && same(currencyProblems('150 € e 160 $', 'GBP'), ['wrong_currency']) && rejectedFor('wrong_currency', 'That’s $160 at the restaurant.', ctx(300, { locale: 'en' })))
}

// ---------------------------------------------------------------------------
section('Fase 2B.7 — l\'importo della riga di fatti non va a capo tra cifra e simbolo')
{
  const SAMPLES = [['disponibile e quota', 1274.6], ['zero', 0], ['sforato di pochi centesimi', -0.4], ['sforato', -120.4]]
  for (const locale of SPENDY_LOCALES) {
    for (const currency of ['EUR', 'USD', 'GBP']) {
      for (const [what, available] of SAMPLES) {
        const context = ctx(available, { locale, currency })
        for (const hideAmounts of [false, true]) {
          const line = budgetFactLine(context, { hideAmounts })
          // Nessuno spazio normale (quindi nessun a capo) tra una cifra o "••••" e il simbolo, in nessun ordine.
          const breakable = /[\d•] [€$£]|[€$£] [\d•]/.test(line)
          check(`${locale} + ${currency}, ${what}${hideAmounts ? ', nascosti' : ''}: importo indivisibile, frase con gli spazi normali tra le parole`,
            !breakable && line.includes(' '), JSON.stringify(line))
        }
      }
    }
  }
  check('dove serve, lo spazio dentro l\'importo è proprio U+00A0 ("0,40 €", "•••• €")', budgetFactLine(ctx(-0.4)).includes(`0,40${NB}€`) && budgetFactLine(ctx(-0.4), { hideAmounts: true }).includes(`••••${NB}€`))
  check('in francese anche il separatore delle migliaia resta indivisibile ("1 274,60 €")', budgetFactLine(ctx(1274.6, { locale: 'fr' })).includes(`1${NB}274,60${NB}€`), JSON.stringify(budgetFactLine(ctx(1274.6, { locale: 'fr' }))))
  check('la formattazione globale non cambia: formatCurrency e maskedCurrency restano con lo spazio normale', formatCurrency(0.4, 'it', 'EUR') === '0,40 €' && maskedCurrency('it', 'EUR') === '•••• €')
  check('il testo, letto con spazi normali, è quello di prima (centesimi, 4 lingue)', facts(ctx(-0.4)) === 'Budget superato di 0,40 €.' && facts(ctx(1274.6, { locale: 'es' })) === 'Disponible: 1.274,60 €, unos 47 € al día.')
}

// ---------------------------------------------------------------------------
section('Fase 2B.7 — coach locale: obiettivo raggiunto e budget finito')
{
  const goal = { id: 'g1', label: 'Bici', target: 500, saved: 500 }
  const coachFor = (available, { goals = [goal], lang = 'it', expenses = [] } = {}) => getSpendyCoach(
    { monthlyBudget: 1500, available, spentRatio: ((1500 - available) / 1500) * 100, spentThisMonth: 1500 - available, goals },
    { today: TODAY, expenses, cycleStartDay: 7, jokeHistory: [], lang },
  )
  const healthy = coachFor(1200)
  check('budget positivo: la festa di sempre (celebrating, "offro io… virtualmente")', healthy.reason === 'goal_reached' && healthy.state === 'celebrating' && healthy.message === translate('it', 'coach.goalreached', { goal: 'Bici' }))
  // Fase 2B.8 (decisione definitiva): a disponibile ESATTAMENTE zero l'obiettivo si
  // riconosce con la frase sobria; sotto zero prevale l'avviso di budget superato
  // (prima, in 2B.7, anche sotto zero si mostrava la frase sobria).
  for (const [what, available] of [['negativo', -120], ['negativo di 0,40', -0.4]]) {
    for (const lang of SPENDY_LOCALES) {
      const c = coachFor(available, { lang })
      check(`${what}, ${lang}: prevale l'avviso di budget superato, nessuna festa al suo posto`, c.reason === 'budget_exceeded' && c.state === 'concerned' && !c.message.includes('Bici'), `${c.reason} ${c.state} ${c.message}`)
    }
  }
  for (const [what, available] of [['zero', 0]]) {
    for (const lang of SPENDY_LOCALES) {
      const c = coachFor(available, { lang })
      check(`${what}, ${lang}: obiettivo festeggiato senza mascotte festosa né invito a spendere`,
        c.reason === 'goal_reached' && c.state === 'advisor' && c.message === translate(lang, 'coach.goalreachedtight', { goal: 'Bici' }) && c.message.includes('Bici') && !/offro|on me|invito yo|moi qui offre/i.test(c.message), `${c.state} ${c.message}`)
    }
  }
  check('la frase nuova esiste nelle 4 lingue, con lo stesso segnaposto {goal}', SPENDY_LOCALES.every((lang) => translate(lang, 'coach.goalreachedtight') !== 'coach.goalreachedtight' && translate(lang, 'coach.goalreachedtight').includes('{goal}')))
  check('stato advisor → tono helpful e animazione gentle (nessuna "celebrate")', resolveSpendyVoice({ decision: { action: 'local' }, coach: coachFor(0), cache: emptyVoiceCache() }).animation !== 'celebrate' && resolveSpendyVoice({ decision: { action: 'local' }, coach: coachFor(0), cache: emptyVoiceCache() }).tone !== 'celebratory')
  check('senza obiettivo raggiunto il coach resta quello di prima (zero: budget_high; sforato: budget_exceeded)', coachFor(0, { goals: [] }).reason === 'budget_high' && coachFor(-120, { goals: [] }).reason === 'budget_exceeded')

  // "Evento positivo" (frasi di risparmio) con il disponibile a zero.
  const expenses = [{ id: 'p1', date: '2026-09-15', amount: 300, categoryId: 'spesa' }, { id: 't1', date: TODAY, amount: 50, categoryId: 'spesa' }]
  const reaction = (financialData) => evaluateExpenseReaction({ today: TODAY, expenses, monthlyBudget: 1500, cycleStartDay: 7, goals: [], financialData, jokeHistory: [], lang: 'it', rng: () => 0.5 })
  check('evento positivo con disponibile 200: invariato (positive_event, happy)', reaction({ available: 200 })?.reason === 'positive_event' && reaction({ available: 200 }).state === 'happy')
  check('evento positivo con disponibile 0: non scatta ("Soldi rimasti nel conto" non sarebbe vero)', reaction({ available: 0 }) === null)
  check('   senza financialData: comportamento di prima', reaction(null)?.reason === 'positive_event')
  check('   e il coach a zero, con la stessa spesa, avvisa (budget_high, concerned)', coachFor(0, { goals: [], expenses }).reason === 'budget_high' && coachFor(0, { goals: [], expenses }).state === 'concerned')

  // Il percorso completo: l'IA festeggia a budget finito → rifiutata → coach locale coerente.
  const { context, meta } = built(0, { events: [{ id: 'goal_reached', key: 'goal_reached:g1', importance: 100 }], goals: [goal] })
  const festive = createSpendyAI({ provider: { name: 't', generate: async () => answer('Bici raggiunta! Festeggiamo, te lo meriti.', 'celebrating') } })
  const { cache, result } = await requestSpendyVoice({ ai: festive, context, meta, cache: emptyVoiceCache(), today: TODAY, now: T0 })
  const coach = coachFor(0)
  const decision = decideSpendyVoice({ coach, meta, today: TODAY, cache, now: T0 + 60000 })
  const voice = resolveSpendyVoice({ decision, coach, cache, context })
  check('IA festosa a budget zero: rifiutata (incoherent_state)', result.ok === false && result.details.includes('incoherent_state'), JSON.stringify(result))
  check('   fallback: coach locale, obiettivo festeggiato con stato advisor, nessuna animazione celebrate', voice.source === 'local' && voice.state === 'advisor' && voice.animation !== 'celebrate' && voice.message.includes('Bici'), JSON.stringify(voice))
}

report('Spendy AI — coerenza con il budget e riga di fatti (Fase 2B.5 + 2B.7)')
