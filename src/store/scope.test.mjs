// Isolamento dei dati locali tra account (store/scope.js).
// `npm test`, senza browser, senza rete, senza Supabase: lo store è quello vero
// (zustand + persist sul gestore degli ambiti), il database finto applica RLS e
// trigger last-write-wins come il vero, e ogni "dispositivo" è uno store
// indipendente sopra il SUO localStorage finto.
//
// Lo scenario che si vuole impossibile:
//   A entra → usa l'app → esce → entra B sullo stesso telefono
//   B non deve vedere niente di A, niente di A deve partire verso l'account di B,
//   e quando A rientra ritrova tutto.

import { check, section, report } from '../sync/testkit.mjs'
import { createMemoryDatabase, createMemoryRemote } from '../sync/memoryRemote.mjs'
import { createSyncEngine } from '../sync/syncEngine.js'
import { migrationStatus, migrateLocalToCloud } from '../sync/migrateLocal.js'
import { toRemoteRow } from '../sync/mappers.js'
import { getCategory } from '../data/categories.js'
import {
  GUEST, scopeFor, stateKey, voiceKey,
  LEGACY_STATE_KEY, ACTIVE_SCOPE_KEY, GUEST_CLAIM_KEY, MIGRATION_KEY,
} from './scope.js'
import { emptyVoiceCache, loadVoiceCache, saveVoiceCache } from '../ai/spendyVoiceCache.js'
import { requestAndStoreVoice } from '../ai/spendyVoiceRequest.js'

const A = 'utente-a-0001'
const B = 'utente-b-0002'
const C = 'utente-c-0003'

// --- un "dispositivo": un localStorage finto e uno store che ci sta sopra -------

function installStorage(map) {
  const fake = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true })
  // persist di zustand legge window.localStorage: serve un window finto.
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: fake, addEventListener: () => {}, removeEventListener: () => {} },
    configurable: true,
    writable: true,
  })
  return fake
}

let boots = 0
// "Avvia l'app" su un localStorage: ogni chiamata è un nuovo caricamento dello store.
async function bootDevice(map) {
  installStorage(map)
  const { useAppStore } = await import(`./useAppStore.js?scope-test=${(boots += 1)}`)
  return useAppStore
}

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// Tutto ciò che un account può avere, con un marcatore riconoscibile nel testo.
function fillAccount(S, tag) {
  const today = S().today
  S().setMonthlyBudget(3333, today)
  S().addExpense({ amount: 777.77, categoryId: 'spesa', description: `SEGRETO-${tag}`, date: today })
  S().addIncome({ amount: 55, categoryId: 'regalo', description: `ENTRATA-${tag}`, date: today })
  S().addCustomCategory({ label: `Categoria-${tag}`, emoji: '🧪', type: 'expense' })
  S().addGoal({ emoji: '🎯', label: `Vacanza-${tag}`, target: 2000, etaMonths: 6, saved: 100 })
  S().contributeToGoal(S().goals[0].id, 50)
  S().contributeToEmergencyFund(25)
  S().toggleAmountHidden()
  S().recordSpendyJoke({ key: `k-${tag}`, text: `Battuta-${tag}`, shownAt: today })
}

const markersOf = (tag) => [`SEGRETO-${tag}`, `ENTRATA-${tag}`, `Categoria-${tag}`, `Vacanza-${tag}`, `Battuta-${tag}`]
const mentions = (value, tag) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return markersOf(tag).filter((marker) => text.includes(marker))
}

const isEmptyState = (state) =>
  state.expenses.length === 0 && state.incomes.length === 0 && state.goals.length === 0
  && state.goalContributions.length === 0 && state.emergencyFundContributions.length === 0
  && state.customCategories.length === 0 && state.spendyJokeHistory.length === 0
  && state.monthlyBudget === 0 && state.cycleStartDay === null && state.emergencyFundSaved === 0
  && state.amountHidden === false && state.sync.outbox.length === 0
  && Object.keys(state.sync.cursors).length === 0 && state.sync.lastSyncAt === null && state.sync.migratedAt === null

const holdersOf = (map, text) => [...map].filter(([, value]) => value.includes(text)).map(([key]) => key).sort()

// =====================================================================
section('A → logout → B: B non vede niente di A, niente di A parte verso B')
// =====================================================================
const mapShared = new Map()
const shared = await bootDevice(mapShared)
const S = shared.getState
const dbShared = createMemoryDatabase()
const remoteOf = (userId) => createMemoryRemote(dbShared, userId)

check('primo avvio: ambito guest, stato vuoto', S().scopeId === GUEST && isEmptyState(S()))

// --- A entra, lavora, sincronizza, poi lavora ancora offline
S().switchScope(scopeFor(A))
check('login A: ambito u:A, userId dello stato = A', S().scopeId === scopeFor(A) && S().sync.userId === A)
fillAccount(S, 'A')
const engineA = createSyncEngine({ store: shared, remote: remoteOf(A), autoFlushMs: 10_000 })
await engineA.syncNow()
check('A ha sincronizzato: coda vuota e cursori presenti', S().sync.outbox.length === 0 && Object.keys(S().sync.cursors).length > 0)
S().addExpense({ amount: 9.5, categoryId: 'bar', description: 'OFFLINE-A', date: S().today })
const dopoA = {
  outbox: S().sync.outbox.map((op) => op.key),
  cursors: { ...S().sync.cursors },
  expenses: S().expenses.map((e) => e.id).sort(),
  goals: S().goals.map((g) => g.id),
  customCategoryId: S().customCategories[0].id,
}
check('A ha una modifica ancora in coda (fatta offline)', dopoA.outbox.length === 1)
check('A: il registro delle categorie conosce la sua categoria', getCategory(dopoA.customCategoryId).label === 'Categoria-A')
const cacheA = { ...emptyVoiceCache(), lastShown: { message: 'Frase-AI-di-A', day: S().today }, calls: { day: S().today, count: 2, lastAt: 1 } }
saveVoiceCache(cacheA, globalThis.localStorage, scopeFor(A))
const bucketA = mapShared.get(stateKey(scopeFor(A)))

