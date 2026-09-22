// Regression test del layer di sincronizzazione.
// `npm test`, senza browser, senza rete, senza un progetto Supabase: il
// database finto (memoryRemote.mjs) applica le stesse regole del vero —
// RLS, trigger last-write-wins, updated_at del server, numeric come
// stringhe. Ogni dato qui dentro è inventato.

import { check, section, report, installFakeLocalStorage } from './testkit.mjs'
import { createMemoryDatabase, createMemoryRemote } from './memoryRemote.mjs'
import { createSyncEngine, cursorFrom, EPOCH } from './syncEngine.js'
import { migrationStatus, migrateLocalToCloud, MIGRATION_STAMP } from './migrateLocal.js'
import { totalForMonth, buildFinancialData } from '../utils/budgetCalculations.js'

const USER = 'utente-test-0001'
const ALTRO_USER = 'utente-estraneo-9999'

// Ogni "dispositivo" è un'istanza indipendente dello store vero: si
// ottiene importando il modulo con una query diversa, così Node non
// riusa la copia in cache. Niente finzioni: sono le stesse azioni che
// chiamano QuickAddScreen, EditExpenseModal e le altre schermate.
async function createDevice(name, { userId = USER, online = true } = {}) {
  installFakeLocalStorage()
  const { useAppStore } = await import(`../store/useAppStore.js?device=${name}`)
  const remote = createMemoryRemote(db, userId, { online })
  const engine = createSyncEngine({ store: useAppStore, remote, autoFlushMs: 10_000 })
  useAppStore.getState().setSyncUser(userId)
  return { name, store: useAppStore, remote, engine, state: () => useAppStore.getState() }
}

const db = createMemoryDatabase()

// =====================================================================
section('1. Push — nessuna perdita, nessun duplicato, idempotenza')
// =====================================================================
const mac = await createDevice('mac')

mac.state().addExpense({ amount: 25, categoryId: 'ristoranti', description: 'Pizza', date: '2026-09-19' })
mac.state().addExpense({ amount: 60.5, categoryId: 'spesa', description: 'Supermercato', date: '2026-09-18' })
mac.state().addExpense({ amount: 12, categoryId: 'bar', description: 'Caffe', date: '2026-09-17' })

check('le 3 spese sono subito nello store (UI immediata)', mac.state().expenses.length === 3)
check('3 operazioni in coda', mac.state().sync.outbox.length === 3)
check('gli id sono UUID, non timestamp', mac.state().expenses.every((e) => /^e-[0-9a-f]{8}-/.test(e.id)))

await mac.engine.syncNow()
check('3 righe sul cloud', db.rows('expenses').length === 3)
check('coda svuotata dopo la conferma', mac.state().sync.outbox.length === 0)

await mac.engine.syncNow()
await mac.engine.syncNow()
check('sync ripetuti: ancora 3 righe, nessun duplicato', db.rows('expenses').length === 3)
check('nessuna spesa persa in locale', mac.state().expenses.length === 3)

// =====================================================================
section('2. Samsung ↔ Mac — sincronizzazione nei due sensi')
// =====================================================================
const samsung = await createDevice('samsung')
await samsung.engine.syncNow()

check('il Samsung vede le 3 spese del Mac', samsung.state().expenses.length === 3)
check('gli importi sono NUMERI, non stringhe', samsung.state().expenses.every((e) => typeof e.amount === 'number'))
check('importo esatto (60.5 non "60.50")', samsung.state().expenses.some((e) => e.amount === 60.5))

samsung.state().addExpense({ amount: 25, categoryId: 'ristoranti', description: 'Ristorante', date: '2026-09-20' })
await samsung.engine.syncNow()
await mac.engine.syncNow()
check('il Mac riceve la spesa inserita dal Samsung', mac.state().expenses.some((e) => e.description === 'Ristorante' && e.amount === 25))

mac.state().addIncome({ amount: 200, categoryId: 'extra', description: 'Extra', date: '2026-09-15' })
await mac.engine.syncNow()
await samsung.engine.syncNow()
check('il Samsung riceve l\'entrata inserita dal Mac', samsung.state().incomes.some((i) => i.amount === 200))

