// Fase 2C: importi della spesa nel contesto AI e nel validatore.
// `npm test`, senza rete e senza modello: funzioni pure del repo.
//
//   Difetto B  il contesto arrotondava l'importo della spesa all'unità:
//              499,60 € nell'app, 500 per l'AI. Ora tiene i centesimi.
//   Difetto A  il validatore controllava che una cifra fosse nel contesto, non
//              a che cosa si riferisse: "Hai speso 980 €" (totale della
//              categoria) passava come importo della spesa. Ora un importo che
//              è solo una statistica deve essere nominato come tale.
import { check, section, report } from '../sync/testkit.mjs'
import { validateSpendyResponse, sanitizeSpendyContext, moneyRoles, cycleIsCalendarMonth } from '../../supabase/functions/_shared/spendyAIRules.js'
import { buildSpendyAIContext } from './spendyAIContext.js'
import { detectSpendyEvents } from './spendyEvents.js'
import { validateAIResponse } from './spendyAIGuard.js'
import { createSpendyAI } from './spendyAI.js'
import { createRemoteProvider, functionsUrl } from './providers/remoteProvider.js'
import { requestSpendyVoice, decideSpendyVoice } from './spendyVoicePolicy.js'
import { emptyVoiceCache } from './spendyVoiceCache.js'
import { formatCurrency } from '../utils/format.js'
import { getCycleTiming } from '../utils/cycle.js'

const TODAY = '2026-10-22'
const answer = (message) => ({ message, state: 'attentive', tone: 'friendly', layout: 'left', animation: 'gentle', priority: 60, shouldShow: true })
const verdict = (message, context) => validateSpendyResponse(answer(message), context)
const accepted = (message, context) => verdict(message, context).valid === true
const errorsOf = (message, context) => (verdict(message, context).errors ?? []).map((e) => String(e).split(':')[0])

// Il percorso reale dell'app: spesa → eventi → contesto → sanitizzazione del server.
const expense = (amount, extra = {}) => ({ id: `e-${amount}`, date: TODAY, amount, categoryId: 'shopping', description: '', updatedAt: `${TODAY}T10:00:00.000Z`, ...extra })
const contextFor = (expenses, { locale = 'it', currency = 'EUR', reason = 'expense_over_100', events = null } = {}) => {
  const list = events ?? detectSpendyEvents({ coach: { reason, insight: { categoryId: null } }, expenses, today: TODAY })
  const { context } = buildSpendyAIContext({ events: list, coach: { state: 'attentive' }, financialData: { monthlyBudget: 3000, available: 1500, spentRatio: 50, spentThisMonth: 1500 }, expenses, today: TODAY, cycleStartDay: 1, goals: [], locale, currency })
  return { built: context, sent: sanitizeSpendyContext(context) }
}

// Il contesto dell'audit: spesa 700 €, media abituale 120 €, totale della categoria nel ciclo 980 €.
const audit = (locale = 'it', extra = {}) => sanitizeSpendyContext({
  version: 1, locale, currency: 'EUR', today: TODAY,
  budget: { monthly: 1500, spent: 1006, available: 494, spentPercent: 67, daysRemaining: 15, cyclePhase: 'mid', dayOfCycle: 16, cycleDays: 31, band: 'ok', dailyAllowance: 32 },
  spending: { today: 700 },
  primaryEvent: { id: 'big_expense', importance: 72, category: 'Shopping', expense: { amount: 700, category: 'Shopping', usualAmount: 120, categoryCycleCurrent: 980, categoryCycleUsual: 300 } },
  otherEvents: [], goal: { label: 'Vacanze 2027', percent: 40, missing: 1200 }, suggestedState: 'attentive', ...extra,
})

