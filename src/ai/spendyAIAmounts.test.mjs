// Fase 2B.1: il guard di Spendy AI e gli importi — regressioni dell'audit 2B.
// `npm test`, senza rete e senza chiamate a pagamento: regole condivise,
// handler della Edge Function in Node con un modello finto, client con un
// provider finto.
//
// Verificato qui (V1–V6 dell'audit):
//   V1  il segno conta: +120 non autorizza -120 e viceversa; con il budget
//       sforato nessun importo accanto a "restano / left / quedan / il reste";
//       il valore senza segno solo come sforamento ("sopra di 120 €");
//   V2  ogni numero del contesto vale solo con il suo significato: importanza,
//       version, data, cifre dei nomi non autorizzano importi;
//   V5  percentuali e giorni non diventano importi (e viceversa);
//   V3  importi e percentuali scritti in lettere (it/en/es/fr) → scartati;
//   V4  confronto esatto in centesimi, nessuna tolleranza né arrotondamento;
//   V6  il 422 all'app è generico, i motivi solo nei log (senza cifre);
//   e: valute (regole della fase valuta invariate), risposta scartata →
//   frase locale, stesso verdetto su server e client.

import { check, section, report } from '../sync/testkit.mjs'
import {
  validateSpendyResponse, sanitizeSpendyContext, buildSpendyPrompt, extractNumbers, allowedNumbers, authorizedNumbers,
  readNumbers, numberWordProblems, numberProblems, currencyProblems, SPENDY_LOCALES, STYLE_EXAMPLES_BY_LOCALE,
} from '../../supabase/functions/_shared/spendyAIRules.js'
import { createSpendyAIHandler, readConfig, logErrorCodes, INVALID_RESPONSE } from '../../supabase/functions/spendy-ai/handler.js'
import { validateAIResponse } from './spendyAIGuard.js'
import { createSpendyAI } from './spendyAI.js'
import { decideSpendyVoice, requestSpendyVoice, resolveSpendyVoice } from './spendyVoicePolicy.js'
import { createRemoteProvider, functionsUrl } from './providers/remoteProvider.js'
import { emptyVoiceCache } from './spendyVoiceCache.js'

const URL_FN = functionsUrl('https://progetto.supabase.co')
const ENV = { AI_PROVIDER: 'anthropic', AI_MODEL: 'modello-configurato', AI_API_KEY: 'sk-segreto-lato-server' }
const DAY1 = Date.parse('2026-10-11T10:00:00Z')
const TODAY = '2026-10-11'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const answer = (message, state = 'attentive') => ({ message, state, tone: 'friendly', layout: 'left', animation: 'gentle', priority: 60, shouldShow: true })

// Il contesto dell'audit: budget sano.
const okContext = (locale = 'it', currency = 'EUR', extra = {}) => sanitizeSpendyContext({
  version: 1, locale, currency, today: TODAY,
  budget: { monthly: 1500, spent: 1006, available: 494, spentPercent: 67, daysRemaining: 26, cyclePhase: 'start', dayOfCycle: 5, cycleDays: 31, band: 'ok', dailyAllowance: 18 },
  spending: { today: 150 },
  primaryEvent: { id: 'big_expense', importance: 72, category: 'Shopping', expense: { amount: 150, category: 'Shopping', usualAmount: 40 } },
  otherEvents: [{ id: 'frequency_up', importance: 55, category: 'Bar' }],
  goal: { label: 'Vacanze 2027', percent: 40, missing: 1200 },
  suggestedState: 'attentive',
  ...extra,
})
// Budget sforato di 120 €.
const overContext = (locale = 'it') => sanitizeSpendyContext({
  version: 1, locale, currency: 'EUR', today: TODAY,
  budget: { monthly: 1500, spent: 1620, available: -120, spentPercent: 108, daysRemaining: 9, cyclePhase: 'second_half', dayOfCycle: 22, cycleDays: 31, band: 'exceeded' },
  spending: { today: 45 },
  primaryEvent: { id: 'budget_exceeded', importance: 95 },
  otherEvents: [], goal: null, suggestedState: 'concerned',
})
const verdict = (message, context, state) => validateSpendyResponse(answer(message, state), context)
const errorsOf = (message, context, state) => verdict(message, context, state).errors ?? []
const accepted = (message, context, state) => verdict(message, context, state).valid === true