check('stesso numero di spese sui due dispositivi', mac.state().expenses.length === samsung.state().expenses.length)
check('stessi id sui due dispositivi', JSON.stringify(mac.state().expenses.map((e) => e.id).sort()) === JSON.stringify(samsung.state().expenses.map((e) => e.id).sort()))

// =====================================================================
section('3. Le engine continuano a funzionare sui dati arrivati dal cloud')
// =====================================================================
const totale = totalForMonth(samsung.state().expenses, '2026-09-20', 1)
check('totalForMonth calcola 122.5 sui dati sincronizzati', totale === 122.5, String(totale))
const financial = buildFinancialData({
  today: '2026-09-20', monthlyBudget: 1800, expenses: samsung.state().expenses,
  incomes: samsung.state().incomes, goals: [], cycleStartDay: 1,
})
check('buildFinancialData produce numeri sensati', financial.spentThisMonth === 122.5 && financial.available === 1877.5)

// =====================================================================
section('4. Offline — inserisco, vedo subito, si sincronizza dopo')
// =====================================================================
samsung.remote.setOnline(false)
const primaDellOffline = db.rows('expenses').length

samsung.state().addExpense({ amount: 8, categoryId: 'bar', description: 'Spesa offline 1', date: '2026-09-20' })
samsung.state().addExpense({ amount: 15, categoryId: 'svago', description: 'Spesa offline 2', date: '2026-09-20' })

check('le spese offline si vedono subito', samsung.state().expenses.filter((e) => e.description.startsWith('Spesa offline')).length === 2)
check('2 operazioni in attesa nella coda', samsung.state().sync.outbox.length === 2)

await samsung.engine.syncNow()
check('offline: il cloud non è cambiato', db.rows('expenses').length === primaDellOffline)
check('offline: la coda NON si svuota', samsung.state().sync.outbox.length === 2)
check('offline: niente è andato perso in locale', samsung.state().expenses.filter((e) => e.description.startsWith('Spesa offline')).length === 2)

samsung.remote.setOnline(true)
await samsung.engine.syncNow()
check('tornata la rete: coda svuotata', samsung.state().sync.outbox.length === 0)
check('tornata la rete: le 2 spese sono sul cloud', db.rows('expenses').length === primaDellOffline + 2)

await mac.engine.syncNow()
check('il Mac riceve le spese fatte offline dal Samsung', mac.state().expenses.filter((e) => e.description.startsWith('Spesa offline')).length === 2)

// La coda sopravvive a un riavvio? È persistita nel blob dello store.
samsung.remote.setOnline(false)
samsung.state().addExpense({ amount: 3, categoryId: 'bar', description: 'Prima di chiudere', date: '2026-09-20' })
const blobSalvato = JSON.parse(globalThis.localStorage.getItem('spendy-storage'))
check('la coda è dentro lo stato persistito (sopravvive al riavvio)', blobSalvato.state.sync.outbox.length === 1)
check('status/error NON sono persistiti (sono transienti)', blobSalvato.state.sync.status === undefined)
samsung.remote.setOnline(true)
await samsung.engine.syncNow()
check('dopo il riavvio simulato la spesa parte lo stesso', db.rows('expenses').some((r) => r.description === 'Prima di chiudere'))

// =====================================================================
section('5. Cancellazioni — si propagano e non tornano indietro')
// =====================================================================
await mac.engine.syncNow()
const daCancellare = mac.state().expenses.find((e) => e.description === 'Caffe')
mac.state().deleteExpense(daCancellare.id)

check('sparita subito dall\'array locale (le engine non la contano più)', !mac.state().expenses.some((e) => e.id === daCancellare.id))
await mac.engine.syncNow()
const rigaCancellata = db.rows('expenses').find((r) => r.id === daCancellare.id)
check('sul cloud la riga esiste ancora ma con deleted_at (soft delete)', !!rigaCancellata && !!rigaCancellata.deleted_at)

