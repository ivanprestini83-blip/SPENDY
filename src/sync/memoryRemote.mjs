// Database finto in memoria, usato SOLO dai test (nessun file dell'app lo
// importa, quindi non finisce mai nel bundle).
//
// Non è un mock generico: riproduce di proposito le tre regole del
// Postgres vero definite in supabase/schema.sql, perché sono esattamente
// quelle su cui il sync può sbagliare:
//   1. RLS — un client può scrivere e leggere solo le righe del proprio
//      user_id, e ogni tentativo fuori perimetro è un errore;
//   2. trigger LWW — un update con client_updated_at più vecchio di
//      quello già salvato viene IGNORATO;
//   3. updated_at messo dal SERVER, mai dal client: è il cursore del
//      pull incrementale e non deve dipendere dall'orologio dei device.
//
// Grazie a questo, i test di "Samsung ↔ Mac", offline e conflitti girano
// senza rete e senza un progetto Supabase.
//
// In più, come PostgREST su Supabase:
//   4. "Max rows": una richiesta restituisce al massimo MEMORY_DB_MAX_ROWS
//      righe (1000, il default di Supabase), e il pull del remote finto passa
//      dalla VERA paginazione di supabaseRemote.js;
//   5. un upsert è un'unica istruzione: tutte le sue righe ricevono lo
//      STESSO updated_at (now() della transazione), come nel Postgres vero,
//      ed è ATOMICO: se una riga è rifiutata non viene salvata nessuna riga;
//   6. le colonne numeric(12,2) rifiutano valori oltre 9.999.999.999,99
//      (codice Postgres 22003); l'RLS rifiuta con 42501.
import { createSupabaseRemote } from './supabaseRemote.js'

export const MEMORY_DB_MAX_ROWS = 1000

export function createMemoryDatabase({ maxRows = MEMORY_DB_MAX_ROWS } = {}) {
  const tables = new Map()
  const subscribers = []
  // Orologio server monotòno: due scritture consecutive hanno sempre
  // updated_at crescenti, cosa che un Date.now() in un test velocissimo
  // non garantirebbe (finirebbero nello stesso millisecondo e il cursore
  // di pull non saprebbe distinguerle).
  let tick = 0
  const serverNow = () => new Date(Date.UTC(2026, 0, 1) + (tick += 1)).toISOString()

  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map())
    return tables.get(name)
  }

  const ownerOf = (name, row) => (name === 'profiles' ? row.id : row.user_id)

  // PostgREST restituisce le colonne `numeric` come STRINGHE ("25.00"),
  // non come numeri. È una trappola vera: senza la conversione fatta dai
  // mapper, ogni somma dell'app diventerebbe una concatenazione di testo
  // e i totali sarebbero sbagliati senza nessun errore a schermo. Il
  // database finto la riproduce apposta, così i test la coprono.
  const NUMERIC_COLUMNS = ['amount', 'target', 'monthly_budget']
  const NUMERIC_12_2_LIMIT = 1e10 // numeric(12,2): al massimo 9.999.999.999,99
  const asPostgrest = (row) => {
    const copy = { ...row }
    for (const column of NUMERIC_COLUMNS) {
      if (typeof copy[column] === 'number') copy[column] = copy[column].toFixed(2)
    }
    return copy
  }

  return {
    serverNow,
    rows: (name) => [...table(name).values()],
    countCalls: { upsert: 0, pull: 0 },

    upsert(name, rows, userId) {
      this.countCalls.upsert += 1
      const store = table(name)
      const emitted = []
      // Un'istruzione, un istante: come now() in Postgres (vedi punto 5).
      const at = serverNow()

      // Atomico (punto 5): prima si controllano TUTTE le righe, e se una è
      // rifiutata l'istruzione intera fallisce senza salvare niente.
      for (const row of rows) {
        // RLS: with check (auth.uid() = user_id)
        if (ownerOf(name, row) !== userId) {
          return { error: `RLS: riga ${row.id} non appartiene a ${userId}`, code: '42501' }
        }
        // RLS sull'update dell'upsert: using (auth.uid() = user_id) sulla riga
        // esistente. Lo stesso id già di un altro utente → errore, non sovrascrittura.
        const current = store.get(row.id)
        if (current && ownerOf(name, current) !== userId) {
          return { error: `RLS: riga ${row.id} non appartiene a ${userId}`, code: '42501' }
        }
        for (const column of NUMERIC_COLUMNS) {
          if (typeof row[column] === 'number' && Math.abs(row[column]) >= NUMERIC_12_2_LIMIT) {
            return { error: 'numeric field overflow', code: '22003' }
          }
        }
      }

      for (const row of rows) {

        const existing = store.get(row.id)
        // Trigger LWW: l'aggiornamento più vecchio non passa.
        if (existing && row.client_updated_at < existing.client_updated_at) continue

        const saved = {
          ...existing,
          ...row,
          created_at: existing?.created_at ?? at,
          updated_at: at,
        }
        store.set(row.id, saved)
        emitted.push({ table: name, row: saved })
      }

      for (const { table: t, row } of emitted) {
        for (const sub of subscribers) {
          if (sub.userId === ownerOf(t, row)) sub.callback({ table: t, row })
        }
      }
      return { error: null, code: null }
    },

    // Una richiesta PostgREST di pull: righe dell'utente (RLS) con
    // updated_at > since, eventualmente dopo la chiave (updated_at, id)
    // dell'ultima riga già ricevuta, ordinate per (updated_at, id) e mai più
    // di maxRows per richiesta, qualunque limit chieda il client.
    query(name, userId, { since, after = null, limit = Infinity }) {
      this.countCalls.pull += 1
      const rows = [...table(name).values()]
        .filter((row) => ownerOf(name, row) === userId) // RLS: using (auth.uid() = user_id)
        .filter((row) => row.updated_at > since)
        .filter((row) => !after || row.updated_at > after.updated_at || (row.updated_at === after.updated_at && row.id > after.id))
        .sort((a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.updated_at < b.updated_at ? -1 : 1))
        .slice(0, Math.min(limit, maxRows))
        .map(asPostgrest)
      return { rows, error: null }
    },

    subscribe(userId, callback) {
      const entry = { userId, callback }
      subscribers.push(entry)
      return () => {
        const index = subscribers.indexOf(entry)
        if (index >= 0) subscribers.splice(index, 1)
      }
    },
  }
}