// ---------------------------------------------------------------------------
section('V1 — il segno: un importo positivo non autorizza il negativo, e viceversa')
{
  const ctx = okContext()
  // Fase 2B.4: il disponibile (494) è una cifra del budget: la scrive l'app, anche quando è giusto.
  check('available +494: "494 €" scritto dal modello → reserved_amount (lo scrive l\'app)', errorsOf('Restano 494 € fino a fine ciclo.', ctx).includes('reserved_amount'))
  check('un importo dell\'evento (150 €) resta lecito', accepted('Oggi 150 € in shopping.', ctx))
  check('available +494: "-494 €" rifiutato (invented_numbers:-494)', errorsOf('Il saldo è -494 €.', ctx).includes('invented_numbers:-494'))
  check('meno tipografico e simbolo davanti: "−150 €", "-€150", "€-150" rifiutati', ['Oggi −150 €.', 'Today -€150.', 'Today €-150.'].every((text, i) => errorsOf(text, okContext(i === 0 ? 'it' : 'en')).includes('invented_numbers:-150')))
  check('un trattino fra cifre non è un segno ("2026-10-11", "10-20")', same(extractNumbers('2026-10-11', 'it'), [2026, 10, 11]) && same(extractNumbers('tra 10-20 €', 'it'), [10, 20]))
  check('extractNumbers con la lingua: valori esatti e con segno', same(extractNumbers('-120 € e 1.794,50 €', 'it'), [-120, 1794.5]))
}

// Fase 2B.3: la regola del budget sforato è STRUTTURALE. Prima (2B.1) un importo
// si autorizzava con parole di sforamento ("sopra di 120 €"), e quelle stesse
// parole aggiravano il controllo (audit 2B.2, R1–R2). Ora con il budget
// sforato la frase del modello non contiene importi e l'app scrive sotto
// "Budget superato di 120 €" dai suoi dati (spendyVoicePolicy.budgetFactLine).
section('V1 — budget sforato: nessun importo dal modello, nemmeno quelli "giusti"')
{
  const REMAINING = {
    it: 'Ti restano ancora 120 € per 9 giorni, coraggio.',
    en: 'You still have €120 left for 9 days.',
    es: 'Te quedan 120 € para 9 días.',
    fr: 'Il te reste 120 € pour 9 jours.',
  }
  for (const [locale, message] of Object.entries(REMAINING)) {
    const errors = errorsOf(message, overContext(locale), 'concerned')
    check(`${locale}: "${message}" → rifiutata (money_when_over_budget)`, errors.includes('money_when_over_budget'), errors.join(','))
  }
  const DEFICIT_WITH_AMOUNT = {
    it: 'Sei sopra il budget di 120 €, con 9 giorni davanti.',
    en: 'You are €120 over budget, 9 days to go.',
    es: 'Has gastado de más: estás 120 € por encima del presupuesto.',
    fr: 'Tu as dépassé le budget de 120 €.',
  }
  for (const [locale, message] of Object.entries(DEFICIT_WITH_AMOUNT)) {
    check(`${locale}: anche lo sforamento giusto con l'importo ("${message}") → rifiutato: l'importo lo scrive l'app`, errorsOf(message, overContext(locale), 'concerned').includes('money_when_over_budget'))
  }
  const DEFICIT_WORDS = {
    it: 'Siamo oltre il budget, con 9 giorni ancora davanti: rallentiamo.',
    en: 'We are over budget with 9 days to go: let’s slow down.',
    es: 'Estamos por encima del presupuesto y quedan 9 días: frenemos un poco.',
    fr: 'Le budget est dépassé et il reste 9 jours : on ralentit.',
  }
  for (const [locale, message] of Object.entries(DEFICIT_WORDS)) {
    check(`${locale}: sforamento senza importi → accettata ("${message}")`, accepted(message, overContext(locale), 'concerned'), errorsOf(message, overContext(locale), 'concerned').join(','))
  }
  const over = overContext()
  check('nessun importo vero: né il budget (1.500 €) né la spesa di oggi (45 €) né "-120 €"', ['Ti restano 1.500 € di budget.', 'Oggi 45 €, rallentiamo.', 'Il saldo del ciclo è -120 €.'].every((text) => errorsOf(text, over, 'concerned').includes('money_when_over_budget')))
  check('nessun simbolo o codice di valuta, nemmeno senza cifre', errorsOf('Ogni € conta, da qui alla fine.', over, 'concerned').includes('money_when_over_budget') && errorsOf('Every EUR counts now.', overContext('en'), 'concerned').includes('money_when_over_budget'))
  check('giorni e percentuale restano leciti ("9 giorni", "108%")', accepted('Sei al 108% del budget: 9 giorni per rimettersi in pari.', over, 'concerned'), errorsOf('Sei al 108% del budget: 9 giorni per rimettersi in pari.', over, 'concerned').join(','))
  check('le frasi del mock per il budget sforato (senza importi) sono valide', ['Siamo oltre il budget, con 9 giorni ancora davanti.', 'Il budget è finito con 9 giorni di anticipo.'].every((text) => accepted(text, over, 'concerned')))
  check('budget sano: "ti restano 494 €" → rifiutata (Fase 2B.4: il disponibile lo scrive l\'app)', errorsOf('Ti restano 494 € per il ciclo.', okContext()).includes('reserved_amount'))
}