// --- A esce
S().switchScope(GUEST)
check('logout: ambito guest', S().scopeId === GUEST && S().sync.userId === null)
check('logout: nessun dato di A nello stato (spese, entrate, obiettivi, versamenti, fondo, categorie, budget, battute, coda, cursori)', isEmptyState(S()))
check('logout: nessun marcatore di A in tutto lo stato (nemmeno l\'importo della sua spesa)', mentions(S(), 'A').length === 0 && !JSON.stringify(S()).includes('777.77'), mentions(S(), 'A').join(','))
check('logout: nemmeno le preferenze: amountHidden di A non resta (20)', S().amountHidden === false)
check('logout: il registro delle categorie non conosce più quelle di A', getCategory(dopoA.customCategoryId).label === 'Altro')
check('logout: la schermata e il modale ripartono puliti', S().modal === null && S().activeTab === 'home')
check('i dati di A sono ancora nel suo contenitore, intatti (nulla è stato cancellato)', mapShared.get(stateKey(scopeFor(A))) === bucketA)

// --- entra B
S().switchScope(scopeFor(B))
check('login B: ambito u:B', S().scopeId === scopeFor(B) && S().sync.userId === B)
check('B vede zero dati di A', isEmptyState(S()) && mentions(S(), 'A').length === 0 && !JSON.stringify(S()).includes('777.77'))
check('B: nessuna spesa, nessun obiettivo, nessuna categoria di A', S().expenses.length === 0 && S().goals.length === 0 && S().customCategories.length === 0)
check('B: la cache di Spendy AI non è quella di A (vuota)', JSON.stringify(loadVoiceCache(globalThis.localStorage, scopeFor(B))) === JSON.stringify(emptyVoiceCache()))
check('B: il contenitore locale di B non contiene niente di A',
  mentions(mapShared.get(stateKey(scopeFor(B))) ?? '', 'A').length === 0 && !(mapShared.get(voiceKey(scopeFor(B))) ?? '').includes('Frase-AI-di-A'))
check('nello storage i dati di A stanno SOLO nel contenitore di A', JSON.stringify(holdersOf(mapShared, 'SEGRETO-A')) === JSON.stringify([stateKey(scopeFor(A))]))
check('le operazioni in attesa di A restano nello scope A',
  JSON.parse(mapShared.get(stateKey(scopeFor(A)))).state.sync.outbox.length === dopoA.outbox.length)

// --- B lavora
S().addExpense({ amount: 12, categoryId: 'bar', description: 'SPESA-B', date: S().today })
check('B: la sua coda contiene solo operazioni di B',
  S().sync.outbox.length === 1 && S().sync.outbox[0].row.description === 'SPESA-B')
check('B: nessuna operazione di A nella coda di B', !S().sync.outbox.some((op) => JSON.stringify(op).includes('OFFLINE-A')))

// --- B sincronizza
const engineB = createSyncEngine({ store: shared, remote: remoteOf(B), autoFlushMs: 10_000 })
const avvioB = await engineB.start(B)
await engineB.syncNow()
check('il motore di B parte nel contenitore di B', avvioB.skipped === undefined && S().sync.outbox.length === 0)
const righeB = dbShared.rows('expenses').filter((r) => r.user_id === B)
check('sul cloud, sotto B, c\'è solo la spesa di B', righeB.length === 1 && righeB[0].description === 'SPESA-B')
check('nessuna operazione di A è stata inviata come B (né sul cloud in generale: era ancora in coda)',
  !dbShared.rows('expenses').some((r) => r.description === 'OFFLINE-A'))
check('B dopo la sincronizzazione: ancora zero dati di A', mentions(S(), 'A').length === 0 && S().expenses.every((e) => e.description === 'SPESA-B'))
engineB.stop()

// --- B esce, A rientra
S().switchScope(GUEST)
S().switchScope(scopeFor(A))
check('A rientra: ritrova le sue spese', JSON.stringify(S().expenses.map((e) => e.id).sort()) === JSON.stringify(dopoA.expenses))
check('A: ritrova entrate, obiettivo, versamenti, fondo emergenza, categoria, budget',
  S().incomes.length === 1 && S().goals.length === 1 && S().goals[0].saved === 150 && S().emergencyFundSaved === 25
  && S().customCategories[0].id === dopoA.customCategoryId && S().monthlyBudget === 3333)
check('A: ritrova la coda (la modifica offline)', JSON.stringify(S().sync.outbox.map((op) => op.key)) === JSON.stringify(dopoA.outbox))
check('A: ritrova i cursori', JSON.stringify(S().sync.cursors) === JSON.stringify(dopoA.cursors))
check('A: ritrova la sua cache di Spendy AI, non quella di B',
  JSON.stringify(loadVoiceCache(globalThis.localStorage, scopeFor(A))) === JSON.stringify({ ...emptyVoiceCache(), ...cacheA }))