await samsung.engine.syncNow()
check('il Samsung la rimuove a sua volta', !samsung.state().expenses.some((e) => e.id === daCancellare.id))
await samsung.engine.syncNow()
await samsung.engine.syncNow()
check('pull successivi NON la fanno resuscitare', !samsung.state().expenses.some((e) => e.id === daCancellare.id))

// Creata e cancellata mentre si è offline: non è mai esistita sul server.
samsung.remote.setOnline(false)
samsung.state().addExpense({ amount: 99, categoryId: 'altro', description: 'Nata e morta offline', date: '2026-09-20' })
const effimera = samsung.state().expenses.find((e) => e.description === 'Nata e morta offline')
samsung.state().deleteExpense(effimera.id)
check('coda: una sola operazione per quella riga (create+delete accorpati)', samsung.state().sync.outbox.filter((op) => op.rowId === effimera.id).length === 1)
samsung.remote.setOnline(true)
await samsung.engine.syncNow()
await mac.engine.syncNow()
check('non compare viva su nessun dispositivo', !mac.state().expenses.some((e) => e.id === effimera.id))

// =====================================================================
section('6. Conflitti — vince la modifica più recente, sempre')
// =====================================================================
await mac.engine.syncNow()
await samsung.engine.syncNow()
const contesa = mac.state().expenses.find((e) => e.description === 'Pizza')

mac.remote.setOnline(false)
samsung.remote.setOnline(false)
mac.state().editExpense(contesa.id, { amount: 30 })       // modifica più vecchia
await new Promise((r) => setTimeout(r, 5))
samsung.state().editExpense(contesa.id, { amount: 45 })    // modifica più recente

mac.remote.setOnline(true)
samsung.remote.setOnline(true)
// Il device con la modifica PIÙ RECENTE invia per primo: il trigger LWW
// deve impedire a quella più vecchia di sovrascriverla.
await samsung.engine.syncNow()
await mac.engine.syncNow()
check('sul cloud resta 45 (la modifica più recente)', Number(db.rows('expenses').find((r) => r.id === contesa.id).amount) === 45)

await mac.engine.syncNow()
check('il Mac si allinea a 45, la sua modifica vecchia non vince', mac.state().expenses.find((e) => e.id === contesa.id).amount === 45)

// Una modifica locale in attesa non viene schiacciata da un pull.
mac.remote.setOnline(false)
mac.state().editExpense(contesa.id, { amount: 77 })
mac.remote.setOnline(true)
await mac.engine.pullAll()
check('il pull NON cancella la modifica locale ancora in coda', mac.state().expenses.find((e) => e.id === contesa.id).amount === 77)
await mac.engine.syncNow()
await samsung.engine.syncNow()
check('poi 77 arriva regolarmente sull\'altro dispositivo', samsung.state().expenses.find((e) => e.id === contesa.id).amount === 77)

// =====================================================================
section('7. Versamenti sugli obiettivi — due device, zero soldi persi')
// =====================================================================
mac.state().addGoal({ emoji: '🎯', label: 'Vacanza', target: 1500, saved: 100, etaMonths: 6 })
const obiettivo = mac.state().goals[0]
check('l\'importo iniziale è diventato un versamento, non un campo', mac.state().goalContributions.length === 1)
check('saved derivato = 100', obiettivo.saved === 100)

await mac.engine.syncNow()
await samsung.engine.syncNow()
check('il Samsung vede l\'obiettivo con saved 100', samsung.state().goals[0]?.saved === 100)

// Il test che giustifica tutta la tabella goal_contributions:
// due versamenti contemporanei da due dispositivi offline.
mac.remote.setOnline(false)
samsung.remote.setOnline(false)
mac.state().contributeToGoal(obiettivo.id, 50)
samsung.state().contributeToGoal(obiettivo.id, 30)
mac.remote.setOnline(true)
samsung.remote.setOnline(true)
await mac.engine.syncNow()
await samsung.engine.syncNow()
await mac.engine.syncNow()

