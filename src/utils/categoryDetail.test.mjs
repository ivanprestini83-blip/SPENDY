// Dettaglio categoria in Analisi (utils/categoryDetail.js): tocco una
// categoria -> vedo le spese reali che fanno il suo totale, nel periodo
// selezionato, dalla più recente, con ora e nota solo quando esistono
// davvero.

import { check, section, report } from '../sync/testkit.mjs'
import { buildCategoryDetail, expenseTime, expenseNote } from './categoryDetail.js'
import { categoryComparison } from './budgetCalculations.js'
import { getCategory } from '../data/categories.js'
import { MIGRATION_STAMP } from '../sync/migrateLocal.js'

// Orari costruiti in ora LOCALE, come li scrive nowIso() sul telefono.
const at = (date, hh, mm) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hh, mm).toISOString()
}
let seq = 0
const spesa = (date, amount, categoryId, description, updatedAt) =>
  ({ id: `e-${seq++}`, date, amount, categoryId, description, updatedAt })

const RISTORANTI = getCategory('ristoranti').label

// Lo store tiene le spese "ultima inserita per prima".
const expenses = [
  spesa('2026-09-18', 15, 'ristoranti', 'Pranzo', at('2026-09-18', 12, 48)),
  spesa('2026-09-22', 20, 'ristoranti', 'Pizza con Marco', at('2026-09-22', 19, 42)),
  spesa('2026-09-20', 35, 'ristoranti', 'Cena', at('2026-09-20', 20, 15)),
  spesa('2026-09-20', 12.5, 'ristoranti', RISTORANTI, at('2026-09-20', 13, 5)), // nessuna nota: il form ha messo il nome categoria
  spesa('2026-09-05', 40, 'ristoranti', 'Cena retrodatata', at('2026-09-12', 9, 0)), // inserita il 12 con data 5
  spesa('2026-09-03', 30, 'ristoranti', '   ', MIGRATION_STAMP), // riga vecchia migrata
  spesa('2026-09-21', 60, 'spesa', 'Supermercato', at('2026-09-21', 18, 0)), // altra categoria
  spesa('2026-08-25', 50, 'ristoranti', 'Agosto', at('2026-08-25', 21, 0)), // altro ciclo
]

// =====================================================================
section('1. Solo la categoria e il periodo selezionati, totale coerente')
// =====================================================================
const settembre = buildCategoryDetail(expenses, 'ristoranti', '2026-09-01', 1)
const rigaAnalisi = categoryComparison(expenses, '2026-09-01', 1).find((r) => r.categoryId === 'ristoranti')
check('il totale è quello della riga di Analisi', settembre.total === rigaAnalisi.current, `${settembre.total} vs ${rigaAnalisi.current}`)
check('il totale è la somma delle spese mostrate',
  settembre.total === settembre.days.flatMap((d) => d.items).reduce((s, i) => s + i.amount, 0))
check('6 spese di settembre, niente agosto né altre categorie', settembre.count === 6, String(settembre.count))
check('tutte della categoria giusta', settembre.days.flatMap((d) => d.items).every((i) => i.categoryId === 'ristoranti'))

const agosto = buildCategoryDetail(expenses, 'ristoranti', '2026-08-01', 1)
check('cambiando periodo si vedono solo le spese di quel periodo', agosto.count === 1 && agosto.total === 50)

const spesaSett = buildCategoryDetail(expenses, 'spesa', '2026-09-01', 1)
check('funziona per qualsiasi categoria', spesaSett.count === 1 && spesaSett.total === 60)

const vuota = buildCategoryDetail(expenses, 'shopping', '2026-09-01', 1)
check('categoria senza spese nel periodo: lista vuota, totale zero', vuota.count === 0 && vuota.total === 0 && vuota.days.length === 0)

const cicloCustom = buildCategoryDetail(expenses, 'ristoranti', '2026-09-20', 20)
check('rispetta anche il ciclo personalizzato (dal 20)', cicloCustom.count === 3, String(cicloCustom.count))

// =====================================================================
section('2. Dalla più recente alla più vecchia, raggruppate per giorno')
// =====================================================================
check('giorni in ordine decrescente',
  settembre.days.map((d) => d.date).join(',') === '2026-09-22,2026-09-20,2026-09-18,2026-09-05,2026-09-03',
  settembre.days.map((d) => d.date).join(','))
const venti = settembre.days.find((d) => d.date === '2026-09-20')
check('stesso giorno: prima la più tarda', venti.items.map((i) => i.time).join(',') === '20:15,13:05', venti.items.map((i) => i.time).join(','))
check('etichetta del giorno in italiano', settembre.days[0].label === '22 settembre', settembre.days[0].label)

// =====================================================================
section("3. L'ora: solo quando il timestamp è davvero quello della spesa")
// =====================================================================
const primo = settembre.days[0].items[0]
check('spesa registrata quel giorno: ora mostrata', primo.time === '19:42', String(primo.time))
check('spesa retrodatata: niente ora (sarebbe quella di inserimento)',
  settembre.days.find((d) => d.date === '2026-09-05').items[0].time === null)
check('riga migrata (timbro fittizio): niente ora',
  settembre.days.find((d) => d.date === '2026-09-03').items[0].time === null)
check('senza updatedAt: niente ora', expenseTime({ date: '2026-09-22' }) === null)

// =====================================================================
section('4. La nota: solo se scritta davvero')
// =====================================================================
check('nota presente', primo.note === 'Pizza con Marco')
check('nome categoria messo dal form = nessuna nota', venti.items[1].note === null)
check('solo spazi = nessuna nota', settembre.days.find((d) => d.date === '2026-09-03').items[0].note === null)
check('nota vuota o mancante = nessuna nota',
  expenseNote({ description: '' }, getCategory('ristoranti')) === null && expenseNote({}, getCategory('ristoranti')) === null)

// =====================================================================
section('5. Non tocca le spese')
// =====================================================================
const prima = JSON.stringify(expenses)
buildCategoryDetail(expenses, 'ristoranti', '2026-09-01', 1)
check('le spese dello store restano identiche', JSON.stringify(expenses) === prima)

report('Dettaglio categoria')
