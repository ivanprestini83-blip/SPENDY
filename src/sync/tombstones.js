// Le voci cancellate (tombstone) sul cloud: solo un marcatore tecnico.
//
// Una cancellazione resta sul server come riga con deleted_at, perché deve
// poter raggiungere gli altri dispositivi (vedi outbox.js e mergeRemoteRows:
// chi la riceve guarda soltanto id e deleted_at). Il contenuto della voce non
// serve a niente di tutto questo, quindi non viaggia: restano id, user_id,
// client_updated_at (conflitti) e deleted_at; updated_at e created_at li mette
// il database. Le colonne NOT NULL ricevono i valori neutri qui sotto.
//
// Gli STESSI valori li impone il trigger spendy_scrub_tombstone
// (supabase/tombstone_minimization.sql), che protegge anche dai client vecchi
// che mandano ancora la riga completa. Un test confronta le due liste.

export const TOMBSTONE_DATE = '1970-01-01'

export const TOMBSTONE_VALUES = {
  expenses: { amount: 0, category_id: 'altro', subcategory: null, description: '', date: TOMBSTONE_DATE },
  incomes: { amount: 0, category_id: 'altro', subcategory: null, description: '', date: TOMBSTONE_DATE },
  goals: { emoji: '🎯', label: '', target: 0, eta_months: 6 },
  goal_contributions: { goal_id: '', amount: 0, date: TOMBSTONE_DATE },
  emergency_fund_contributions: { amount: 0, date: TOMBSTONE_DATE },
  custom_categories: { label: '', emoji: '🏷️', type: 'expense', pinned: false, subcategories: [] },
}

export const tombstoneToRemote = (table, row, userId) => ({
  id: row.id,
  user_id: userId,
  ...TOMBSTONE_VALUES[table],
  client_updated_at: row.updatedAt,
  deleted_at: row.deletedAt,
})