// =====================================================================
section('Precisione: l\'importo della spesa arriva all\'AI con i centesimi')
// =====================================================================
{
  for (const [amount, cents] of [[499.6, 49960], [499.99, 49999], [700, 70000], [12.05, 1205]]) {
    const { built, sent } = contextFor([expense(amount)])
    check(`${String(amount).replace('.', ',')} €: expense.amount = ${amount} (nessun arrotondamento all'unità)`, built.primaryEvent.expense.amount === amount && sent.primaryEvent.expense.amount === amount
      && Math.round(sent.primaryEvent.expense.amount * 100) === cents, JSON.stringify(sent.primaryEvent.expense))
  }
  const { sent: sameDay } = contextFor([expense(12.35, { id: 'a' }), expense(7.4, { id: 'b' }), expense(0.1, { id: 'c' }), expense(0.2, { id: 'd' })])
  check('spesa di oggi con centesimi = somma delle spese (12,35 + 7,40 + 0,10 + 0,20 = 20,05)', sameDay.spending.today === 20.05, String(sameDay.spending.today))
  const above = { id: 'expense_above_average', importance: 60, categoryId: 'shopping', insight: { type: 'amount_above_average', current: 89.9, baseline: 40.4, changePercent: 122.5, category: { label: 'Shopping' } } }
  const { sent: single } = contextFor([expense(89.9)], { events: [above] })
  check('spesa sopra la media: singleExpense.amount 89,90 resta 89.9; la media (statistica) resta arrotondata a 40', single.primaryEvent.singleExpense.amount === 89.9 && single.primaryEvent.singleExpense.usualAmount === 40, JSON.stringify(single.primaryEvent.singleExpense))
  for (const locale of ['it', 'en', 'es', 'fr']) {
    const { built } = contextFor([expense(499.6)], { locale })
    const json = JSON.stringify(built)
    check(`${locale}: nel JSON inviato 499.6 con il punto, mai "499,6" (indipendente dalla lingua)`, json.includes('"amount":499.6') && !json.includes('499,6'))
  }
  check('l\'importo salvato e quello mostrato non cambiano (499,60 € nell\'app)', expense(499.6).amount === 499.6 && formatCurrency(499.6, 'it', 'EUR') === '499,60 €')
}

// =====================================================================
section('Precisione: il validatore legge l\'importo esatto in ogni lingua')
// =====================================================================
{
  const ctx = (locale) => contextFor([expense(499.6)], { locale }).sent
  check('it: "Hai speso 499,60 €" accettata', accepted('Hai speso 499,60 € in Shopping.', ctx('it')))
  check('en: "You spent €499.60" accettata', accepted('You spent €499.60 on Shopping.', ctx('en')))
  check('es: "Has gastado 499,60 €" accettata', accepted('Has gastado 499,60 € en Shopping.', ctx('es')))
  check('fr: "Tu as dépensé 499,60 €" accettata', accepted('Tu as dépensé 499,60 € en Shopping.', ctx('fr')))
  check('it: "Hai speso 500 €" per 499,60 € → rifiutata (non è l\'importo esatto)', !accepted('Hai speso 500 € in Shopping.', ctx('it')), errorsOf('Hai speso 500 € in Shopping.', ctx('it')).join())
  check('en: "€500" per 499,60 € → rifiutata', !accepted('You spent €500 on Shopping.', ctx('en')))
  check('it: "499.60 €" col punto → rifiutata (in italiano il punto separa le migliaia: ambiguo)', !accepted('Hai speso 499.60 € in Shopping.', ctx('it')))
  check('it: "499,6 €" (un solo decimale) → accettata, stesso valore', accepted('Hai speso 499,6 € in Shopping.', ctx('it')))
}

