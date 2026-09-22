// La coda delle modifiche locali non ancora arrivate al cloud.
//
// È il pezzo che rende vero "inserisco la spesa offline, la vedo subito,
// e quando torna internet si sincronizza da sola": ogni mutazione dello
// store aggiorna lo stato E accoda qui un'operazione. La coda è dentro
// lo stato persistito, quindi sopravvive a un reload, alla chiusura del
// browser e al riavvio del Mac.
//
// Una scelta che semplifica tutto: NON esiste un'operazione "delete".
// Una cancellazione è un normale upsert di una riga che porta
// `deletedAt` valorizzato (soft delete). Così funziona anche nel caso
// scomodo — riga creata E cancellata mentre si era offline, quindi mai
// esistita sul server: l'upsert la crea già cancellata, invece di
// fallire perché non c'è niente da aggiornare.

export const SETTINGS_KEY = '__settings'

export const opKey = (collection, rowId) => `${collection}:${rowId}`

// Accoda, o sostituisce l'operazione già in attesa per la stessa riga.
// Modificare tre volte la stessa spesa offline lascia UNA operazione con
// il valore finale: la coda non cresce con le correzioni e il server non
// riceve stati intermedi che non interessano a nessuno.
export function enqueueOp(outbox, { collection, rowId, row, updatedAt }) {
  const key = opKey(collection, rowId)
  const op = { key, collection, rowId, row, updatedAt, attempts: 0 }
  const index = outbox.findIndex((existing) => existing.key === key)
  if (index === -1) return [...outbox, op]
  const next = [...outbox]
  next[index] = op
  return next
}

export const hasPending = (outbox, collection, rowId) =>
  outbox.some((op) => op.key === opKey(collection, rowId))

// Gli id di una collezione che hanno una modifica locale in attesa.
// Il pull li salta: una riga che sto per mandare io è più recente di
// quella che il server sta restituendo adesso, e sovrascriverla
// significherebbe vedersi annullare una modifica appena fatta.
export const pendingIds = (outbox, collection) =>
  new Set(outbox.filter((op) => op.collection === collection).map((op) => op.rowId))

// Rimuove SOLO le operazioni confermate dal server, e solo se nel
// frattempo non sono state rimpiazzate da una versione più recente
// (confronto su updatedAt, non solo sulla chiave). Senza questo
// controllo, una modifica fatta durante il push in volo verrebbe
// silenziosamente cancellata dalla coda e non arriverebbe mai al cloud.
export function ackOps(outbox, sentOps) {
  const sent = new Map(sentOps.map((op) => [op.key, op.updatedAt]))
  return outbox.filter((op) => !(sent.has(op.key) && sent.get(op.key) === op.updatedAt))
}

// Segna un tentativo fallito: serve al backoff dell'engine e a mostrare
// all'utente che qualcosa non sta passando, invece di ritentare in
// silenzio all'infinito.
export function markAttempt(outbox, failedOps) {
  const keys = new Set(failedOps.map((op) => op.key))
  return outbox.map((op) => (keys.has(op.key) ? { ...op, attempts: (op.attempts ?? 0) + 1 } : op))
}

export const groupByCollection = (ops) => {
  const groups = new Map()
  for (const op of ops) {
    if (!groups.has(op.collection)) groups.set(op.collection, [])
    groups.get(op.collection).push(op)
  }
  return groups
}
