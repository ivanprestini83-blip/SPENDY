// Traduzione fra la forma LOCALE delle righe (quella che i componenti e
// le engine leggono da sempre: camelCase, niente user_id) e la forma
// REMOTA delle tabelle Postgres (snake_case, con user_id e i timestamp
// di sincronizzazione).
//
// Tutta la conoscenza dei nomi delle colonne sta qui dentro: il resto
// del sync layer ragiona solo su "righe locali" e "tabelle".

// La mappa che tiene insieme le due metà: chiave = nome della collezione
// nello store, `table` = nome della tabella su Supabase.
export const SYNC_COLLECTIONS = {
  expenses: { table: 'expenses' },
  incomes: { table: 'incomes' },
  goals: { table: 'goals' },
  goalContributions: { table: 'goal_contributions' },
  emergencyFundContributions: { table: 'emergency_fund_contributions' },
  customCategories: { table: 'custom_categories' },
}

export const COLLECTION_KEYS = Object.keys(SYNC_COLLECTIONS)
export const SETTINGS_TABLE = 'profiles'

// Nome della collezione locale a partire dal nome della tabella remota
// (serve quando arriva un evento realtime, che parla in snake_case).
export const collectionForTable = (table) =>
  COLLECTION_KEYS.find((key) => SYNC_COLLECTIONS[key].table === table) ?? null

const number = (value) => (typeof value === 'string' ? parseFloat(value) : value)

// --- spese / entrate: stessa forma, due tabelle -----------------------

const transactionToRemote = (row, userId) => ({
  id: row.id,
  user_id: userId,
  amount: row.amount,
  category_id: row.categoryId ?? 'altro',
  subcategory: row.subcategory ?? null,
  description: row.description ?? '',
  date: row.date,
  client_updated_at: row.updatedAt,
  deleted_at: row.deletedAt ?? null,
})

const transactionToLocal = (row) => ({
  id: row.id,
  // numeric(12,2) torna da PostgREST come STRINGA ("25.00"): senza questa
  // conversione ogni somma dell'app diventerebbe una concatenazione di
  // testo ("25" + "60.5" = "2560.5") e tutti i totali sarebbero sbagliati.
  amount: number(row.amount),
  categoryId: row.category_id ?? 'altro',
  description: row.description ?? '',
  date: row.date,
  updatedAt: row.client_updated_at,
  ...(row.subcategory ? { subcategory: row.subcategory } : {}),
})

// --- obiettivi --------------------------------------------------------

// `saved` non viene mai inviato: sul server non esiste come colonna, è
// la somma di goal_contributions (vedi schema.sql).
const goalToRemote = (row, userId) => ({
  id: row.id,
  user_id: userId,
  emoji: row.emoji ?? '🎯',
  label: row.label,
  target: row.target,
  eta_months: row.etaMonths ?? 6,
  client_updated_at: row.updatedAt,
  deleted_at: row.deletedAt ?? null,
})

const goalToLocal = (row) => ({
  id: row.id,
  emoji: row.emoji ?? '🎯',
  label: row.label,
  target: number(row.target),
  etaMonths: row.eta_months ?? 6,
  // Ricalcolato da recomputeGoalSaved() appena la riga entra nello store:
  // qui si mette 0 solo per non lasciare il campo indefinito, mai come
  // valore creduto.
  saved: 0,
  updatedAt: row.client_updated_at,
})

// --- versamenti (obiettivi e fondo emergenza) -------------------------

const goalContributionToRemote = (row, userId) => ({
  id: row.id,
  user_id: userId,
  goal_id: row.goalId,
  amount: row.amount,
  date: row.date,
  client_updated_at: row.updatedAt,
  deleted_at: row.deletedAt ?? null,
})

const goalContributionToLocal = (row) => ({
  id: row.id,
  goalId: row.goal_id,
  amount: number(row.amount),
  date: row.date,
  updatedAt: row.client_updated_at,
})

const fundContributionToRemote = (row, userId) => ({
  id: row.id,
  user_id: userId,
  amount: row.amount,
  date: row.date,
  client_updated_at: row.updatedAt,
  deleted_at: row.deletedAt ?? null,
})

const fundContributionToLocal = (row) => ({
  id: row.id,
  amount: number(row.amount),
  date: row.date,
  updatedAt: row.client_updated_at,
})

// --- categorie personalizzate ----------------------------------------

const categoryToRemote = (row, userId) => ({
  id: row.id,
  user_id: userId,
  label: row.label,
  emoji: row.emoji ?? '🏷️',
  type: row.type === 'income' ? 'income' : 'expense',
  pinned: row.pinned === true,
  subcategories: row.subcategories ?? [],
  client_updated_at: row.updatedAt,
  deleted_at: row.deletedAt ?? null,
})

const categoryToLocal = (row) => ({
  id: row.id,
  label: row.label,
  emoji: row.emoji ?? '🏷️',
  type: row.type === 'income' ? 'income' : 'expense',
  pinned: row.pinned === true,
  subcategories: Array.isArray(row.subcategories) ? row.subcategories : [],
  updatedAt: row.client_updated_at,
})

const MAPPERS = {
  expenses: { toRemote: transactionToRemote, toLocal: transactionToLocal },
  incomes: { toRemote: transactionToRemote, toLocal: transactionToLocal },
  goals: { toRemote: goalToRemote, toLocal: goalToLocal },
  goalContributions: { toRemote: goalContributionToRemote, toLocal: goalContributionToLocal },
  emergencyFundContributions: { toRemote: fundContributionToRemote, toLocal: fundContributionToLocal },
  customCategories: { toRemote: categoryToRemote, toLocal: categoryToLocal },
}

export const toRemoteRow = (collection, row, userId) => MAPPERS[collection].toRemote(row, userId)
export const toLocalRow = (collection, row) => MAPPERS[collection].toLocal(row)

// --- impostazioni (tabella profiles, una riga per utente) -------------

export const settingsToRemote = (settings, userId) => ({
  id: userId,
  monthly_budget: settings.monthlyBudget ?? 0,
  currency: settings.currency ?? '€',
  cycle_start_day: settings.cycleStartDay ?? null,
  amount_hidden: settings.amountHidden === true,
  client_updated_at: settings.updatedAt,
})

export const settingsToLocal = (row) => ({
  monthlyBudget: number(row.monthly_budget) ?? 0,
  currency: row.currency ?? '€',
  cycleStartDay: row.cycle_start_day ?? null,
  // `amountHidden` NON viene adottato dal cloud: è la preferenza
  // "nascondi gli importi" del singolo dispositivo (utile sul telefono in
  // pubblico, non sul Mac di casa). Viaggia nella tabella per completezza
  // ma chi applica le impostazioni lo ignora — vedi syncEngine.
  amountHidden: row.amount_hidden === true,
  updatedAt: row.client_updated_at,
})