// Il minimo di client PostgREST che supabaseRemote.pull usa — from / select /
// gt / or / order / limit — sopra il database in memoria, per l'utente del
// dispositivo. Il filtro or() è quello della paginazione per chiave:
//   updated_at.gt."T",and(updated_at.eq."T",id.gt."ID")
const QUOTED = '"((?:[^"\\\\]|\\\\.)*)"'
const KEYSET_FILTER = new RegExp(`^updated_at\\.gt\\.${QUOTED},and\\(updated_at\\.eq\\.${QUOTED},id\\.gt\\.${QUOTED}\\)$`)
const unquote = (value) => value.replace(/\\(.)/g, '$1')

function memoryPostgrest(db, userId) {
  return {
    from(name) {
      const request = { since: '', after: null, limit: Infinity }
      const builder = {
        select: () => builder,
        gt(column, value) {
          if (column !== 'updated_at') throw new Error(`filtro non previsto: ${column}`)
          request.since = value
          return builder
        },
        or(expression) {
          const match = KEYSET_FILTER.exec(expression)
          if (!match || unquote(match[1]) !== unquote(match[2])) throw new Error(`filtro or() non previsto: ${expression}`)
          request.after = { updated_at: unquote(match[1]), id: unquote(match[3]) }
          return builder
        },
        order: () => builder, // l'ordine (updated_at, id) lo applica già query()
        limit(n) {
          request.limit = n
          return builder
        },
        then(resolve, reject) {
          const { rows, error } = db.query(name, userId, request)
          return Promise.resolve({ data: rows, error: error ? { message: error } : null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

// Il "client" di un singolo dispositivo: stessa interfaccia che l'engine
// si aspetta da supabaseRemote.js (upsert / pull / subscribe). Il pull è
// quello VERO di supabaseRemote.js, paginato, sopra memoryPostgrest.
export function createMemoryRemote(db, userId, options = {}) {
  let online = options.online ?? true
  let realtimeEnabled = options.realtime ?? false

  const offlineError = { error: 'network: offline' }
  const paginated = createSupabaseRemote(memoryPostgrest(db, userId))

  return {
    setOnline: (value) => {
      online = value
    },
    upsert: async (table, rows) => (online ? db.upsert(table, rows, userId) : offlineError),
    pull: async (table, since) => (online ? paginated.pull(table, since) : { rows: [], ...offlineError }),
    subscribe: (id, callback) => (realtimeEnabled ? db.subscribe(id, callback) : () => {}),
    enableRealtime: () => {
      realtimeEnabled = true
    },
  }
}
