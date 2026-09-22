// Regression test della Fase 0 (export/import backup).
// Si esegue con `npm test`, senza browser e senza rete: tutti i dati qui
// dentro sono finti e non toccano nulla di reale.
//
// Questi test restano nel progetto: ogni modifica futura allo store o al
// layer di sincronizzazione deve continuare a superarli, perche' sono la
// garanzia scritta che un import non possa duplicare o distruggere righe.

import {
  buildBackup, serializeBackup, parseBackup, buildImportPatch, previewImport, getSnapshot,
} from './backup.js'
import { check, section, report } from './testkit.mjs'



// Stato finto, con dentro tutti i casi che contano
const fakeState = {
  expenses: [
    { id: 'e-1', amount: 25, categoryId: 'ristoranti', description: 'Pizza', date: '2026-09-19' },
    { id: 'e-2', amount: 60.5, categoryId: 'spesa', description: 'Supermercato', date: '2026-09-18' },
    { id: 'e-3', amount: 12, categoryId: 'bar', description: 'Caffè', date: '2026-09-17' },
  ],
  incomes: [{ id: 'i-1', amount: 200, categoryId: 'extra', description: 'Extra', date: '2026-09-15' }],
  goals: [{ id: 'g-1', emoji: '🎯', label: 'Vacanza', saved: 300, target: 1500, etaMonths: 6 }],
  goalContributions: [{ id: 'gc-1', goalId: 'g-1', amount: 300, date: '2026-09-11' }],
  customCategories: [
    { id: 'custom-1', label: 'Barbiere', emoji: '💈', type: 'expense', pinned: false, subcategories: [] },
    { id: 'custom-2', label: 'Ripetizioni', emoji: '📘', type: 'income', pinned: true, subcategories: [] },
  ],
  emergencyFundContributions: [
    { id: 'ef-1', amount: 100, date: '2026-09-10' },
    { id: 'ef-2', amount: 50, date: '2026-09-12' },
  ],
  emergencyFundSaved: 150,
  monthlyBudget: 1800,
  currency: '€',
  cycleStartDay: 27,
  amountHidden: false,
  spendyJokeHistory: [{ key: 'bar:spike', text: 'battuta', shownAt: '2026-09-19' }],
  today: '2026-09-20',
  activeTab: 'home',
  modal: null,
}

const emptyState = {
  expenses: [], incomes: [], goals: [], goalContributions: [], customCategories: [], emergencyFundContributions: [],
  emergencyFundSaved: 0, monthlyBudget: 0, currency: '€', cycleStartDay: null, amountHidden: false,
}

section('1. Export — contenuto e esclusioni')
const backup = buildBackup(fakeState)
check('envelope con app/version/exportedAt', backup.app === 'spendy' && backup.backupVersion === 1 && !!backup.exportedAt)
check('include tutte e 5 le collezioni', ['expenses','incomes','goals','customCategories','emergencyFundContributions'].every((f) => Array.isArray(backup.data[f])))
check('include le impostazioni', backup.data.monthlyBudget === 1800 && backup.data.cycleStartDay === 27 && backup.data.currency === '€')
check('ESCLUDE spendyJokeHistory', backup.data.spendyJokeHistory === undefined)
check('ESCLUDE i transienti (today/activeTab/modal)', backup.data.today === undefined && backup.data.activeTab === undefined && backup.data.modal === undefined)
check('counts corretti', backup.counts.expenses === 3 && backup.counts.emergencyFundContributions === 2)

section('2. Round-trip export → JSON → import')
const json = serializeBackup(backup)
check('JSON indentato e leggibile', json.includes('\n  "data"') && json.split('\n').length > 20)
const parsed = parseBackup(json)
check('riletto senza errori', parsed.ok === true, parsed.error ?? '')
check('nessun warning su dati puliti', parsed.warnings.length === 0, JSON.stringify(parsed.warnings))
check('spese identiche', JSON.stringify(parsed.snapshot.expenses) === JSON.stringify(fakeState.expenses))
check('obiettivi identici', JSON.stringify(parsed.snapshot.goals) === JSON.stringify(fakeState.goals))
check('versamenti sugli obiettivi identici', JSON.stringify(parsed.snapshot.goalContributions) === JSON.stringify(fakeState.goalContributions))
check('impostazioni identiche', parsed.snapshot.monthlyBudget === 1800 && parsed.snapshot.cycleStartDay === 27)
check('origine registrata nel meta', parsed.meta.backupVersion === 1)