// =====================================================================
section('Ruoli: spesa 700 €, media abituale 120 €, totale di categoria 980 €')
// =====================================================================
{
  const ctx = audit()
  const roles = moneyRoles(ctx)
  check('ruoli dal contesto: 700 spesa, 120 media, 980 totale del ciclo, 1.200 obiettivo', roles.get(70000).has('expense') && roles.get(12000).has('usual') && roles.get(98000).has('cycle_total') && roles.get(120000).has('goal'))
  check('"Hai speso 700 €" → accettata', accepted('Hai speso 700 € in Shopping.', ctx))
  check('"Hai speso 120 €" (la media presentata come spesa) → rifiutata', errorsOf('Hai speso 120 € in Shopping.', ctx).includes('misattributed_amount'))
  check('"Hai speso 980 €" (il totale presentato come spesa) → rifiutata', errorsOf('Hai speso 980 € in Shopping.', ctx).includes('misattributed_amount'))
  check('"Questa spesa da 120 €…" → rifiutata', errorsOf('Questa spesa da 120 € pesa.', ctx).includes('misattributed_amount'))
  check('"Hai speso 700 €, mentre la tua media abituale è 120 €" → accettata', accepted('Hai speso 700 €, mentre la tua media abituale è 120 €.', ctx))
  check('"Hai speso 700 € e di solito ne spendi 120" → accettata', accepted('Hai speso 700 € e di solito ne spendi 120 €.', ctx))
  check('"Il totale della categoria è 980 €" → accettata (dato presente e nominato)', accepted('Il totale della categoria è 980 €.', ctx))
  check('"In questo ciclo Shopping è a 980 €" → accettata', accepted('In questo ciclo Shopping è a 980 €.', ctx))
  check('"Il totale della categoria è 120 €" (nominato, ma è la media) → rifiutata', errorsOf('Il totale della categoria è 120 €.', ctx).includes('misattributed_amount'))
  check('"La tua media è 980 €" (nominato, ma è il totale) → rifiutata', errorsOf('La tua media è 980 €.', ctx).includes('misattributed_amount'))
  check('importo inventato ("Hai speso 650 €") → rifiutata come prima (invented_numbers)', errorsOf('Hai speso 650 € in Shopping.', ctx).includes('invented_numbers'))
  check('cifre del budget (1.500 €, 494 €) → regole esistenti (reserved_amount)', errorsOf('Hai speso 1.500 € in Shopping.', ctx).includes('reserved_amount') && errorsOf('Ti restano 494 €.', ctx).includes('reserved_amount'))
  check('quanto manca all\'obiettivo, nominato → accettata', accepted('Mancano 1.200 € a Vacanze 2027.', ctx))
  check('"Hai speso 1.200 €" (quanto manca all\'obiettivo) → rifiutata', errorsOf('Hai speso 1.200 € in Shopping.', ctx).includes('misattributed_amount'))
}

// =====================================================================
section('Ruoli in inglese, spagnolo e francese')
// =====================================================================
{
  const cases = {
    en: ['You spent €700 on Shopping.', 'You spent €980 on Shopping.', 'You spent €700, while your usual is €120.', 'Shopping is at €980 this cycle.'],
    es: ['Has gastado 700 € en Shopping.', 'Has gastado 980 € en Shopping.', 'Has gastado 700 €, mientras que lo habitual son 120 €.', 'En este ciclo Shopping va por 980 €.'],
    fr: ['Tu as dépensé 700 € en Shopping.', 'Tu as dépensé 980 € en Shopping.', 'Tu as dépensé 700 €, alors que d’habitude c’est 120 €.', 'Ce cycle, Shopping en est à 980 € au total.'],
  }
  for (const [locale, [own, wrong, both, total]] of Object.entries(cases)) {
    const ctx = audit(locale)
    check(`${locale}: spesa accettata, totale come spesa rifiutato, spesa + media accettata, totale nominato accettato`,
      accepted(own, ctx) && errorsOf(wrong, ctx).includes('misattributed_amount') && accepted(both, ctx) && accepted(total, ctx),
      [own, wrong, both, total].map((m) => `${accepted(m, ctx) ? 'ok' : errorsOf(m, ctx).join('+')}`).join(' | '))
  }
}

