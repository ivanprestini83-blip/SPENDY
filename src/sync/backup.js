import { todayStr } from '../utils/date.js'

// Fase 0 del passaggio al cloud: export/import di tutto lo stato
// persistito, in un JSON leggibile da un umano.
//
// Esiste PRIMA di qualsiasi riga di sincronizzazione, per una ragione
// concreta: finché i dati vivono solo in localStorage sono legati
// all'ORIGINE del browser (schema + host + porta). Un IP di rete
// riassegnato dal router, o una porta diversa del dev server, fanno
// "sparire" tutte le transazioni senza che nulla sia stato cancellato —
// sono semplicemente in un altro cassetto. Questo file è la via d'uscita
// da quella situazione (esporto dalla vecchia origine, importo nella
// nuova) ed è la rete di sicurezza di ogni fase successiva: si esporta
// prima di migrare, sempre.
//
// Regola non negoziabile di questo modulo: NON scrive mai sullo stato
// dell'app (né sul vecchio 'spendy-storage', né sui contenitori per ambito
// 'spendy-storage-v2:…': ci pensa zustand persist) e non cancella mai niente.
// Gli unici write che fa sono su chiavi nuove, con un prefisso tutto suo.

export const BACKUP_VERSION = 1
export const STORAGE_KEY = 'spendy-storage'
export const AUTO_BACKUP_PREFIX = 'spendy-backup-auto-'

// Le collezioni di righe: hanno un `id` per elemento, quindi si possono
// unire tra due dispositivi/origini senza creare duplicati.
export const COLLECTION_FIELDS = [
  'expenses',
  'incomes',
  'goals',
  'goalContributions',
  'customCategories',
  'emergencyFundContributions',
]

// Le impostazioni: valori singoli, non uniscibili riga per riga (vedi
// mergeScalar più sotto per come vengono trattate in import).
export const SCALAR_FIELDS = ['monthlyBudget', 'currency', 'cycleStartDay', 'amountHidden']

export const FIELD_LABELS = {
  expenses: 'Spese',
  incomes: 'Entrate extra',
  goals: 'Obiettivi',
  goalContributions: 'Versamenti sugli obiettivi',
  customCategories: 'Categorie personalizzate',
  emergencyFundContributions: 'Versamenti fondo emergenza',
}

// Volutamente ESCLUSI dall'export:
//  - today / activeTab / modal / modalPayload: stato transiente, non è
//    mai stato nemmeno persistito (vedi il partialize dello store);
//  - spendyJokeHistory: contabilità anti-ripetizione delle battute, per
//    dispositivo. È capped a 50 voci che si rigenerano da sole, non è
//    un dato che l'utente si accorgerebbe di aver perso.

// ---------------------------------------------------------------- export

// `emergencyFundSaved` viene incluso anche se è derivabile (è la somma
// dei contributi): serve a rendere il file leggibile senza fare la somma
// a mente. In import NON viene mai creduto sulla parola — si ricalcola.
export function getSnapshot(state) {
  const snapshot = {}
  for (const field of [...COLLECTION_FIELDS, ...SCALAR_FIELDS]) snapshot[field] = state[field]
  snapshot.emergencyFundSaved = state.emergencyFundSaved
  return snapshot
}

export function countRows(snapshot) {
  const counts = {}
  for (const field of COLLECTION_FIELDS) counts[field] = (snapshot[field] ?? []).length
  return counts
}

export function buildBackup(state) {
  const data = getSnapshot(state)
  return {
    app: 'spendy',
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    // Annotare l'origine serve davvero: se un domani ci si ritrova con
    // due backup e non si sa quale venga dal dispositivo giusto, questa
    // riga lo dice ("http://192.168.1.101:5173" vs "http://localhost:5173").
    exportedFrom: typeof window !== 'undefined' ? (window.location?.origin ?? null) : null,
    counts: countRows(data),
    data,
  }
}

export function serializeBackup(backup) {
  return JSON.stringify(backup, null, 2)
}

export function backupFilename(date = todayStr()) {
  const time = new Date().toTimeString().slice(0, 5).replace(':', '')
  return `spendy-backup-${date}-${time}.json`
}

