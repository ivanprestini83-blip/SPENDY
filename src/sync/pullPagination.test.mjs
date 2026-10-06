// Pull da Supabase oltre il limite di righe per richiesta. `npm test`, senza rete.
//
// PostgREST restituisce al massimo "Max rows" righe per richiesta (1000 di
// default su Supabase). Il client finto qui sotto si comporta come PostgREST:
// applica quel tetto, i filtri gt/eq/or (con valori tra virgolette), il doppio
// ordinamento e limit. supabaseRemote.js è quello vero.
//
// Il caso che si rompeva: un upsert scrive tante righe nello STESSO istante
// (stesso updated_at). Con una sola richiesta se ne ricevevano 1000, il cursore
// (max updated_at - 1s) tornava sullo stesso blocco e le altre non arrivavano mai.

import { check, section, report, installFakeLocalStorage } from './testkit.mjs'
import { createSupabaseRemote, PULL_PAGE_SIZE, PULL_MAX_PAGES } from './supabaseRemote.js'
import { createSyncEngine, cursorFrom, EPOCH } from './syncEngine.js'
import { scopeFor } from '../store/scope.js'
import { createMemoryDatabase, createMemoryRemote, MEMORY_DB_MAX_ROWS } from './memoryRemote.mjs'

const MAX_ROWS = 1000 // "Max rows" di default dell'API Supabase

// Timestamp come li restituisce PostgREST (microsecondi, +00:00) e come li
// manda il client ('Z', millisecondi): confrontati per valore, non come testo.
const micros = (ts) => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(ts)
  if (!m) throw new Error(`timestamp non valido nel test: ${ts}`)
  const base = Date.parse(`${m[1]}${m[3] === 'Z' ? 'Z' : m[3]}`)
  return base * 1000 + Number((m[2] ?? '').padEnd(6, '0'))
}
const ts = (second, micro = 0) => `2026-10-06T09:00:${String(second).padStart(2, '0')}.${String(micro).padStart(6, '0')}+00:00`

const VALUE = '"((?:[^"\\\\]|\\\\.)*)"'
const OR_KEYSET = new RegExp(`^updated_at\\.gt\\.${VALUE},and\\(updated_at\\.eq\\.${VALUE},id\\.gt\\.${VALUE}\\)$`)
const unquote = (v) => v.replace(/\\(.)/g, '$1')

// Un PostgREST in miniatura per una sola tabella.
function fakePostgrest(table, { maxRows = MAX_ROWS, failOnRequest = null, beforeRequest = null } = {}) {
  const state = { rows: [], requests: [] }
  const client = {
    from(name) {
      const q = { filters: [], orders: [], limit: Infinity }
      const builder = {
        select() { return builder },
        gt(col, val) { q.filters.push((r) => (col === 'updated_at' ? micros(r[col]) > micros(val) : r[col] > val)); return builder },
        or(expr) {
          const m = OR_KEYSET.exec(expr)
          if (!m) throw new Error(`filtro or() non riconosciuto: ${expr}`)
          const [at, atEq, id] = [unquote(m[1]), unquote(m[2]), unquote(m[3])]
          q.filters.push((r) => micros(r.updated_at) > micros(at) || (micros(r.updated_at) === micros(atEq) && r.id > id))
          q.or = expr
          return builder
        },
        order(col, { ascending }) { q.orders.push({ col, ascending }); return builder },
        limit(n) { q.limit = n; return builder },
        then(resolve, reject) {
          const index = state.requests.length
          state.requests.push({ table: name, ...q })
          beforeRequest?.(index, state)
          if (failOnRequest === index) return Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(resolve, reject)
          const cmp = (a, b) => {
            for (const { col, ascending } of q.orders) {
              const [x, y] = col === 'updated_at' ? [micros(a[col]), micros(b[col])] : [a[col], b[col]]
              if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1)
            }
            return 0
          }
          const data = state.rows.filter((r) => q.filters.every((f) => f(r))).sort(cmp).slice(0, Math.min(q.limit, maxRows))
          return Promise.resolve({ data: data.map((r) => ({ ...r })), error: null }).then(resolve, reject)
        },
      }
      if (name !== table) throw new Error(`tabella inattesa ${name}`)
      return builder
    },
  }
  return { client, state }
}