section('3. Import su dispositivo VUOTO (il caso del recupero)')
const r1 = buildImportPatch(emptyState, parsed.snapshot, 'merge')
check('entrano tutte e 3 le spese', r1.patch.expenses.length === 3)
check('entra lo stipendio (era 0)', r1.patch.monthlyBudget === 1800)
check('entra il giorno di ciclo (era null)', r1.patch.cycleStartDay === 27)
check('fondo emergenza RICALCOLATO dai contributi', r1.patch.emergencyFundSaved === 150)
check('report: 3 spese aggiunte', r1.report.collections.expenses.added === 3)

section('4. IDEMPOTENZA — reimportare lo stesso file non duplica')
const afterFirst = { ...emptyState, ...r1.patch }
const r2 = buildImportPatch(afterFirst, parsed.snapshot, 'merge')
check('seconda import: 0 spese aggiunte', r2.report.collections.expenses.added === 0)
check('seconda import: 3 riconosciute come già presenti', r2.report.collections.expenses.skipped === 3)
check('totale invariato', r2.patch.expenses.length === 3)
check('fondo emergenza invariato', r2.patch.emergencyFundSaved === 150)
const r3 = buildImportPatch({ ...afterFirst, ...r2.patch }, parsed.snapshot, 'merge')
check('terza import: ancora 3, nessun duplicato', r3.patch.expenses.length === 3)

section('5. MERGE NON DISTRUTTIVO su dispositivo già pieno')
const busyState = {
  ...emptyState,
  expenses: [{ id: 'e-99', amount: 999, categoryId: 'casa', description: 'Affitto', date: '2026-09-20' }],
  monthlyBudget: 2500,
  cycleStartDay: 1,
  amountHidden: true,
}
const r4 = buildImportPatch(busyState, parsed.snapshot, 'merge')
check('la spesa locale esistente è ancora lì', r4.patch.expenses.some((e) => e.id === 'e-99' && e.amount === 999))
check('totale = 1 locale + 3 importate', r4.patch.expenses.length === 4)
check('stipendio locale NON sovrascritto (2500 resta)', r4.patch.monthlyBudget === 2500)
check('giorno ciclo locale NON sovrascritto (1 resta)', r4.patch.cycleStartDay === 1)
check('amountHidden resta la preferenza locale', r4.patch.amountHidden === true)

section('6. Conflitto di id: la riga locale vince e non viene toccata')
const conflict = { ...emptyState, expenses: [{ id: 'e-1', amount: 9999, categoryId: 'casa', description: 'NON TOCCARE', date: '2026-09-19' }] }
const r5 = buildImportPatch(conflict, parsed.snapshot, 'merge')
const kept = r5.patch.expenses.find((e) => e.id === 'e-1')
check('e-1 locale intatta (9999, non 25)', kept.amount === 9999 && kept.description === 'NON TOCCARE')
check('le altre 2 sono state aggiunte', r5.patch.expenses.length === 3)

section('7. REPLACE — sostituzione totale')
const r6 = buildImportPatch(busyState, parsed.snapshot, 'replace')
check('la spesa locale e-99 NON c\'è più', !r6.patch.expenses.some((e) => e.id === 'e-99'))
check('ci sono le 3 del file', r6.patch.expenses.length === 3)
check('stipendio preso dal file', r6.patch.monthlyBudget === 1800)

section('8. Ordinamento e invarianti della UI')
check('spese dal più recente al meno recente', r1.patch.expenses.map((e) => e.date).join() === '2026-09-19,2026-09-18,2026-09-17')
check('categorie pinnate davanti', r1.patch.customCategories[0].pinned === true)

section('9. Blob grezzo di zustand (recupero da altra origine via console)')
const rawBlob = JSON.stringify({ state: getSnapshot(fakeState), version: 0 })
const pr = parseBackup(rawBlob)
check('riconosciuto il formato {state,version}', pr.ok === true, pr.error ?? '')
check('3 spese lette dal blob', pr.ok && pr.snapshot.expenses.length === 3)

section('10. Fondo emergenza legacy (totale senza storico)')
const legacy = parseBackup(JSON.stringify({ data: { expenses: [{ id: 'e-1', amount: 10, categoryId: 'bar', date: '2026-09-01', description: 'x' }], emergencyFundSaved: 420, emergencyFundContributions: [] } }))
check('ricostruita la voce ef-legacy da 420', legacy.ok && legacy.snapshot.emergencyFundContributions[0].amount === 420)
check('avvisata la ricostruzione', legacy.warnings.some((w) => w.includes('Fondo emergenza')))

