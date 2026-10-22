// Importi nelle reazioni della volpe (expenseReactionEngine + libreria).
// `npm test`, senza rete.
//
// Bug riprodotto qui: una spesa di 700 € ha mostrato "500 €?! Aspetta, mi
// devo sedere.". Nella libreria `{amount:500}` è la SOGLIA del gruppo
// "spesa enorme 500–999", non l'importo della spesa; in quella frase però è
// presentata come l'importo appena speso. Stesso schema per "1.000 €?!" e
// "Mille euro?!" con una spesa di 1.200 €.
//
// Regola verificata: una frase che dice QUANTO hai appena speso compare solo
// se quel numero è l'importo vero della spesa (e, per "Mille euro", la valuta
// è l'euro). Le frasi con una soglia ("più di 100 €", "100 € superati") restano
// valide sopra la soglia. Le altre frasi non citano importi.
// La spesa che attiva la reazione resta quella di sempre (findTriggerExpense,
// come in HEAD): una modifica non la sposta; il limite dopo una
// sincronizzazione è documentato nella sezione 7.
import { check, section, report } from '../sync/testkit.mjs'
import { evaluateExpenseReaction, resolveReactionText, findTriggerExpense, phraseFitsExpense } from './expenseReactionEngine.js'
import { REACTION_LIBRARY } from '../data/spendyReactionLibrary.js'
import { formatCurrencyWhole } from './format.js'
import { mergeRemoteRows } from '../sync/syncEngine.js'
import { detectSpendyEvents } from '../ai/spendyEvents.js'

const TODAY = '2026-10-21'
const LANGS = ['it', 'en', 'es', 'fr']
const CURRENCIES = ['EUR', 'USD', 'GBP']
let seq = 0
const expense = (amount, categoryId = 'shopping', extra = {}) => ({
  id: `e-${(seq += 1)}`, date: TODAY, amount, categoryId, description: '', updatedAt: `2026-10-21T19:${String(10 + seq).padStart(2, '0')}:00.000Z`, ...extra,
})

// rng a sequenza: il primo valore decide la frase rara (0.5 = no), il secondo quale frase.
const rngSeq = (values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)] }
const react = (expenses, { lang = 'it', currency = 'EUR', pick = 0.5, rare = 0.5, jokeHistory = [], monthlyBudget = 5000, available = 3000 } = {}) => evaluateExpenseReaction({
  today: TODAY, expenses, monthlyBudget, cycleStartDay: 1, goals: [], financialData: { available }, jokeHistory, lang, currency, rng: rngSeq([rare, pick]),
})
// Tutte le frasi raggiungibili (ogni posizione del pool), senza frasi rare.
const allReactions = (expenses, options = {}) => {
  const seen = new Map()
  for (let i = 0; i < 64; i += 1) {
    const r = react(expenses, { ...options, pick: i / 64 })
    if (r) seen.set(r.message, r)
  }
  return [...seen.values()]
}

// Importi che una frase può attribuire alla spesa: soglie del motore e parole "mille".
const THOUSAND_WORDS = /\b(mille euros?|a thousand euros|mil euros)\b/i
const fmt = (n, lang, currency) => formatCurrencyWhole(n, lang, currency)
function wrongAmounts(message, amount, lang, currency) {
  const wrong = []
  for (const n of [500, 1000]) if (n !== amount && message.includes(fmt(n, lang, currency))) wrong.push(fmt(n, lang, currency))
  // 100 compare solo come soglia ("più di 100 €", "100 € superati"): vale sopra 100.
  if (amount <= 100 && message.includes(fmt(100, lang, currency))) wrong.push(fmt(100, lang, currency))
  if (THOUSAND_WORDS.test(message) && !(amount === 1000 && currency === 'EUR')) wrong.push(message.match(THOUSAND_WORDS)[0])
  return wrong
}