// ---------------------------------------------------------------------------
section('V2 + V5 — ogni numero con il suo significato')
{
  const ctx = okContext()
  const typed = authorizedNumbers(ctx)
  // Fase 2B.4: le cifre del budget (18 quota, 494 disponibile, 1006 speso, 1500 budget) sono riservate all'app.
  check('importi che il modello può scrivere: 40 150 1200 (in centesimi)', same([...typed.money].sort((a, b) => a - b), [4000, 15000, 120000]))
  check('cifre del budget riservate all\'app: 18 494 1006 1500', same([...typed.reserved].sort((a, b) => a - b), [1800, 49400, 100600, 150000]))
  // Fase 2B.3: tra i giorni anche 27 (i 26 che restano compreso oggi) e 1 (primo giorno del ciclo).
  check('percentuali 67 e 40; giorni 1 5 26 27 31; data 2026-10-11', same([...typed.percent].sort((a, b) => a - b), [40, 67]) && same([...typed.days].sort((a, b) => a - b), [1, 5, 26, 27, 31]) && same(typed.today, { year: 2026, month: 10, day: 11 }))
  check('allowedNumbers = solo gli importi scrivibili (senza 1, 72, 55, 2026, 2027, 10, 11 né le cifre del budget)', same([...allowedNumbers(ctx)].sort((a, b) => a - b), [40, 150, 1200]))

  const NOT_MONEY = [
    ['Hai speso 72 € in shopping.', 72, 'importance'], ['Only €55 left.', 55, 'importance di un altro evento'], ['Restano 1 € per oggi.', 1, 'version'],
    ['Hai speso 67 € oggi.', 67, 'percentuale'], ['Restano 26 € nel ciclo.', 26, 'giorni che restano'], ['Restano 31 €.', 31, 'durata del ciclo'],
    ['Hai speso 2026 € questo ciclo.', 2026, 'anno della data'], ['Hai speso 11 € al bar.', 11, 'giorno della data'], ['Il budget è 2027 €.', 2027, 'cifra del nome "Vacanze 2027"'],
  ]
  for (const [message, value, why] of NOT_MONEY) {
    const locale = /Only/.test(message) ? 'en' : 'it'
    check(`"${message}": ${value} è ${why}, non un importo → rifiutata`, errorsOf(message, okContext(locale)).includes(`invented_numbers:${value}`), errorsOf(message, okContext(locale)).join(','))
  }

  const PERCENT = { it: 'Sei al 67% del budget.', en: 'You are at 67 percent of the budget.', es: 'Vas por el 67 por ciento del presupuesto.', fr: 'Tu es à 67 pour cent du budget.' }
  for (const [locale, message] of Object.entries(PERCENT)) check(`${locale}: percentuale vera come percentuale → accettata ("${message}")`, accepted(message, okContext(locale)), errorsOf(message, okContext(locale)).join(','))
  check('un importo usato come percentuale ("150%") → rifiutato', errorsOf('Sei al 150% del budget!', ctx).includes('invented_numbers:150'))
  check('la percentuale dell\'obiettivo (40%) → accettata', accepted('"Vacanze 2027" è al 40%.', ctx))

  const DAYS = { it: 'Restano 26 giorni.', en: '26 days left in the cycle.', es: 'Quedan 26 días.', fr: 'Il reste 26 jours.' }
  for (const [locale, message] of Object.entries(DAYS)) check(`${locale}: giorni veri come giorni → accettata ("${message}")`, accepted(message, okContext(locale)), errorsOf(message, okContext(locale)).join(','))
  check('"giorno 5 di 31" / "day 5 of 31" → accettate', accepted('Giorno 5 di 31: 150 € di shopping.', ctx) && accepted('Day 5 of 31: €150 on shopping.', okContext('en')))
  check('un importo usato come giorni ("150 giorni") → rifiutato', errorsOf('Mancano 150 giorni.', ctx).includes('invented_numbers:150'))

  const countCtx = sanitizeSpendyContext({
    version: 1, locale: 'it', today: TODAY,
    budget: { monthly: 1500, spent: 300, available: 1200, spentPercent: 20, daysRemaining: 20, band: 'ok' },
    spending: { today: 12 },
    primaryEvent: { id: 'frequency_up', importance: 60, category: 'Bar', purchases: { current: 7, usual: 3 } },
    otherEvents: [], goal: null, suggestedState: 'ironic',
  })
  check('conteggi veri: "7 acquisti, di solito 3" / "7 volte contro 3" → accettate', accepted('7 acquisti al bar questo ciclo, di solito 3.', countCtx, 'ironic') && accepted('Bar: 7 volte contro 3.', countCtx, 'ironic'), errorsOf('7 acquisti al bar questo ciclo, di solito 3.', countCtx, 'ironic').join(','))
  check('un conteggio usato come importo ("7 €") → rifiutato', errorsOf('Al bar 7 € oggi.', countCtx, 'ironic').includes('invented_numbers:7'))
  check('un importo usato come conteggio ("12 acquisti") → rifiutato', errorsOf('12 acquisti al bar.', countCtx, 'ironic').includes('invented_numbers:12'))
}

