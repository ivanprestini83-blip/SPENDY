import { COLLECTION_KEYS, SETTINGS_TABLE, SYNC_COLLECTIONS } from './mappers.js'

// L'implementazione reale dell'interfaccia `remote` che il sync engine
// si aspetta: upsert / pull / subscribe. Il gemello di prova è
// memoryRemote.mjs, che replica le stesse regole in memoria — il motore
// non distingue i due, ed è ciò che permette di testare offline,
// conflitti e due dispositivi senza toccare il database vero.

const ALL_TABLES = [...COLLECTION_KEYS.map((key) => SYNC_COLLECTIONS[key].table), SETTINGS_TABLE]

// Righe per pagina del pull. Va tenuto NON oltre il "Max rows" dell'API di
// Supabase (1000 di default): una pagina più corta del richiesto è il segnale
// che le righe sono finite. 500 lascia margine anche se Max rows venisse
// abbassato fino a quel valore.
export const PULL_PAGE_SIZE = 500
// Tetto di sicurezza contro cicli infiniti (es. una riga senza id).
export const PULL_MAX_PAGES = 2000

// Valori dentro i filtri or() di PostgREST: tra virgolette, perché date e id
// contengono caratteri riservati (':', '.', ',').
const quoteFilterValue = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function createSupabaseRemote(client) {
  return {
    async upsert(table, rows) {
      // Un solo upsert per tutte le righe della stessa tabella: una
      // serata di spese inserite offline parte in una richiesta, non in
      // dieci. `onConflict: 'id'` rende l'operazione idempotente —
      // rimandare la stessa riga non crea un duplicato, aggiorna.
      const { error } = await client.from(table).upsert(rows, { onConflict: 'id' })
      // `code` è il codice Postgres/PostgREST (es. 22003 numeric overflow,
      // 42501 RLS): serve al motore per distinguere un rifiuto definitivo
      // della riga da un errore temporaneo (rete, timeout, 5xx).
      return { error: error ? `${table}: ${error.message}` : null, code: error?.code ?? null }
    },

    async pull(table, since) {
      // Niente filtro su user_id: ci pensa la RLS lato server. Metterlo
      // qui darebbe la falsa impressione che sia il client a garantire
      // l'isolamento dei dati, quando invece è (e deve essere) il
      // database a deciderlo.
      //
      // Paginato: PostgREST restituisce al massimo "Max rows" righe per
      // richiesta (1000 di default su Supabase). Le pagine seguono la chiave
      // (updated_at, id), non la posizione: è deterministica anche con
      // migliaia di righe con lo stesso updated_at (un upsert ne scrive tante
      // nello stesso istante) e non salta righe se qualcosa cambia tra una
      // pagina e l'altra. Se una pagina fallisce non torna niente: il motore
      // non sposta il cursore e il prossimo sync riparte da capo.
      const rows = []
      let after = null
      for (let page = 0; page < PULL_MAX_PAGES; page += 1) {
        let query = client.from(table).select('*').gt('updated_at', since)
        if (after) {
          const at = quoteFilterValue(after.updated_at)
          query = query.or(`updated_at.gt.${at},and(updated_at.eq.${at},id.gt.${quoteFilterValue(after.id)})`)
        }
        const { data, error } = await query
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(PULL_PAGE_SIZE)
        if (error) return { rows: [], error: `${table}: ${error.message}` }
        const batch = data ?? []
        rows.push(...batch)
        if (batch.length < PULL_PAGE_SIZE) return { rows, error: null }
        after = batch[batch.length - 1]
      }
      return { rows: [], error: `${table}: troppe pagine (oltre ${PULL_MAX_PAGES * PULL_PAGE_SIZE} righe)` }
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
