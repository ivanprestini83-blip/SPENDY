// Due garanzie che prima non erano scritte da nessuna parte:
//
//  1. la volpe ha SEI stati illustrati e devono essere tutti
//     raggiungibili. Lo erano solo sulla carta: la Home passava al coach
//     una lista di obiettivi vuota, quindi "obiettivo raggiunto" — cioe'
//     l'unico caso in cui Spendy festeggia — non poteva scattare. Questo
//     test riproduce ESATTAMENTE la chiamata che fa HomePage, cosi' se
//     qualcuno riscollega male i dati il conto degli stati scende e il
//     test fallisce.
//  2. gli importi mostrano i centesimi: 175,50 € non deve diventare 176 €.

import { check, section, report } from '../sync/testkit.mjs'
import { getSpendyCoach, getInsightTopicKey, SPENDY_STATES } from './spendyCoach.js'
import { buildFinancialData } from './budgetCalculations.js'
import { formatCurrency } from './format.js'
import { spendyStates } from '../components/spendy/spendyStates.js'
import { existsSync } from 'node:fs'

const TODAY = '2026-09-20'
let seq = 0
const expense = (date, amount, categoryId) => ({ id: `e-${seq++}`, date, amount, categoryId, description: categoryId })
const history = (categoryId, values) => ['06', '07', '08'].map((month, i) => expense(`2026-${month}-10`, values[i], categoryId))

// La stessa identica forma con cui HomePage chiama il coach: se questa
// riga e quella della pagina divergono, il test non protegge piu' niente.
function coachAsHome({ expenses = [], monthlyBudget = 1000, goals = [] }) {
  const financialData = buildFinancialData({
    today: TODAY, monthlyBudget, expenses, incomes: [], goals, cycleStartDay: 1,
  })
  return getSpendyCoach(financialData, {
    expenses, today: TODAY, monthlyBudget, cycleStartDay: 1, goals, jokeHistory: [], financialData,
  })
}

// =====================================================================
section('1. I sei stati della volpe sono tutti raggiungibili dalla Home')
// =====================================================================
const scenari = {
  advisor: { monthlyBudget: 0 },
  celebrating: {
    expenses: [expense('2026-09-10', 50, 'spesa')],
    goals: [{ id: 'g-1', label: 'Vacanze', saved: 1000, target: 1000 }],
  },
  concerned: { expenses: [expense('2026-09-10', 900, 'spesa')] },
  attentive: { expenses: [expense('2026-09-10', 750, 'spesa')] },
  ironic: { expenses: [expense(TODAY, 150, 'shopping')], monthlyBudget: 5000 },
  happy: {
    expenses: [...history('spesa', [100, 110, 105]), expense('2026-09-05', 100, 'spesa')],
  },
}

const visti = new Set()
for (const [atteso, scenario] of Object.entries(scenari)) {
  const coach = coachAsHome(scenario)
  visti.add(coach.state)
  check(`${atteso}: raggiunto (${coach.reason})`, coach.state === atteso, `ottenuto ${coach.state}`)
}

const TUTTI = Object.values(SPENDY_STATES)
check('sono sei stati in tutto', TUTTI.length === 6)
check('nessuno resta inutilizzato', TUTTI.every((stato) => visti.has(stato)),
  `mancanti: ${TUTTI.filter((s) => !visti.has(s)).join(', ')}`)

// Regressione precisa: e' il bug che c'era davvero.
const conObiettivoRaggiunto = coachAsHome({
  expenses: [expense('2026-09-10', 50, 'spesa')],
  goals: [{ id: 'g-1', label: 'Vacanze', saved: 1000, target: 1000 }],
})
check('un obiettivo raggiunto fa festeggiare la volpe', conObiettivoRaggiunto.state === 'celebrating')
check('e lo dice per nome', conObiettivoRaggiunto.message.includes('Vacanze'))

const senzaObiettivi = coachAsHome({ expenses: [expense('2026-09-10', 50, 'spesa')], goals: [] })
check('senza obiettivi non festeggia a vuoto', senzaObiettivi.state !== 'celebrating')