// =====================================================================
section('1. Riproduzione: spesa shopping di 700 €')
// =====================================================================
{
  const reactions = allReactions([expense(700, 'shopping')])
  const sit = resolveReactionText(REACTION_LIBRARY.it.SPESA_ENORME_500[0], 'it', 'EUR')
  check('700 € → gruppo "spesa enorme 500–999" (regola invariata)', reactions.every((r) => r.reason === 'mega_expense_500'), reactions.map((r) => r.reason).join())
  check('mai "500 €?! Aspetta, mi devo sedere." per una spesa di 700 €', !reactions.some((r) => r.message === sit), sit)
  check('nessuna frase attribuisce alla spesa 500 € o 1.000 €', reactions.every((r) => wrongAmounts(r.message, 700, 'it', 'EUR').length === 0),
    reactions.map((r) => r.message).filter((m) => wrongAmounts(m, 700, 'it', 'EUR').length).join(' | '))
  check('restano frasi valide (nessun silenzio): almeno 3 diverse', reactions.length >= 3, String(reactions.length))
}

// =====================================================================
section('2–6. Importi 50, 150, 500, 999, 1.000, 1.200 in 4 lingue e 3 valute')
// =====================================================================
{
  for (const amount of [50, 150, 500, 700, 999, 1000, 1200]) {
    const problems = []
    for (const lang of LANGS) {
      for (const currency of CURRENCIES) {
        for (const r of allReactions([expense(amount, 'casa')], { lang, currency })) {
          const wrong = wrongAmounts(r.message, amount, lang, currency)
          if (wrong.length) problems.push(`${lang}/${currency}: ${r.message}`)
        }
      }
    }
    check(`${amount}: nessuna frase con un importo diverso da quello vero (it/en/es/fr × EUR/USD/GBP)`, problems.length === 0, problems.slice(0, 3).join(' | '))
  }
  const fiveHundred = allReactions([expense(500, 'casa')]).map((r) => r.message)
  check('500 € esatti: "500 €?! Aspetta, mi devo sedere." resta possibile', fiveHundred.includes('500 €?! Aspetta, mi devo sedere.'), fiveHundred.join(' | '))
  const at500_40 = allReactions([expense(500.4, 'casa')]).map((r) => r.message)
  check('500,40 €: la frase "500 €?!" no (l\'importo non è 500)', !at500_40.some((m) => m.startsWith('500 €?!')))
  const thousand = (currency, lang = 'it') => allReactions([expense(1000, 'casa')], { currency, lang }).map((r) => r.message)
  check('1.000 € in euro: "1.000 €?!" e "Mille euro?!" possibili', thousand('EUR').some((m) => m.startsWith('1.000 €?!')) && thousand('EUR').some((m) => m.startsWith('Mille euro?!')))
  check('1.000 in dollari: "1.000 $?!"/"$1,000?!" sì, "Mille euro" mai (valuta sbagliata)', thousand('USD', 'en').some((m) => m.startsWith('$1,000?!')) && !thousand('USD').some((m) => /euro/i.test(m)) && !thousand('USD', 'en').some((m) => /euro/i.test(m)))
  const fifty = react([expense(50, 'casa')])
  check('50 €: nessuna reazione per importo (regola "spesa piccola" invariata)', fifty === null, JSON.stringify(fifty))
  const oneFifty = allReactions([expense(150, 'casa')]).map((r) => r.message)
  check('150 €: le frasi di soglia ("più di 100 €") restano possibili', oneFifty.some((m) => m.includes('100 €')), oneFifty.join(' | '))
}