const expenseRow = (i, updatedAt, id = `e-${String(i).padStart(5, '0')}`) => ({
  id, user_id: 'u', amount: '1.00', category_id: 'bar', description: '', date: '2026-10-01',
  client_updated_at: '2026-10-06T09:00:00.000Z', deleted_at: null, updated_at: updatedAt,
})
const ids = (rows) => rows.map((r) => r.id)
const unique = (rows) => new Set(ids(rows)).size

// =====================================================================
section('Parametri')
// =====================================================================
check(`pagine da ${PULL_PAGE_SIZE} righe, sotto il "Max rows" di default (${MAX_ROWS})`, PULL_PAGE_SIZE > 0 && PULL_PAGE_SIZE <= MAX_ROWS)
check('tetto di sicurezza sulle pagine', PULL_MAX_PAGES * PULL_PAGE_SIZE >= 100_000)

// =====================================================================
section('Sotto il limite: come prima')
// =====================================================================
{
  const { client, state } = fakePostgrest('expenses')
  for (let i = 0; i < 10; i += 1) state.rows.push(expenseRow(i, ts(i)))
  const { rows, error } = await createSupabaseRemote(client).pull('expenses', EPOCH)
  check('10 righe: tutte, nessun errore', rows.length === 10 && error === null)
  check('   una sola richiesta, senza filtro di pagina', state.requests.length === 1 && !state.requests[0].or)
  check('   ordinate per updated_at e poi id', JSON.stringify(state.requests[0].orders) === JSON.stringify([{ col: 'updated_at', ascending: true }, { col: 'id', ascending: true }]))
  check('   filtro "dopo il cursore" invariato', state.requests[0].filters.length === 1)
  const empty = fakePostgrest('expenses')
  const none = await createSupabaseRemote(empty.client).pull('expenses', EPOCH)
  check('tabella vuota: nessuna riga, una richiesta', none.rows.length === 0 && none.error === null && empty.state.requests.length === 1)
}

// =====================================================================
section('2.500 righe con lo STESSO updated_at (un solo upsert)')
// =====================================================================
{
  const { client, state } = fakePostgrest('expenses')
  const same = ts(5, 123456)
  // inserite in ordine casuale: l'ordine deve venire dalla query, non dall'inserimento
  const order = Array.from({ length: 2500 }, (_, i) => i).sort(() => Math.random() - 0.5)
  for (const i of order) state.rows.push(expenseRow(i, same))
  const { rows, error } = await createSupabaseRemote(client).pull('expenses', EPOCH)
  check('tutte le 2.500 righe, nessun errore', rows.length === 2500 && error === null, `${rows.length}`)
  check('   nessun duplicato', unique(rows) === 2500)
  check('   ordine deterministico (updated_at, id)', ids(rows).join() === [...ids(rows)].sort().join())
  check(`   ${Math.ceil(2500 / PULL_PAGE_SIZE) + 1} richieste (l'ultima vuota chiude)`, state.requests.length === Math.ceil(2500 / PULL_PAGE_SIZE) + 1, String(state.requests.length))
  check('   ogni richiesta chiede al massimo una pagina', state.requests.every((r) => r.limit === PULL_PAGE_SIZE))
  check('   dalla seconda in poi riparte dopo l\'ultima riga ricevuta', state.requests.slice(1).every((r) => r.or?.includes(same) && r.or?.includes('id.gt.')))
}

// =====================================================================
section('Righe miste: pareggi, cursore "since", valori con caratteri speciali')
// =====================================================================
{
  const { client, state } = fakePostgrest('expenses')
  let n = 0
  for (const [second, count] of [[1, 700], [2, 1300], [3, 1], [4, 999]]) {
    for (let k = 0; k < count; k += 1) state.rows.push(expenseRow(n++, ts(second)))
  }
  state.rows.push(expenseRow(n++, ts(4), 'e-z,(speciale)"id\\x'))
  const total = state.rows.length
  const { rows } = await createSupabaseRemote(client).pull('expenses', EPOCH)
  check(`tutte le ${total} righe, una volta sola`, rows.length === total && unique(rows) === total, `${rows.length}/${total}`)
  check('   anche l\'id con virgola, parentesi, virgolette e barra', rows.some((r) => r.id === 'e-z,(speciale)"id\\x'))

  const after = await createSupabaseRemote(client).pull('expenses', '2026-10-06T09:00:02.000Z')
  check('since = 09:00:02: solo le righe successive (secondi 3 e 4)', after.rows.length === 1 + 999 + 1 && after.rows.every((r) => micros(r.updated_at) > micros('2026-10-06T09:00:02.000Z')))
}