// =====================================================================
section('2. Ogni stato ha la sua illustrazione')
// =====================================================================
check('la mappa copre tutti e sei gli stati', TUTTI.every((stato) => typeof spendyStates[stato] === 'string'))
for (const stato of TUTTI) {
  const file = `public${spendyStates[stato]}`
  check(`${stato}: il file esiste (${spendyStates[stato]})`, existsSync(new URL(`../../${file}`, import.meta.url)))
}
check('sei immagini distinte, nessuna riusata', new Set(Object.values(spendyStates)).size === 6)

// =====================================================================
section('3. Gli importi mostrano i centesimi')
// =====================================================================
// Il formato italiano (la matrice delle quattro lingue è in utils/format.test.mjs).
check('175,50 resta 175,50 (non 176)', formatCurrency(175.5, 'it') === '175,50 €', formatCurrency(175.5, 'it'))
check('un intero mostra comunque i decimali', formatCurrency(7, 'it').endsWith('7,00 €'), formatCurrency(7, 'it'))
check('zero', formatCurrency(0, 'it') === '0,00 €')
check('negativo', formatCurrency(-50.2, 'it') === '-50,20 €', formatCurrency(-50.2, 'it'))
check('sempre due cifre decimali, mai una o tre',
  [1.005, 0.1, 12, 9999.999].every((v) => /^-?[\d.]+,\d{2} €$/.test(formatCurrency(v, 'it'))),
  [1.005, 0.1, 12, 9999.999].map((v) => formatCurrency(v, 'it')).join(' | '))
check('virgola decimale italiana, non punto', !formatCurrency(1234.5, 'it').includes('.5'))
check('un valore non numerico non rompe la schermata', formatCurrency(undefined, 'it') === '0,00 €')

// =====================================================================
section('4. Una nuova spesa = una sola reaction visibile')
// =====================================================================
// Riproduce il ciclo reale di HomePage: render -> la frase mostrata viene
// registrata in jokeHistory (recordSpendyJoke) -> nuovo render. Prima il
// secondo render sceglieva un'altra frase per la STESSA spesa: due
// reaction una dopo l'altra.
function coachWithHistory(expenses, jokeHistory) {
  const financialData = buildFinancialData({
    today: TODAY, monthlyBudget: 5000, expenses, incomes: [], goals: [], cycleStartDay: 1,
  })
  return getSpendyCoach(financialData, {
    expenses, today: TODAY, monthlyBudget: 5000, cycleStartDay: 1, goals: [], jokeHistory, financialData,
  })
}
const record = (history, coach) => [...history, { key: getInsightTopicKey(coach.insight), text: coach.message, shownAt: TODAY }]

const primaSpesa = [expense(TODAY, 150, 'shopping')]
const primoRender = coachWithHistory(primaSpesa, [])
check('la spesa > 100 € produce una reaction', primoRender.reason === 'expense_over_100', primoRender.reason)

const storicoDopoPrimo = record([], primoRender)
const secondoRender = coachWithHistory(primaSpesa, storicoDopoPrimo)
check('dopo la registrazione della frase la reaction NON cambia', secondoRender.message === primoRender.message,
  `"${primoRender.message}" -> "${secondoRender.message}"`)

const altriRender = Array.from({ length: 20 }, () => coachWithHistory(primaSpesa, storicoDopoPrimo).message)
check('e resta la stessa negli altri 20 render (sync, toggle...)', altriRender.every((m) => m === primoRender.message))

// Una spesa NUOVA resta un evento nuovo: frase nuova, non la stessa di prima.
const secondaSpesa = [expense(TODAY, 180, 'shopping'), ...primaSpesa]
const renderNuovaSpesa = coachWithHistory(secondaSpesa, storicoDopoPrimo)
check('una nuova spesa riceve la sua reaction', renderNuovaSpesa.reason === 'expense_over_100', renderNuovaSpesa.reason)
check('e non ripete la frase appena mostrata', renderNuovaSpesa.message !== primoRender.message)

report('spendy')