// =====================================================================
section('7. Quale spesa attiva la reazione: la più recente inserita (regola di HEAD)')
// =====================================================================
{
  // La regola di HEAD (prima di questa correzione), riscritta qui per confrontarla.
  const headRule = (expenses, today) => expenses.find((e) => e.date === today) ?? null
  const first = expense(500, 'tecnologia', { updatedAt: '2026-10-21T19:10:27.719Z' })
  const second = expense(1200, 'shopping', { updatedAt: '2026-10-21T19:20:00.000Z' })
  // addExpense mette la nuova spesa davanti: [seconda, prima].
  check('due spese consecutive: la reazione riguarda la seconda (1.200 €), non eredita la prima', react([second, first]).reason === 'mega_expense_1000')
  const seven = expense(700, 'shopping')
  const afterSeven = allReactions([seven, first])
  check('500 € e poi 700 €: nessuna frase dice "500 €" per la spesa da 700 €', afterSeven.every((r) => wrongAmounts(r.message, 700, 'it', 'EUR').length === 0 && !r.message.includes('500 €')))

  // editExpense: stessa posizione nell'array, updatedAt nuovo (anche per la sola nota).
  const morning = expense(700, 'casa', { id: 'mattina', updatedAt: '2026-10-21T08:00:00.000Z' })
  const coffee = expense(20, 'bar', { id: 'pomeriggio', updatedAt: '2026-10-21T12:00:00.000Z' })
  const noteEdited = [coffee, { ...morning, description: 'nota aggiunta', updatedAt: '2026-10-21T18:00:00.000Z' }]
  check('modificare solo la nota della spesa del mattino NON la rende la spesa della reazione', findTriggerExpense(noteEdited, TODAY)?.id === 'pomeriggio')
  check('   la volpe non torna a commentare la spesa da 700 €: nessuna reazione, come prima della nota', react([coffee, morning]) === null && react(noteEdited) === null)

  const cases = {
    'più recente davanti': [second, first],
    'nota modificata': noteEdited,
    'timestamp mancanti': [expense(700, 'casa', { updatedAt: undefined }), expense(150, 'casa', { updatedAt: undefined })],
    'timestamp identici': [expense(150, 'casa', { updatedAt: '2000-01-01T00:00:00.000Z' }), expense(700, 'casa', { updatedAt: '2000-01-01T00:00:00.000Z' })],
    'spese di altri giorni davanti': [expense(900, 'casa', { date: '2026-10-20' }), coffee, morning],
    'nessuna spesa di oggi': [expense(900, 'casa', { date: '2026-10-20' })],
  }
  check('findTriggerExpense identica alla regola di HEAD in tutti i casi', Object.values(cases).every((list) => findTriggerExpense(list, TODAY) === headRule(list, TODAY)),
    Object.entries(cases).filter(([, list]) => findTriggerExpense(list, TODAY) !== headRule(list, TODAY)).map(([name]) => name).join())

  // Limite noto, documentato e NON corretto qui: dopo una sincronizzazione completa
  // mergeRemoteRows ordina solo per data (il pull arriva in updated_at crescente), quindi
  // fra due spese dello stesso giorno può stare davanti la più vecchia. Senza un'ora di
  // creazione sulle spese non c'è modo affidabile di distinguerle (updatedAt cambia con
  // le modifiche); serve una modifica del modello dei dati, non approvata.
  const remote = [first, second].map((e) => ({ id: e.id, user_id: 'u', amount: e.amount, category_id: e.categoryId, subcategory: null, description: '', date: e.date, client_updated_at: e.updatedAt.replace('Z', '+00:00'), deleted_at: null }))
  const synced = mergeRemoteRows('expenses', [], remote)
  check('[limite noto] dopo una sincronizzazione completa la più vecchia può stare davanti', synced[0].amount === 500 && findTriggerExpense(synced, TODAY).amount === 500)
  const event = detectSpendyEvents({ coach: { reason: 'mega_expense_500', insight: { categoryId: null } }, expenses: synced, today: TODAY })
  check('   anche in quel caso reazione locale e contesto AI parlano della stessa spesa', event.some((e) => e.trigger === findTriggerExpense(synced, TODAY)))
  check('   e la frase non attribuisce mai a quella spesa un importo diverso dal suo', allReactions(synced).every((r) => wrongAmounts(r.message, 500, 'it', 'EUR').length === 0))
}

