// Andamento: lo storico ricalcolato dai dati dello store, ciclo per ciclo.
// Nessun archivio, nessun minimo di cicli (non è il Radar), e le stesse
// regole di ciclo/budget del resto dell'app — il test 13 lo verifica
// confrontando il ciclo corrente con buildFinancialData, cioè con quello
// che la Home mostra davvero.

import { check, section, report } from '../sync/testkit.mjs'
import { buildAndamento, compareCycles, computeChange, ANDAMENTO_MAX_CYCLES } from './andamentoEngine.js'
import { buildFinancialData } from './budgetCalculations.js'

const TODAY = '2026-09-22'
let seq = 0
const expense = (date, amount, categoryId = 'spesa') => ({ id: `e-${seq++}`, date, amount, categoryId, updatedAt: '2026-09-01T00:00:00Z' })
const income = (date, amount, categoryId = 'extra') => ({ id: `i-${seq++}`, date, amount, categoryId, updatedAt: '2026-09-01T00:00:00Z' })
const andamento = (input) => buildAndamento({ today: TODAY, cycleStartDay: 1, monthlyBudget: 1500, ...input })
const cycleAt = (result, start) => result.cycles.find((cycle) => cycle.key === start)
const near = (a, b) => Math.abs(a - b) < 1e-9

// =====================================================================
section('1. Un ciclo senza spese')
// =====================================================================
const vuoto = andamento({ expenses: [], incomes: [] })
check('mostra comunque il ciclo corrente', vuoto.cycles.length === 1)
check('il ciclo corrente è settembre', vuoto.current.key === '2026-09-01' && vuoto.current.label === 'Settembre 2026')
check('spese a zero', vuoto.current.spent === 0 && vuoto.current.categories.length === 0)
check('entrate = stipendio', vuoto.current.income === 1500)
check('risparmio = stipendio', vuoto.current.savings === 1500)
check('budget usato 0%', vuoto.current.budgetUsed === 0)
check('hasData false', vuoto.hasData === false)
const senzaStipendio = andamento({ monthlyBudget: 0 })
check('senza stipendio il budget usato è null, non 0% né NaN', senzaStipendio.current.budgetUsed === null)

// =====================================================================
section('2. Un ciclo con spese')
// =====================================================================
const conSpese = andamento({
  expenses: [expense('2026-09-03', 300, 'spesa'), expense('2026-09-10', 120.5, 'ristoranti'), expense('2026-09-12', 80, 'spesa')],
})
check('un solo ciclo', conSpese.cycles.length === 1)
check('spese sommate', conSpese.current.spent === 500.5, `ottenuto ${conSpese.current.spent}`)
check('risparmio = entrate - spese', conSpese.current.savings === 999.5)
check('budget usato', near(conSpese.current.budgetUsed, (500.5 / 1500) * 100))
check('categorie ordinate per importo', conSpese.current.categories.map((c) => c.categoryId).join() === 'spesa,ristoranti')
check('quota della categoria principale', near(conSpese.current.categories[0].share, (380 / 500.5) * 100))
check('etichetta categoria risolta', conSpese.current.categories[0].category.label === 'Spesa')
check('conteggio spese', conSpese.current.expenseCount === 3)

// =====================================================================
section('3. Entrate una tantum')
// =====================================================================
const conEntrate = andamento({
  expenses: [expense('2026-09-05', 200)],
  incomes: [income('2026-09-15', 250, 'regalo'), income('2026-08-15', 999, 'extra')],
})
check('entrate = stipendio + una tantum del ciclo', conEntrate.current.income === 1750)
check('la parte extra è separata', conEntrate.current.extraIncome === 250 && conEntrate.current.salary === 1500)
check('l\'entrata di agosto resta in agosto', cycleAt(conEntrate, '2026-08-01').extraIncome === 999)
check('risparmio include le entrate', conEntrate.current.savings === 1550)
check('il budget usato si misura sullo stipendio, come nella Home', near(conEntrate.current.budgetUsed, (200 / 1500) * 100))

