// Fase 2B.3: soluzione strutturale per il budget e regressioni dell'audit 2B.2.
// `npm test`, senza rete e senza chiamate a pagamento.
//
// Verificato qui:
//   - BUDGET SFORATO (strutturale): il modello non scrive importi; l'app
//     scrive sotto la frase "Budget superato di 120 €" dai suoi dati, nella
//     lingua e nella valuta dell'account (budgetFactLine);
//   - R1  verbi di permesso e frasi di "resto" a budget sforato, con e senza
//         importi; a budget sano "restano X" solo con il disponibile, la quota
//         giornaliera o quanto manca all'obiettivo;
//   - R2  parole di sforamento generiche ("oltre", "over", "de plus", "de
//         más") non autorizzano più nulla;
//   - R3  sforamento affermato con il budget sano;
//   - R4  segni meno Unicode; negativo contabile "(€494)";
//   - R5  importi senza simbolo non diventano conteggi;
//   - R6  numeri in lettere (senza valuta, col trattino, approssimativi,
//         gergo) e i loro falsi positivi;
//   - R7/R8 cifre non standard e caratteri invisibili vicino alle cifre;
//   - R9  etichette fatte di cifre;
//   - FP1–FP4 dell'audit 2B.2;
//   - rifiuto → frase locale, server 422, cache delle regole precedenti scartata.
//   - Fase 2B.5: la riga di fatti ha i centesimi e il formato della BudgetCard
//     ("120,00 €", "494,00 €"; prima "120 €", arrotondato) e in italiano dice
//     "Disponibile" come la card (prima "Disponibili"): aspettative aggiornate.
//   - Fase 2B.4: le cifre del budget (disponibile, quota giornaliera, budget,
//     speso) le scrive solo l'app, anche a budget sano; saldo e disponibilità
//     non si affermano con importi del modello.

import { check, section, report } from '../sync/testkit.mjs'
import {
  validateSpendyResponse, sanitizeSpendyContext, buildSpendyPrompt, authorizedNumbers, isOverBudget,
  normalizeSpendyCurrency, currencyProblems, SPENDY_LOCALES,
} from '../../supabase/functions/_shared/spendyAIRules.js'
import { createSpendyAIHandler, readConfig } from '../../supabase/functions/spendy-ai/handler.js'
import { createSpendyAI } from './spendyAI.js'
import { budgetFactLine, voiceFromAI, decideSpendyVoice, requestSpendyVoice, resolveSpendyVoice } from './spendyVoicePolicy.js'
import { emptyVoiceCache, loadVoiceCache, VOICE_CACHE_VERSION } from './spendyVoiceCache.js'
import { createMockProvider } from './providers/mockProvider.js'
import { functionsUrl } from './providers/remoteProvider.js'

const TODAY = '2026-10-11'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// Fase 2B.7: nella riga di fatti gli spazi DENTRO un importo sono non separabili
// ("0,40 €" non va a capo). I confronti di testo qui sotto li leggono come spazi
// normali; lo spazio non separabile è verificato a parte (Fase 2B.7).
const NB = '\u00a0'
const nbspToSpace = (text) => (typeof text === 'string' ? text.replaceAll(NB, ' ') : text)
const facts = (...args) => nbspToSpace(budgetFactLine(...args))
const answer = (message, state = 'attentive') => ({ message, state, tone: 'friendly', layout: 'left', animation: 'gentle', priority: 60, shouldShow: true })

// Budget sano (lo stesso dell'audit): disponibile 494, quota 18, obiettivo -1200.
const healthy = (locale = 'it', currency = 'EUR', extra = {}) => sanitizeSpendyContext({
  version: 1, locale, currency, today: TODAY,
  budget: { monthly: 1500, spent: 1006, available: 494, spentPercent: 67, daysRemaining: 26, cyclePhase: 'start', dayOfCycle: 5, cycleDays: 31, band: 'ok', dailyAllowance: 18 },
  spending: { today: 150 },
  primaryEvent: { id: 'category_above_usual', importance: 72, category: 'Ristorante', cycle: { current: 160, usual: 55, difference: 105, changePercent: 191 } },
  otherEvents: [{ id: 'frequency_up', importance: 55, category: 'Bar' }],
  goal: { label: 'Vacanze 2027', percent: 40, missing: 1200 },
  suggestedState: 'attentive',
  ...extra,
})
// Budget sforato di 120.
const over = (locale = 'it', currency = 'EUR') => sanitizeSpendyContext({
  version: 1, locale, currency, today: TODAY,
  budget: { monthly: 1500, spent: 1620, available: -120, spentPercent: 108, daysRemaining: 9, cyclePhase: 'second_half', dayOfCycle: 22, cycleDays: 31, band: 'exceeded' },
  spending: { today: 45 },
  primaryEvent: { id: 'budget_exceeded', importance: 95 },
  otherEvents: [], goal: null, suggestedState: 'concerned',
})
// Frequenza al bar: 7 acquisti questo ciclo, di solito 3.
const frequency = (locale = 'it') => sanitizeSpendyContext({
  version: 1, locale, currency: 'EUR', today: TODAY,
  budget: { monthly: 1500, spent: 300, available: 1200, spentPercent: 20, daysRemaining: 20, cyclePhase: 'first_half', dayOfCycle: 11, cycleDays: 31, band: 'ok' },
  spending: { today: 12 },
  primaryEvent: { id: 'frequency_up', importance: 60, category: 'Bar', purchases: { current: 7, usual: 3 } },
  otherEvents: [], goal: null, suggestedState: 'ironic',
})
const errorsOf = (message, context) => validateSpendyResponse(answer(message, isOverBudget(context) ? 'concerned' : 'attentive'), context).errors ?? []
const accepted = (message, context) => validateSpendyResponse(answer(message, isOverBudget(context) ? 'concerned' : 'attentive'), context).valid === true
const rejectedFor = (code, message, context) => errorsOf(message, context).some((e) => e === code || e.startsWith(`${code}:`))

