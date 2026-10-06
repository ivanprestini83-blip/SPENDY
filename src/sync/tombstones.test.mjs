// Voci cancellate: sul cloud resta solo un marcatore tecnico, e la
// cancellazione continua a raggiungere tutti i dispositivi. `npm test`, senza
// rete.
//
// Tre punti devono dire la stessa cosa: il client (tombstones.js, mappers.js),
// il trigger SQL (supabase/tombstone_minimization.sql, letto qui come testo) e
// il database finto (memoryRemote.mjs, che simula il trigger).

import { readFileSync } from 'node:fs'
import { check, section, report, installFakeLocalStorage } from './testkit.mjs'
import { createMemoryDatabase, createMemoryRemote, MEMORY_DB_SCRUB } from './memoryRemote.mjs'
import { createSyncEngine } from './syncEngine.js'
import { toRemoteRow, SYNC_COLLECTIONS, COLLECTION_KEYS } from './mappers.js'
import { TOMBSTONE_VALUES } from './tombstones.js'
import { scopeFor, stateKey } from '../store/scope.js'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const TABLES = COLLECTION_KEYS.map((key) => SYNC_COLLECTIONS[key].table)
const TECHNICAL = ['id', 'user_id', 'client_updated_at', 'deleted_at']
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))
const SECRET = 'Regalo per Giulia'

let boots = 0
async function device(db, userId, { realtime = false } = {}) {
  installFakeLocalStorage()
  const storage = globalThis.localStorage
  const { useAppStore } = await import(`../store/useAppStore.js?tombstones=${(boots += 1)}`)
  useAppStore.getState().switchScope(scopeFor(userId))
  const remote = createMemoryRemote(db, userId, { realtime })
  const engine = createSyncEngine({ store: useAppStore, remote, autoFlushMs: 10_000 })
  useAppStore.getState().setSyncUser(userId)
  return { store: useAppStore, S: () => useAppStore.getState(), engine, remote, storage }
}
const cloudRow = (db, table, id) => db.rows(table).find((row) => row.id === id)
const isScrubbed = (table, row) => Boolean(row?.deleted_at) && Object.entries(MEMORY_DB_SCRUB[table]).every(([k, v]) => JSON.stringify(row[k]) === JSON.stringify(v))
const opsOf = (S) => S().sync.outbox

// --- il trigger SQL letto come testo -------------------------------------

const literal = (text) => {
  const t = text.trim()
  if (t === 'null') return null
  if (t === 'true' || t === 'false') return t === 'true'
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  let m = /^date '([^']*)'$/.exec(t)
  if (m) return m[1]
  m = /^'([^']*)'::jsonb$/.exec(t)
  if (m) return JSON.parse(m[1])
  m = /^'([^']*)'$/.exec(t)
  if (m) return m[1]
  throw new Error(`letterale SQL non riconosciuto: ${t}`)
}
function sqlScrubValues(sql) {
  const body = /create or replace function public\.spendy_scrub_tombstone\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(sql)?.[1] ?? ''
  const out = {}
  const branch = /(?:if|elsif) tg_table_name (?:in \(([^)]*)\)|= '([^']*)') then([\s\S]*?)(?=elsif|end if;)/g
  for (const [, list, single, assignments] of body.matchAll(branch)) {
    const tables = list ? [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]) : [single]
    const values = {}
    for (const [, column, value] of assignments.matchAll(/new\.(\w+) := ([^;]+);/g)) values[column] = literal(value)
    for (const t of tables) out[t] = values
  }
  return out
}
// Colonne NOT NULL senza default, per tabella, da schema.sql.
function requiredColumns(schema) {
  const out = {}
  for (const [, table, columns] of schema.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    out[table] = columns.split('\n')
      .map((line) => /^\s+(\w+)\s+(.*?),?$/.exec(line))
      .filter((m) => m && /not null/.test(m[2]) && !/default/.test(m[2]) && !/primary key/.test(m[2]))
      .map((m) => m[1])
  }
  return out
}