// =====================================================================
section('Compatibilità: nessun cambiamento dove la spesa non c\'è o il ruolo coincide')
// =====================================================================
{
  // Evento di categoria SENZA spesa nel contesto: come prima (frase delle prove di quota).
  const category = sanitizeSpendyContext({
    version: 1, locale: 'it', today: TODAY,
    budget: { monthly: 2000, spent: 160, available: 1840, spentPercent: 8, daysRemaining: 11, band: 'ok', dailyAllowance: 167 },
    spending: { today: 0 },
    primaryEvent: { id: 'category_above_usual', importance: 60, category: 'Ristorante', cycle: { current: 160, usual: 55, difference: 105, changePercent: 191 } },
    otherEvents: [], goal: null, suggestedState: 'ironic',
  })
  check('nessuna spesa nel contesto: "Ristorante a 160 €, la tua media è 55 €" accettata come prima', accepted('Ristorante a 160 €, la tua media è 55 €. Ciclo speciale?', category))
  // Una sola spesa oggi: lo stesso importo è spesa E spesa di oggi.
  const one = contextFor([expense(700)]).sent
  check('una sola spesa oggi: "Oggi 700 € in Shopping" accettata', accepted('Oggi 700 € in Shopping.', one))
  // Due spese oggi: il totale del giorno va nominato.
  const two = contextFor([expense(700, { id: 'x' }), expense(20.5, { id: 'y', categoryId: 'bar' })]).sent
  check('due spese oggi (720,50 €): "Hai speso 720,50 €" senza "oggi" → rifiutata', errorsOf('Hai speso 720,50 € in Shopping.', two).includes('misattributed_amount'))
  check('   "Oggi in tutto 720,50 €" → accettata', accepted('Oggi in tutto 720,50 €.', two))
  // Differenza nominata.
  const withDiff = audit('it', { primaryEvent: { id: 'big_expense', importance: 72, category: 'Shopping', expense: { amount: 700, category: 'Shopping' }, cycle: { current: 980, usual: 300, difference: 680, changePercent: 227 } } })
  check('differenza nominata ("680 € in più del solito") accettata; presentata come spesa rifiutata', accepted('Shopping è a 680 € in più del solito.', withDiff) && errorsOf('Hai speso 680 € in Shopping.', withDiff).includes('misattributed_amount'))
}

// =====================================================================
section('Fallback: una risposta rifiutata lato server è rifiutata anche nell\'app')
// =====================================================================
{
  const ctx = audit()
  const app = validateAIResponse(answer('Hai speso 980 € in Shopping.'), ctx)
  check('il controllo dell\'app (spendyAIGuard) usa la stessa regola: invalid → frase locale', app.valid === false && (app.errors ?? []).some((e) => String(e).startsWith('misattributed_amount')))
  check('   e accetta la stessa frase corretta del server', validateAIResponse(answer('Hai speso 700 €, mentre la tua media abituale è 120 €.'), ctx).valid === true)
}

