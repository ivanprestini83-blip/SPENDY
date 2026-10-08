// Regression test del RADAR SPENDY. `npm test`, senza browser e senza
// rete. Tutti i dati sono inventati per il test, nessuno viene dall'app.

import { check, section, report } from '../sync/testkit.mjs'
import { buildRadar, RADAR_STATUS, RADAR_ACTIONS, RADAR_CARD_LIMIT } from './radarEngine.js'
import { buildFinancialData } from './budgetCalculations.js'
import { getSpendyCoach } from './spendyCoach.js'

const TODAY = '2026-09-20'
const CYCLE = 1

// rng fisso: JokeEvaluator sceglie a caso tra le battute a pari
// punteggio, quindi senza questo i test sarebbero instabili per
// costruzione. Non maschera niente: la SELEZIONE resta quella vera.
const rng = () => 0

let seq = 0
const expense = (date, amount, categoryId) => ({ id: `e-${seq++}`, date, amount, categoryId, description: categoryId })

// Tre cicli di storico + il ciclo corrente, cosi' i check che
// richiedono una media hanno di che lavorare.
const cycleOf = (month, amount, categoryId, day = '10') => expense(`2026-${month}-${day}`, amount, categoryId)

const ristorantiStabile = [
  cycleOf('06', 50, 'ristoranti'),
  cycleOf('07', 60, 'ristoranti'),
  cycleOf('08', 55, 'ristoranti'),
]
const spesaAlta = [
  cycleOf('06', 200, 'spesa'),
  cycleOf('07', 190, 'spesa'),
  cycleOf('08', 210, 'spesa'),
]
// 10 caffe' da 7 € nel ciclo corrente: sotto la soglia "piccola spesa",
// abbastanza numerosi e abbastanza pesanti insieme.
const piccoleSpese = Array.from({ length: 10 }, (_, i) =>
  expense(`2026-09-${String(i + 2).padStart(2, '0')}`, 7, 'bar'))

const GOALS = [{ id: 'g-1', label: 'Vacanze', emoji: '🎯', saved: 720, target: 1000, etaMonths: 6 }]

function radar({ expenses, monthlyBudget = 1000, goals = [], jokeHistory = [], lang = 'it', limit } = {}) {
  const financialData = buildFinancialData({ today: TODAY, monthlyBudget, expenses, incomes: [], goals, cycleStartDay: CYCLE })
  return buildRadar({
    expenses, goals, today: TODAY, monthlyBudget, cycleStartDay: CYCLE,
    financialData, jokeHistory, lang, rng, ...(limit ? { limit } : {}),
  })
}

const cardOfType = (result, type) => result.cards.find((card) => card.type === type)
// Gli importi ora hanno i decimali ("175,50 €"): la virgola e' parte
// del numero, non un separatore fra due numeri diversi.
const numbersIn = (text) => (String(text ?? '').match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Math.round(parseFloat(n.replace(',', '.'))))

// =====================================================================
section('1. Nessun dato / dati insufficienti — Spendy non inventa niente')
// =====================================================================
const vuoto = radar({ expenses: [] })
check('nessuna spesa → stato "sto imparando"', vuoto.status === RADAR_STATUS.LEARNING)
check('nessuna scheda mostrata', vuoto.cards.length === 0)
check('dice quanti cicli gli servono', vuoto.cyclesNeeded === 3 && vuoto.cyclesSeen === 0)

const pochiDati = radar({ expenses: [expense('2026-09-10', 40, 'spesa'), expense('2026-09-12', 25, 'bar')] })
check('due spese in un solo ciclo → ancora in apprendimento', pochiDati.status === RADAR_STATUS.LEARNING)
check('nessun trend inventato dal nulla', pochiDati.cards.length === 0)
check('ha visto 1 solo ciclo', pochiDati.cyclesSeen === 1)