// =====================================================================
section('1. Trigger SQL, client e database finto: stessi valori neutri')
// =====================================================================
{
  const migration = read('supabase/tombstone_minimization.sql')
  const schema = read('supabase/schema.sql')
  const fromSql = sqlScrubValues(migration)
  for (const table of TABLES) {
    check(`${table}: SQL = client = database finto`, JSON.stringify(fromSql[table]) === JSON.stringify(TOMBSTONE_VALUES[table])
      && JSON.stringify(MEMORY_DB_SCRUB[table]) === JSON.stringify(TOMBSTONE_VALUES[table]), JSON.stringify(fromSql[table]))
    for (const file of [migration, schema]) {
      check(`   trigger ${table}_scrub_tombstone before insert or update (${file === schema ? 'schema.sql' : 'tombstone_minimization.sql'})`,
        new RegExp(`create trigger ${table}_scrub_tombstone before insert or update on public\\.${table}\\s+for each row execute function public\\.spendy_scrub_tombstone\\(\\);`).test(file))
    }
  }
  check('profiles non ha il trigger (non ha cancellazioni)', !/profiles_scrub_tombstone/.test(migration + schema))
  check('schema.sql contiene la stessa funzione', JSON.stringify(sqlScrubValues(schema)) === JSON.stringify(fromSql))
  check('si attiva solo con deleted_at valorizzato', /if new\.deleted_at is null then\s+return new;/.test(migration))
  check('parte prima di <tabella>_touch (ordine alfabetico dei trigger)', TABLES.every((t) => `${t}_scrub_tombstone` < `${t}_touch`))
  const active = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  check('il file di migrazione non modifica dati da solo (UPDATE/DELETE solo nei commenti)', !/\b(update|delete from|truncate|drop table|alter table)\b/i.test(active.replace(/before insert or update/g, '')))
  check('   e non tocca RLS o policy', !/policy|row level security/i.test(active))
  const required = requiredColumns(schema)
  for (const table of TABLES) {
    const row = toRemoteRow(COLLECTION_KEYS[TABLES.indexOf(table)], { id: 'x', deletedAt: '2026-10-06T10:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' }, 'u')
    const missing = required[table].filter((column) => row[column] === null || row[column] === undefined)
    check(`${table}: il marcatore rispetta i NOT NULL dello schema (${required[table].join(', ')})`, required[table].length > 0 && missing.length === 0, missing.join())
  }
}

// =====================================================================
section('2. Il marcatore inviato contiene solo campi tecnici e valori neutri')
// =====================================================================
{
  const full = { id: 'e-1', amount: 42.5, categoryId: 'regali', subcategory: 'compleanno', description: SECRET, date: '2026-10-01', deletedAt: '2026-10-06T10:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' }
  for (const collection of COLLECTION_KEYS) {
    const table = SYNC_COLLECTIONS[collection].table
    const row = toRemoteRow(collection, { ...full, label: SECRET, target: 900, goalId: 'g-1', emoji: '🎁', subcategories: [SECRET] }, 'u-1')
    check(`${collection}: solo ${TECHNICAL.join(', ')} + valori neutri`, JSON.stringify(row) === JSON.stringify({ id: 'e-1', user_id: 'u-1', ...TOMBSTONE_VALUES[table], client_updated_at: full.updatedAt, deleted_at: full.deletedAt })
      && !JSON.stringify(row).includes(SECRET))
  }
  const live = toRemoteRow('expenses', { ...full, deletedAt: undefined }, 'u-1')
  check('una voce NON cancellata viaggia completa come prima', live.description === SECRET && live.amount === 42.5 && live.category_id === 'regali' && live.deleted_at === null)
}