// =====================================================================
section('Audit 2C: "mese" conferma il totale del ciclo solo se il ciclo è il mese di calendario')
// =====================================================================
{
  // Il contesto porta oggi, giorno del ciclo, giorni del ciclo e giorni rimanenti
  // (getCycleTiming): da qui le date vere di inizio e fine del ciclo.
  const withCycle = (todayStr, timing, locale = 'it') => sanitizeSpendyContext({
    version: 1, locale, currency: 'EUR', today: todayStr,
    budget: { monthly: 1500, spent: 1006, available: 494, spentPercent: 67, cyclePhase: 'mid', band: 'ok', dailyAllowance: 32, ...timing },
    spending: { today: 700 },
    primaryEvent: { id: 'big_expense', importance: 72, category: 'Shopping', expense: { amount: 700, category: 'Shopping', usualAmount: 120, categoryCycleCurrent: 980, categoryCycleUsual: 300 } },
    otherEvents: [], goal: null, suggestedState: 'attentive',
  })
  const timingOf = (dateStr, startDay) => { const t = getCycleTiming(dateStr, startDay); return { dayOfCycle: t.dayOfCycle, cycleDays: t.cycleDays, daysRemaining: t.daysRemaining } }
  const MONTH = {
    it: ['Questo mese Shopping è a 980 €.', 'Il mese scorso hai speso 980 €.'],
    en: ['This month Shopping is at €980.', 'Last month you spent €980.'],
    es: ['Este mes Shopping va por 980 €.', 'El mes pasado gastaste 980 €.'],
    fr: ['Ce mois-ci, Shopping en est à 980 €.', 'Le mois dernier, tu as dépensé 980 €.'],
  }
  const calendar = { today: '2026-10-22', timing: timingOf('2026-10-22', 1) } // 1 ott – 31 ott
  const seventh = { today: '2026-10-22', timing: timingOf('2026-10-22', 7) } // 7 ott – 6 nov
  check('premessa: date del ciclo come getCycleTiming (1→31 ottobre; 7 ottobre → 6 novembre)', getCycleTiming('2026-10-22', 1).start === '2026-10-01' && getCycleTiming('2026-10-22', 7).start === '2026-10-07' && getCycleTiming('2026-10-22', 7).lastDay === '2026-11-06')
  check('cycleIsCalendarMonth: ciclo 1–31 ottobre → sì; ciclo dal 7 → no', cycleIsCalendarMonth(withCycle(calendar.today, calendar.timing)) && !cycleIsCalendarMonth(withCycle(seventh.today, seventh.timing)))
  for (const [locale, [thisMonth, lastMonth]] of Object.entries(MONTH)) {
    check(`${locale}: ciclo = mese di calendario → "${thisMonth}" accettata`, accepted(thisMonth, withCycle(calendar.today, calendar.timing, locale)), errorsOf(thisMonth, withCycle(calendar.today, calendar.timing, locale)).join())
    check(`${locale}:   ma il mese PASSATO no ("${lastMonth}")`, errorsOf(lastMonth, withCycle(calendar.today, calendar.timing, locale)).includes('misattributed_amount'))
    check(`${locale}: ciclo dal 7 al 6 → "${thisMonth}" rifiutata`, errorsOf(thisMonth, withCycle(seventh.today, seventh.timing, locale)).includes('misattributed_amount'))
    check(`${locale}:   "ciclo/cycle" resta valido anche lì`, accepted({ it: 'In questo ciclo Shopping è a 980 €.', en: 'Shopping is at €980 this cycle.', es: 'En este ciclo Shopping va por 980 €.', fr: 'Ce cycle, Shopping en est à 980 € au total.' }[locale], withCycle(seventh.today, seventh.timing, locale)))
  }
  // Cambio d'anno: dicembre di calendario sì; 15 dicembre – 14 gennaio no.
  check('cambio d\'anno: ciclo 1–31 dicembre (oggi 20/12) → mese di calendario', cycleIsCalendarMonth(withCycle('2026-12-20', timingOf('2026-12-20', 1))))
  check('   ciclo 15 dicembre 2026 – 14 gennaio 2027 (oggi 3/1) → no, e "Questo mese…" rifiutata', !cycleIsCalendarMonth(withCycle('2027-01-03', timingOf('2027-01-03', 15)))
    && errorsOf('Questo mese Shopping è a 980 €.', withCycle('2027-01-03', timingOf('2027-01-03', 15))).includes('misattributed_amount'))
  check('febbraio bisestile (2028, ciclo dal 1°, 29 giorni) → mese di calendario', cycleIsCalendarMonth(withCycle('2028-02-10', timingOf('2028-02-10', 1))))
  // Inizio e fine del ciclo: stesso verdetto di getCycleTiming su 4 anni e tutti i giorni di inizio.
  const mismatches = []
  for (let ms = Date.UTC(2025, 0, 1); ms <= Date.UTC(2028, 11, 31); ms += 3 * 86400000) {
    const day = new Date(ms).toISOString().slice(0, 10)
    for (let startDay = 1; startDay <= 31; startDay += 1) {
      const t = getCycleTiming(day, startDay)
      const [ny, nm] = t.start.split('-').map(Number)
      const expected = t.start.endsWith('-01') && t.end === `${nm === 12 ? ny + 1 : ny}-${String(nm === 12 ? 1 : nm + 1).padStart(2, '0')}-01`
      if (cycleIsCalendarMonth(withCycle(day, timingOf(day, startDay))) !== expected) mismatches.push(`${day}/${startDay}`)
    }
  }
  check('date di inizio e fine: stesso verdetto di getCycleTiming (2025–2028, giorni di inizio 1–31)', mismatches.length === 0, mismatches.slice(0, 5).join(' '))
  check('dati del ciclo mancanti o incoerenti → non dimostrabile ("mese" non basta)', !cycleIsCalendarMonth(withCycle('2026-10-22', { dayOfCycle: 22, cycleDays: 31 }))
    && !cycleIsCalendarMonth(withCycle('2026-10-22', { dayOfCycle: 22, cycleDays: 31, daysRemaining: 3 })) && !cycleIsCalendarMonth({ budget: calendar.timing }))
}