// =====================================================================
section('8–9. Modifica di una spesa (importo, categoria): niente frase dell\'importo precedente')
// =====================================================================
{
  // Percorso dell'app: nessun rng iniettato, la reazione di un evento viene ricordata.
  const realRandom = Math.random
  try {
    let values = [0.5, 0]
    Math.random = () => values.shift() ?? 0
    const original = expense(500, 'casa', { id: 'spesa-modificata' })
    const before = evaluateExpenseReaction({ today: TODAY, expenses: [original], monthlyBudget: 5000, financialData: { available: 3000 }, lang: 'it', currency: 'EUR' })
    check('premessa: per 500 € esatti viene scelta "500 €?! Aspetta, mi devo sedere."', before.message === '500 €?! Aspetta, mi devo sedere.', before.message)
    values = [0.5, 0]
    const edited = { ...original, amount: 700, updatedAt: '2026-10-21T19:40:00.000Z' }
    const after = evaluateExpenseReaction({ today: TODAY, expenses: [edited], monthlyBudget: 5000, financialData: { available: 3000 }, lang: 'it', currency: 'EUR' })
    check('stessa spesa portata a 700 €: la frase da 500 € non viene riusata', after.reason === 'mega_expense_500' && wrongAmounts(after.message, 700, 'it', 'EUR').length === 0, after.message)
    values = [0.5, 0]
    const recat = { ...edited, categoryId: 'shopping', updatedAt: '2026-10-21T19:45:00.000Z' }
    const afterCategory = evaluateExpenseReaction({ today: TODAY, expenses: [recat], monthlyBudget: 5000, financialData: { available: 3000 }, lang: 'it', currency: 'EUR' })
    check('cambio di categoria: reazione ricalcolata, sempre senza importi sbagliati', wrongAmounts(afterCategory.message, 700, 'it', 'EUR').length === 0, afterCategory.message)
    values = [0.5, 0]
    const again = evaluateExpenseReaction({ today: TODAY, expenses: [recat], monthlyBudget: 5000, financialData: { available: 3000 }, lang: 'it', currency: 'EUR' })
    check('stessa spesa invariata: la stessa reazione di prima (una sola reazione per evento)', again.message === afterCategory.message)
    // "Mille euro?!" scelto per 1.000 € in euro, poi l'account passa ai dollari:
    // lo stesso evento non può tenere una frase che dice "euro".
    let thousandEvent = null
    let first = null
    for (let i = 0; i < 40; i += 1) {
      values = [0.5, i / 40]
      const candidate = expense(1000, 'casa', { id: `spesa-mille-${i}` })
      first = evaluateExpenseReaction({ today: TODAY, expenses: [candidate], monthlyBudget: 5000, financialData: { available: 3000 }, lang: 'it', currency: 'EUR' })
      if (/^Mille euro/.test(first.message)) { thousandEvent = candidate; break }
    }
    check('premessa: "Mille euro?!" scelto per 1.000 € in euro', thousandEvent !== null, first?.message)
    values = [0.5, 0.5]
    const inEnglish = evaluateExpenseReaction({ today: TODAY, expenses: [thousandEvent ?? expense(1000, 'casa')], monthlyBudget: 5000, financialData: { available: 3000 }, lang: 'en', currency: 'EUR' })
    check('stesso evento, lingua cambiata (euro): la stessa frase tradotta, come prima', inEnglish.message === 'A thousand euros?! Your account just saw its life flash before its eyes.', inEnglish.message)
    values = [0.5, 0.5]
    const inDollars = evaluateExpenseReaction({ today: TODAY, expenses: [thousandEvent ?? expense(1000, 'casa')], monthlyBudget: 5000, financialData: { available: 3000 }, lang: 'it', currency: 'USD' })
    check('stesso evento, valuta cambiata in dollari: niente "Mille euro", una frase valida al suo posto', !/euro/i.test(inDollars.message) && wrongAmounts(inDollars.message, 1000, 'it', 'USD').length === 0, inDollars.message)
  } finally {
    Math.random = realRandom
  }
}