check('Mac: 100 + 50 + 30 = 180 (nessun versamento perso)', mac.state().goals[0].saved === 180, String(mac.state().goals[0].saved))
check('Samsung: stesso totale 180', samsung.state().goals[0].saved === 180, String(samsung.state().goals[0].saved))
check('3 versamenti distinti, nessuno sovrascritto', mac.state().goalContributions.length === 3)

mac.state().deleteGoal(obiettivo.id)
await mac.engine.syncNow()
await samsung.engine.syncNow()
check('cancellando l\'obiettivo spariscono anche i suoi versamenti', samsung.state().goals.length === 0 && samsung.state().goalContributions.length === 0)

// =====================================================================
section('8. Categorie personalizzate — arrivano e sono riconosciute')
// =====================================================================
mac.state().addCustomCategory({ label: 'Barbiere', emoji: '💈', type: 'expense' })
const categoria = mac.state().customCategories[0]
mac.state().addExpense({ amount: 20, categoryId: categoria.id, description: 'Taglio', date: '2026-09-20' })
await mac.engine.syncNow()
await samsung.engine.syncNow()

check('la categoria arriva sull\'altro dispositivo', samsung.state().customCategories.some((c) => c.label === 'Barbiere'))
// applyRemote deve aver richiamato registerCustomCategories: senza,
// la spesa che usa questa categoria verrebbe disegnata come "Altro".
// (In Node il registro di categories.js e' condiviso fra le copie dello
// store, quindi si verifica su quello: nell'app c'e' un dispositivo per
// processo e la condizione e' la stessa.)
const { getCategory } = await import('../data/categories.js')
check('ed è REGISTRATA: la spesa non finisce in "Altro"', getCategory(categoria.id).label === 'Barbiere')
check('emoji conservata', getCategory(categoria.id).emoji === '💈')

mac.state().togglePinCategory(categoria.id)
await mac.engine.syncNow()
await samsung.engine.syncNow()
check('il pin si sincronizza', samsung.state().customCategories.find((c) => c.id === categoria.id).pinned === true)

// =====================================================================
section('9. Impostazioni (stipendio, ciclo) e preferenze locali')
// =====================================================================
mac.state().setMonthlyBudget(1800, '2026-09-27')
await mac.engine.syncNow()
await samsung.engine.syncNow()
check('lo stipendio arriva sull\'altro dispositivo', samsung.state().monthlyBudget === 1800)
check('e con esso il giorno di inizio ciclo', samsung.state().cycleStartDay === 27)

samsung.state().toggleAmountHidden()
const codaDopoToggle = samsung.state().sync.outbox.length
check('"nascondi importi" NON crea traffico: resta locale', codaDopoToggle === 0)
await samsung.engine.syncNow()
await mac.engine.syncNow()
check('e non si propaga all\'altro dispositivo', mac.state().amountHidden === false)

// =====================================================================
section('10. RLS — i dati di un altro utente non si vedono e non si scrivono')
// =====================================================================
const estraneo = await createDevice('estraneo', { userId: ALTRO_USER })
await estraneo.engine.syncNow()
check('un altro utente non vede nessuna spesa', estraneo.state().expenses.length === 0)
check('né obiettivi, né categorie, né entrate', estraneo.state().goals.length === 0 && estraneo.state().customCategories.length === 0 && estraneo.state().incomes.length === 0)

const scritturaAbusiva = db.upsert('expenses', [{ id: 'furto', user_id: USER, amount: 1, date: '2026-09-20' }], ALTRO_USER)
check('scrivere su righe altrui viene rifiutato', !!scritturaAbusiva.error)
check('e non lascia traccia', !db.rows('expenses').some((r) => r.id === 'furto'))

// =====================================================================
section('11. Un dispositivo VUOTO non può azzerare il cloud')
// =====================================================================
const righePrima = db.rows('expenses').length
const upsertPrima = db.countCalls.upsert
const nuovo = await createDevice('nuovo-telefono')

check('parte davvero vuoto', nuovo.state().expenses.length === 0 && nuovo.state().sync.outbox.length === 0)
const stato = migrationStatus(nuovo.state(), USER)
check('migrazione: "niente da caricare", non parte', stato.needed === false && stato.reason === 'nothing-local')

