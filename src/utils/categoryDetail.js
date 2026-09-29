// Dettaglio di UNA categoria in Analisi: tutte le spese che compongono il
// suo totale nel ciclo selezionato, dalla più recente alla più vecchia,
// raggruppate per giorno. Logica pura, niente React: AnalyticsPage passa
// le spese reali dello store e il ciclo che sta mostrando.
//
// Stesso filtro di categoryComparison/totalForPeriod (isWithinRange sul
// ciclo di `referenceDate`), quindi il totale qui è per costruzione lo
// stesso della riga di Analisi toccata.
import { getCycleRange, isWithinRange } from './cycle.js'
import { getCategory } from '../data/categories.js'
import { MIGRATION_STAMP } from '../sync/migrateLocal.js'

const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
]

const pad = (n) => String(n).padStart(2, '0')

// "22 settembre" — l'anno solo se diverso da quello del ciclo guardato.
function dayLabel(dateStr, referenceYear) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const base = `${day} ${MONTHS_IT[month - 1]}`
  return year === referenceYear ? base : `${base} ${year}`
}

// L'ora della spesa. Le spese non hanno un campo "ora": hanno `date`
// (il giorno scelto nel form, anche retrodatato) e `updatedAt` (l'istante
// dell'ultima scrittura: la creazione, o l'ultima modifica). `updatedAt`
// dice l'ora della spesa solo quando cade nello STESSO giorno di `date`
// (spesa registrata quel giorno). Negli altri casi — spesa retrodatata,
// modificata un altro giorno, riga migrata con il timbro fittizio
// MIGRATION_STAMP — quell'ora non ha niente a che fare con la spesa, e
// allora meglio nessuna ora che un'ora sbagliata.
export function expenseTime(expense) {
  if (!expense.updatedAt || expense.updatedAt === MIGRATION_STAMP) return null
  const stamp = new Date(expense.updatedAt)
  if (Number.isNaN(stamp.getTime())) return null
  const localDay = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`
  if (localDay !== expense.date) return null
  return `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`
}

// La nota scritta dall'utente. Il form, se la descrizione resta vuota,
// ci scrive il nome della categoria: quello non è una nota, è un
// riempitivo — e una nota vuota non si mostra.
export function expenseNote(expense, category) {
  const text = (expense.description ?? '').trim()
  if (!text) return null
  if (category && text.toLowerCase() === category.label.trim().toLowerCase()) return null
  return text
}

export function buildCategoryDetail(expenses, categoryId, referenceDate, cycleStartDay = 1) {
  const range = getCycleRange(referenceDate, cycleStartDay)
  const category = getCategory(categoryId)
  const referenceYear = Number(range.start.slice(0, 4))

  // L'ordine dello store è già "ultima inserita per prima"; il sort per
  // giorno (poi per istante di scrittura) è stabile e lo conserva a parità.
  const items = expenses
    .filter((expense) => expense.categoryId === categoryId && isWithinRange(expense.date, range))
    .map((expense, index) => ({ expense, index }))
    .sort((a, b) => {
      if (a.expense.date !== b.expense.date) return a.expense.date < b.expense.date ? 1 : -1
      const ta = a.expense.updatedAt ?? ''
      const tb = b.expense.updatedAt ?? ''
      if (ta !== tb) return ta < tb ? 1 : -1
      return a.index - b.index
    })
    .map(({ expense }) => ({
      id: expense.id,
      date: expense.date,
      amount: expense.amount,
      time: expenseTime(expense),
      note: expenseNote(expense, category),
      categoryId: expense.categoryId,
    }))

  const days = []
  for (const item of items) {
    const last = days[days.length - 1]
    if (last && last.date === item.date) last.items.push(item)
    else days.push({ date: item.date, label: dayLabel(item.date, referenceYear), items: [item] })
  }

  return {
    category,
    total: items.reduce((sum, item) => sum + item.amount, 0),
    count: items.length,
    days,
  }
}