// =====================================================================
section('10. Nessuna frase compatibile: si ripiega su una generica (o nessuna reazione)')
// =====================================================================
{
  check('phraseFitsExpense: soglia → sempre; importo esatto → solo se coincide', phraseFitsExpense('Più di {amount:100}?', { amount: 700 }, 'EUR')
    && phraseFitsExpense('{expense:500}?!', { amount: 500 }, 'EUR') && !phraseFitsExpense('{expense:500}?!', { amount: 700 }, 'EUR')
    && !phraseFitsExpense('{expense:500}?!', null, 'EUR'))
  check('   "{if-expense:1000:EUR}" → solo 1.000 in euro', phraseFitsExpense('{if-expense:1000:EUR}Mille euro?!', { amount: 1000 }, 'EUR')
    && !phraseFitsExpense('{if-expense:1000:EUR}Mille euro?!', { amount: 1000 }, 'USD') && !phraseFitsExpense('{if-expense:1000:EUR}Mille euro?!', { amount: 1200 }, 'EUR'))
  // In ogni gruppo raggiungibile da una spesa c'è sempre almeno una frase senza importi.
  const groups = ['SPESA_ENORME_500', 'SPESA_ENORME_1000', 'SPESA_100', 'SPESA_INUTILE', 'RARE_SPECIALI']
  check('ogni gruppo ha frasi generiche (senza importi) in tutte le lingue', LANGS.every((lang) => groups.every((g) => REACTION_LIBRARY[lang][g].some((t) => !/\{(expense|if-expense):/.test(t)))))
  const odd = [5.5, 101, 499.99, 501, 777, 998, 1001, 2500, 99999]
  check(`importi qualsiasi (${odd.join(', ')}): sempre una reazione, mai un importo sbagliato`, odd.every((amount) => {
    const all = allReactions([expense(amount, 'casa')])
    return (amount <= 100 ? true : all.length > 0) && all.every((r) => wrongAmounts(r.message, amount, 'it', 'EUR').length === 0)
  }))
}

// =====================================================================
section('11. Formattazione: importo esatto nella lingua e valuta dell\'account')
// =====================================================================
{
  const raw = (lang) => REACTION_LIBRARY[lang].SPESA_ENORME_500[0]
  // Testo approvato invariato: `{expense:500}` si legge esattamente come il vecchio `{amount:500}`.
  const asBefore = (lang, currency) => resolveReactionText(raw(lang).replace('{expense:500}', '{amount:500}'), lang, currency)
  check('la frase da 500 € si legge come prima, in ogni lingua e valuta (testo approvato invariato)', raw('it').includes('{expense:500}')
    && LANGS.every((lang) => CURRENCIES.every((c) => resolveReactionText(raw(lang), lang, c) === asBefore(lang, c))), LANGS.map((l) => resolveReactionText(raw(l), l, 'EUR')).join(' | '))
  check('   e con dollari/sterline usa il formato della valuta', resolveReactionText(raw('en'), 'en', 'USD').startsWith('$500?!') && resolveReactionText(raw('it'), 'it', 'GBP').startsWith('500 £?!'))
  check('"Mille euro?!": la direttiva non si vede nel testo', resolveReactionText(REACTION_LIBRARY.it.SPESA_ENORME_1000[2], 'it', 'EUR') === 'Mille euro?! Il tuo conto ha appena visto la luce.')
  check('nessun segnaposto rimasto in nessuna frase risolta', LANGS.every((lang) => CURRENCIES.every((c) => Object.values(REACTION_LIBRARY[lang]).flat().every((t) => !/[{}]/.test(resolveReactionText(t, lang, c))))))
}

// =====================================================================
section('12. Nessuna regressione: lingue allineate, anti-ripetizione, scelta casuale')
// =====================================================================
{
  const req = (t) => (t.match(/\{(?:if-)?expense:(\d+)(?::([A-Z]{3}))?\}/) ?? []).slice(1).join(':')
  check('stessa regola d\'importo nella stessa posizione in tutte le lingue', Object.keys(REACTION_LIBRARY.it).every((g) => {
    const it = [REACTION_LIBRARY.it[g]].flat().map(req)
    return LANGS.every((lang) => JSON.stringify([REACTION_LIBRARY[lang][g]].flat().map(req)) === JSON.stringify(it))
  }))
  const pool700 = allReactions([expense(700, 'casa')]).map((r) => r.message)
  const last = pool700[0]
  const history = [{ key: 'general:mega_expense_500', text: last, shownAt: TODAY }]
  const next = allReactions([expense(700, 'casa')], { jokeHistory: history }).map((r) => r.message)
  check('una frase appena mostrata non si ripete subito (fra quelle valide)', !next.includes(last) && next.length === pool700.length - 1)
  const picks = LANGS.map((lang) => react([expense(700, 'casa')], { lang, pick: 0.3 }))
  const it500 = REACTION_LIBRARY.it.SPESA_ENORME_500.map((t) => resolveReactionText(t, 'it', 'EUR'))
  const idx = it500.indexOf(picks[0].message)
  check('stessa scelta in tutte le lingue (stessa posizione nel gruppo)', idx >= 0 && picks.every((p, i) => p.message === resolveReactionText(REACTION_LIBRARY[LANGS[i]].SPESA_ENORME_500[idx], LANGS[i], 'EUR')))
  const rare = react([expense(700, 'casa')], { rare: 0.01 })
  check('le frasi rare restano possibili (8%) e non citano importi', rare.insight.type === 'rare_special' && wrongAmounts(rare.message, 700, 'it', 'EUR').length === 0)
}

report('Reazioni della volpe: importi coerenti con la spesa')