section('V2 — date e anni: solo quella di oggi')
{
  const TODAY_DATES = { it: 'Oggi, 11 ottobre: 150 € di shopping.', en: 'Today, October 11: €150 on shopping.', es: 'Hoy, 11 de octubre: 150 € en compras.', fr: 'Aujourd’hui, 11 octobre : 150 € de shopping.' }
  for (const [locale, message] of Object.entries(TODAY_DATES)) check(`${locale}: la data di oggi → accettata ("${message}")`, accepted(message, okContext(locale)), errorsOf(message, okContext(locale)).join(','))
  check('formati numerici: "11/10", "11/10/2026", "2026-10-11"; in inglese anche "10/11"', ['Oggi 11/10: 150 €.', 'Oggi 11/10/2026: 150 €.', 'Oggi 2026-10-11: 150 €.'].every((text) => accepted(text, okContext())) && accepted('Today 10/11: €150.', okContext('en')))
  check('un\'altra data → invented_date ("12 ottobre", "25/12", "12/25", "October 12")', [['Il 12 ottobre 150 €.', 'it'], ['Il 25/12 150 €.', 'it'], ['On 12/25 €150.', 'en'], ['October 12: €150.', 'en']].every(([text, locale]) => errorsOf(text, okContext(locale)).includes('invented_date')))
  check('anno: "nel 2026" sì, "nel 2027" no (invented_date)', accepted('Nel 2026 hai già fatto 150 € di shopping oggi.', okContext()) && errorsOf('Nel 2027 spenderai 150 €.', okContext()).includes('invented_date'))
  check('senza context.today nessuna data è autorizzata', errorsOf('Oggi 11/10: 150 €.', { ...okContext(), today: undefined }).includes('invented_date'))
}

section('V2 — numeri dentro i nomi: si cita il nome, non la cifra')
{
  const ctx = okContext()
  check('"Vacanze 2027" citato: accettato', accepted('Per "Vacanze 2027" mancano 1.200 €.', ctx))
  check('lo stesso nome senza virgolette: accettato', accepted('Per Vacanze 2027 mancano 1.200 €.', ctx))
  check('la cifra del nome come importo: rifiutata', errorsOf('Hai messo da parte 2027 €.', ctx).includes('invented_numbers:2027'))
  check('readNumbers non vede le cifre del nome', readNumbers('Vacanze 2027: 1.200 €', 'it', { labels: ['vacanze 2027'] }).every((token) => token.value !== 2027))
}