check('A: ritrova la preferenza "nascondi importi" (20)', S().amountHidden === true)
check('A: ritrova la cronologia delle sue battute', S().spendyJokeHistory.some((j) => j.text === 'Battuta-A'))
check('A: il registro delle categorie torna a conoscere la sua', getCategory(dopoA.customCategoryId).label === 'Categoria-A')
check('A: e non vede niente di B', mentions(S(), 'B').length === 0 && !S().expenses.some((e) => e.description === 'SPESA-B'))
await engineA.syncNow()
check('A sincronizza: la sua modifica offline arriva sotto A',
  dbShared.rows('expenses').some((r) => r.user_id === A && r.description === 'OFFLINE-A'))
check('e la spesa di B è rimasta di B', dbShared.rows('expenses').find((r) => r.description === 'SPESA-B')?.user_id === B)

// =====================================================================
section('Cache Spendy AI e coda: completamente separate tra A e B')
// =====================================================================
{
  const map = new Map()
  const store = await bootDevice(map)
  const s = store.getState
  s().switchScope(scopeFor(A))
  saveVoiceCache({ ...emptyVoiceCache(), lastShown: { message: 'frase-A', day: '2026-09-30' } }, globalThis.localStorage, scopeFor(A))
  s().addExpense({ amount: 1, categoryId: 'bar', description: 'coda-A', date: s().today })
  s().switchScope(scopeFor(B))
  check('la cache di B parte vuota', loadVoiceCache(globalThis.localStorage, scopeFor(B)).lastShown === null)
  saveVoiceCache({ ...emptyVoiceCache(), lastShown: { message: 'frase-B', day: '2026-09-30' } }, globalThis.localStorage, scopeFor(B))
  s().addExpense({ amount: 2, categoryId: 'bar', description: 'coda-B', date: s().today })
  check('due chiavi diverse, una per ambito', map.has(voiceKey(scopeFor(A))) && map.has(voiceKey(scopeFor(B))) && voiceKey(scopeFor(A)) !== voiceKey(scopeFor(B)))
  check('ciascuno legge solo la sua cache',
    loadVoiceCache(globalThis.localStorage, scopeFor(A)).lastShown.message === 'frase-A'
    && loadVoiceCache(globalThis.localStorage, scopeFor(B)).lastShown.message === 'frase-B'
    && loadVoiceCache(globalThis.localStorage, GUEST).lastShown === null)
  check('nessuna chiave globale della vecchia cache', !map.has('spendy-ai-voice'))
  const codaA = JSON.parse(map.get(stateKey(scopeFor(A)))).state.sync.outbox
  const codaB = JSON.parse(map.get(stateKey(scopeFor(B)))).state.sync.outbox
  check('due code, ciascuna con le sole operazioni del suo account',
    codaA.length === 1 && codaA[0].row.description === 'coda-A' && codaB.length === 1 && codaB[0].row.description === 'coda-B')
  check('le due code sono in contenitori diversi', stateKey(scopeFor(A)) !== stateKey(scopeFor(B)) && !map.get(stateKey(scopeFor(B))).includes('coda-A'))
}

