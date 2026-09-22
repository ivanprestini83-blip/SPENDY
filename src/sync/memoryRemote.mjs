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

export function createMemoryDatabase() {
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

      for (const row of rows) {
        // RLS: with check (auth.uid() = user_id)
        if (ownerOf(name, row) !== userId) {
          return { error: `RLS: riga ${row.id} non appartiene a ${userId}` }
        }

        const existing = store.get(row.id)
        // Trigger LWW: l'aggiornamento più vecchio non passa.
        if (existing && row.client_updated_at < existing.client_updated_at) continue

        const saved = {
          ...existing,
          ...row,
          created_at: existing?.created_at ?? serverNow(),
          updated_at: serverNow(),
        }
        store.set(row.id, saved)
        emitted.push({ table: name, row: saved })
      }

      for (const { table: t, row } of emitted) {
        for (const sub of subscribers) {
          if (sub.userId === ownerOf(t, row)) sub.callback({ table: t, row })
        }
      }
      return { error: null }
    },

    pull(name, since, userId) {
      this.countCalls.pull += 1
      const rows = [...table(name).values()]
        .map(asPostgrest)
        .filter((row) => ownerOf(name, row) === userId) // RLS: using (auth.uid() = user_id)
        .filter((row) => row.updated_at > since)
        .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1))
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

// Il "client" di un singolo dispositivo: stessa interfaccia che l'engine
// si aspetta da supabaseRemote.js (upsert / pull / subscribe).
export function createMemoryRemote(db, userId, options = {}) {
  let online = options.online ?? true
  let realtimeEnabled = options.realtime ?? false

  const offlineError = { error: 'network: offline' }

  return {
    setOnline: (value) => {
      online = value
    },
    upsert: async (table, rows) => (online ? db.upsert(table, rows, userId) : offlineError),
    pull: async (table, since) => (online ? db.pull(table, since, userId) : { rows: [], ...offlineError }),
    subscribe: (id, callback) => (realtimeEnabled ? db.subscribe(id, callback) : () => {}),
    enableRealtime: () => {
      realtimeEnabled = true
    },
  }
}