// ---------------------------------------------------------------------------
section('V3 — importi scritti in lettere (quattro lingue)')
{
  const IN_WORDS = {
    it: ['Hai speso mille euro in shopping.', 'Cento euro di shopping oggi.', 'Duecentocinquanta euro in un giorno!', 'Quasi duemila € questo ciclo.', 'Migliaia di euro in shopping.', 'Un milione di euro, quasi.', 'Sei al cinquanta per cento del budget.', 'Ventitré euro al bar.', '€ mille, più o meno.'],
    en: ['Almost a thousand euros on shopping.', 'One hundred euros today.', 'Two hundred and fifty euros on clothes.', 'Twenty-five euros at the bar.', 'Hundreds of euros on shopping.', 'Fifty percent of the budget is gone.', 'Five cents left, joking.', '$ fifty here and there.'],
    es: ['Gastaste mil euros en compras.', 'Cien euros hoy.', 'Doscientos cincuenta euros en ropa.', 'Veintidós euros en el bar.', 'Un millón de euros, casi.', 'Miles de euros en compras.', 'Cincuenta por ciento del presupuesto.'],
    fr: ['Mille euros de shopping.', 'Cent euros aujourd’hui.', 'Deux mille cinq cents euros en un mois.', 'Quatre-vingt-dix euros au bar.', 'Vingt-et-un euros au café.', 'Des milliers d’euros de shopping.', 'Cinquante pour cent du budget.'],
  }
  for (const [locale, messages] of Object.entries(IN_WORDS)) {
    for (const message of messages) check(`${locale}: "${message}" → number_in_words`, errorsOf(message, okContext(locale)).includes('number_in_words'), errorsOf(message, okContext(locale)).join(','))
  }
  const NOT_AMOUNTS = {
    it: ['Tre volte al bar questa settimana, 150 € in shopping.', 'Un caffè e 150 € di shopping.', 'Mille grazie: 150 € ben spesi.', 'Sei a 150 € di shopping oggi.', 'Una pausa ogni tanto non guasta.'],
    en: ['One more coffee and €150 on shopping.', 'I lost two pounds this week.', 'Thousand Island dressing, €150 of shopping.'],
    es: ['Dos veces al bar y 150 € en compras.', 'Una libra de café, 150 € en total.'],
    fr: ['Un livre et 150 € de shopping.', 'Cent fois rien, c’est rien : 150 € quand même.'],
  }
  for (const [locale, messages] of Object.entries(NOT_AMOUNTS)) {
    for (const message of messages) check(`${locale}: "${message}" → nessun number_in_words`, !errorsOf(message, okContext(locale)).includes('number_in_words'), errorsOf(message, okContext(locale)).join(','))
  }
  check('il nome dell\'obiettivo non conta ("Mille euro per la bici" come obiettivo)', numberWordProblems('Per "Mille euro per la bici" ci sei quasi.', ['mille euro per la bici']).length === 0)
  const started = Date.now()
  numberWordProblems(`${'doscientos '.repeat(400)}x`)
  numberWordProblems(`${'quatre-vingt-'.repeat(300)}x`)
  check('testi patologici lunghi: controllo rapido (< 500 ms)', Date.now() - started < 500, `${Date.now() - started} ms`)
}