// ---------------------------------------------------------------------------
section('Budget sforato — strutturale: nessun importo dal modello, l\'importo lo scrive l\'app')
{
  check('isOverBudget: available negativo o fascia exceeded', isOverBudget(over()) && !isOverBudget(healthy()) && isOverBudget({ budget: { available: 0, band: 'exceeded' } }))
  const FACTS = {
    it: { EUR: 'Budget superato di 120,00 €.', USD: 'Budget superato di 120 USD.', GBP: 'Budget superato di 120 GBP.' },
  }
  check('riga di fatti in italiano, euro: "Budget superato di 120,00 €."', facts(over()) === FACTS.it.EUR, facts(over()))
  for (const locale of SPENDY_LOCALES) {
    for (const currency of ['EUR', 'USD', 'GBP']) {
      const line = facts(over(locale, currency))
      const symbol = { EUR: '€', USD: '$', GBP: '£' }[currency]
      check(`${locale} + ${currency}: riga di fatti con 120 e ${symbol}, senza segno meno`, typeof line === 'string' && line.includes('120') && line.includes(symbol) && !/[-−]/.test(line), line)
    }
  }
  check('   en: "Over budget by €120.00."; es: "Presupuesto superado en 120,00 €."; fr: "Budget dépassé de 120,00 €."',
    facts(over('en')) === 'Over budget by €120.00.' && facts(over('es')) === 'Presupuesto superado en 120,00 €.' && facts(over('fr')) === 'Budget dépassé de 120,00 €.',
    [facts(over('en')), facts(over('es')), facts(over('fr'))].join(' | '))
  // Fase 2B.4: anche a budget sano la riga di fatti c'è: il disponibile lo scrive l'app.
  check('budget sano: riga di fatti con disponibile e quota ("Disponibile: 494,00 €, circa 18 € al giorno.")', facts(healthy()) === 'Disponibile: 494,00 €, circa 18 € al giorno.' && facts(null) === null, facts(healthy()))
  check('voiceFromAI: la riga di fatti accompagna la frase del modello, che resta com\'è', (() => {
    const voice = voiceFromAI({ message: 'Siamo oltre il budget: rallentiamo.', state: 'concerned', tone: 'concerned', layout: 'overlap', animation: 'concerned' }, over())
    return voice.message === 'Siamo oltre il budget: rallentiamo.' && nbspToSpace(voice.secondaryText) === 'Budget superato di 120,00 €.'
  })())

  const LIES = {
    it: ['Puoi ancora spendere 1.500 € questo ciclo.', 'Hai un margine di 1.500 € per il ciclo.', 'Budget di 1.500 €: tranquillo, c’è spazio.', 'Ti restano ancora 120 € oltre le spese di oggi.'],
    en: ['You can still spend €1,500 this cycle.', 'Over the next 9 days you still have €120 to spend.'],
    es: ['Todavía puedes gastar 1.500 € este ciclo.', 'Te quedan 120 € de más para gastar.'],
    fr: ['Tu peux encore dépenser 1 500 € ce cycle.', 'Il te reste 120 € de plus à dépenser.'],
  }
  for (const [locale, messages] of Object.entries(LIES)) {
    for (const message of messages) check(`R1/R2 ${locale}: "${message}" → rifiutata (money_when_over_budget)`, rejectedFor('money_when_over_budget', message, over(locale)), errorsOf(message, over(locale)).join(','))
  }
  const NO_AMOUNT_LIES = {
    it: ['Puoi ancora spendere tranquillo questo ciclo.', 'Ti restano ancora un po’ di soldi.', 'C’è ancora margine, nessun problema.'],
    en: ['You can still spend a bit this cycle.', 'You still have some money left.'],
    es: ['Todavía puedes gastar un poco.', 'Te queda dinero de sobra.'],
    fr: ['Tu peux encore dépenser un peu.', 'Il te reste de l’argent.'],
  }
  for (const [locale, messages] of Object.entries(NO_AMOUNT_LIES)) {
    for (const message of messages) check(`R1 ${locale}: permesso o "resto" senza importi ("${message}") → incoherent_budget`, rejectedFor('incoherent_budget', message, over(locale)), errorsOf(message, over(locale)).join(','))
  }
  const HONEST = {
    it: 'Siamo oltre il budget, con 9 giorni ancora davanti: rallentiamo.',
    en: 'We are over budget with 9 days to go: let’s slow down.',
    es: 'Estamos por encima del presupuesto y quedan 9 días: frenemos un poco.',
    fr: 'Le budget est dépassé et il reste 9 jours : on ralentit.',
  }
  for (const [locale, message] of Object.entries(HONEST)) check(`${locale}: sforamento detto senza importi → accettata ("${message}")`, accepted(message, over(locale)), errorsOf(message, over(locale)).join(','))
  check('giorni e percentuale verificati restano leciti ("108%", "9 giorni")', accepted('Sei al 108% del budget: 9 giorni per rimettersi in pari.', over()))
}