// =====================================================================
section('Risposte tardive dopo un cambio account: scartate')
// =====================================================================
{
  // Le spie: dopo il cambio, nessuna di queste azioni dello store deve essere chiamata dal motore di A.
  const spy = (store, names) => {
    const calls = []
    const patch = {}
    for (const name of names) {
      const original = store.getState()[name]
      patch[name] = (...args) => { calls.push(name); return original(...args) }
    }
    store.setState(patch)
    return calls
  }
  const ACTIONS = ['ackOps', 'applyRemote', 'applyRemoteSettings', 'setCursor', 'setSyncStatus']

  // (a) la risposta del PULL arriva dopo che A ha lasciato il posto a B
  {
    const map = new Map()
    const store = await bootDevice(map)
    const s = store.getState
    const db = createMemoryDatabase()
    s().switchScope(scopeFor(A))
    s().addExpense({ amount: 1, categoryId: 'bar', description: 'PRIMA-A', date: s().today })
    // una riga di A sul cloud, più nuova del suo cursore: il pull la riporterebbe indietro
    db.upsert('expenses', [toRemoteRow('expenses', { id: 'e-tardiva', amount: 2, categoryId: 'bar', description: 'ARRIVATA-TARDI-A', date: s().today, updatedAt: new Date().toISOString() }, A)], A)
    const base = createMemoryRemote(db, A)
    const gate = deferred()
    const slow = { upsert: base.upsert, subscribe: base.subscribe, pull: async (...args) => { await gate.promise; return base.pull(...args) } }
    const engine = createSyncEngine({ store, remote: slow, autoFlushMs: 10_000 })
    const running = engine.syncNow() // push ok, poi resta in attesa del pull
    await tick(); await tick()
    store.getState().switchScope(scopeFor(B)) // nel frattempo entra B (il motore di A NON viene fermato: caso peggiore)
    const calls = spy(store, ACTIONS)
    gate.resolve()
    const esito = await running
    check('risposta di pull tardiva: il giro di A viene scartato', esito.skipped === 'scope-cambiato', JSON.stringify(esito))
    check('   non applica righe, cursori, impostazioni né stato dentro B', calls.length === 0, calls.join(','))
    check('   B resta vuoto e intatto', isEmptyState(s()) && s().sync.status === 'idle' && s().sync.userId === B)
    check('   il contenitore di B non contiene la riga arrivata tardi', !(map.get(stateKey(scopeFor(B))) ?? '').includes('ARRIVATA-TARDI-A'))
    s().switchScope(scopeFor(A))
    check('   A, rientrando, ha ancora tutto e riceverà la riga al prossimo giro',
      s().expenses.some((e) => e.description === 'PRIMA-A') && !s().expenses.some((e) => e.id === 'e-tardiva'))
    await createSyncEngine({ store, remote: createMemoryRemote(db, A), autoFlushMs: 10_000 }).syncNow()
    check('   e al prossimo giro di A la riga arriva', s().expenses.some((e) => e.id === 'e-tardiva'))
  }

  // (b) la conferma del PUSH arriva dopo il cambio: la coda di A non si tocca
  {
    const map = new Map()
    const store = await bootDevice(map)
    const s = store.getState
    const db = createMemoryDatabase()
    s().switchScope(scopeFor(A))
    s().addExpense({ amount: 1, categoryId: 'bar', description: 'IN-VOLO-A', date: s().today })
    const base = createMemoryRemote(db, A)
    const gate = deferred()
    const slow = { pull: base.pull, subscribe: base.subscribe, upsert: async (...args) => { await gate.promise; return base.upsert(...args) } }
    const engine = createSyncEngine({ store, remote: slow, autoFlushMs: 10_000 })
    const running = engine.syncNow()
    await tick(); await tick()
    store.getState().switchScope(scopeFor(B))
    s().addExpense({ amount: 3, categoryId: 'bar', description: 'SPESA-B', date: s().today })
    const coda = s().sync.outbox.map((op) => op.key)
    const calls = spy(store, ACTIONS)
    gate.resolve()
    const esito = await running
    check('conferma di push tardiva: scartata', esito.skipped === 'scope-cambiato', JSON.stringify(esito))
    check('   nessuna conferma, nessun cursore, nessuno stato toccati in B', calls.length === 0, calls.join(','))
    check('   la coda di B è intatta', JSON.stringify(s().sync.outbox.map((op) => op.key)) === JSON.stringify(coda))
    check('   la coda di A è ancora nel suo contenitore (verrà confermata al suo rientro)',
      JSON.parse(map.get(stateKey(scopeFor(A)))).state.sync.outbox.length === 1)
    s().switchScope(scopeFor(A))
    await createSyncEngine({ store, remote: createMemoryRemote(db, A), autoFlushMs: 10_000 }).syncNow()
    check('   al rientro di A la coda si svuota senza duplicare la riga già accettata',
      s().sync.outbox.length === 0 && db.rows('expenses').filter((r) => r.description === 'IN-VOLO-A').length === 1)
    check('   e niente di A è finito sotto B', !db.rows('expenses').some((r) => r.user_id === B && r.description === 'IN-VOLO-A'))
  }

  // (c) la risposta di Spendy AI arriva dopo il cambio
  {
    const map = new Map()
    const store = await bootDevice(map)
    const s = store.getState
    s().switchScope(scopeFor(A))
    const gate = deferred()
    const ai = {
      generate: async () => {
        await gate.promise
        return { ok: true, response: { message: 'Frase-tardiva-di-A', state: 'happy', tone: 'friendly', layout: null, animation: 'gentle', priority: 50, shouldShow: true }, provider: 'test' }
      },
    }
    const running = requestAndStoreVoice({
      ai, context: {}, meta: { fingerprint: 'f-1', eventKey: 'k-1', importance: 60 },
      cache: emptyVoiceCache(), today: s().today, scope: s().scopeId, storage: globalThis.localStorage,
    })
    s().switchScope(scopeFor(B)) // l'utente cambia mentre l'AI sta pensando
    gate.resolve()
    await running
    check('risposta AI tardiva: niente nello scope attivo (B)', !map.has(voiceKey(scopeFor(B))))
    check('   e niente in una chiave globale', !map.has('spendy-ai-voice') && !map.has(voiceKey(GUEST)))
    check('   finisce nella memoria di chi l\'ha richiesta (A)', loadVoiceCache(globalThis.localStorage, scopeFor(A)).history[0]?.message === 'Frase-tardiva-di-A')
    check('   B, leggendo la sua cache, non la vede', loadVoiceCache(globalThis.localStorage, scopeFor(B)).history.length === 0)
  }
}

// =====================================================================
section('engine.start(B) con i dati di A è rifiutato')
// =====================================================================
{
  const map = new Map()
  const store = await bootDevice(map)
  const s = store.getState
  const db = createMemoryDatabase()
  s().switchScope(scopeFor(A))
  s().addExpense({ amount: 4, categoryId: 'bar', description: 'DI-A', date: s().today })
  const base = createMemoryRemote(db, B)
  const richieste = []
  const remote = {
    upsert: (...args) => { richieste.push('upsert'); return base.upsert(...args) },
    pull: (...args) => { richieste.push('pull'); return base.pull(...args) },
    subscribe: (...args) => { richieste.push('subscribe'); return base.subscribe(...args) },
  }
  const engine = createSyncEngine({ store, remote, autoFlushMs: 10_000 })
  const esito = await engine.start(B)
  check('start(B) con ambito u:A: rifiutato', esito.skipped === 'scope-diverso', JSON.stringify(esito))
  check('   nessuna richiesta di rete', richieste.length === 0)
  check('   lo stato non cambia identità', s().sync.userId === A && s().scopeId === scopeFor(A))
  check('   la coda di A è intatta e nel cloud di B non c\'è niente', s().sync.outbox.length === 1 && db.rows('expenses').length === 0)
  const esitoGuest = (() => { s().switchScope(GUEST); return engine.start(B) })()
  check('start(B) con ambito guest: rifiutato', (await esitoGuest).skipped === 'scope-diverso')
  s().switchScope(scopeFor(B))
  const esitoGiusto = await engine.start(B)
  check('start(B) con ambito u:B: parte', esitoGiusto.skipped === undefined)
  engine.stop()
}