// Scarica il JSON come file. Un <a download> con un blob URL: funziona
// su Safari desktop, su Chrome Android e nella webview di un'eventuale
// PWA installata, senza dipendenze.
export function downloadBackup(state) {
  const backup = buildBackup(state)
  const blob = new Blob([serializeBackup(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = backupFilename()
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  return backup
}

// Copia di sicurezza dello stato corrente su una chiave NUOVA, presa
// appena prima di applicare un import o una migrazione. Non tocca lo stato
// dell'app: se l'operazione si rivelasse sbagliata, lo stato di partenza è
// ancora lì, recuperabile dalla console con
//   JSON.parse(localStorage.getItem('<chiave>'))
// e reimportabile da questa stessa schermata. Il nome della chiave contiene
// l'ambito (guest o account, vedi store/scope.js): la copia di un account non
// si confonde con quella di un altro.
export function saveAutoBackup(state) {
  const scope = String(state.scopeId ?? 'guest').replace(/[^A-Za-z0-9_-]+/g, '-')
  const key = `${AUTO_BACKUP_PREFIX}${scope}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    window.localStorage.setItem(key, serializeBackup(buildBackup(state)))
    return key
  } catch {
    // Quota piena o storage bloccato (Safari in navigazione privata):
    // l'import può comunque proseguire, ma chi chiama deve poterlo dire
    // all'utente invece di far finta di avere un backup che non c'è.
    return null
  }
}

export function listAutoBackups() {
  try {
    return Object.keys(window.localStorage)
      .filter((key) => key.startsWith(AUTO_BACKUP_PREFIX))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

// ---------------------------------------------------------- parsing/pulizia

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isDateStr = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

// Accetta sia 12.5 che "12,50": un backup scritto o corretto a mano da
// un umano italiano è un caso reale, non un'ipotesi.
function toNumber(value) {
  const parsed = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : value
  return Number.isFinite(parsed) ? parsed : null
}

// Un id mancante non fa buttare via la riga: se ne costruisce uno
// DETERMINISTICO dal contenuto. Deterministico è la parola chiave —
// reimportare due volte lo stesso file in modalità "unisci" non può
// creare doppioni, perché la seconda volta ricalcola lo stesso id.
//
// Volutamente NON entra la posizione della riga nel file: basterebbe
// cancellare una spesa e riesportare perché tutte le successive slittino
// di uno, cambiando id, e al reimport diventassero righe "nuove" da
// aggiungere. Entra invece un contatore delle righe con contenuto
// identico, perché due caffè da 2 € nello stesso giorno sono due spese
// vere e devono restare due.
function makeIdFactory(prefix) {
  const seen = new Map()
  return (parts) => {
    const key = parts.join('|')
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    return `${prefix}-import-${key}${occurrence > 0 ? `-${occurrence}` : ''}`
  }
}

// Ogni sanitize* restituisce la riga ripulita oppure null se il dato è
// irrecuperabile (importo non numerico). Le riparazioni minori vengono
// annotate in `warnings` e mostrate all'utente: preferisco dirgli "3
// righe avevano la data mancante, ho messo oggi" piuttosto che
// scartarle in silenzio o fingere che fosse tutto a posto.
function sanitizeTransaction(row, index, prefix, warnings, fallbackDate, assignId) {
  if (!isPlainObject(row)) return null
  const amount = toNumber(row.amount)
  if (amount === null) {
    warnings.push(`${prefix === 'e' ? 'Spesa' : 'Entrata'} #${index + 1}: importo non valido, riga ignorata`)
    return null
  }
  let date = row.date
  if (!isDateStr(date)) {
    date = fallbackDate
    warnings.push(`${prefix === 'e' ? 'Spesa' : 'Entrata'} #${index + 1}: data mancante, impostata al ${date}`)
  }
  return {
    id: typeof row.id === 'string' && row.id ? row.id : assignId([date, amount, row.categoryId ?? 'altro']),
    amount,
    // getCategory() fa già fallback su "altro" per un id sconosciuto,
    // quindi una categoria non riconosciuta non rompe nulla a valle.
    categoryId: typeof row.categoryId === 'string' && row.categoryId ? row.categoryId : 'altro',
    description: typeof row.description === 'string' ? row.description : '',
    date,
  }
}

function sanitizeGoal(row, index, warnings, assignId) {
  if (!isPlainObject(row)) return null
  const target = toNumber(row.target)
  if (target === null || target <= 0) {
    warnings.push(`Obiettivo #${index + 1}: importo obiettivo non valido, riga ignorata`)
    return null
  }
  const saved = toNumber(row.saved)
  return {
    id: typeof row.id === 'string' && row.id ? row.id : assignId([row.label ?? `obiettivo-${index}`, target]),
    emoji: typeof row.emoji === 'string' && row.emoji ? row.emoji : '🎯',
    label: typeof row.label === 'string' && row.label ? row.label : `Obiettivo ${index + 1}`,
    saved: saved !== null && saved >= 0 ? saved : 0,
    target,
    etaMonths: Number.isFinite(row.etaMonths) ? row.etaMonths : 6,
  }
}

function sanitizeCategory(row, index, warnings, assignId) {
  if (!isPlainObject(row)) return null
  const label = typeof row.label === 'string' ? row.label.trim() : ''
  if (!label) {
    warnings.push(`Categoria #${index + 1}: nome mancante, riga ignorata`)
    return null
  }
  return {
    id: typeof row.id === 'string' && row.id ? row.id : assignId([label, row.type === 'income' ? 'income' : 'expense']),
    label,
    emoji: typeof row.emoji === 'string' && row.emoji ? row.emoji : '🏷️',
    type: row.type === 'income' ? 'income' : 'expense',
    pinned: row.pinned === true,
    subcategories: Array.isArray(row.subcategories) ? row.subcategories : [],
  }
}

function sanitizeGoalContribution(row, index, warnings, fallbackDate, assignId) {
  if (!isPlainObject(row)) return null
  const amount = toNumber(row.amount)
  if (amount === null) {
    warnings.push(`Versamento obiettivo #${index + 1}: importo non valido, riga ignorata`)
    return null
  }
  if (typeof row.goalId !== 'string' || !row.goalId) {
    warnings.push(`Versamento obiettivo #${index + 1}: obiettivo di destinazione mancante, riga ignorata`)
    return null
  }
  const date = isDateStr(row.date) ? row.date : fallbackDate
  return {
    id: typeof row.id === 'string' && row.id ? row.id : assignId([row.goalId, date, amount]),
    goalId: row.goalId,
    amount,
    date,
  }
}

function sanitizeContribution(row, index, warnings, fallbackDate, assignId) {
  if (!isPlainObject(row)) return null
  const amount = toNumber(row.amount)
  if (amount === null) {
    warnings.push(`Versamento fondo #${index + 1}: importo non valido, riga ignorata`)
    return null
  }
  return {
    id: typeof row.id === 'string' && row.id ? row.id : assignId([isDateStr(row.date) ? row.date : fallbackDate, amount]),
    amount,
    date: isDateStr(row.date) ? row.date : fallbackDate,
  }
}

// Riconosce tre forme di file, in ordine di preferenza:
//  1. l'envelope prodotto da buildBackup  → parsed.data
//  2. il blob grezzo di zustand persist   → parsed.state
//     (cioè esattamente ciò che si ottiene con
//      localStorage.getItem('spendy-storage') dalla console: è LA forma
//      con cui si recuperano i dati rimasti su una vecchia origine)
//  3. uno snapshot nudo                   → parsed stesso
function extractSnapshot(parsed) {
  if (!isPlainObject(parsed)) return null
  if (isPlainObject(parsed.data)) return parsed.data
  if (isPlainObject(parsed.state)) return parsed.state
  if (COLLECTION_FIELDS.some((field) => Array.isArray(parsed[field]))) return parsed
  return null
}

export function parseBackup(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Il file non è un JSON valido.' }
  }

  const raw = extractSnapshot(parsed)
  if (!raw) {
    return { ok: false, error: 'Il file non sembra un backup di Spendy: non contiene nessuna delle sezioni attese.' }
  }

  const warnings = []
  const fallbackDate = isDateStr(parsed?.exportedAt?.slice(0, 10)) ? parsed.exportedAt.slice(0, 10) : todayStr()
  const array = (field) => (Array.isArray(raw[field]) ? raw[field] : [])

  const expenseId = makeIdFactory('e')
  const incomeId = makeIdFactory('i')
  const goalId = makeIdFactory('g')
  const categoryId = makeIdFactory('custom')
  const goalContributionId = makeIdFactory('gc')
  const contributionId = makeIdFactory('ef')

  const snapshot = {
    expenses: array('expenses')
      .map((row, index) => sanitizeTransaction(row, index, 'e', warnings, fallbackDate, expenseId))
      .filter(Boolean),
    incomes: array('incomes')
      .map((row, index) => sanitizeTransaction(row, index, 'i', warnings, fallbackDate, incomeId))
      .filter(Boolean),
    goals: array('goals')
      .map((row, index) => sanitizeGoal(row, index, warnings, goalId))
      .filter(Boolean),
    goalContributions: array('goalContributions')
      .map((row, index) => sanitizeGoalContribution(row, index, warnings, fallbackDate, goalContributionId))
      .filter(Boolean),
    customCategories: array('customCategories')
      .map((row, index) => sanitizeCategory(row, index, warnings, categoryId))
      .filter(Boolean),
    emergencyFundContributions: array('emergencyFundContributions')
      .map((row, index) => sanitizeContribution(row, index, warnings, fallbackDate, contributionId))
      .filter(Boolean),
    monthlyBudget: toNumber(raw.monthlyBudget) ?? 0,
    currency: typeof raw.currency === 'string' && raw.currency ? raw.currency : '€',
    cycleStartDay:
      Number.isInteger(raw.cycleStartDay) && raw.cycleStartDay >= 1 && raw.cycleStartDay <= 31
        ? raw.cycleStartDay
        : null,
    amountHidden: raw.amountHidden === true,
  }

  // Un fondo emergenza salvato prima che esistessero i contributi (stessa
  // situazione che onRehydrateStorage già gestisce nello store) arriva
  // come totale senza storico: gli si ricostruisce una voce "legacy" con
  // id stabile, così il totale resta giusto ed è modificabile come le altre.
  // Un obiettivo salvato prima che esistessero i versamenti porta il
  // risparmiato come numero su di se'. Diventa un versamento "legacy" con
  // id stabile: il totale non cambia di un centesimo, ma da qui in poi e'
  // una riga come le altre — quindi sincronizzabile senza che due
  // versamenti fatti insieme da due dispositivi si sovrascrivano.
  const legacyGoalContributions = snapshot.goals
    .filter((goal) => goal.saved > 0 && !snapshot.goalContributions.some((c) => c.goalId === goal.id))
    .map((goal) => ({ id: `gc-legacy-${goal.id}`, goalId: goal.id, amount: goal.saved, date: fallbackDate }))
  if (legacyGoalContributions.length > 0) {
    snapshot.goalContributions = [...snapshot.goalContributions, ...legacyGoalContributions]
    warnings.push(`${legacyGoalContributions.length} obiettivo/i senza storico dei versamenti: ricostruita una voce con il totale.`)
  }

  const legacyTotal = toNumber(raw.emergencyFundSaved)
  if (snapshot.emergencyFundContributions.length === 0 && legacyTotal !== null && legacyTotal > 0) {
    snapshot.emergencyFundContributions = [{ id: 'ef-legacy', amount: legacyTotal, date: fallbackDate }]
    warnings.push('Fondo emergenza senza storico: ricostruita una voce unica con il totale.')
  }

  const empty =
    COLLECTION_FIELDS.every((field) => snapshot[field].length === 0) && snapshot.monthlyBudget === 0
  if (empty) {
    return { ok: false, error: 'Il backup è vuoto: non contiene né transazioni né stipendio. Import annullato.' }
  }

  return {
    ok: true,
    snapshot,
    warnings,
    meta: {
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
      exportedFrom: typeof parsed.exportedFrom === 'string' ? parsed.exportedFrom : null,
      backupVersion: Number.isFinite(parsed.backupVersion) ? parsed.backupVersion : null,
    },
  }
}

// ---------------------------------------------------------------- import

const sumAmounts = (list) => list.reduce((total, entry) => total + entry.amount, 0)

// Unione per id: le righe già presenti NON vengono toccate, nemmeno se
// il file ne contiene una versione diversa. In fase 0 non esiste ancora
// un modo affidabile di sapere quale delle due sia più recente (i
// timestamp per riga arrivano con il sync), quindi la scelta prudente è
// una sola: non sovrascrivere mai nulla di esistente. Chi vuole davvero
// la versione del file usa "Sostituisci", che è esplicito e confermato.
function mergeCollection(current, incoming) {
  const existingIds = new Set(current.map((row) => row.id))
  const added = incoming.filter((row) => !existingIds.has(row.id))
  return { rows: [...current, ...added], added: added.length, skipped: incoming.length - added.length }
}

// Le transazioni sono tenute dal più recente al meno recente: è
// l'ordine che addExpense produce inserendo in testa, e su cui
// expenseReactionEngine conta per trovare "l'ultima spesa di oggi".
// Dopo un merge l'ordine di inserimento non significa più niente, quindi
// si riordina per data per ripristinare quell'invariante.
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)