await nuovo.engine.syncNow()
check('nessuna scrittura inviata al cloud', db.countCalls.upsert === upsertPrima)
check('il cloud ha ancora tutte le righe', db.rows('expenses').length === righePrima)
check('ed è il dispositivo nuovo a riempirsi', nuovo.state().expenses.length > 0)
check('con lo stipendio corretto', nuovo.state().monthlyBudget === 1800)

// Il dispositivo ora e' pieno, ma solo di righe ARRIVATE dal cloud
// (hanno tutte un updatedAt). Premere "migra" non deve rispedirle su.
const upsertPrimaDiForzare = db.countCalls.upsert
const forzata = await migrateLocalToCloud({ store: nuovo.store, engine: nuovo.engine, userId: USER })
check('forzare la migrazione su un device riempito dal cloud: non fa nulla', forzata.migrated === false)
check('nessuna ri-scrittura inutile di tutto il database', db.countCalls.upsert === upsertPrimaDiForzare)
check('e il cloud resta intatto', db.rows('expenses').length === righePrima)

// =====================================================================
section('12. Migrazione dei dati storici di localStorage')
// =====================================================================
// Blob "vecchio stile": id da Date.now, nessun updatedAt, nessuna coda,
// obiettivo con `saved` e senza storico dei versamenti.
installFakeLocalStorage({
  state: {
    monthlyBudget: 1500, currency: '€', cycleStartDay: 5, amountHidden: false,
    expenses: [
      { id: 'e-1789123456789', amount: 42, categoryId: 'spesa', description: 'Storica 1', date: '2026-09-10' },
      { id: 'e-1789123456790', amount: 18, categoryId: 'bar', description: 'Storica 2', date: '2026-09-11' },
    ],
    incomes: [{ id: 'i-1789123456791', amount: 90, categoryId: 'regalo', description: 'Regalo', date: '2026-09-09' }],
    customCategories: [],
    goals: [{ id: 'g-1789123456792', emoji: '🎯', label: 'Auto', saved: 700, target: 5000, etaMonths: 12 }],
    emergencyFundSaved: 250,
    emergencyFundContributions: [{ id: 'ef-1789123456793', amount: 250, date: '2026-09-01' }],
    spendyJokeHistory: [],
  },
  version: 0,
})
const { useAppStore: storico } = await import('../store/useAppStore.js?device=storico')
const remotoStorico = createMemoryRemote(db, 'utente-storico-0002', {})
const engineStorico = createSyncEngine({ store: storico, remote: remotoStorico, autoFlushMs: 10_000 })
storico.getState().setSyncUser('utente-storico-0002')

check('i dati storici si sono caricati', storico.getState().expenses.length === 2)
check('l\'obiettivo ha conservato saved = 700', storico.getState().goals[0].saved === 700)
check('ed è nato il suo versamento legacy', storico.getState().goalContributions.length === 1 && storico.getState().goalContributions[0].id === 'gc-legacy-g-1789123456792')
check('nessuna operazione in coda per la sola rilettura', storico.getState().sync.outbox.length === 0)

const statoMigrazione = migrationStatus(storico.getState(), 'utente-storico-0002')
check('la migrazione risulta necessaria', statoMigrazione.needed === true)
check('e conta le righe giuste (2 spese + 1 entrata + 1 obiettivo + 1 versamento + 1 fondo)', statoMigrazione.total === 6, String(statoMigrazione.total))

const esito = await migrateLocalToCloud({ store: storico, engine: engineStorico, userId: 'utente-storico-0002' })
check('migrazione completata', esito.migrated === true)
check('backup automatico creato prima di toccare qualunque cosa', !!esito.backupKey)
check('lo storage originale NON è stato cancellato', globalThis.localStorage.getItem('spendy-storage') !== null)
check('le spese storiche sono sul cloud con il loro id originale', db.rows('expenses').some((r) => r.id === 'e-1789123456789'))
check('timbrate come le più vecchie di tutte (non schiacciano nulla)', db.rows('expenses').find((r) => r.id === 'e-1789123456789').client_updated_at === MIGRATION_STAMP)
check('coda svuotata', storico.getState().sync.outbox.length === 0)

