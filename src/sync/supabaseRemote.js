import { COLLECTION_KEYS, SETTINGS_TABLE, SYNC_COLLECTIONS } from './mappers.js'

// L'implementazione reale dell'interfaccia `remote` che il sync engine
// si aspetta: upsert / pull / subscribe. Il gemello di prova è
// memoryRemote.mjs, che replica le stesse regole in memoria — il motore
// non distingue i due, ed è ciò che permette di testare offline,
// conflitti e due dispositivi senza toccare il database vero.

const ALL_TABLES = [...COLLECTION_KEYS.map((key) => SYNC_COLLECTIONS[key].table), SETTINGS_TABLE]

export function createSupabaseRemote(client) {
  return {
    async upsert(table, rows) {
      // Un solo upsert per tutte le righe della stessa tabella: una
      // serata di spese inserite offline parte in una richiesta, non in
      // dieci. `onConflict: 'id'` rende l'operazione idempotente —
      // rimandare la stessa riga non crea un duplicato, aggiorna.
      const { error } = await client.from(table).upsert(rows, { onConflict: 'id' })
      return { error: error ? `${table}: ${error.message}` : null }
    },

    async pull(table, since) {
      // Niente filtro su user_id: ci pensa la RLS lato server. Metterlo
      // qui darebbe la falsa impressione che sia il client a garantire
      // l'isolamento dei dati, quando invece è (e deve essere) il
      // database a deciderlo.
      const { data, error } = await client
        .from(table)
        .select('*')
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
      return { rows: data ?? [], error: error ? `${table}: ${error.message}` : null }
    },

    subscribe(userId, onRow) {
      const channel = client.channel(`spendy-sync-${userId}`)

      for (const table of ALL_TABLES) {
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            // profiles ha l'utente nella chiave primaria, le altre in user_id.
            filter: table === SETTINGS_TABLE ? `id=eq.${userId}` : `user_id=eq.${userId}`,
          },
          (payload) => {
            if (payload.new && payload.new.id) onRow({ table, row: payload.new })
          },
        )
      }

      channel.subscribe()
      return () => client.removeChannel(channel)
    },
  }
}