// =====================================================================
section('3. Nella coda locale la cancellazione non conserva dati')
// =====================================================================
{
  const db = createMemoryDatabase()
  const d = await device(db, 'utente-coda')
  const S = d.S
  S().addExpense({ amount: 42.5, categoryId: 'regali', description: SECRET, date: '2026-10-01' })
  S().addIncome({ amount: 300, categoryId: 'regalo', description: SECRET, date: '2026-10-01' })
  S().addCustomCategory({ label: SECRET, emoji: '🎁', type: 'expense' })
  S().contributeToEmergencyFund(77)
  S().addGoal({ label: SECRET, emoji: '🎁', target: 900, etaMonths: 6 })
  S().contributeToGoal(S().goals[0].id, 50)
  await d.engine.syncNow()
  await wait()
  S().deleteExpense(S().expenses[0].id)
  S().deleteIncome(S().incomes[0].id)
  S().deleteCustomCategory(S().customCategories[0].id)
  S().deleteEmergencyFundContribution(S().emergencyFundContributions[0].id)
  S().deleteGoal(S().goals[0].id)
  const ops = opsOf(S)
  check('6 cancellazioni in coda (spesa, entrata, categoria, fondo, obiettivo + suo versamento)', ops.length === 6, String(ops.length))
  check('ogni riga in coda è solo { id, deletedAt, updatedAt }', ops.every((op) => JSON.stringify(Object.keys(op.row).sort()) === '["deletedAt","id","updatedAt"]'))
  const persisted = d.storage.getItem(stateKey(scopeFor('utente-coda')))
  check('nel salvataggio locale non resta il testo delle voci cancellate', !persisted.includes(SECRET) && !persisted.includes('42.5'))
  await d.engine.syncNow()
  check('sul cloud: tutte le voci cancellate sono marcatori neutri', TABLES.every((t) => db.rows(t).every((row) => isScrubbed(t, row))))
  check('   nessuna traccia del testo nel database', !JSON.stringify(TABLES.map((t) => db.rows(t))).includes(SECRET))
}

// =====================================================================
section('4. Cancellazione sul telefono → sparisce sul secondo dispositivo')
// =====================================================================
const db = createMemoryDatabase()
const USER = 'utente-propagazione'
const phone = await device(db, USER)
const mac = await device(db, USER)
{
  phone.S().addExpense({ amount: 18, categoryId: 'bar', description: SECRET, date: '2026-10-02' })
  phone.S().addExpense({ amount: 9, categoryId: 'bar', description: 'resta', date: '2026-10-02' })
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  check('premessa: il Mac ha entrambe le spese', mac.S().expenses.length === 2)
  const id = phone.S().expenses.find((e) => e.description === SECRET).id
  await wait()
  phone.S().deleteExpense(id)
  await phone.engine.syncNow()
  check('sul cloud la riga è un marcatore neutro con deleted_at', isScrubbed('expenses', cloudRow(db, 'expenses', id)))
  await mac.engine.syncNow()
  check('sul Mac la spesa cancellata sparisce', !mac.S().expenses.some((e) => e.id === id))
  check('   l\'altra resta, con i suoi dati', mac.S().expenses.length === 1 && mac.S().expenses[0].description === 'resta' && mac.S().expenses[0].amount === 9)
}

// =====================================================================
section('5. Secondo dispositivo offline durante la cancellazione')
// =====================================================================
{
  phone.S().addIncome({ amount: 120, categoryId: 'extra', description: 'entrata da cancellare', date: '2026-10-02' })
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  const id = mac.S().incomes.find((i) => i.description === 'entrata da cancellare')?.id
  check('premessa: il Mac ha l\'entrata', Boolean(id))
  mac.remote.setOnline(false)
  await wait()
  phone.S().deleteIncome(id)
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  check('offline: il Mac la mostra ancora (non sa nulla)', mac.S().incomes.some((i) => i.id === id))
  mac.remote.setOnline(true)
  await mac.engine.syncNow()
  check('tornato online: sparisce', !mac.S().incomes.some((i) => i.id === id))
}

// =====================================================================
section('6. Full sync (cursori azzerati, dispositivo nuovo)')
// =====================================================================
{
  const fresh = await device(db, USER)
  await fresh.engine.syncNow()
  check('dispositivo nuovo: riceve solo le voci attive', fresh.S().expenses.length === 1 && fresh.S().incomes.length === 0)
  // Un dispositivo che ha ancora la voce in locale e riparte da zero.
  const stale = await device(db, USER)
  const old = { id: 'e-vecchia', amount: 5, categoryId: 'bar', description: SECRET, date: '2026-09-01', updatedAt: '2026-09-01T10:00:00.000Z' }
  stale.store.setState({ expenses: [old] })
  phone.store.setState((s) => ({ expenses: [old, ...s.expenses] }))
  phone.S().deleteExpense('e-vecchia')
  await phone.engine.syncNow()
  stale.store.setState((s) => ({ sync: { ...s.sync, cursors: {} } }))
  await stale.engine.syncNow()
  check('dispositivo con la voce in locale e cursori azzerati: la voce sparisce', !stale.S().expenses.some((e) => e.id === 'e-vecchia'))
}