// ---------------------------------------------------------------------------
section('V4 — confronto esatto: niente ±1, niente arrotondamenti')
{
  const ctx = okContext()
  check('150 → "150 €" sì; "149 €" e "151 €" no', accepted('Hai speso 150 € oggi.', ctx) && errorsOf('Hai speso 149 € oggi.', ctx).includes('invented_numbers:149') && errorsOf('Hai speso 151 € oggi.', ctx).includes('invented_numbers:151'))
  check('494 → "493 €" e "495 €" no; 1500 → "1.501 €" no', ['Restano 493 €.', 'Restano 495 €.', 'Budget di 1.501 €.'].every((text) => errorsOf(text, ctx).some((e) => e.startsWith('invented_numbers'))))
  check('"1,5 €" non diventa 2 (rifiutato come 1.5)', errorsOf('Solo 1,5 € di caffè.', ctx).includes('invented_numbers:1.5'))
  check('"150,4 €", "150,99 €", "€149.49" rifiutati (valori esatti)', errorsOf('Hai speso 150,4 € oggi.', ctx).includes('invented_numbers:150.4') && errorsOf('Hai speso 150,99 € oggi.', ctx).includes('invented_numbers:150.99') && errorsOf('You spent €149.49 today.', okContext('en')).includes('invented_numbers:149.49'))
  const ZERO_CENTS = { it: 'Mancano 1.200,00 € all\'obiettivo.', es: 'Faltan 1.200,00 € para el objetivo.', en: 'Still €1,200.00 to go for the goal.', fr: 'Il manque 1 200,00 € pour l’objectif.' }
  for (const [locale, message] of Object.entries(ZERO_CENTS)) check(`${locale}: ",00" è lo stesso valore → accettato ("${message}")`, accepted(message, okContext(locale)), errorsOf(message, okContext(locale)).join(','))
  const cents = sanitizeSpendyContext({ ...okContext(), budget: { ...okContext().budget, available: 493.16 }, spending: { today: 493.16 } })
  check('il contesto conserva i centesimi degli importi (493,16)', cents.budget.available === 493.16 && cents.spending.today === 493.16 && cents.budget.spentPercent === 67)
  check('   "493,16 €" accettato, "493 €" e "493,17 €" no', accepted('Oggi 493,16 € di shopping.', cents) && errorsOf('Oggi 493 € di shopping.', cents).includes('invented_numbers:493') && errorsOf('Oggi 493,17 € di shopping.', cents).includes('invented_numbers:493.17'))
  check('più di due decimali: fuori grammatica (malformed_number)', errorsOf('Hai speso 150,999 € oggi.', ctx).includes('malformed_number') && errorsOf('You spent €150.999 today.', okContext('en')).includes('malformed_number'))
}

section('V4 — separatori: lo stesso valore solo nella grammatica della lingua')
{
  const SEPARATORS = { it: ['Mancano 1.200 €.', 'Mancano 1200 €.'], es: ['Faltan 1.200 €.', 'Faltan 1200 €.'], en: ['Still €1,200 to go.', 'Still €1200 to go.'], fr: ['Il manque 1 200 €.', 'Il manque 1\u202f200 €.', 'Il manque 1\u00a0200 €.', 'Il manque 1200 €.'] }
  for (const [locale, messages] of Object.entries(SEPARATORS)) check(`${locale}: ${messages.length} scritture di 1200 → accettate`, messages.every((text) => accepted(text, okContext(locale))), messages.map((text) => errorsOf(text, okContext(locale)).join(',')).join(' | '))
  const WRONG = [['it', 'Mancano 1,200 €.'], ['it', 'Mancano 1 200 €.'], ['en', 'Still €1.200 to go.'], ['es', 'Faltan 1,200 €.'], ['fr', 'Il manque 1.200 €.'], ['en', 'Still €1’200 to go.']]
  for (const [locale, message] of WRONG) check(`${locale}: "${message}" (separatore di un'altra lingua) → malformed_number`, errorsOf(message, okContext(locale)).includes('malformed_number'))
}