section('R1 a budget sano: con un importo, "restano / puoi spendere" li dice solo l\'app')
{
  check('"Ti restano 1.500 €" (è il budget, non il disponibile) → rifiutata', rejectedFor('reserved_amount', 'Ti restano 1.500 € per il ciclo.', healthy()) && rejectedFor('incoherent_budget', 'Ti restano 1.500 € per il ciclo.', healthy()))
  check('"You can spend €1,006" → rifiutata', rejectedFor('reserved_amount', 'You can spend €1,006 this cycle.', healthy('en')))
  // Fase 2B.4: anche le affermazioni VERE con le cifre del budget passano dall'app
  // (prima 2B.3 le accettava): il modello non sceglie più quale cifra chiamare "disponibile".
  const TRUE_BUT_APP_ONLY = [
    ['it', 'Ti restano 494 € per il ciclo.'], ['en', 'You have €494 left.'], ['es', 'Te quedan 494 € y 26 días.'], ['fr', 'Il te reste 494 € et 26 jours.'],
    ['it', 'Puoi spendere circa 18 € al giorno.'], ['en', 'You can spend about €18 a day.'], ['it', 'Restano 494 € dei 1.500 € del budget.'],
  ]
  for (const [locale, message] of TRUE_BUT_APP_ONLY) check(`${locale}: "${message}" → rifiutata (reserved_amount: la scrive l'app)`, rejectedFor('reserved_amount', message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  check('quanto manca all\'obiettivo, in una frase sull\'obiettivo, resta lecito', accepted('Il te reste 1 200 € à mettre de côté pour l’objectif.', healthy('fr')) && accepted('Per Vacanze 2027 ti restano 1.200 € da mettere da parte.', healthy()), errorsOf('Il te reste 1 200 € à mettre de côté pour l’objectif.', healthy('fr')).join(','))
}

section('R2 — le parole di sforamento non autorizzano più niente')
{
  check('a budget sano "oltre / over" non cambiano nulla: importi veri sì, inventati no', accepted('Ristorante: 105 € oltre il solito.', healthy()) && rejectedFor('invented_numbers', 'Ristorante: 999 € oltre il solito.', healthy()))
  check('a budget sforato "oltre / over / de plus / de más" non rendono lecito un importo', [['it', 'Sei oltre di 120 €.'], ['en', 'You are €120 over.'], ['fr', 'Tu as 120 € de plus.'], ['es', 'Tienes 120 € de más.']].every(([locale, text]) => rejectedFor('money_when_over_budget', text, over(locale))))
}

section('R3 — sforamento affermato con il budget sano')
{
  const FALSE_OVER = { it: 'Sei oltre il budget di 494 €.', en: 'You are €494 over budget.', es: 'Estás por encima del presupuesto: 494 €.', fr: 'Tu as dépassé le budget de 494 €.' }
  for (const [locale, message] of Object.entries(FALSE_OVER)) check(`${locale}: "${message}" con 494 € ancora disponibili → incoherent_budget`, rejectedFor('incoherent_budget', message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  check('"sopra la media" / "above your usual" (non il budget) restano lecite', accepted('Ristorante sopra la media: 160 € contro 55 €.', healthy()) && accepted('Restaurants above your usual: €160 vs €55.', healthy('en')))
}

// ---------------------------------------------------------------------------
section('R4 — segni meno Unicode e negativo contabile')
{
  for (const dash of ['-', '−', '–', '—', '‒', '－', '﹣']) {
    check(`"${dash}494 €" attaccato → negativo (invented_numbers:-494), mai +494`, rejectedFor('invented_numbers', `Il saldo è ${dash}494 €.`, healthy()) && errorsOf(`Il saldo è ${dash}494 €.`, healthy()).includes('invented_numbers:-494'))
  }
  check('trattino con spazi intorno = punteggiatura ("Oggi – 150 € di ristorante")', accepted('Oggi – 150 € di ristorante, niente male.', healthy()))
  check('"(€494)" / "($1,200)" (negativo contabile) → malformed_number', rejectedFor('malformed_number', 'Your balance is (€494).', healthy('en')) && rejectedFor('malformed_number', 'Your goal: ($1,200).', healthy('en', 'USD')))
  check('"(160 €)" come inciso resta lecito', accepted('Il ristorante (160 €) guida il ciclo.', healthy()))
}

section('R5 — importi senza simbolo non diventano conteggi')
{
  const ctx = frequency()
  for (const message of ['Hai speso 7 questo ciclo.', 'Hai speso 7 al bar oggi.', 'Hai speso 7 di spese al bar.']) {
    check(`"${message}" (7 sono gli acquisti) → rifiutata`, rejectedFor('invented_numbers', message, ctx), errorsOf(message, ctx).join(','))
  }
  check('en: "You spent 3 this cycle" (3 = acquisti soliti) → rifiutata', rejectedFor('invented_numbers', 'You spent 3 this cycle.', frequency('en')))
  check('conteggi veri: "7 volte, di solito 3", "7 caffè", "7 acquisti contro 3"', ['Bar: 7 volte questo ciclo, di solito 3.', '7 caffè al bar questo ciclo.', 'Bar: 7 acquisti contro 3.'].every((text) => accepted(text, ctx)), ['Bar: 7 volte questo ciclo, di solito 3.', '7 caffè al bar questo ciclo.', 'Bar: 7 acquisti contro 3.'].map((t) => errorsOf(t, ctx).join(',')).join(' | '))
  check('"una parola qualsiasi + ciclo" non è più un conteggio ("7 bei cicli")', rejectedFor('invented_numbers', 'Hai speso 7 bei cicli.', ctx))
}

// ---------------------------------------------------------------------------
section('R6 — numeri in lettere: nuove forme coperte, senza i falsi positivi')
{
  const COVERED = {
    it: ['Hai speso mille in shopping.', 'Mille bei euro in shopping.', 'Una ventina di euro al bar.', 'Hai speso una decina al bar.', 'Hai speso centocinquanta al ristorante.'],
    en: ['You dropped a thousand on clothes.', 'A thousand-euro dinner, really?', 'Two grand on clothes.', 'You spent a couple hundred at the bar.', 'You spent a grand on shoes.'],
    es: ['Veintiún euros en el bar.', 'Gastaste mil en ropa.', 'Una decena de euros en el bar.', 'Gastaste unos doscientos en el bar.'],
    fr: ['Une vingtaine d’euros au bar.', 'Mille balles de shopping.', 'Tu as dépensé deux cents au restaurant.', 'Une dizaine d’euros au café.'],
  }
  for (const [locale, messages] of Object.entries(COVERED)) {
    for (const message of messages) check(`${locale}: "${message}" → number_in_words`, rejectedFor('number_in_words', message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  }
  const FREE = {
    it: ['Mille grazie: restano 494 €.', 'Tre volte al bar e 150 € di ristorante.', 'Un caffè e 150 € di ristorante.', 'Cento di questi giorni: 494 € per il ciclo.'],
    en: ['A grand total of €150 today.', 'I lost two pounds this week and kept €494.', 'One more coffee and €150 at the restaurant.'],
    es: ['Dos veces al bar y 150 € en restaurantes.', 'Una libra de café y 150 € en restaurantes.'],
    fr: ['Un livre et 150 € de restaurant.', 'Cent fois rien, c’est rien : 150 € quand même.'],
  }
  for (const [locale, messages] of Object.entries(FREE)) {
    for (const message of messages) check(`${locale}: "${message}" → nessun number_in_words`, !rejectedFor('number_in_words', message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  }
}

section('R7 / R8 — cifre non standard e caratteri invisibili vicino alle cifre')
{
  const ODD = ['Hai speso ¹²³⁴ € oggi.', 'Hai speso ① ② ③ € oggi.', 'Hai speso ½ € oggi.', 'Hai speso Ⅻ € oggi.', 'Hai speso 150\u200b494 € oggi.', 'Hai speso 150\u2060494 € oggi.', 'Hai speso 150\u00ad494 € oggi.', 'Hai speso 150\u2007494 € oggi.', 'Hai speso 150\u2002494 € oggi.', 'Hai speso \u200b150 € oggi.']
  for (const message of ODD) check(`${JSON.stringify(message)} → malformed_number`, rejectedFor('malformed_number', message, healthy()), errorsOf(message, healthy()).join(','))
  check('spazi del francese (NBSP, NNBSP) restano leciti', accepted('Il reste 1\u00a0200 € pour l’objectif.', healthy('fr')) && accepted('Il reste 1\u202f200 € pour l’objectif.', healthy('fr')))
  check('un carattere invisibile lontano dalle cifre non conta', accepted('Ciao\u200b, 150 € di ristorante oggi.', healthy()))
}

section('R9 — un\'etichetta fatta di cifre non cancella gli importi')
{
  const ctx = healthy('it', 'EUR', { goal: { label: '500', percent: 40, missing: 1200 } })
  check('obiettivo "500": "Hai speso 500 € al ristorante" → invented_numbers:500', errorsOf('Hai speso 500 € al ristorante.', ctx).includes('invented_numbers:500'))
  check('   lo stesso nome tra virgolette si può citare', accepted('Per "500" mancano 1.200 €.', ctx), errorsOf('Per "500" mancano 1.200 €.', ctx).join(','))
  check('   un nome con lettere e cifre ("Vacanze 2027") si cita anche senza virgolette', accepted('Per Vacanze 2027 mancano 1.200 €.', healthy()))
  check('un nome si toglie solo come parola intera ("Bar" non dentro "Barcellona 2027 €")', rejectedFor('invented_numbers', 'Barcellona: 2027 € di sogni.', healthy()))
}

// ---------------------------------------------------------------------------
section('FP1–FP4 — falsi positivi dell\'audit 2B.2')
{
  const FP1 = { it: '150 € una bella cifra per un giorno solo.', es: 'Hoy 150 € un poco por encima de lo normal.', fr: 'Aujourd’hui 150 € une belle somme.', en: 'Today €150, one dinner to remember.' }
  for (const [locale, message] of Object.entries(FP1)) check(`FP1 ${locale}: "${message}" → accettata`, accepted(message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  check('FP1 it: "Oggi 150 € un po’ sopra le righe" → accettata', accepted('Oggi 150 € un po’ sopra le righe.', healthy()))
  // Fase 2B.4: con un importo dell'evento (160, ristorante); 1.006 è il totale speso, cifra del budget.
  const FP2 = { it: 'Al ristorante hai speso 160 questo ciclo.', en: 'You spent 160 at restaurants this cycle.', es: 'Has gastado 160 en restaurantes este ciclo.', fr: 'Tu as dépensé 160 au restaurant ce cycle.' }
  for (const [locale, message] of Object.entries(FP2)) check(`FP2 ${locale}: "${message}" (importo senza simbolo) → accettata`, accepted(message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  check('FP3 fr: "encore" non è più "ti resta" (budget sano e sforato)', accepted('Encore 150 € au restaurant aujourd’hui.', healthy('fr')) && accepted('Encore un effort : le budget est dépassé, il reste 9 jours.', over('fr')))
  const DATES = [
    ['it', 'Il ciclo finisce il 6 novembre: intanto 160 € al ristorante.'], ['en', 'The cycle ends on November 6: €160 at restaurants so far.'], ['es', 'El ciclo termina el 6 de noviembre: 160 € en restaurantes.'],
    ['fr', 'Le cycle se termine le 6 novembre : 160 € au restaurant.'], ['it', 'Il nuovo ciclo parte il 7 novembre.'], ['it', 'Il ciclo è iniziato il 7 ottobre: 160 € al ristorante.'],
  ]
  for (const [locale, message] of DATES) check(`FP4 ${locale}: date del ciclo ("${message}") → accettata`, accepted(message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  check('FP4: una data fuori dal ciclo resta inventata ("5 novembre")', rejectedFor('invented_date', 'Il ciclo finisce il 5 novembre.', healthy()))
  check('FP4: "27 giorni compreso oggi", "il 1° giorno", "5 su 31", "day 5 of 31"', ['Mancano 27 giorni compreso oggi: 160 € al ristorante finora.', 'Il 1° giorno del ciclo sembra lontano.', 'Mancano 26 giorni: 5 su 31 sono passati.'].every((t) => accepted(t, healthy())) && accepted('Day 5 of 31 and €150 already.', healthy('en')),
    ['Mancano 27 giorni compreso oggi: 160 € al ristorante finora.', 'Il 1° giorno del ciclo sembra lontano.', 'Mancano 26 giorni: 5 su 31 sono passati.'].map((t) => errorsOf(t, healthy()).join(',')).join(' | '))
  check('FP4 (scelta documentata): orari, durate e percentuali calcolate non sono dati di Spendy → rifiutati', rejectedFor('invented_numbers', 'Alle 13:30 già 150 € di ristorante.', healthy()) && rejectedFor('invented_numbers', 'In 2 settimane 150 € al ristorante.', healthy()) && rejectedFor('invented_numbers', 'Restano 494 € (il 33% del budget).', healthy()))
  check('anno: "nel 2026" sì; "a total of 2026" / "un gasto de 2026" sono importi → rifiutati', accepted('Nel 2026 il ristorante è a 160 €.', healthy()) && rejectedFor('invented_numbers', 'You spent a total of 2026 this cycle.', healthy('en')) && rejectedFor('invented_numbers', 'Llevas un gasto de 2026 este ciclo.', healthy('es')))
}

// ---------------------------------------------------------------------------
section('Rifiuto → frase locale; server; cache delle regole precedenti')
{
  const coach = { state: 'concerned', reason: 'budget_exceeded', message: 'Budget superato: da qui conta ogni piccola spesa.' }
  const meta = { fingerprint: 'exceeded|budget_exceeded', facts: '{"x":1}', eventKey: 'budget_exceeded', importance: 95 }
  const lie = createSpendyAI({ provider: { name: 'test', generate: async () => answer('Puoi ancora spendere 1.500 € questo ciclo.', 'concerned') } })
  const { cache, result } = await requestSpendyVoice({ ai: lie, context: over(), meta, cache: emptyVoiceCache(), today: TODAY, now: Date.parse('2026-10-11T10:00:00Z') })
  check('il modello che dice "puoi spendere 1.500 €" a budget sforato: scartato (invalid)', result.ok === false && result.error === 'invalid' && result.details.includes('money_when_over_budget'), JSON.stringify(result))
  const decision = decideSpendyVoice({ coach, meta, today: TODAY, cache, now: Date.parse('2026-10-11T11:00:00Z') })
  const voice = resolveSpendyVoice({ decision, coach, cache, context: over() })
  check('   l\'utente vede la frase locale, nessun retry, nessuna traccia della frase scartata', decision.reason === 'ai_failed:invalid' && voice.source === 'local' && voice.message === coach.message && !JSON.stringify(cache).includes('1.500'))

  const mock = createSpendyAI({ provider: createMockProvider({ latencyMs: 0 }) })
  const ok = await mock.generate(over())
  check('il mock a budget sforato produce una frase valida, senza importi', ok.ok === true && !/€|\$|£/.test(ok.response.message), JSON.stringify(ok.response?.message ?? ok))
  const mockMeta = { ...meta, fingerprint: 'mock' }
  const run = await requestSpendyVoice({ ai: mock, context: over('en', 'USD'), meta: mockMeta, cache: emptyVoiceCache(), today: TODAY, now: Date.parse('2026-10-11T10:00:00Z') })
  const cached = resolveSpendyVoice({ decision: decideSpendyVoice({ coach, meta: mockMeta, today: TODAY, cache: run.cache, now: Date.parse('2026-10-11T10:05:00Z') }), coach, cache: run.cache, context: over('en', 'USD') })
  check('dalla cache: frase del modello + riga di fatti dell\'app (en, USD: "Over budget by $120.00.")', cached.source === 'ai' && nbspToSpace(cached.secondaryText) === 'Over budget by $120.00.', JSON.stringify(cached))

  const logs = []
  const handler = createSpendyAIHandler({
    aiPreference: async () => true, config: readConfig((name) => ({ AI_PROVIDER: 'anthropic', AI_MODEL: 'm', AI_API_KEY: 'k' })[name]),
    verifyUser: async () => ({ id: 'u', emailConfirmed: true }),
    callModel: async () => ({ text: JSON.stringify(answer('Sei sopra il budget di 120 €.', 'concerned')), stopReason: 'end_turn', model: 'm' }),
    quota: { reserve: async () => ({ allowed: true }), release: async () => {}, recordUsage: async () => {} }, now: () => Date.parse('2026-10-11T10:00:00Z'), log: (entry) => logs.push(entry),
  })
  const res = await handler(new Request(functionsUrl('https://p.supabase.co'), { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify({ context: over() }) }))
  const body = await res.json()
  check('server: importo a budget sforato → 422 generico, nei log solo "money_when_over_budget"', res.status === 422 && same(body, { error: 'invalid', message: 'response_rejected' }) && same(logs.find((e) => e.outcome === 'invalid')?.errors, ['money_when_over_budget']))

  const storage = { data: { 'spendy-ai-voice:guest': JSON.stringify({ ...emptyVoiceCache(), version: 1, current: { fingerprint: 'f', day: TODAY, voice: { message: 'Ti restano 120 €' }, facts: 'x' } }) }, getItem(key) { return this.data[key] ?? null }, setItem() {} }
  check(`cache versione ${VOICE_CACHE_VERSION}: le frasi salvate con le regole precedenti (v1) si scartano`, VOICE_CACHE_VERSION === 2 && loadVoiceCache(storage).current === null)
}

section('Valute e lingue: le modifiche della fase valuta restano')
{
  check('normalizeSpendyCurrency e currencyProblems invariati', normalizeSpendyCurrency('$') === 'USD' && same(currencyProblems('150 € e 160 $', 'GBP'), ['wrong_currency']))
  check('importi nella valuta sbagliata ancora rifiutati', rejectedFor('wrong_currency', 'That’s $160 at the restaurant.', healthy('en')) && accepted('That’s $160 at the restaurant.', healthy('en', 'USD')))
  check('prompt: sezione VALUTA per USD senza "€", e la regola del budget sforato', (() => {
    const usd = buildSpendyPrompt(healthy('en', 'USD')).system
    return usd.includes('VALUTA') && !usd.includes('€') && usd.includes('NON scrivere importi') && usd.includes('lo scrive l\'app')
  })())
  check('date del ciclo calcolate dal contesto (inizio 7/10, fine 6/11, prossimo 7/11)', same(authorizedNumbers(healthy()).dates, [{ year: 2026, month: 10, day: 11 }, { year: 2026, month: 10, day: 7 }, { year: 2026, month: 11, day: 6 }, { year: 2026, month: 11, day: 7 }]))
}

// ---------------------------------------------------------------------------
section('Fase 2B.4 — cifre del budget scritte solo dall\'app; saldo e disponibilità mai inventati')
{
  // Il caso dell'audit 2B.3: 1.500 è il budget del ciclo, il disponibile è 494.
  const BUDGET_AS_BALANCE = {
    it: ['Hai in cassa 1.500 €.', 'Il tuo saldo è 1.500 €.', 'Sul conto hai 1.500 €.', 'Hai 1.500 € a disposizione.'],
    en: ['You have €1,500 in your account.', 'Your balance is €1,500.', 'You’ve got €1,500 to play with.'],
    es: ['Tienes 1.500 € en tu cuenta.', 'Tu saldo es de 1.500 €.', 'Cuentas con 1.500 € este ciclo.'],
    fr: ['Tu as 1 500 € sur ton compte.', 'Ton solde est de 1 500 €.', 'Tu disposes de 1 500 € ce cycle.'],
  }
  for (const [locale, messages] of Object.entries(BUDGET_AS_BALANCE)) {
    for (const message of messages) check(`${locale}: "${message}" (1.500 = budget, non disponibile) → reserved_amount`, rejectedFor('reserved_amount', message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  }
  check('   la garanzia non dipende dalle parole: anche una formulazione mai vista ("Il tesoretto del mese: 1.500 €") è rifiutata', rejectedFor('reserved_amount', 'Il tesoretto del mese: 1.500 €, che bello.', healthy()))
  const ALL_BUDGET_FIGURES = { 'disponibile (494)': 'Ecco 494 € per te.', 'quota giornaliera (18)': 'Ecco 18 € per te.', 'budget (1.500)': 'Ecco 1.500 € per te.', 'speso (1.006)': 'Ecco 1.006 € per te.' }
  for (const [what, message] of Object.entries(ALL_BUDGET_FIGURES)) check(`ogni cifra del budget è riservata: ${what}`, rejectedFor('reserved_amount', message, healthy()), errorsOf(message, healthy()).join(','))
  const INVENTED = { it: 'Il tuo saldo è 777 €.', en: 'Your balance is €777.', es: 'Tu saldo es de 777 €.', fr: 'Ton solde est de 777 €.' }
  for (const [locale, message] of Object.entries(INVENTED)) check(`${locale}: saldo inventato ("${message}") → invented_numbers:777`, errorsOf(message, healthy(locale)).includes('invented_numbers:777'))
  check('quota giornaliera inventata ("puoi spendere 25 € al giorno") → rifiutata', rejectedFor('invented_numbers', 'Puoi spendere 25 € al giorno.', healthy()) && rejectedFor('incoherent_budget', 'Puoi spendere 25 € al giorno.', healthy()))
  const EVENT_AS_BALANCE = { it: 'Hai in cassa 160 €.', en: 'Your balance is €160.', es: 'Te quedan 160 €.', fr: 'Il te reste 160 €.' }
  for (const [locale, message] of Object.entries(EVENT_AS_BALANCE)) check(`${locale}: un importo dell'evento presentato come saldo ("${message}") → incoherent_budget`, rejectedFor('incoherent_budget', message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  check('quanto manca all\'obiettivo SENZA parlare dell\'obiettivo ("Ti restano 1.200 €") → incoherent_budget', rejectedFor('incoherent_budget', 'Ti restano 1.200 €.', healthy()))
  // L'eccezione dell'obiettivo vale SOLO per "quanto manca": un altro importo in una frase sull'obiettivo resta un saldo inventato.
  for (const [locale, message] of [['it', 'Per Vacanze 2027 ti restano 160 €.'], ['en', 'For your goal you have €160 left.'], ['es', 'Para el objetivo te quedan 160 €.'], ['fr', 'Pour l’objectif, il te reste 160 €.']]) {
    check(`${locale}: frase sull'obiettivo con un importo che non è "quanto manca" ("${message}") → incoherent_budget`, rejectedFor('incoherent_budget', message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  }
  const EVENT_OK = {
    it: ['Ristorante a 160 € contro i soliti 55 €: ciclo speciale?', 'Oggi 150 € in un colpo solo.', 'Mancano 1.200 € a Vacanze 2027.'],
    en: ['Restaurants at €160 vs your usual €55: special cycle?', '€150 in one go today.'],
    es: ['Restaurantes a 160 € frente a los 55 € habituales.', 'Hoy 150 € de golpe.'],
    fr: ['Restaurants à 160 € contre 55 € d’habitude.', 'Aujourd’hui 150 € d’un coup.'],
  }
  for (const [locale, messages] of Object.entries(EVENT_OK)) {
    for (const message of messages) check(`${locale}: importi dell'evento ("${message}") → accettata`, accepted(message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  }
  const MOTIVATIONAL = {
    it: ['Un passo alla volta: il budget regge.', 'Sei al 67% del budget: con calma si arriva in fondo.', 'Mancano 26 giorni: tutto sotto controllo.'],
    en: ['One step at a time: the budget is holding up.', 'You’re at 67% of the budget: steady does it.'],
    es: ['Paso a paso: el presupuesto aguanta.', 'Vas por el 67 % del presupuesto: con calma.'],
    fr: ['Un pas après l’autre : le budget tient bon.', 'Tu es à 67 % du budget : on garde le rythme.'],
  }
  for (const [locale, messages] of Object.entries(MOTIVATIONAL)) {
    for (const message of messages) check(`${locale}: motivazionale senza importi ("${message}") → accettata`, accepted(message, healthy(locale)), errorsOf(message, healthy(locale)).join(','))
  }
  check('importi, percentuali e giorni restano distinti ("67 €" no, "67%" sì; "26 €" no, "26 giorni" sì)', rejectedFor('invented_numbers', 'Hai speso 67 € oggi.', healthy()) && accepted('Sei al 67% del budget.', healthy()) && rejectedFor('invented_numbers', 'Ancora 26 € e poi basta.', healthy()) && accepted('Mancano 26 giorni.', healthy()))

  for (const locale of SPENDY_LOCALES) {
    for (const currency of ['EUR', 'USD', 'GBP']) {
      const line = facts(healthy(locale, currency))
      const symbol = { EUR: '€', USD: '$', GBP: '£' }[currency]
      check(`riga di fatti a budget sano, ${locale} + ${currency}: 494 e 18 con ${symbol}`, typeof line === 'string' && line.includes('494') && line.includes('18') && line.includes(symbol), line)
    }
  }
  check('   en / es / fr: "Available: €494.00, about €18 a day." / "Disponible: 494,00 €, unos 18 € al día." / "Disponible : 494,00 €, environ 18 € par jour."',
    facts(healthy('en')) === 'Available: €494.00, about €18 a day.' && facts(healthy('es')) === 'Disponible: 494,00 €, unos 18 € al día.' && facts(healthy('fr')).replace(/\s/g, ' ') === 'Disponible : 494,00 €, environ 18 € par jour.',
    [facts(healthy('en')), facts(healthy('es')), facts(healthy('fr'))].join(' | '))
  check('senza quota giornaliera: solo il disponibile ("Disponibile: 0,00 €.")', facts({ locale: 'it', currency: 'EUR', budget: { available: 0, band: 'high' } }) === 'Disponibile: 0,00 €.')
  check('budget negativo: il contratto della 2B.3 resta ("Budget superato di 120,00 €.")', facts(over()) === 'Budget superato di 120,00 €.' && rejectedFor('money_when_over_budget', 'Ti restano 120 €.', over()))
  const voice = voiceFromAI({ message: 'Ristorante a 160 €: ciclo speciale?', state: 'attentive', tone: 'friendly', layout: 'left', animation: 'gentle' }, healthy())
  check('voiceFromAI a budget sano: frase del modello + riga di fatti dell\'app', voice.message === 'Ristorante a 160 €: ciclo speciale?' && nbspToSpace(voice.secondaryText) === 'Disponibile: 494,00 €, circa 18 € al giorno.')

  const logs = []
  const handler = createSpendyAIHandler({
    aiPreference: async () => true, config: readConfig((name) => ({ AI_PROVIDER: 'anthropic', AI_MODEL: 'm', AI_API_KEY: 'k' })[name]),
    verifyUser: async () => ({ id: 'u', emailConfirmed: true }),
    callModel: async () => ({ text: JSON.stringify(answer('Hai in cassa 1.500 €, tranquillo.')), stopReason: 'end_turn', model: 'm' }),
    quota: { reserve: async () => ({ allowed: true }), release: async () => {}, recordUsage: async () => {} }, now: () => Date.parse('2026-10-11T10:00:00Z'), log: (entry) => logs.push(entry),
  })
  const res = await handler(new Request(functionsUrl('https://p.supabase.co'), { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify({ context: healthy() }) }))
  const body = await res.json()
  const codes = logs.find((e) => e.outcome === 'invalid')?.errors ?? []
  check('server: "Hai in cassa 1.500 €" → 422 generico; nei log reserved_amount e incoherent_budget, senza cifre', res.status === 422 && same(body, { error: 'invalid', message: 'response_rejected' }) && codes.includes('reserved_amount') && codes.includes('incoherent_budget') && !/1[.,]?500/.test(JSON.stringify(logs)), JSON.stringify(codes))
}

report('Spendy AI — budget e guard (Fase 2B.3 + 2B.4)')