// =====================================================================
section('4. Più cicli')
// =====================================================================
const piuCicli = andamento({
  expenses: [
    expense('2026-04-10', 980), expense('2026-05-10', 1100), expense('2026-06-10', 1050),
    expense('2026-07-10', 1240), expense('2026-08-10', 1240), expense('2026-09-10', 1080),
  ],
})
check('sei cicli, dal più vecchio al corrente', piuCicli.cycles.map((c) => c.shortLabel).join() === 'Apr,Mag,Giu,Lug,Ago,Set')
check('importi per ciclo', piuCicli.cycles.map((c) => c.spent).join() === '980,1100,1050,1240,1240,1080')
check('solo l\'ultimo è il corrente', piuCicli.cycles.filter((c) => c.isCurrent).length === 1 && piuCicli.cycles[5].isCurrent)
const dueCicli = andamento({ expenses: [expense('2026-08-20', 50), expense('2026-09-02', 70)] })
check('con due cicli di dati ne mostra due (nessun minimo di 3)', dueCicli.cycles.length === 2)
const antichissimo = andamento({ expenses: [expense('2020-01-10', 10)] })
check(`al massimo ${ANDAMENTO_MAX_CYCLES} cicli`, antichissimo.cycles.length === ANDAMENTO_MAX_CYCLES)
const futuro = andamento({ expenses: [expense('2026-12-10', 10)] })
check('una spesa futura non crea cicli nel futuro', futuro.cycles.length === 1 && futuro.current.spent === 0)

// =====================================================================
section('5. Ciclo personalizzato con cycleStartDay = 27')
// =====================================================================
const custom = buildAndamento({
  today: TODAY, cycleStartDay: 27, monthlyBudget: 1700,
  expenses: [expense('2026-08-27', 100), expense('2026-09-22', 50), expense('2026-08-26', 400), expense('2026-07-27', 30)],
})
check('il ciclo corrente va dal 27 agosto al 26 settembre', custom.current.range.start === '2026-08-27' && custom.current.range.end === '2026-09-27')
check('etichetta "27 Ago – 26 Set"', custom.current.label === '27 Ago – 26 Set', custom.current.label)
check('etichetta breve "27 Ago"', custom.current.shortLabel === '27 Ago')
check('il 27/8 sta nel ciclo corrente, il 26/8 no', custom.current.spent === 150)
check('il 26/8 sta nel ciclo precedente, col 27/7', cycleAt(custom, '2026-07-27').spent === 430)
check('due cicli in tutto', custom.cycles.length === 2)
const nullDay = buildAndamento({ today: TODAY, cycleStartDay: null, monthlyBudget: 0, expenses: [expense('2026-09-01', 5)] })
check('cycleStartDay null si comporta come il mese di calendario', nullDay.current.label === 'Settembre 2026')

// =====================================================================
section('6. Confronto tra due cicli')
// =====================================================================
const esempio = buildAndamento({
  today: TODAY, cycleStartDay: 1, monthlyBudget: 1500,
  expenses: [
    expense('2026-08-05', 180, 'ristoranti'), expense('2026-08-06', 320, 'spesa'), expense('2026-08-07', 150, 'shopping'),
    expense('2026-08-08', 590, 'casa'),
    expense('2026-09-05', 110, 'ristoranti'), expense('2026-09-06', 350, 'spesa'), expense('2026-09-07', 30, 'bar'),
    expense('2026-09-08', 590, 'casa'),
  ],
  incomes: [income('2026-08-20', 200), income('2026-09-20', 200)],
})
const agosto = cycleAt(esempio, '2026-08-01')
const settembre = cycleAt(esempio, '2026-09-01')
const confronto = compareCycles(agosto, settembre)
check('spese: 1240 → 1080', confronto.spent.before === 1240 && confronto.spent.after === 1080)
check('differenza spese -160', confronto.spent.diff === -160 && confronto.spent.kind === 'down')
check('percentuale spese -12,9%', near(Math.round(confronto.spent.percent * 10) / 10, -12.9), String(confronto.spent.percent))
check('entrate invariate', confronto.income.diff === 0 && confronto.income.kind === 'same')
check('risparmio +160', confronto.savings.diff === 160 && confronto.savings.kind === 'up')
check('budget usato 82,7% → 72%', near(confronto.budgetUsed.before, (1240 / 1500) * 100) && near(confronto.budgetUsed.after, 72))
check('differenza in punti di budget', near(confronto.budgetUsed.diffPoints, 72 - (1240 / 1500) * 100))
check('senza stipendio il confronto budget è null', compareCycles(
  buildAndamento({ today: TODAY, monthlyBudget: 0 }).current,
  buildAndamento({ today: TODAY, monthlyBudget: 0 }).current,
).budgetUsed === null)

// =====================================================================
section('7-9. Confronto categorie')
// =====================================================================
const riga = (id) => confronto.categories.find((row) => row.categoryId === id)
check('7. presente in entrambi: ristoranti 180 → 110, -70', riga('ristoranti').before === 180 && riga('ristoranti').after === 110 && riga('ristoranti').diff === -70 && riga('ristoranti').kind === 'down')
check('7. presente in entrambi: spesa +30', riga('spesa').diff === 30 && riga('spesa').kind === 'up')
check('7. invariata: casa 0 di differenza', riga('casa').diff === 0 && riga('casa').kind === 'same')
check('8. solo nel primo: shopping azzerato', riga('shopping').before === 150 && riga('shopping').after === 0 && riga('shopping').kind === 'gone')
check('9. solo nel secondo: bar è nuova', riga('bar').before === 0 && riga('bar').after === 30 && riga('bar').kind === 'new')
check('ordinate per variazione assoluta', confronto.categories.map((row) => row.categoryId).join() === 'shopping,ristoranti,spesa,bar,casa',
  confronto.categories.map((row) => row.categoryId).join())