// =====================================================================
section('Difesa in più: lo stato di un ambito non può portare l\'identità di un altro')
// =====================================================================
{
  const map = new Map()
  const store = await bootDevice(map)
  const s = store.getState
  const db = createMemoryDatabase()
  s().switchScope(scopeFor(A))
  s().addExpense({ amount: 4, categoryId: 'bar', description: 'DI-A', date: s().today })
  s().setSyncUser(B) // stato incoerente: contenitore di A, identità di B (non deve succedere)
  const base = createMemoryRemote(db, B)
  const richieste = []
  const remote = {
    upsert: (...args) => { richieste.push('upsert'); return base.upsert(...args) },
    pull: (...args) => { richieste.push('pull'); return base.pull(...args) },
    subscribe: base.subscribe,
  }
  const engine = createSyncEngine({ store, remote, autoFlushMs: 10_000 })
  const push = await engine.pushPending()
  const pull = await engine.pullAll()
  check('il motore non spedisce la coda di un contenitore con l\'identità di un altro', /non coerente/.test(push.error ?? '') && push.pushed === 0)
  check('   né scarica dati con quell\'identità', /non coerente/.test(pull.error ?? '') && pull.pulled === 0)
  check('   nessuna richiesta di rete è partita e nel cloud non è arrivato niente', richieste.length === 0 && db.rows('expenses').length === 0)
  check('   la coda resta dov\'era', s().sync.outbox.length === 1)
  const giro = await engine.syncNow()
  check('   nemmeno un giro completo la spedisce', /non coerente/.test(giro.error ?? '') && richieste.length === 0)
}

// =====================================================================
section('Guest: comportamento invariato')
// =====================================================================
{
  const map = new Map()
  let store = await bootDevice(map)
  let s = store.getState
  check('senza login: ambito guest, nessun utente', s().scopeId === GUEST && s().sync.userId === null)
  s().setMonthlyBudget(1800, s().today)
  s().addExpense({ amount: 30, categoryId: 'bar', description: 'GUEST-SPESA', date: s().today })
  s().addGoal({ emoji: '🎯', label: 'Obiettivo guest', target: 500, etaMonths: 3, saved: 0 })
  check('guest: lavora come sempre (spese, budget, obiettivi)', s().expenses.length === 1 && s().monthlyBudget === 1800 && s().goals.length === 1)
  check('guest: la coda si accumula come sempre (nessun motore)', s().sync.outbox.length >= 2)
  check('guest: persistito nel suo contenitore', map.has(stateKey(GUEST)) && JSON.parse(map.get(stateKey(GUEST))).state.expenses.length === 1)
  check('guest: nessun vecchio storage creato, nessun ambito account', !map.has(LEGACY_STATE_KEY) && ![...map.keys()].some((k) => k.startsWith(`${stateKey('u:')}`)))
  const esito = s().switchScope(GUEST)
  check('guest: rimanere guest non cambia niente', esito === false && s().expenses.length === 1)
  store = await bootDevice(map) // chiude e riapre l'app
  s = store.getState
  check('guest: alla riapertura ritrova tutto', s().expenses.length === 1 && s().monthlyBudget === 1800 && s().goals.length === 1 && s().scopeId === GUEST)
  check('guest: la coda sopravvive alla riapertura', s().sync.outbox.length >= 2)
  check('guest: la memoria AI del guest è la sua chiave', (saveVoiceCache(emptyVoiceCache(), globalThis.localStorage), map.has(voiceKey(GUEST))))
}