// =====================================================================
section('7. Realtime: sparisce senza aspettare il pull')
// =====================================================================
{
  const live = await device(db, USER, { realtime: true })
  await live.engine.start(USER)
  phone.S().addExpense({ amount: 3, categoryId: 'bar', description: 'realtime', date: '2026-10-03' })
  await phone.engine.syncNow()
  await wait(20)
  const id = live.S().expenses.find((e) => e.description === 'realtime')?.id
  check('premessa: arrivata in realtime', Boolean(id))
  await wait()
  phone.S().deleteExpense(id)
  await phone.engine.syncNow()
  await wait(20)
  check('cancellata in realtime: sparisce dal dispositivo aperto', !live.S().expenses.some((e) => e.id === id))
  live.engine.stop()
}

// =====================================================================
section('8. Voce creata e cancellata mentre si era offline')
// =====================================================================
{
  phone.remote.setOnline(false)
  phone.S().addExpense({ amount: 61, categoryId: 'spesa', description: SECRET, date: '2026-10-03' })
  const id = phone.S().expenses.find((e) => e.amount === 61).id
  phone.S().deleteExpense(id)
  const pending = opsOf(phone.S).filter((op) => op.rowId === id)
  check('in coda una sola operazione, ed è il marcatore minimo', pending.length === 1 && pending[0].row.deletedAt && !('description' in pending[0].row))
  phone.remote.setOnline(true)
  await phone.engine.syncNow()
  const row = cloudRow(db, 'expenses', id)
  check('sul cloud nasce già come marcatore neutro', isScrubbed('expenses', row) && row.date === '1970-01-01' && row.amount === 0)
  check('   coda vuota, sync riuscito', opsOf(phone.S).length === 0 && phone.S().sync.status === 'synced')
  await mac.engine.syncNow()
  check('   il Mac non la vede mai', !mac.S().expenses.some((e) => e.id === id))
}

// =====================================================================
section('9. Conflitti: modifica più vecchia / più recente della cancellazione')
// =====================================================================
{
  phone.S().addExpense({ amount: 14, categoryId: 'bar', description: 'conflitto-vecchio', date: '2026-10-03' })
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  const id = mac.S().expenses.find((e) => e.description === 'conflitto-vecchio').id
  mac.remote.setOnline(false)
  mac.S().editExpense(id, { description: 'modificata offline PRIMA' })
  await wait()
  phone.S().deleteExpense(id)
  await phone.engine.syncNow()
  mac.remote.setOnline(true)
  await mac.engine.syncNow()
  check('modifica più vecchia: la cancellazione vince, il cloud resta un marcatore neutro', isScrubbed('expenses', cloudRow(db, 'expenses', id)))
  check('   e la voce sparisce anche dal dispositivo che l\'aveva modificata', !mac.S().expenses.some((e) => e.id === id))

  phone.S().addExpense({ amount: 15, categoryId: 'bar', description: 'conflitto-nuovo', date: '2026-10-03' })
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  const id2 = mac.S().expenses.find((e) => e.description === 'conflitto-nuovo').id
  mac.remote.setOnline(false)
  phone.S().deleteExpense(id2)
  await phone.engine.syncNow()
  await wait()
  mac.S().editExpense(id2, { description: 'modificata DOPO', amount: 16 })
  mac.remote.setOnline(true)
  await mac.engine.syncNow()
  const back = cloudRow(db, 'expenses', id2)
  check('modifica più recente: la voce torna (comportamento invariato), con i dati completi di chi l\'ha modificata', back.deleted_at === null && back.description === 'modificata DOPO' && Number(back.amount) === 16 && back.category_id === 'bar' && back.date === '2026-10-03')
  await phone.engine.syncNow()
  check('   e ricompare sul telefono con quei dati', phone.S().expenses.some((e) => e.id === id2 && e.description === 'modificata DOPO' && e.amount === 16))
}