// ---------------------------------------------------------------------------
section('Valute: le regole della fase valuta restano (euro, dollari, sterline)')
{
  check('EUR: "150 €" sì, "$150" no (wrong_currency)', accepted('150 € oggi.', okContext()) && errorsOf('That’s $150 on shopping.', okContext('en')).includes('wrong_currency'))
  check('USD: "$150" sì, "150 €" no', accepted('That’s $150 on shopping.', okContext('en', 'USD')) && errorsOf('That’s €150 on shopping.', okContext('en', 'USD')).includes('wrong_currency'))
  check('GBP: "£150" sì, "150 bucks" no', accepted('That’s £150 on shopping.', okContext('en', 'GBP')) && errorsOf('That’s 150 bucks on shopping.', okContext('en', 'GBP')).includes('wrong_currency'))
  check('conversione: valuta sbagliata + importo inventato', same(errorsOf('150 € oggi, circa 160 dollari.', okContext()).filter((e) => e !== 'number_in_words'), ['invented_numbers:160', 'wrong_currency']))
  check('numeri in lettere con un\'altra valuta: entrambi i problemi', ['number_in_words', 'wrong_currency'].every((code) => errorsOf('You spent three hundred dollars? Wow.', okContext('en')).includes(code)))
  check('currencyProblems invariata (nomi dell\'utente esclusi)', currencyProblems('"Euro Disney" a 150 $', 'USD', ['euro disney']).length === 0 && same(currencyProblems('150 € e 160 $', 'GBP'), ['wrong_currency']))
  check('il prompt chiede cifre, non lettere, e spiega available negativo; nessun € per USD', (() => {
    const usd = buildSpendyPrompt(okContext('en', 'USD')).system
    const eur = buildSpendyPrompt(okContext()).system
    return eur.includes('mai in lettere') && eur.includes('budget.available negativo') && eur.includes('importance, priority e version non sono dati da citare') && !usd.includes('€')
  })())
}