// =====================================================================
section('Righe che cambiano tra una pagina e l\'altra: nessuna saltata')
// =====================================================================
{
  const before = new Map()
  const { client, state } = fakePostgrest('expenses', {
    beforeRequest: (index, st) => {
      if (index !== 1) return
      // dopo la prima pagina: una riga già letta e una non ancora letta vengono
      // modificate da un altro dispositivo (updated_at più recente)
      const read = st.rows.find((r) => r.id === 'e-00010')
      const unread = st.rows.find((r) => r.id === 'e-01800')
      before.set('read', read.updated_at)
      read.updated_at = ts(30)
      unread.updated_at = ts(31)
    },
  })
  for (let i = 0; i < 2000; i += 1) state.rows.push(expenseRow(i, ts(1)))
  const { rows } = await createSupabaseRemote(client).pull('expenses', EPOCH)
  const all = new Set(ids(rows))
  check('nessuna riga persa (le 2.000 presenti tutte)', [...Array(2000).keys()].every((i) => all.has(`e-${String(i).padStart(5, '0')}`)))
  check('   le righe modificate arrivano con la versione nuova', rows.filter((r) => r.id === 'e-01800').some((r) => r.updated_at === ts(31)) && rows.filter((r) => r.id === 'e-00010').some((r) => r.updated_at === ts(30)))
}

// =====================================================================
section('Errore a metà: niente righe parziali')
// =====================================================================
{
  const { client, state } = fakePostgrest('expenses', { failOnRequest: 2 })
  for (let i = 0; i < 1800; i += 1) state.rows.push(expenseRow(i, ts(1)))
  const result = await createSupabaseRemote(client).pull('expenses', EPOCH)
  check('errore alla terza pagina: nessuna riga, errore riportato', result.rows.length === 0 && /expenses: connection reset/.test(result.error))
}

// =====================================================================
section('Sync completo: un dispositivo nuovo riceve tutte le righe')
// =====================================================================
{
  const USER = 'utente-molte-righe'
  const fake = fakePostgrest('expenses')
  const same = ts(7, 1)
  for (let i = 0; i < 2600; i += 1) fake.state.rows.push({ ...expenseRow(i, same), user_id: USER })
  // le altre tabelle sono vuote: un PostgREST per tabella dietro un unico client
  const others = {}
  const client = { from: (name) => (name === 'expenses' ? fake.client.from(name) : (others[name] ??= fakePostgrest(name)).client.from(name)) }
  const remote = { ...createSupabaseRemote(client), upsert: async () => ({ error: null }), subscribe: () => () => {} }

  installFakeLocalStorage()
  const { useAppStore } = await import('../store/useAppStore.js?pull-pagination=1')
  useAppStore.getState().switchScope(scopeFor(USER))
  const engine = createSyncEngine({ store: useAppStore, remote, autoFlushMs: 10_000 })
  await engine.start(USER)
  const S = useAppStore.getState
  check('2.600 spese con lo stesso updated_at: tutte nello store', S().expenses.length === 2600, String(S().expenses.length))
  check('   sync riuscito', S().sync.status === 'synced' && !S().sync.error, String(S().sync.error))
  check('   cursore = updated_at - 1s, come prima', S().sync.cursors.expenses === cursorFrom([{ updated_at: same }], EPOCH))
  await engine.syncNow()
  check('   un secondo sync (sovrapposizione di 1s) non duplica nulla', S().expenses.length === 2600 && new Set(S().expenses.map((e) => e.id)).size === 2600)
  engine.stop()
}

