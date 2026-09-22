import { COLLECTION_KEYS } from './mappers.js'
import { SETTINGS_KEY } from './outbox.js'
import { saveAutoBackup } from './backup.js'

// Migrazione una-tantum dei dati già presenti in localStorage verso il
// cloud, al primo accesso su un dispositivo.
//
// Non viene MAI eseguita da sola all'avvio o al login: la lancia l'utente
// da Impostazioni, dopo aver visto quante righe verranno caricate. È una
// scelta deliberata — una migrazione automatica è esattamente il tipo di
// operazione che, se sbaglia, sbaglia su tutto senza che nessuno abbia
// avuto modo di dire no.
//
// Cosa NON fa, in nessun caso:
//  - non cancella e non riscrive 'spendy-storage';
//  - non svuota lo store;
//  - non invia niente se in locale non c'è niente da inviare (è la
//    protezione contro "il dispositivo appena installato azzera il
//    cloud": uno stato vuoto non ha nulla da caricare, quindi tace).

// Tutte le righe migrate partono con questo timestamp. Sono dati nati
// prima che esistesse il concetto di "modificato il", quindi devono
// essere i più VECCHI di tutti: se una riga con lo stesso id esiste già
// sul cloud perché modificata altrove, il trigger last-write-wins
// lascia vincere quella del cloud e la migrazione non la schiaccia.
export const MIGRATION_STAMP = '2000-01-01T00:00:00.000Z'

// Una riga e' "storica" se non ha `updatedAt`: e' nata prima che
// esistesse il concetto di modifica sincronizzabile, quindi il cloud non
// puo' averla vista. Tutte le altre sono gia' passate (o stanno per
// passare) dalla coda di invio e non hanno bisogno di nessuna migrazione.
//
// Questa distinzione e' anche cio' che rende innocuo premere il pulsante
// su un dispositivo appena riempito dal cloud: le sue righe hanno tutte
// un updatedAt, quindi non c'e' niente da migrare e non parte una
// ri-scrittura inutile di tutto il database.
const isLegacyRow = (row) => !row.updatedAt

export function countLocalRows(state) {
  const counts = {}
  let total = 0
  for (const collection of COLLECTION_KEYS) {
    const size = (state[collection] ?? []).filter(isLegacyRow).length
    counts[collection] = size
    total += size
  }
  // Le impostazioni non hanno una riga con timestamp da guardare: si
  // migrano solo se esistono davvero e questo dispositivo non ha mai
  // completato un sync (altrimenti arrivano dal cloud, non dal passato).
  const hasSettings =
    (state.monthlyBudget > 0 || state.cycleStartDay != null) && !state.sync.lastSyncAt
  return { counts, total, hasSettings }
}

export function migrationStatus(state, userId) {
  const { total, hasSettings, counts } = countLocalRows(state)
  if (state.sync.migratedAt && state.sync.userId === userId) {
    return { needed: false, reason: 'already-migrated', at: state.sync.migratedAt, counts, total }
  }
  if (total === 0 && !hasSettings) {
    return { needed: false, reason: 'nothing-local', counts, total }
  }
  return { needed: true, counts, total }
}

// Accoda tutte le righe locali. Non tocca il cloud direttamente: usa la
// stessa coda di qualsiasi altra modifica, quindi eredita gratis tutte
// le sue garanzie — ritento in caso di rete assente, niente doppioni
// grazie alla deduplica per riga, e upsert idempotente sul server.
export function buildMigrationOps(state) {
  const ops = []
  for (const collection of COLLECTION_KEYS) {
    for (const row of state[collection] ?? []) {
      if (!isLegacyRow(row)) continue
      ops.push({ collection, row: { ...row, updatedAt: MIGRATION_STAMP } })
    }
  }

  // Stipendio e giorno di ciclo non sono in nessuna collezione: sono la
  // riga `profiles`. Senza questo, si migrerebbero le spese ma il budget
  // su cui sono calcolate resterebbe solo sul vecchio dispositivo.
  if (countLocalRows(state).hasSettings) {
    ops.push({
      collection: SETTINGS_KEY,
      row: {
        id: 'me',
        monthlyBudget: state.monthlyBudget,
        currency: state.currency,
        cycleStartDay: state.cycleStartDay,
        amountHidden: state.amountHidden,
        updatedAt: MIGRATION_STAMP,
      },
    })
  }

  return ops
}

export async function migrateLocalToCloud({ store, engine, userId }) {
  const state = store.getState()
  const status = migrationStatus(state, userId)
  if (!status.needed) return { migrated: false, ...status }

  // Copia di sicurezza su una chiave nuova PRIMA di toccare qualunque
  // cosa. Se qualcosa andasse storto, lo stato di partenza è ancora lì.
  const backupKey = saveAutoBackup(state)

  const ops = buildMigrationOps(state)
  store.getState().enqueueMigration(ops)

  const result = await engine.syncNow()
  if (result?.error) return { migrated: false, error: result.error, backupKey, ...status }

  // Il segno di "già fatto" si mette solo dopo che la coda è davvero
  // vuota: se il push si è fermato a metà per un problema di rete, la
  // migrazione deve poter ripartire, non risultare completata.
  const stillPending = store.getState().sync.outbox.length
  if (stillPending > 0) {
    return { migrated: false, pending: stillPending, backupKey, ...status }
  }

  store.getState().markMigrated(new Date().toISOString())
  return { migrated: true, backupKey, ...status }
}