// =====================================================================
section('Audit 2C: un comparativo dopo un importo statistico lo presenta come differenza')
// =====================================================================
{
  const REJECT = {
    it: ['Hai speso 120 € più della media.', 'Hai speso 980 € più del solito.', 'Hai speso 120 € in più.'],
    en: ['You spent €120 over your average.', 'You spent €120 more than usual.', 'You spent €980 more than usual.'],
    es: ['Has gastado 120 € más que el promedio.', 'Has gastado 980 € más que lo habitual.'],
    fr: ['Tu as dépensé 120 € de plus que la moyenne.', 'Tu as dépensé 980 € de plus ce mois-ci.', 'Tu as dépensé 120 € plus que d’habitude.'],
  }
  const KEEP = {
    it: ['Hai speso 700 €, più del solito.', 'Hai speso 700 € più del solito.', 'Hai speso 700 €, mentre la tua media abituale è 120 €.', '700 € contro una media di 120 €.'],
    en: ['You spent €700, more than usual.', 'You spent €700 more than usual this time.', 'You spent €700, while your usual is €120.'],
    es: ['Has gastado 700 €, más de lo habitual.', 'Has gastado 700 €, mientras que lo habitual son 120 €.'],
    fr: ['Tu as dépensé 700 €, plus que d’habitude.', 'Tu as dépensé 700 €, alors que d’habitude c’est 120 €.'],
  }
  for (const locale of ['it', 'en', 'es', 'fr']) {
    const ctx = audit(locale)
    const wrong = REJECT[locale].filter((m) => !errorsOf(m, ctx).includes('misattributed_amount'))
    check(`${locale}: media o totale seguiti da un comparativo → rifiutate (${REJECT[locale].length})`, wrong.length === 0, wrong.join(' | '))
    const lost = KEEP[locale].filter((m) => !accepted(m, ctx))
    check(`${locale}:   le frasi corrette con la spesa reale restano accettate (${KEEP[locale].length})`, lost.length === 0, lost.map((m) => `${m} → ${errorsOf(m, ctx).join()}`).join(' | '))
  }
  // Quando l'importo È la differenza, il comparativo è giusto.
  const withDiff = audit('it', { primaryEvent: { id: 'big_expense', importance: 72, category: 'Shopping', expense: { amount: 700, category: 'Shopping', usualAmount: 120 }, cycle: { current: 980, usual: 300, difference: 680, changePercent: 227 } } })
  check('la differenza vera seguita dal comparativo → accettata ("680 € in più del solito")', accepted('In questo ciclo Shopping è a 680 € in più del solito.', withDiff) && accepted('Shopping: 680 € più del solito.', withDiff))
  check('   la media con il comparativo, anche lì → rifiutata', errorsOf('Shopping: 120 € più del solito.', withDiff).includes('misattributed_amount'))
}