// =====================================================================
section('2. Radar tranquillo — storico sufficiente, niente da segnalare')
// =====================================================================
// Perche' proprio questi numeri: per essere TRANQUILLO il Radar deve
// avere storico a sufficienza (3 cicli con dati) e insieme nessun
// appiglio — niente variazioni (importi identici), niente streak (un
// ciclo vuoto la interrompe) e una percentuale di budget nella fascia
// 50-70%, l'unica in cui nessuna scheda budget si attiva.
const speseTranquille = [
  cycleOf('06', 600, 'spesa'),
  cycleOf('08', 600, 'spesa'),
  cycleOf('09', 600, 'spesa'),
]
const tranquillo = radar({ expenses: speseTranquille, monthlyBudget: 1000 })
check('storico sufficiente ma nessuna anomalia → stato tranquillo', tranquillo.status === RADAR_STATUS.QUIET)
check('nessuna scheda vuota mostrata', tranquillo.cards.length === 0)
check('ha una frase rassicurante', typeof tranquillo.quietMessage === 'string' && tranquillo.quietMessage.length > 10)

const variazioni = new Set()
for (let i = 0; i < 6; i++) {
  variazioni.add(buildRadar({
    expenses: speseTranquille,
    today: TODAY, monthlyBudget: 1000, cycleStartDay: CYCLE,
    financialData: buildFinancialData({ today: TODAY, monthlyBudget: 1000, expenses: speseTranquille, incomes: [], goals: [], cycleStartDay: CYCLE }),
    rng: () => i / 6,
  }).quietMessage)
}
check('la frase cambia, non e\' sempre la stessa', variazioni.size > 1, `${variazioni.size} varianti`)
check('"budget rispettato" non diventa una scheda (e\' gia\' il messaggio della Home)',
  radar({ expenses: speseTranquille, monthlyBudget: 5000 }).cards.every((card) => card.type !== 'budget_respected'))

// =====================================================================
section('3. Categoria in aumento')
// =====================================================================
const aumento = radar({ expenses: [...ristorantiStabile, cycleOf('09', 200, 'ristoranti')] })
const cardAumento = aumento.cards[0]
check('il Radar si attiva', aumento.status === RADAR_STATUS.ACTIVE)
check('titolo = la categoria', cardAumento.title === 'RISTORANTE', cardAumento.title)
check('tono di avviso (arancione)', cardAumento.tone === 'warning' && cardAumento.dot === '🟠')
check('dato principale = quanto ha speso', cardAumento.metric.value === '200,00 €', cardAumento.metric.value)
check('confronto con la media', /rispetto alla tua media/.test(cardAumento.comparison.text))
check('la percentuale ha il segno +', cardAumento.comparison.text.startsWith('+'))
check('azione reale: vedi categoria', cardAumento.action === RADAR_ACTIONS.CATEGORY)
check('c\'e\' una frase di Spendy', typeof cardAumento.message === 'string' && cardAumento.message.length > 0)
check('stato mascotte coerente (non happy su un aumento)', ['attentive', 'concerned', 'ironic'].includes(cardAumento.state))

// =====================================================================
section('4. Categoria in diminuzione — il Radar non segnala solo problemi')
// =====================================================================
const calo = radar({ expenses: [...spesaAlta, cycleOf('09', 60, 'spesa')] })
const cardCalo = calo.cards[0]
check('si attiva anche per un miglioramento', calo.status === RADAR_STATUS.ACTIVE)
check('tono positivo (verde)', cardCalo.tone === 'positive' && cardCalo.dot === '🟢')
check('percentuale negativa', cardCalo.comparison.text.startsWith('-'))
check('consiglio utile, non un rimprovero', /obiettivo/i.test(cardCalo.advice))
check('azione reale: vedi obiettivo', cardCalo.action === RADAR_ACTIONS.GOALS)

// =====================================================================
section('5. Tante piccole spese')
// =====================================================================
const piccole = radar({ expenses: [...ristorantiStabile, ...piccoleSpese] })
const cardPiccole = cardOfType(piccole, 'small_expenses_add_up')
check('la scheda esiste', Boolean(cardPiccole))
check('titolo dedicato', cardPiccole.title === 'PICCOLE SPESE')
check('conta gli acquisti (10)', cardPiccole.metric.value === '10 acquisti')
check('e il totale (70 €)', cardPiccole.metric.label === '70,00 €', cardPiccole.metric.label)
check('media per acquisto nel confronto', cardPiccole.comparison.text === '7,00 € in media l\'uno', cardPiccole.comparison.text)
check('riconosce la categoria dominante', /bar/i.test(cardPiccole.explanation))
check('azione reale: vedi le spese', cardPiccole.action === RADAR_ACTIONS.EXPENSES)