// ---------------------------------------------------------------------------
section('V6 + fallback — 422 generico, motivi solo nei log, l\'utente vede la frase locale')
function memoryQuota() {
  let used = 0
  return {
    async reserve({ limits }) { if (used >= limits.daily) return { allowed: false, reason: 'daily', used }; used += 1; return { allowed: true, reason: null, used } },
    async release() { used = Math.max(used - 1, 0) },
    async recordUsage() {},
  }
}
function serverSaying(message) {
  const logs = []
  const handler = createSpendyAIHandler({
    aiPreference: async () => true, config: readConfig((name) => ENV[name]),
    verifyUser: async () => ({ id: 'utente-a', emailConfirmed: true }),
    callModel: async () => ({ text: JSON.stringify(answer(message, 'concerned')), stopReason: 'end_turn', model: 'm' }),
    quota: memoryQuota(), now: () => DAY1, log: (entry) => logs.push(entry),
  })
  return { handler, logs }
}
const post = (body) => new Request(URL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' }, body: JSON.stringify(body) })
{
  const lie = 'Ti restano ancora 120 € per 9 giorni, coraggio.'
  const { handler, logs } = serverSaying(lie)
  const res = await handler(post({ context: overContext() }))
  const body = await res.json()
  check('budget sforato + "ti restano 120 €": il server risponde 422', res.status === 422)
  check('   corpo generico e stabile, senza dettagli né cifre', same(body, { error: 'invalid', message: 'response_rejected' }) && same(body, INVALID_RESPONSE) && !/\d/.test(JSON.stringify(body)))
  const entry = logs.find((e) => e.outcome === 'invalid')
  check('   nei log solo il codice: money_when_over_budget (Fase 2B.3)', same(entry?.errors, ['money_when_over_budget']), JSON.stringify(entry?.errors))
  check('   nessun importo né testo della risposta nei log', !/120|restano|coraggio/.test(JSON.stringify(logs)))
  const invented = serverSaying('Hai speso 2026 € e 72 € oggi.')
  await invented.handler(post({ context: okContext() }))
  check('importi inventati: nel log "invented_numbers" senza valori', same(invented.logs.find((e) => e.outcome === 'invalid')?.errors, ['invented_numbers']) && !/2026|72/.test(JSON.stringify(invented.logs.map((e) => e.errors))))

  const provider = createRemoteProvider({ url: URL_FN, publicKey: 'chiave-pubblica', getAccessToken: async () => 'token-a', fetchImpl: async (url, init) => serverSaying(lie).handler(new Request(url, init)) })
  const ai = createSpendyAI({ provider })
  const coach = { state: 'concerned', reason: 'budget_exceeded', message: 'Budget superato: da qui conta ogni piccola spesa.' }
  const meta = { fingerprint: 'exceeded|budget_exceeded', facts: '{"x":1}', eventKey: 'budget_exceeded', importance: 95 }
  const { cache, result } = await requestSpendyVoice({ ai, context: overContext(), meta, cache: emptyVoiceCache(), today: TODAY, now: DAY1 })
  check('client: il 422 diventa invalid', result.ok === false && result.error === 'invalid', JSON.stringify(result))
  const decision = decideSpendyVoice({ coach, meta, today: TODAY, cache, now: DAY1 + 60 * 60 * 1000 })
  const voice = resolveSpendyVoice({ decision, coach, cache })
  check('   l\'utente vede la frase locale, non quella scartata (nessun retry)', decision.action === 'local' && decision.reason === 'ai_failed:invalid' && voice.source === 'local' && voice.message === coach.message && !voice.message.includes('120'))
  check('   in cache nessuna frase AI e nessuna cifra', cache.current === null && cache.history.length === 0 && same(cache.failure.error, 'invalid'))

  const mockLie = createSpendyAI({ provider: { name: 'test', generate: async () => answer('Hai speso 72 € in shopping.') } })
  const local = await mockLie.generate(okContext())
  check('provider locale (mock): lo stesso guard nel client scarta la risposta', local.ok === false && local.error === 'invalid' && local.details.includes('invented_numbers:72'))
}

section('Server, guard e client: stesso verdetto')
{
  const SAMPLES = [
    ['it', 'Ti restano 494 € per il ciclo.', okContext], ['it', 'Hai speso 72 € in shopping.', okContext], ['en', 'Almost a thousand euros on shopping.', okContext],
    ['it', 'Ti restano ancora 120 € per 9 giorni, coraggio.', overContext], ['fr', 'Tu as dépassé le budget de 120 €.', overContext], ['es', 'Hoy, 11 de octubre: 150 € en compras.', okContext],
  ]
  const outcomes = []
  for (const [locale, message, make] of SAMPLES) {
    const context = make(locale)
    const state = make === overContext ? 'concerned' : 'attentive'
    const direct = validateSpendyResponse(answer(message, state), context)
    const guard = validateAIResponse(answer(message, state), context)
    const client = await createSpendyAI({ provider: { name: 'test', generate: async () => answer(message, state) } }).generate(context)
    const { handler, logs } = serverSaying(message)
    const res = await handler(post({ context }))
    const serverErrors = logs.find((e) => e.outcome === 'invalid')?.errors ?? []
    const agree = direct.valid === guard.valid && guard.valid === client.ok && client.ok === (res.status === 200)
      && same(direct.errors ?? [], guard.errors ?? []) && same(guard.errors ?? [], client.details ?? []) && same(logErrorCodes(client.details ?? []), serverErrors)
    outcomes.push(direct.valid)
    check(`${locale}: "${message}" → ${direct.valid ? 'accettata' : `rifiutata (${direct.errors.join(',')})`} ovunque`, agree, JSON.stringify({ direct: direct.errors, client: client.details, server: serverErrors, status: res.status }))
  }
  check('nel campione ci sono sia risposte accettate sia rifiutate', outcomes.includes(true) && outcomes.includes(false))
}

section('Ingressi vuoti, nulli e malformati: mai un\'eccezione, sempre un rifiuto sicuro')
{
  const odd = [null, undefined, {}, [], 'testo', 42]
  check('risposte non oggetto o vuote → rifiutate', odd.every((raw) => validateSpendyResponse(raw, okContext()).valid === false))
  check('contesto nullo: qualunque importo è inventato', errorsOf('Hai speso 150 €.', null).includes('invented_numbers:150'))
  check('numberProblems e readNumbers tollerano testo nullo', same(numberProblems(null, okContext()), []) && same(readNumbers(undefined, 'it'), []))
  check('numeri enormi: rifiutati come inventati', errorsOf(`Hai speso ${'9'.repeat(30)} € oggi.`, okContext()).some((e) => e.startsWith('invented_numbers')))
  // Fase 5A: il prompt ne porta 4 a rotazione; il controllo copre tutta la raccolta di ogni lingua.
  check('tutti gli esempi di stile (raccolta intera e quelli del prompt): nessun numero in lettere, nessun numero fuori grammatica', SPENDY_LOCALES.every((locale) => [...STYLE_EXAMPLES_BY_LOCALE[locale], ...buildSpendyPrompt(okContext(locale)).input.styleExamples].every((example) => numberWordProblems(example).length === 0 && !extractNumbers(example, locale).some(Number.isNaN))))
}

report('Spendy AI — importi e guard (Fase 2B.1)')