// =====================================================================
section('Revisione 2C: "over / above" + periodo è una durata, non un confronto')
// =====================================================================
{
  // Contesto in dollari; ciclo dal 7 (personalizzato) o dal 1° (mese di calendario).
  const withCycle = (timing) => sanitizeSpendyContext({
    version: 1, locale: 'en', currency: 'USD', today: TODAY,
    budget: { monthly: 1500, spent: 1006, available: 494, spentPercent: 67, cyclePhase: 'mid', band: 'ok', dailyAllowance: 32, ...timing },
    spending: { today: 700 },
    primaryEvent: { id: 'big_expense', importance: 72, category: 'Shopping', expense: { amount: 700, category: 'Shopping', usualAmount: 120, categoryCycleCurrent: 980 } },
    otherEvents: [], goal: null, suggestedState: 'attentive',
  })
  const custom = withCycle({ dayOfCycle: 16, cycleDays: 31, daysRemaining: 15 }) // 7 ott – 6 nov
  const calendar = withCycle({ dayOfCycle: 22, cycleDays: 31, daysRemaining: 9 }) // 1 – 31 ott
  check('premessa: ciclo dal 7 non è il mese di calendario, ciclo dal 1° sì', !cycleIsCalendarMonth(custom) && cycleIsCalendarMonth(calendar))
  for (const [name, ctx] of [['ciclo dal 7', custom], ['ciclo = mese', calendar]]) {
    check(`${name}: "You have spent $980 over this cycle on Shopping." → accettata`, accepted('You have spent $980 over this cycle on Shopping.', ctx), errorsOf('You have spent $980 over this cycle on Shopping.', ctx).join())
    check(`${name}:   "over the whole cycle" → accettata`, accepted('You have spent $980 over the whole cycle.', ctx))
    for (const m of ['You have spent $120 over your average.', 'You spent $120 above your usual.', 'You spent $120 over the average.', 'You spent $980 over your usual.']) {
      check(`${name}:   "${m}" → rifiutata (la statistica presentata come differenza)`, errorsOf(m, ctx).includes('misattributed_amount'))
    }
  }
  check('ciclo dal 7: "$980 over the month" → rifiutata (il mese non è il ciclo)', errorsOf('You have spent $980 over the month on Shopping.', custom).includes('misattributed_amount'))
  check('ciclo = mese: "$980 over the month" → accettata', accepted('You have spent $980 over the month on Shopping.', calendar))
  check('"$980 over the last week" → rifiutata in entrambi: 980 è il totale del ciclo, non della settimana', errorsOf('Shopping reached $980 over the last week.', custom).includes('misattributed_amount') && errorsOf('Shopping reached $980 over the last week.', calendar).includes('misattributed_amount'))
  check('la spesa reale seguita da "over" resta accettata ("You spent $700 over your usual.")', accepted('You spent $700 over your usual.', custom) && accepted('You spent $700, over your usual $120.', custom),
    `${errorsOf('You spent $700 over your usual.', custom).join()} | ${errorsOf('You spent $700, over your usual $120.', custom).join()}`)
}

// =====================================================================
section('Audit 2C: «media» aggettivo della spesa non è la media abituale')
// =====================================================================
{
  const REJECT = {
    it: 'Hai fatto una spesa media di 120 €.',
    en: 'That was an average purchase of €120.',
    es: 'Fue un gasto medio de 120 €.',
    fr: 'C’était une dépense moyenne de 120 €.',
  }
  const KEEP = {
    it: ['La tua media abituale è 120 €.', 'La tua spesa media è 120 €.', 'Di solito spendi 120 €.'],
    en: ['Your usual is €120.', 'Your average purchase is €120.', 'On average you spend €120.'],
    es: ['Lo habitual son 120 €.', 'Tu gasto medio es de 120 €.', 'De media gastas 120 €.'],
    fr: ['D’habitude c’est 120 €.', 'Ta dépense moyenne est de 120 €.', 'En moyenne, tu dépenses 120 €.'],
  }
  for (const locale of ['it', 'en', 'es', 'fr']) {
    const ctx = audit(locale)
    check(`${locale}: "${REJECT[locale]}" → rifiutata`, errorsOf(REJECT[locale], ctx).includes('misattributed_amount'), errorsOf(REJECT[locale], ctx).join())
    const lost = KEEP[locale].filter((m) => !accepted(m, ctx))
    check(`${locale}:   la media vera (articolo determinativo, possessivo, "di solito") resta accettata`, lost.length === 0, lost.map((m) => `${m} → ${errorsOf(m, ctx).join()}`).join(' | '))
  }
}

// =====================================================================
section('Audit 2C: complemento iniziale separato da una virgola')
// =====================================================================
{
  const ctx = audit()
  for (const m of ['In questo ciclo, Shopping è a 980 €.', 'In media, spendi 120 €.', 'Ce cycle, Shopping en est à 980 €.']) {
    check(`"${m}" → accettata (tempo o media pura prima della virgola)`, accepted(m, m.startsWith('Ce') ? audit('fr') : ctx))
  }
  for (const m of ['Più del solito, hai speso 120 €.', 'Di solito, hai speso 980 €.', 'Oggi, hai speso 980 €.', 'Questo mese, Shopping è a 980 €.']) {
    check(`"${m}" → rifiutata (il complemento non nomina quel dato, o il ciclo non è il mese)`, errorsOf(m, ctx).includes('misattributed_amount'))
  }
}