const noPiccole = radar({ expenses: [...ristorantiStabile, ...piccoleSpese.slice(0, 5)] })
check('sotto la soglia di numerosita\' non segnala niente', !cardOfType(noPiccole, 'small_expenses_add_up'))

// =====================================================================
section('6. Budget quasi esaurito e budget superato')
// =====================================================================
const speseCorrenti = [...ristorantiStabile, cycleOf('09', 200, 'ristoranti')]
const quasi = radar({ expenses: speseCorrenti, monthlyBudget: 220 })
const cardQuasi = cardOfType(quasi, 'budget_high')
check('budget al 91% → scheda budget', Boolean(cardQuasi))
check('mostra il residuo come dato principale', cardQuasi.metric.value === '20,00 €', cardQuasi.metric.value)
check('etichetta "ancora disponibili"', cardQuasi.metric.label === 'ancora disponibili')
check('mostra la percentuale utilizzata', cardQuasi.comparison.text === '91% utilizzato')
check('mostra speso su totale', cardQuasi.comparison.baselineText === '200,00 € spesi su 220,00 €.', cardQuasi.comparison.baselineText)
check('azione reale: posso permettermelo?', cardQuasi.action === RADAR_ACTIONS.AFFORDABILITY)
check('il budget quasi esaurito batte la variazione di categoria', quasi.cards[0].type === 'budget_high',
  quasi.cards.map((c) => `${c.type}:${c.priority}`).join(' '))

const superato = radar({ expenses: speseCorrenti, monthlyBudget: 150 })
const cardSuperato = cardOfType(superato, 'budget_exceeded')
check('budget superato → scheda critica', cardSuperato.tone === 'critical' && cardSuperato.dot === '🔴')
check('mostra di quanto si e\' sforato', cardSuperato.metric.value === '50,00 €', cardSuperato.metric.value)
check('etichetta "oltre il budget"', cardSuperato.metric.label === 'oltre il budget')
check('e\' la scheda con priorita\' piu\' alta', superato.cards[0].type === 'budget_exceeded')
check('azione reale: vai al budget', cardSuperato.action === RADAR_ACTIONS.BUDGET)

// =====================================================================
section('7. Risparmio')
// =====================================================================
const risparmio = radar({
  expenses: [
    cycleOf('06', 300, 'spesa'), cycleOf('07', 320, 'spesa'), cycleOf('08', 310, 'spesa'),
    cycleOf('09', 120, 'spesa'),
  ],
  monthlyBudget: 1000,
})
const cardRisparmio = cardOfType(risparmio, 'savings_vs_usual')
check('la scheda risparmio esiste', Boolean(cardRisparmio))
check('titolo RISPARMIO', cardRisparmio.title === 'RISPARMIO')
check('tono positivo', cardRisparmio.tone === 'positive')
check('mostra quanto ha risparmiato', /€/.test(cardRisparmio.metric.value))
check('etichetta "in meno del solito"', cardRisparmio.metric.label === 'in meno del solito')
check('stato mascotte felice', cardRisparmio.state === 'happy')

// =====================================================================
section('8. Obiettivo')
// =====================================================================
const obiettivo = radar({ expenses: [...ristorantiStabile, cycleOf('09', 200, 'ristoranti')], goals: GOALS })
const cardObiettivo = cardOfType(obiettivo, 'goal_progress')
check('la scheda obiettivo esiste', Boolean(cardObiettivo))
check('tono dedicato 🎯', cardObiettivo.tone === 'goal' && cardObiettivo.dot === '🎯')
check('percentuale come dato principale (72%)', cardObiettivo.metric.value === '72%')
check('nome obiettivo come etichetta', cardObiettivo.metric.label === 'Vacanze')
// Niente assert sulla formattazione esatta delle migliaia: dipende dai
// dati di localizzazione disponibili (il browser scrive "1.000 €", Node
// senza ICU completo scrive "1000 €"). Cio' che conta e' che ci siano
// entrambi i numeri veri.
check('accumulato / target nel confronto',
  /^720,00 € \/ 1\.?000,00 €$/.test(cardObiettivo.comparison.text), cardObiettivo.comparison.text)