const righeUtenteStorico = db.rows('expenses').filter((r) => r.user_id === 'utente-storico-0002').length
const esito2 = await migrateLocalToCloud({ store: storico, engine: engineStorico, userId: 'utente-storico-0002' })
check('rilanciare la migrazione non fa nulla', esito2.migrated === false && esito2.reason === 'already-migrated')
check('e non duplica nemmeno una riga', db.rows('expenses').filter((r) => r.user_id === 'utente-storico-0002').length === righeUtenteStorico)

// =====================================================================
section('13. Pull incrementale e cursori')
// =====================================================================
check('cursorFrom torna indietro di 1s per non saltare righe a cavallo',
  cursorFrom([{ updated_at: '2026-09-20T10:00:10.000Z' }], EPOCH) === '2026-09-20T10:00:09.000Z')
check('senza righe il cursore non si muove', cursorFrom([], '2026-09-20T10:00:00.000Z') === '2026-09-20T10:00:00.000Z')

await mac.engine.pullAll()
const speseDopoPrimoPull = mac.state().expenses.length
const pullPrima = db.countCalls.pull
await mac.engine.pullAll()
check('ogni pull interroga tutte e 7 le tabelle', db.countCalls.pull - pullPrima === 7, String(db.countCalls.pull - pullPrima))
// La sovrapposizione di 1 secondo fa riscaricare qualche riga: e'
// voluto. Cio' che conta e' che riapplicarla non cambi niente.
check('ripullare non duplica nulla', mac.state().expenses.length === speseDopoPrimoPull)
check('e non altera gli importi', mac.state().expenses.every((e) => typeof e.amount === 'number'))

// La migrazione ha portato su anche stipendio e giorno di ciclo?
check('le impostazioni storiche sono arrivate sul cloud', db.rows('profiles').some((r) => Number(r.monthly_budget) === 1500))

// =====================================================================
section('14. Realtime — il Mac aperto vede comparire la spesa del Samsung')
// =====================================================================
const macLive = await createDevice('mac-live')
macLive.remote.enableRealtime()
await macLive.engine.start(USER)
const primaDelRealtime = macLive.state().expenses.length

samsung.state().addExpense({ amount: 7, categoryId: 'bar', description: 'Arrivata in realtime', date: '2026-09-20' })
await samsung.engine.syncNow()
await new Promise((r) => setTimeout(r, 20))

check('comparsa senza aver fatto un pull', macLive.state().expenses.length === primaDelRealtime + 1)
check('con i dati giusti', macLive.state().expenses.some((e) => e.description === 'Arrivata in realtime' && e.amount === 7))
macLive.engine.stop()

// =====================================================================
section('15. Cambio account sullo stesso dispositivo')
// =====================================================================
const condiviso = await createDevice('dispositivo-condiviso')
condiviso.state().addExpense({ amount: 55, categoryId: 'casa', description: 'Del primo utente', date: '2026-09-20' })
check('una modifica del primo utente resta in coda', condiviso.state().sync.outbox.length === 1)

const esitoCambio = await condiviso.engine.start(ALTRO_USER)
check('il sync NON parte con un altro account', esitoCambio.skipped === 'coda-di-un-altro-utente')
check('e lo dice chiaramente', condiviso.state().sync.status === 'error' && condiviso.state().sync.error.includes('account precedente'))
check('la coda resta intatta, niente e\' andato perso', condiviso.state().sync.outbox.length === 1)
check('e NON e\' finita nell\'account dell\'altro utente',
  !db.rows('expenses').some((r) => r.user_id === ALTRO_USER && r.description === 'Del primo utente'))

// Rientrando con l'account giusto la coda si svuota regolarmente.
await condiviso.engine.start(USER)
check('con l\'account originale il sync riparte', condiviso.state().sync.outbox.length === 0)
check('e la spesa arriva nell\'account giusto',
  db.rows('expenses').some((r) => r.user_id === USER && r.description === 'Del primo utente'))
condiviso.engine.stop()

report('sync')