// =====================================================================
section('10. Client vecchio che manda ancora la riga completa')
// =====================================================================
{
  phone.S().addExpense({ amount: 33, categoryId: 'regali', description: SECRET, date: '2026-10-04' })
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  const id = phone.S().expenses.find((e) => e.amount === 33).id
  const at = new Date(Date.now() + 1000).toISOString()
  // Come faceva la versione precedente: tutta la riga, più deleted_at.
  const { error } = db.upsert('expenses', [{ id, user_id: USER, amount: 33, category_id: 'regali', subcategory: 'amici', description: SECRET, date: '2026-10-04', client_updated_at: at, deleted_at: at }], USER)
  const row = cloudRow(db, 'expenses', id)
  check('accettata, e il database la riduce a marcatore neutro', !error && isScrubbed('expenses', row) && row.subcategory === null)
  check('   restano id, user_id, deleted_at, client_updated_at', row.id === id && row.user_id === USER && row.deleted_at === at && row.client_updated_at === at)
  await mac.engine.syncNow()
  check('   la cancellazione arriva comunque al Mac', !mac.S().expenses.some((e) => e.id === id))
  const goal = { id: 'g-vecchio', user_id: USER, emoji: '🎁', label: SECRET, target: 900, eta_months: 3, client_updated_at: at, deleted_at: at }
  const category = { id: 'c-vecchia', user_id: USER, label: SECRET, emoji: '🎁', type: 'income', pinned: true, subcategories: [SECRET], client_updated_at: at, deleted_at: at }
  const contribution = { id: 'gc-vecchio', user_id: USER, goal_id: 'g-vecchio', amount: 50, date: '2026-10-04', client_updated_at: at, deleted_at: at }
  const fund = { id: 'ef-vecchio', user_id: USER, amount: 80, date: '2026-10-04', client_updated_at: at, deleted_at: at }
  db.upsert('goals', [goal], USER)
  db.upsert('custom_categories', [category], USER)
  db.upsert('goal_contributions', [contribution], USER)
  db.upsert('emergency_fund_contributions', [fund], USER)
  check('   lo stesso per obiettivi, categorie, versamenti, fondo emergenza', isScrubbed('goals', cloudRow(db, 'goals', 'g-vecchio')) && isScrubbed('custom_categories', cloudRow(db, 'custom_categories', 'c-vecchia'))
    && isScrubbed('goal_contributions', cloudRow(db, 'goal_contributions', 'gc-vecchio')) && isScrubbed('emergency_fund_contributions', cloudRow(db, 'emergency_fund_contributions', 'ef-vecchio')))
  check('   nessuna traccia del testo nel database', !JSON.stringify(TABLES.map((t) => db.rows(t))).includes(SECRET))
}

// =====================================================================
section('11. deleteGoal: obiettivo e suoi versamenti')
// =====================================================================
{
  phone.S().addGoal({ label: 'Viaggio a Lisbona', emoji: '✈️', target: 1200, etaMonths: 8 })
  const goalId = phone.S().goals.find((g) => g.label === 'Viaggio a Lisbona').id
  phone.S().contributeToGoal(goalId, 100)
  phone.S().contributeToGoal(goalId, 40)
  await phone.engine.syncNow()
  await mac.engine.syncNow()
  check('premessa: il Mac vede l\'obiettivo con 140 € versati', mac.S().goals.find((g) => g.id === goalId)?.saved === 140)
  const contributionIds = phone.S().goalContributions.filter((c) => c.goalId === goalId).map((c) => c.id)
  await wait()
  phone.S().deleteGoal(goalId)
  const ops = opsOf(phone.S)
  check('in coda: obiettivo + 2 versamenti, tutti marcatori minimi', ops.length === 3 && ops.every((op) => Object.keys(op.row).length === 3 && op.row.deletedAt))
  await phone.engine.syncNow()
  check('sul cloud: obiettivo e versamenti neutri (goal_id compreso)', isScrubbed('goals', cloudRow(db, 'goals', goalId)) && contributionIds.every((id) => isScrubbed('goal_contributions', cloudRow(db, 'goal_contributions', id))))
  await mac.engine.syncNow()
  check('sul Mac spariscono obiettivo e versamenti', !mac.S().goals.some((g) => g.id === goalId) && !mac.S().goalContributions.some((c) => contributionIds.includes(c.id)))
}