check('quanto manca', cardObiettivo.comparison.baselineText === 'Mancano 280,00 €.', cardObiettivo.comparison.baselineText)
check('azione reale: vedi obiettivo', cardObiettivo.action === RADAR_ACTIONS.GOALS)

const obiettivoLontano = radar({ expenses: [...ristorantiStabile], goals: [{ id: 'g-2', label: 'Auto', saved: 100, target: 5000 }] })
check('un obiettivo al 2% non e\' ancora una notizia', !cardOfType(obiettivoLontano, 'goal_progress'))

// =====================================================================
section('9. Priorita\' e limite')
// =====================================================================
const molti = radar({
  expenses: [
    ...ristorantiStabile, cycleOf('09', 200, 'ristoranti'),
    ...spesaAlta, cycleOf('09', 60, 'spesa'),
    ...piccoleSpese,
    cycleOf('06', 40, 'svago'), cycleOf('07', 45, 'svago'), cycleOf('08', 42, 'svago'), cycleOf('09', 120, 'svago'),
    cycleOf('06', 30, 'viaggi'), cycleOf('07', 35, 'viaggi'), cycleOf('08', 33, 'viaggi'), cycleOf('09', 90, 'viaggi'),
  ],
  monthlyBudget: 600,
  goals: GOALS,
})
check('piu\' insight → piu\' schede', molti.cards.length > 1)
check('mai piu\' di 5 schede', molti.cards.length <= RADAR_CARD_LIMIT)
check('esattamente 5 quando ce ne sono di piu\'', molti.cards.length === 5)
const priorita = molti.cards.map((card) => card.priority)
check('ordinate dalla piu\' importante alla meno importante',
  priorita.every((value, i) => i === 0 || priorita[i - 1] >= value), JSON.stringify(priorita))
check('ogni scheda ha un punteggio 0-100', priorita.every((value) => value >= 0 && value <= 100))

const limitato = radar({ expenses: molti.cards.length ? [...ristorantiStabile, cycleOf('09', 200, 'ristoranti'), ...piccoleSpese] : [], limit: 1 })
check('il limite e\' configurabile', limitato.cards.length === 1)

// =====================================================================
section('10. Nessuna duplicazione — il Radar non e\' la Home')
// =====================================================================
const ids = molti.cards.map((card) => card.id)
check('nessuna scheda ripetuta', new Set(ids).size === ids.length)
const ristorantiCards = molti.cards.filter((card) => card.insight.categoryId === 'ristoranti')
check('una sola scheda per categoria+direzione', ristorantiCards.length <= 1)

const financialData = buildFinancialData({ today: TODAY, monthlyBudget: 600, expenses: [...ristorantiStabile, cycleOf('09', 200, 'ristoranti'), ...piccoleSpese], incomes: [], goals: GOALS, cycleStartDay: CYCLE })
const coach = getSpendyCoach(financialData, { expenses: [...ristorantiStabile, cycleOf('09', 200, 'ristoranti'), ...piccoleSpese], today: TODAY, monthlyBudget: 600, cycleStartDay: CYCLE, jokeHistory: [], financialData })
check('la Home resta un messaggio solo', typeof coach.message === 'string')
check('il Radar ne mostra di piu\'', molti.cards.length > 1)

// =====================================================================
section('11. Niente ripetizioni: la cronologia viene rispettata')
// =====================================================================
const primaVolta = radar({ expenses: [...ristorantiStabile, cycleOf('09', 200, 'ristoranti')] })
const fraseMostrata = primaVolta.cards[0].message
const storico = Array.from({ length: 30 }, () => ({ key: primaVolta.cards[0].id, text: fraseMostrata, shownAt: TODAY }))
const secondaVolta = radar({ expenses: [...ristorantiStabile, cycleOf('09', 200, 'ristoranti')], jokeHistory: storico })
check('la stessa battuta non viene riproposta', secondaVolta.cards[0].message !== fraseMostrata)
check('ma la scheda resta (con un\'altra frase o informativa)', secondaVolta.cards.length > 0)