section('10-bis. Obiettivo legacy: saved senza storico dei versamenti')
const legacyGoal = parseBackup(JSON.stringify({ data: {
  goals: [{ id: 'g-9', label: 'Auto', target: 5000, saved: 1200, etaMonths: 12 }],
  expenses: [], incomes: [], customCategories: [], emergencyFundContributions: [], monthlyBudget: 900,
} }))
check('creato un versamento legacy per l\'obiettivo', legacyGoal.ok && legacyGoal.snapshot.goalContributions.length === 1)
check('id stabile gc-legacy-g-9', legacyGoal.snapshot.goalContributions[0].id === 'gc-legacy-g-9')
check('importo conservato (1200)', legacyGoal.snapshot.goalContributions[0].amount === 1200)
check('avvisata la ricostruzione', legacyGoal.warnings.some((w) => w.includes('senza storico dei versamenti')))
const legacyPatch = buildImportPatch(emptyState, legacyGoal.snapshot, 'merge')
check('saved dell\'obiettivo ricalcolato dai versamenti = 1200', legacyPatch.patch.goals[0].saved === 1200)
const legacyTwice = buildImportPatch({ ...emptyState, ...legacyPatch.patch }, legacyGoal.snapshot, 'merge')
check('reimport: nessun versamento duplicato', legacyTwice.patch.goalContributions.length === 1)
check('saved resta 1200, non 2400', legacyTwice.patch.goals[0].saved === 1200)

section('11. File sporchi o sbagliati — nessun crash, nessuna scrittura')
check('JSON invalido → errore chiaro', parseBackup('{rotto').ok === false)
check('JSON valido ma non Spendy → rifiutato', parseBackup('{"foo":1}').ok === false)
check('backup VUOTO → rifiutato (mai sovrascrivere con niente)', parseBackup(JSON.stringify({ data: emptyState })).ok === false)
const dirty = parseBackup(JSON.stringify({ data: { expenses: [
  { id: 'e-a', amount: '12,50', categoryId: 'bar', description: 'virgola', date: '2026-09-10' },
  { id: 'e-b', amount: 'pippo', categoryId: 'bar', date: '2026-09-10' },
  { amount: 5, categoryId: 'bar', date: '2026-09-11' },
  { id: 'e-d', amount: 8, categoryId: 'sconosciuta', date: 'non-una-data' },
], monthlyBudget: 100 } }))
check('importo "12,50" interpretato come 12.5', dirty.snapshot.expenses.some((e) => e.amount === 12.5))
check('riga con importo non numerico scartata + avviso', !dirty.snapshot.expenses.some((e) => e.id === 'e-b') && dirty.warnings.some((w) => w.includes('importo non valido')))
check('riga senza id recuperata con id deterministico', dirty.snapshot.expenses.some((e) => e.id.startsWith('e-import-')))
check('data invalida riparata + avviso', dirty.warnings.some((w) => w.includes('data mancante')))
// Stessa riga, ma in un file dove le righe precedenti non ci sono piu'
// (e' cio' che succede riesportando dopo aver cancellato qualcosa):
// l'id deve restare identico, o al reimport diventerebbe una riga nuova.
const dirty2 = parseBackup(JSON.stringify({ data: { expenses: [{ amount: 5, categoryId: 'bar', date: '2026-09-11' }], monthlyBudget: 100 } }))
const idA = dirty.snapshot.expenses.find((e) => e.id.startsWith('e-import-')).id
const idB = dirty2.snapshot.expenses.find((e) => e.id.startsWith('e-import-')).id
check('id generato STABILE anche se la riga cambia posizione', idA === idB, `${idA} vs ${idB}`)

// Due spese identiche nello stesso giorno sono due spese vere: devono
// ricevere due id diversi e sopravvivere entrambe.
const twins = parseBackup(JSON.stringify({ data: { expenses: [
  { amount: 2, categoryId: 'bar', date: '2026-09-11', description: 'Caffe' },
  { amount: 2, categoryId: 'bar', date: '2026-09-11', description: 'Caffe' },
], monthlyBudget: 100 } }))
check('due righe identiche = due id distinti', twins.snapshot.expenses[0].id !== twins.snapshot.expenses[1].id)
const twinsImport = buildImportPatch(emptyState, twins.snapshot, 'merge')
check('entrambe importate, nessuna persa', twinsImport.patch.expenses.length === 2)
const twinsAgain = buildImportPatch({ ...emptyState, ...twinsImport.patch }, twins.snapshot, 'merge')
check('reimport delle gemelle: 0 duplicati', twinsAgain.patch.expenses.length === 2)

section('12. Anteprima = ciò che poi succede davvero')
const prev = previewImport(busyState, parsed.snapshot)
const prevExp = prev.find((r) => r.field === 'expenses')
check('anteprima: 1 attuale, 3 in arrivo, +3', prevExp.current === 1 && prevExp.incoming === 3 && prevExp.added === 3)
check('anteprima coerente col patch reale', prevExp.added === r4.report.collections.expenses.added)

report('backup')