// =====================================================================
section('Primo login: adozione dei dati guest (una sola volta)')
// =====================================================================
{
  const map = new Map()
  const store = await bootDevice(map)
  const s = store.getState
  const db = createMemoryDatabase()
  // dati guest: una riga "storica" (senza updatedAt) e una modifica in coda
  store.setState({ expenses: [{ id: 'e-storica-1', amount: 42, categoryId: 'spesa', description: 'STORICA-GUEST', date: s().today }] })
  s().addExpense({ amount: 5, categoryId: 'bar', description: 'CODA-GUEST', date: s().today })
  const codaGuest = s().sync.outbox.length
  const guestPrima = map.get(stateKey(GUEST))

  s().switchScope(scopeFor(A))
  check('primo login: il primo account adotta i dati guest', s().expenses.some((e) => e.description === 'STORICA-GUEST') && s().expenses.some((e) => e.description === 'CODA-GUEST'))
  check('   con la coda e l\'identità dell\'account', s().sync.outbox.length === codaGuest && s().sync.userId === A)
  check('   la riga storica resta da migrare in modo esplicito (non parte da sola)', migrationStatus(s(), A).needed === true)
  check('   il guest è stato archiviato, non perso', [...map.keys()].some((k) => k.startsWith(`${stateKey(GUEST)}:adopted:`)) && map.get([...map.keys()].find((k) => k.startsWith(`${stateKey(GUEST)}:adopted:`))) === guestPrima)
  check('   e liberato: dopo il logout non mostra niente di A', !map.has(stateKey(GUEST)))
  check('   l\'adozione è segnata', map.get(GUEST_CLAIM_KEY) === A)

  const engine = createSyncEngine({ store, remote: createMemoryRemote(db, A), autoFlushMs: 10_000 })
  await engine.start(A)
  check('   la coda guest arriva nell\'account di A', db.rows('expenses').some((r) => r.user_id === A && r.description === 'CODA-GUEST'))
  check('   la riga storica NON parte finché non la si carica', !db.rows('expenses').some((r) => r.description === 'STORICA-GUEST'))
  const esitoMigrazione = await migrateLocalToCloud({ store, engine, userId: A })
  check('   migrazione esplicita: completata, con copia di sicurezza dell\'ambito di A', esitoMigrazione.migrated === true && /^spendy-backup-auto-u-/.test(esitoMigrazione.backupKey ?? ''), String(esitoMigrazione.backupKey))
  check('   la riga storica arriva sotto A', db.rows('expenses').some((r) => r.user_id === A && r.description === 'STORICA-GUEST'))
  engine.stop()

  // --- logout, poi il guest lavora ancora, poi entra un SECONDO account
  s().switchScope(GUEST)
  check('dopo il logout di A il guest è vuoto', isEmptyState(s()))
  s().addExpense({ amount: 6, categoryId: 'bar', description: 'GUEST-DOPO', date: s().today })
  s().switchScope(scopeFor(B))
  check('secondo account: NON adotta i dati guest', !s().expenses.some((e) => e.description === 'GUEST-DOPO') && isEmptyState(s()))
  check('   né vede quelli di A', mentions(s(), 'A').length === 0 && !s().expenses.some((e) => e.description === 'STORICA-GUEST' || e.description === 'CODA-GUEST'))
  check('   i dati guest restano dove sono', JSON.parse(map.get(stateKey(GUEST))).state.expenses.some((e) => e.description === 'GUEST-DOPO'))
  check('   il marcatore resta quello del primo account', map.get(GUEST_CLAIM_KEY) === A)
  s().switchScope(scopeFor(C))
  check('terzo account: niente adozione nemmeno per lui', isEmptyState(s()))
  s().switchScope(scopeFor(A))
  check('nemmeno il primo account adotta di nuovo i dati guest di dopo', !s().expenses.some((e) => e.description === 'GUEST-DOPO') && s().expenses.some((e) => e.description === 'STORICA-GUEST'))
  s().switchScope(GUEST)
  check('tornati guest: i dati guest sono ancora lì', s().expenses.some((e) => e.description === 'GUEST-DOPO'))
}
{
  // il primo account entra con il guest vuoto: niente da adottare, ma il posto "primo" è preso
  const map = new Map()
  const store = await bootDevice(map)
  store.getState().switchScope(scopeFor(A))
  check('guest vuoto: nessuna adozione, ma A risulta il primo account', map.get(GUEST_CLAIM_KEY) === A && ![...map.keys()].some((k) => k.includes(':adopted:')))
  store.getState().switchScope(GUEST)
  store.getState().addExpense({ amount: 1, categoryId: 'bar', description: 'GUEST-TARDI', date: store.getState().today })
  store.getState().switchScope(scopeFor(B))
  check('   e B non adotta i dati guest creati dopo', !store.getState().expenses.some((e) => e.description === 'GUEST-TARDI'))
}

{
  // Il guest adottato porta con sé dei cursori: non devono finire nell'account,
  // o il primo sync salterebbe tutte le righe più vecchie di quei timestamp.
  const map = new Map()
  const store = await bootDevice(map)
  const s = store.getState
  const db = createMemoryDatabase()
  db.upsert('expenses', [toRemoteRow('expenses', { id: 'e-cloud-a-1', amount: 70, categoryId: 'casa', description: 'CLOUD-A-VECCHIA', date: '2026-09-01', updatedAt: '2026-09-01T10:00:00.000Z' }, A)], A)
  const futuro = new Date(Date.now() + 3_600_000).toISOString()
  s().addExpense({ amount: 4, categoryId: 'bar', description: 'GUEST-CON-CURSORI', date: s().today })
  s().setSyncStatus({ cursors: { expenses: futuro, profiles: futuro } })
  const guestPrima = map.get(stateKey(GUEST))

  s().switchScope(scopeFor(A))
  check('adozione: i dati guest arrivano nell\'account', s().expenses.some((e) => e.description === 'GUEST-CON-CURSORI') && s().sync.outbox.length === 1)
  check('   ma i cursori del guest NO', Object.keys(s().sync.cursors).length === 0)
  check('   l\'archivio del guest resta identico (cursori compresi)', map.get([...map.keys()].find((k) => k.startsWith(`${stateKey(GUEST)}:adopted:`))) === guestPrima)

  const engine = createSyncEngine({ store, remote: createMemoryRemote(db, A), autoFlushMs: 10_000 })
  await engine.start(A)
  check('   il primo sync recupera anche le righe vecchie dell\'account', s().expenses.some((e) => e.description === 'CLOUD-A-VECCHIA'))
  check('   e la coda guest parte regolarmente', s().sync.outbox.length === 0 && db.rows('expenses').some((r) => r.user_id === A && r.description === 'GUEST-CON-CURSORI'))
  engine.stop()
}