check('nessuna categoria duplicata', new Set(confronto.categories.map((row) => row.categoryId)).size === confronto.categories.length)

// =====================================================================
section('10. Percentuale con valore precedente = 0')
// =====================================================================
const daZero = computeChange(0, 30)
check('nessun Infinity/NaN: percent è null', daZero.percent === null && daZero.kind === 'new')
check('0 → 0 è "uguale", senza percentuale', computeChange(0, 0).kind === 'same' && computeChange(0, 0).percent === null)
check('riga categoria nuova senza percentuale', riga('bar').percent === null)
check('categoria azzerata: -100% calcolabile ma segnata "gone"', riga('shopping').percent === -100 && riga('shopping').kind === 'gone')
check('base negativa (risparmio in rosso): niente percentuale', computeChange(-50, 100).percent === null && computeChange(-50, 100).kind === 'up')
const cicloVuoto = buildAndamento({ today: TODAY, monthlyBudget: 0, expenses: [expense('2026-07-05', 100)] })
const daVuoto = compareCycles(cycleAt(cicloVuoto, '2026-08-01'), cicloVuoto.current)
check('confronto fra due cicli vuoti: tutto finito', [daVuoto.spent, daVuoto.income, daVuoto.savings]
  .every((change) => Number.isFinite(change.diff) && change.percent === null))

// =====================================================================
section('11. Modifica della data di una spesa')
// =====================================================================
const originale = expense('2026-09-10', 90, 'bar')
const altra = expense('2026-08-10', 40, 'spesa')
const prima = andamento({ expenses: [originale, altra] })
const spostata = { ...originale, date: '2026-08-12', updatedAt: '2026-09-22T10:00:00Z' }
const dopo = andamento({ expenses: [spostata, altra] })
check('prima: 90 a settembre, 40 ad agosto', prima.current.spent === 90 && cycleAt(prima, '2026-08-01').spent === 40)
check('dopo: 0 a settembre, 130 ad agosto', dopo.current.spent === 0 && cycleAt(dopo, '2026-08-01').spent === 130)
check('la categoria si sposta col suo ciclo', cycleAt(dopo, '2026-08-01').categories.some((c) => c.categoryId === 'bar')
  && dopo.current.categories.length === 0)
const indietro = andamento({ expenses: [{ ...originale, date: '2026-05-01' }] })
check('spostarla più indietro allarga lo storico', indietro.cycles.length === 5 && indietro.cycles[0].spent === 90)

// =====================================================================
section('12. Cicli senza dati intermedi')
// =====================================================================
const buchi = andamento({ expenses: [expense('2026-05-10', 200, 'viaggi'), expense('2026-09-10', 100)] })
check('cinque cicli da maggio a settembre, anche se vuoti in mezzo', buchi.cycles.length === 5)
check('i cicli intermedi sono a zero', buchi.cycles.slice(1, 4).every((c) => c.spent === 0 && c.categories.length === 0))
check('ma hanno comunque lo stipendio', buchi.cycles.slice(1, 4).every((c) => c.income === 1500 && c.savings === 1500))
check('confronto maggio vs settembre salta i buchi', compareCycles(buchi.cycles[0], buchi.current).spent.diff === -100)

// =====================================================================
section('13. Coerenza con i numeri della Home (buildFinancialData)')
// =====================================================================
for (const cycleStartDay of [1, 27]) {
  const expenses = [expense('2026-09-01', 33.3), expense('2026-08-28', 12.2), expense('2026-09-20', 400, 'casa')]
  const incomes = [income('2026-09-02', 75)]
  const home = buildFinancialData({ today: TODAY, monthlyBudget: 1200, expenses, incomes, goals: [], cycleStartDay })
  const { current } = buildAndamento({ today: TODAY, monthlyBudget: 1200, expenses, incomes, cycleStartDay })
  check(`giorno ${cycleStartDay}: spese uguali alla Home`, near(current.spent, Math.round(home.spentThisMonth * 100) / 100))
  check(`giorno ${cycleStartDay}: risparmio = disponibile della Home`, near(current.savings, Math.round(home.available * 100) / 100))
  check(`giorno ${cycleStartDay}: budget usato = spentRatio della Home`, near(current.budgetUsed, home.spentRatio))
}

report('Andamento')