// =====================================================================
section('Database finto con il limite di 1.000 righe: due dispositivi veri')
// =====================================================================
// Il remote finto usato da tutti i test di sync ora si comporta come
// PostgREST: massimo 1.000 righe per richiesta, e un upsert dà lo stesso
// updated_at a tutte le sue righe. Il suo pull è quello vero, paginato.
{
  const db = createMemoryDatabase()
  const OWNER = 'utente-1500-spese'
  const OTHER = 'utente-estraneo'
  const device = async (name, userId) => {
    installFakeLocalStorage()
    const { useAppStore } = await import(`../store/useAppStore.js?pull-memory=${name}`)
    useAppStore.getState().switchScope(scopeFor(userId))
    const engine = createSyncEngine({ store: useAppStore, remote: createMemoryRemote(db, userId), autoFlushMs: 10_000 })
    return { state: () => useAppStore.getState(), engine }
  }

  check(`il database finto simula "Max rows" = ${MEMORY_DB_MAX_ROWS}`, MEMORY_DB_MAX_ROWS === 1000)

  // Telefono: 1.200 spese inviate in UN upsert (stesso updated_at), poi altre 300.
  const phone = await device('telefono', OWNER)
  for (let i = 0; i < 1200; i += 1) phone.state().addExpense({ amount: 1 + (i % 50), categoryId: 'bar', description: `prima-${i}`, date: '2026-10-01' })
  await phone.engine.syncNow()
  for (let i = 0; i < 300; i += 1) phone.state().addExpense({ amount: 2, categoryId: 'spesa', description: `dopo-${i}`, date: '2026-10-02' })
  await phone.engine.syncNow()
  phone.engine.stop()

  const cloud = db.rows('expenses').filter((r) => r.user_id === OWNER)
  const byTimestamp = new Map()
  for (const r of cloud) byTimestamp.set(r.updated_at, (byTimestamp.get(r.updated_at) ?? 0) + 1)
  const biggestTie = Math.max(...byTimestamp.values())
  check('sul cloud 1.500 spese (più di 1.000)', cloud.length === 1500, String(cloud.length))
  check('   di cui almeno 1.001 con lo stesso updated_at', biggestTie >= 1001, String(biggestTie))
  check('   il limite è attivo: una sola richiesta ne restituisce 1.000', db.query('expenses', OWNER, { since: EPOCH }).rows.length === 1000)

  // Il pull del remote finto (paginato): esattamente tutti i record.
  const pulled = await createMemoryRemote(db, OWNER).pull('expenses', EPOCH)
  const cloudIds = cloud.map((r) => r.id).sort()
  const pulledIds = pulled.rows.map((r) => r.id).sort()
  check('pull: esattamente 1.500 record, nessun errore', pulled.rows.length === 1500 && pulled.error === null, String(pulled.rows.length))
  check('   nessun duplicato', new Set(pulledIds).size === 1500)
  check('   nessuna omissione: stessi id del cloud', JSON.stringify(pulledIds) === JSON.stringify(cloudIds))
  check('   nessun record di altri utenti', pulled.rows.every((r) => r.user_id === OWNER))

  // Mac nuovo, localStorage vuoto: il sync vero porta tutto.
  const mac = await device('mac-nuovo', OWNER)
  await mac.engine.start(OWNER)
  const local = mac.state().expenses.map((e) => e.id).sort()
  check('Mac nuovo: 1.500 spese nello store', local.length === 1500, String(local.length))
  check('   stesse identiche spese del cloud, senza duplicati', JSON.stringify(local) === JSON.stringify(cloudIds))
  check('   importi e descrizioni intatti', mac.state().expenses.find((e) => e.description === 'prima-1199')?.amount === 1 + (1199 % 50)
    && mac.state().expenses.some((e) => e.description === 'dopo-299'))
  check('   sync riuscito', mac.state().sync.status === 'synced' && !mac.state().sync.error)
  await mac.engine.syncNow()
  check('   un secondo sync non duplica né perde nulla', mac.state().expenses.length === 1500 && new Set(mac.state().expenses.map((e) => e.id)).size === 1500)
  mac.engine.stop()

  const stranger = await device('estraneo', OTHER)
  await stranger.engine.start(OTHER)
  check('un altro utente non riceve nessuna delle 1.500', stranger.state().expenses.length === 0)
  stranger.engine.stop()
}

report('Pull paginato (oltre 1.000 righe)')