// =====================================================================
section('Migrazione dal vecchio spendy-storage')
// =====================================================================
const legacyRaw = (userId) => JSON.stringify({
  state: {
    monthlyBudget: 1500, currency: '€', cycleStartDay: 5, amountHidden: true,
    expenses: [{ id: 'e-legacy-1', amount: 42, categoryId: 'spesa', description: 'LEGACY-SEGRETA', date: '2026-09-10', updatedAt: '2026-09-10T10:00:00.000Z' }],
    incomes: [], customCategories: [], goals: [], goalContributions: [], emergencyFundSaved: 0,
    emergencyFundContributions: [], spendyJokeHistory: [],
    sync: { userId, outbox: [], cursors: { expenses: '2026-09-10T10:00:00.000Z' }, lastSyncAt: '2026-09-10T10:00:00.000Z', migratedAt: '2026-09-10T10:00:00.000Z' },
  },
  version: 0,
})
const legacyVoice = JSON.stringify({ ...emptyVoiceCache(), lastShown: { message: 'frase-legacy', day: '2026-09-10' } })

{
  // con userId (come i dati dei dispositivi già in uso con un account)
  const U = 'utente-legacy-0009'
  const raw = legacyRaw(U)
  const map = new Map([[LEGACY_STATE_KEY, raw], ['spendy-ai-voice', legacyVoice]])
  const store = await bootDevice(map)
  const s = store.getState
  check('vecchio storage con userId: l\'app si apre sull\'account proprietario', s().scopeId === scopeFor(U) && s().sync.userId === U)
  check('   con tutti i suoi dati (spese, budget, preferenze, cursori)', s().expenses.length === 1 && s().monthlyBudget === 1500 && s().amountHidden === true && s().sync.cursors.expenses === '2026-09-10T10:00:00.000Z')
  check('   copiato nel contenitore v2 dell\'account, identico', map.get(stateKey(scopeFor(U))) === raw)
  check('   la cache di Spendy AI segue i dati', map.get(voiceKey(scopeFor(U))) === legacyVoice)
  check('   il vecchio spendy-storage è intatto, byte per byte', map.get(LEGACY_STATE_KEY) === raw)
  check('   la vecchia cache AI globale è intatta', map.get('spendy-ai-voice') === legacyVoice)
  check('   l\'adozione guest è già presa dal proprietario', map.get(GUEST_CLAIM_KEY) === U && map.get(ACTIVE_SCOPE_KEY) === scopeFor(U))
  check('   il guest è vuoto, niente dei dati dell\'account', !map.has(stateKey(GUEST)))
  check('   marcatore della migrazione scritto', JSON.parse(map.get(MIGRATION_KEY)).status === 'migrated')
  s().addExpense({ amount: 1, categoryId: 'bar', description: 'DOPO-LA-MIGRAZIONE', date: s().today })
  check('   le modifiche successive vanno nel contenitore v2, non nel vecchio', map.get(LEGACY_STATE_KEY) === raw && map.get(stateKey(scopeFor(U))).includes('DOPO-LA-MIGRAZIONE'))
  s().switchScope(GUEST)
  check('   dopo il logout nessun dato del vecchio storage è visibile (nemmeno quelli migrati)', isEmptyState(s()) && !JSON.stringify(s()).includes('LEGACY-SEGRETA'))
  s().switchScope(scopeFor('altro-account-0010'))
  check('   un altro account non vede niente di quei dati', isEmptyState(s()))
  check('   il vecchio spendy-storage è ancora intatto dopo tutto questo', map.get(LEGACY_STATE_KEY) === raw)

  // idempotente: riavviare l'app non rifà la migrazione e non perde le modifiche successive
  const marcatore = map.get(MIGRATION_KEY)
  const bucket = map.get(stateKey(scopeFor(U)))
  const riavviato = await bootDevice(map)
  check('migrazione idempotente: il riavvio non rifà niente', map.get(MIGRATION_KEY) === marcatore && map.get(stateKey(scopeFor(U))) === bucket)
  riavviato.getState().switchScope(scopeFor(U))
  check('   le modifiche successive non vengono ripristinate dal vecchio storage', riavviato.getState().expenses.some((e) => e.description === 'DOPO-LA-MIGRAZIONE'))
  const conMarcatoreRimosso = new Map(map)
  conMarcatoreRimosso.delete(MIGRATION_KEY)
  await bootDevice(conMarcatoreRimosso)
  check('   anche senza marcatore il contenitore v2 esistente non viene sovrascritto', conMarcatoreRimosso.get(stateKey(scopeFor(U))) === bucket)
}
{
  // senza userId (chi non ha mai fatto login)
  const raw = legacyRaw(null)
  const map = new Map([[LEGACY_STATE_KEY, raw]])
  const store = await bootDevice(map)
  const s = store.getState
  check('vecchio storage senza userId: l\'app si apre come guest, con i suoi dati', s().scopeId === GUEST && s().expenses.length === 1 && s().monthlyBudget === 1500)
  check('   copiato nel guest v2, identico', map.get(stateKey(GUEST)) === raw)
  check('   il vecchio storage è intatto', map.get(LEGACY_STATE_KEY) === raw)
  check('   nessun account ha ancora preso il posto di "primo"', !map.has(GUEST_CLAIM_KEY))
  s().switchScope(scopeFor(A))
  check('   il primo account che entra li adotta (come prima del cambiamento)', s().expenses.some((e) => e.description === 'LEGACY-SEGRETA') && map.get(GUEST_CLAIM_KEY) === A)
  check('   il vecchio storage resta intatto anche dopo l\'adozione', map.get(LEGACY_STATE_KEY) === raw)
}
{
  // contenitore v2 già esistente: non si sovrascrive mai
  const U = 'utente-legacy-0011'
  const raw = legacyRaw(U)
  const esistente = JSON.stringify({ state: { expenses: [{ id: 'e-v2', amount: 9, categoryId: 'bar', description: 'V2-ESISTENTE', date: '2026-09-20', updatedAt: '2026-09-20T10:00:00.000Z' }], sync: { userId: U } }, version: 0 })
  const map = new Map([[LEGACY_STATE_KEY, raw], [stateKey(scopeFor(U)), esistente]])
  const store = await bootDevice(map)
  check('contenitore v2 già esistente: non viene sovrascritto', map.get(stateKey(scopeFor(U))) === esistente)
  check('   il vecchio storage è intatto', map.get(LEGACY_STATE_KEY) === raw)
  check('   l\'app si apre sui dati v2 del proprietario, non su quelli vecchi', store.getState().scopeId === scopeFor(U) && store.getState().expenses.some((e) => e.description === 'V2-ESISTENTE') && !store.getState().expenses.some((e) => e.description === 'LEGACY-SEGRETA'))
  check('   marcatore: v2 già esistente', JSON.parse(map.get(MIGRATION_KEY)).status === 'v2-already-exists')
}
{
  // JSON corrotto: niente si cancella, niente si rompe
  const map = new Map([[LEGACY_STATE_KEY, '{questo non è json']])
  const store = await bootDevice(map)
  check('vecchio storage corrotto: l\'app parte vuota, senza errori', store.getState().scopeId === GUEST && isEmptyState(store.getState()))
  check('   il vecchio dato NON è stato cancellato né toccato', map.get(LEGACY_STATE_KEY) === '{questo non è json')
  check('   marcatore: corrotto, niente da ritentare a ogni avvio', JSON.parse(map.get(MIGRATION_KEY)).status === 'legacy-corrupt')
  store.getState().addExpense({ amount: 1, categoryId: 'bar', description: 'NUOVA', date: store.getState().today })
  check('   l\'app funziona e salva nel suo contenitore, lasciando il vecchio com\'è', map.get(LEGACY_STATE_KEY) === '{questo non è json' && map.get(stateKey(GUEST)).includes('NUOVA'))

  const riconoscibile = new Map([[LEGACY_STATE_KEY, '{"x":1}']])
  await bootDevice(riconoscibile)
  check('vecchio storage di forma sconosciuta: intatto e segnato', riconoscibile.get(LEGACY_STATE_KEY) === '{"x":1}' && JSON.parse(riconoscibile.get(MIGRATION_KEY)).status === 'legacy-unrecognized')

  // un contenitore v2 corrotto: si conserva una copia prima che venga riscritto
  const corrotto = new Map([[stateKey(GUEST), '{corrotto'], [MIGRATION_KEY, '{"status":"x"}']])
  const s2 = await bootDevice(corrotto)
  check('contenitore v2 corrotto: l\'app parte vuota', isEmptyState(s2.getState()))
  check('   con una copia del dato originale messa da parte', [...corrotto].some(([k, v]) => k.startsWith(`${stateKey(GUEST)}:corrupt:`) && v === '{corrotto'))
}
{
  // storage non disponibile: niente errori, si lavora in memoria
  Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true })
  const { useAppStore } = await import(`./useAppStore.js?scope-test=${(boots += 1)}`)
  useAppStore.getState().addExpense({ amount: 1, categoryId: 'bar', description: 'IN-MEMORIA', date: useAppStore.getState().today })
  useAppStore.getState().switchScope(scopeFor(A))
  check('senza localStorage: nessun errore, si lavora in memoria e il cambio ambito funziona', useAppStore.getState().scopeId === scopeFor(A) && useAppStore.getState().expenses.length === 0)
}