// =====================================================================
section('Audit 2C: importi uguali con ruoli diversi')
// =====================================================================
{
  const ctx = (expense, budget = {}) => audit('it', {
    budget: { monthly: 1500, spent: 1006, available: 494, spentPercent: 67, daysRemaining: 15, cyclePhase: 'mid', dayOfCycle: 16, cycleDays: 31, band: 'ok', dailyAllowance: 32, ...budget },
    spending: { today: expense.amount },
    primaryEvent: { id: 'big_expense', importance: 72, category: 'Shopping', expense: { category: 'Shopping', ...expense } },
  })
  const same = ctx({ amount: 120, usualAmount: 120, categoryCycleCurrent: 980 })
  check('spesa = media = 120: un solo valore con entrambi i ruoli; spesa e media accettate', [...moneyRoles(same).get(12000)].sort().join() === 'expense,today,usual'
    && accepted('Hai speso 120 € in Shopping.', same) && accepted('Di solito spendi 120 €.', same))
  const total = ctx({ amount: 700, usualAmount: 120, categoryCycleCurrent: 700 })
  check('spesa = totale di categoria = 700: entrambe le letture accettate', moneyRoles(total).get(70000).has('cycle_total') && accepted('Hai speso 700 € in Shopping.', total) && accepted('In questo ciclo Shopping è a 700 €.', total))
  const budgetSame = ctx({ amount: 700, usualAmount: 120 }, { spent: 700, available: 800 })
  check('spesa = speso nel ciclo (budget) = 700: spesa accettata, "Ti restano 700 €" rifiutata (regole di budget)', accepted('Hai speso 700 € in Shopping.', budgetSame) && !accepted('Ti restano 700 €.', budgetSame))
  const usualTotal = ctx({ amount: 700, usualAmount: 300, categoryCycleCurrent: 300 })
  check('media = totale = 300: media e totale accettati, come spesa rifiutato', accepted('La tua media è 300 €.', usualTotal) && accepted('In questo ciclo Shopping è a 300 €.', usualTotal)
    && errorsOf('Hai speso 300 € in Shopping.', usualTotal).includes('misattributed_amount'))
}

// =====================================================================
section('Audit 2C: risposta rifiutata → frase locale, nessuna nuova chiamata')
// =====================================================================
{
  let fetches = 0
  const provider = createRemoteProvider({ url: functionsUrl('https://x.supabase.co'), publicKey: 'pk', getAccessToken: async () => 'token',
    fetchImpl: async () => { fetches += 1; return new Response(JSON.stringify({ error: 'invalid', message: 'response_rejected' }), { status: 422 }) } })
  const meta = { fingerprint: 'f-misattributed', eventKey: 'big_expense:x', importance: 70, facts: null }
  const first = await requestSpendyVoice({ ai: createSpendyAI({ provider }), context: audit(), meta, cache: emptyVoiceCache(), today: TODAY, now: Date.parse(`${TODAY}T10:00:00Z`) })
  const next = decideSpendyVoice({ coach: { state: 'attentive', message: 'frase locale', reason: 'expense_over_100' }, meta, today: TODAY, cache: first.cache, now: Date.parse(`${TODAY}T10:05:00Z`) })
  check('422 dal server → errore "invalid", fallimento ricordato per la situazione', first.result.error === 'invalid' && first.cache.failure?.fingerprint === 'f-misattributed')
  check('   la stessa situazione dopo: frase locale, nessuna seconda richiesta al modello', next.action === 'local' && next.reason === 'ai_failed:invalid' && fetches === 1, `${next.action} ${next.reason} ${fetches}`)
}

report('Spendy AI — importi della spesa: precisione e ruoli (Fase 2C)')