// Le categorie pinnate stanno davanti (QuickAddScreen legge questo
// ordine per costruire la griglia).
const pinnedFirst = (a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1)

// In "unisci" un'impostazione viene adottata dal file SOLO se qui non è
// ancora stata impostata. Così importare un backup su un dispositivo già
// configurato non ti cambia lo stipendio sotto il naso.
function mergeScalar(currentValue, incomingValue, isUnset) {
  return isUnset(currentValue) ? incomingValue : currentValue
}

export function buildImportPatch(state, snapshot, mode = 'merge') {
  const report = { mode, collections: {}, scalars: [] }
  const patch = {}

  if (mode === 'replace') {
    for (const field of COLLECTION_FIELDS) {
      patch[field] = snapshot[field]
      report.collections[field] = { added: snapshot[field].length, skipped: 0, total: snapshot[field].length }
    }
    for (const field of SCALAR_FIELDS) patch[field] = snapshot[field]
    report.scalars = SCALAR_FIELDS.filter((field) => state[field] !== snapshot[field])
  } else {
    for (const field of COLLECTION_FIELDS) {
      const { rows, added, skipped } = mergeCollection(state[field] ?? [], snapshot[field])
      patch[field] = rows
      report.collections[field] = { added, skipped, total: rows.length }
    }

    patch.monthlyBudget = mergeScalar(state.monthlyBudget, snapshot.monthlyBudget, (value) => !value)
    patch.cycleStartDay = mergeScalar(state.cycleStartDay, snapshot.cycleStartDay, (value) => value == null)
    patch.currency = mergeScalar(state.currency, snapshot.currency, (value) => !value)
    // amountHidden è una preferenza di visualizzazione del singolo
    // dispositivo ("nascondi gli importi"): non ha senso che viaggi in
    // un backup, quindi in unione resta sempre quella locale.
    patch.amountHidden = state.amountHidden
    report.scalars = SCALAR_FIELDS.filter((field) => state[field] !== patch[field])
  }

  patch.expenses = [...patch.expenses].sort(byDateDesc)
  patch.incomes = [...patch.incomes].sort(byDateDesc)
  patch.emergencyFundContributions = [...patch.emergencyFundContributions].sort(byDateDesc)
  patch.goalContributions = [...patch.goalContributions].sort(byDateDesc)
  patch.customCategories = [...patch.customCategories].sort(pinnedFirst)
  // Mai presi dal file: sono sempre la somma dei versamenti effettivi.
  patch.emergencyFundSaved = sumAmounts(patch.emergencyFundContributions)
  patch.goals = patch.goals.map((goal) => ({
    ...goal,
    saved: sumAmounts(patch.goalContributions.filter((contribution) => contribution.goalId === goal.id)),
  }))

  return { patch, report }
}

// Anteprima a secco: stessi calcoli dell'import vero, ma senza scrivere
// niente. È ciò che permette alla UI di dire "aggiungerò 47 spese, 3 le
// hai già" PRIMA che l'utente decida.
export function previewImport(state, snapshot) {
  const merge = buildImportPatch(state, snapshot, 'merge').report
  return COLLECTION_FIELDS.map((field) => ({
    field,
    label: FIELD_LABELS[field],
    current: (state[field] ?? []).length,
    incoming: snapshot[field].length,
    added: merge.collections[field].added,
    skipped: merge.collections[field].skipped,
  }))
}