// =====================================================================
section('Coerenza dello stato per ambito')
// =====================================================================
{
  const map = new Map()
  const store = await bootDevice(map)
  const { emptyScopeState } = await import(`./useAppStore.js?scope-test=${boots}`)
  store.getState().addExpense({ amount: 1, categoryId: 'bar', description: 'x', date: store.getState().today })
  const persistito = JSON.parse(map.get(stateKey(GUEST))).state
  const vuoto = emptyScopeState()
  check('i campi da svuotare al cambio ambito sono esattamente quelli persistiti',
    JSON.stringify(Object.keys(persistito).sort()) === JSON.stringify(Object.keys(vuoto).sort()),
    `${Object.keys(persistito).sort()} ≠ ${Object.keys(vuoto).sort()}`)
  const nuovo = await bootDevice(new Map())
  const iniziale = Object.fromEntries(Object.keys(vuoto).map((k) => [k, nuovo.getState()[k]]))
  check('e ai valori di un avvio pulito', JSON.stringify(iniziale) === JSON.stringify(vuoto))
  check('due chiamate a emptyScopeState non condividono gli array', emptyScopeState().expenses !== emptyScopeState().expenses && emptyScopeState().sync.outbox !== emptyScopeState().sync.outbox)
}

report('Isolamento account')