// =====================================================================
section('12. Nessun numero inventato')
// =====================================================================
// Ogni cifra nella frase di Spendy e nel dato principale deve esistere
// nell'insight che l'ha generata. La spiegazione discorsiva e' esclusa
// di proposito: cita anche soglie di configurazione (i 15 € della
// "piccola spesa", il 70% delle streak), che sono costanti note, non
// numeri inventati sul momento.
let inventati = []
for (const card of molti.cards) {
  const insight = card.insight
  const consentiti = [insight.current, insight.baseline, insight.changeAmount, insight.changePercent,
    ...Object.values(insight.facts ?? {})]
    .filter((n) => typeof n === 'number' && Number.isFinite(n))
    .map((n) => Math.round(Math.abs(n)))
  for (const value of [...numbersIn(card.message), ...numbersIn(card.metric.value), ...numbersIn(card.metric.label)]) {
    if (!consentiti.some((allowed) => Math.abs(allowed - value) <= 1)) {
      inventati.push(`${card.type}: ${value} (ammessi ${consentiti.join(',')})`)
    }
  }
}
check('nessuna cifra fuori dai dati dell\'insight', inventati.length === 0, inventati.join(' | '))

const cardConSegnaposto = cardOfType(obiettivo, 'goal_progress')
check('i segnaposto sono stati sostituiti, non lasciati a schermo', !/\{[a-z]+\}/.test(cardConSegnaposto.message))
check('nessun segnaposto residuo in nessuna scheda',
  molti.cards.every((card) => !/\{[a-z]+\}/.test(`${card.message}${card.explanation}${card.advice ?? ''}`)))

// =====================================================================
section('13. Azioni: tutte reali')
// =====================================================================
const TAB_REALI = new Set(['home', 'expenses', 'incomes', 'analytics', 'goals', 'spendy'])
const MODAL_REALI = new Set(['addTransaction', 'quickAdd', 'editExpense', 'editIncome', 'newGoal',
  'contributeGoal', 'radarDetail', 'affordability', 'emergencyFund', 'settings'])
const tutteLeSchede = [...molti.cards, ...superato.cards, ...quasi.cards, ...obiettivo.cards, ...risparmio.cards, ...piccole.cards]
const azioniInvalide = tutteLeSchede.filter((card) => {
  if (!card.action) return false
  if (card.action.kind === 'tab') return !TAB_REALI.has(card.action.target)
  if (card.action.kind === 'modal') return !MODAL_REALI.has(card.action.target)
  return card.action.kind !== 'detail'
})
check('ogni azione punta a una schermata che esiste davvero', azioniInvalide.length === 0,
  azioniInvalide.map((c) => `${c.type}→${c.action.target}`).join(', '))
check('ogni scheda ha un\'azione', tutteLeSchede.every((card) => Boolean(card.action)))
// Fase 4A: l'etichetta (nella lingua scelta) è card.actionLabel; card.action resta l'oggetto di RADAR_ACTIONS.
check('ogni azione ha un\'etichetta leggibile', tutteLeSchede.every((card) => card.actionLabel.length > 3))

// =====================================================================
section('14. Cambio lingua')
// =====================================================================
const IT = radar({ expenses: [...ristorantiStabile, cycleOf('09', 200, 'ristoranti')], goals: GOALS, lang: 'it' })
for (const lang of ['en', 'fr', 'es']) {
  const tradotto = radar({ expenses: [...ristorantiStabile, cycleOf('09', 200, 'ristoranti')], goals: GOALS, lang })
  check(`lingua ${lang}: stesse schede`, tradotto.cards.length === IT.cards.length)
  check(`lingua ${lang}: la frase cambia davvero`, tradotto.cards[0].message !== IT.cards[0].message)
  check(`lingua ${lang}: obiettivo senza segnaposto rimasti`,
    !/\{[a-z]+\}/.test(cardOfType(tradotto, 'goal_progress')?.message ?? ''))
}

report('radar')