// =====================================================================
section('12. Più di 1.000 cancellazioni (pull paginato)')
// =====================================================================
{
  const big = createMemoryDatabase()
  const OWNER = 'utente-tante'
  const a = await device(big, OWNER)
  for (let i = 0; i < 1200; i += 1) a.S().addExpense({ amount: 1 + (i % 50), categoryId: 'spesa', description: `voce-${i}`, date: '2026-10-01' })
  await a.engine.syncNow()
  const b = await device(big, OWNER)
  await b.engine.syncNow()
  check('premessa: il secondo dispositivo ha 1.200 spese', b.S().expenses.length === 1200)
  await wait()
  for (const id of a.S().expenses.map((e) => e.id)) a.S().deleteExpense(id)
  await a.engine.syncNow()
  check('1.200 marcatori neutri sul cloud (stesso updated_at, un solo upsert)', big.rows('expenses').length === 1200 && big.rows('expenses').every((r) => isScrubbed('expenses', r)) && new Set(big.rows('expenses').map((r) => r.updated_at)).size === 1)
  await b.engine.syncNow()
  check('il secondo dispositivo le vede sparire tutte', b.S().expenses.length === 0)
  const c = await device(big, OWNER)
  await c.engine.syncNow()
  check('un dispositivo nuovo parte vuoto', c.S().expenses.length === 0)
}

// =====================================================================
section('13. Operazioni rifiutate e isolamento tra utenti')
// =====================================================================
{
  const shared = createMemoryDatabase()
  const a = await device(shared, 'utente-a')
  a.store.setState((s) => ({ expenses: [{ id: 'stesso-id', amount: 70, categoryId: 'casa', description: 'di A', date: '2026-10-01', updatedAt: '2026-10-01T09:00:00.000Z' }], sync: { ...s.sync, outbox: [{ collection: 'expenses', rowId: 'stesso-id', row: { id: 'stesso-id', amount: 70, categoryId: 'casa', description: 'di A', date: '2026-10-01', updatedAt: '2026-10-01T09:00:00.000Z' }, updatedAt: '2026-10-01T09:00:00.000Z' }] } }))
  await a.engine.syncNow()
  const b = await device(shared, 'utente-b')
  b.store.setState({ expenses: [{ id: 'stesso-id', amount: 5, categoryId: 'bar', description: SECRET, date: '2026-10-01', updatedAt: '2026-10-01T09:00:00.000Z' }] })
  b.S().deleteExpense('stesso-id')
  b.S().addExpense({ amount: 8, categoryId: 'bar', description: 'spesa di B', date: '2026-10-02' })
  await b.engine.syncNow()
  const rejected = b.S().sync.rejected
  check('la cancellazione di B su una riga di A è rifiutata (RLS)', rejected.length === 1 && rejected[0].rowId === 'stesso-id')
  check('   la lista delle rifiutate non contiene dati della voce', JSON.stringify(Object.keys(rejected[0].row).sort()) === '["deletedAt","id","updatedAt"]' && !JSON.stringify(rejected).includes(SECRET))
  check('   la riga di A è intatta (non cancellata, non azzerata)', (() => { const r = cloudRow(shared, 'expenses', 'stesso-id'); return r.user_id === 'utente-a' && r.deleted_at === null && r.description === 'di A' && Number(r.amount) === 70 })())
  check('   la spesa di B parte comunque', shared.rows('expenses').some((r) => r.description === 'spesa di B'))
  await wait()
  b.S().deleteExpense(b.S().expenses.find((e) => e.description === 'spesa di B').id)
  await b.engine.syncNow()
  await a.engine.syncNow()
  check('A non riceve le cancellazioni di B, e mantiene la sua spesa', a.S().expenses.length === 1 && a.S().expenses[0].description === 'di A')
  const persisted = b.storage.getItem(stateKey(scopeFor('utente-b')))
  check('nel salvataggio locale di B non resta il testo della voce cancellata', !persisted.includes(SECRET))
}

report('Voci cancellate: solo un marcatore tecnico')
