// La valuta dell'account (Fase 3B + 3C): modello, store, persistenza, sync,
// backup e migrazione ospite → account. `npm test`, senza rete.
//
// Si controlla soprattutto che cambiare valuta cambi SOLO la preferenza:
// nessun importo convertito, nessun dato toccato, e i valori salvati dalle
// versioni precedenti ('€') letti come EUR.

import { check, section, report, installFakeLocalStorage } from '../sync/testkit.mjs'
import { CURRENCIES, CURRENCY_CODES, DEFAULT_CURRENCY, isCurrency, normalizeCurrency, currencyInfo } from './currency.js'
import { settingsToLocal, settingsToRemote } from '../sync/mappers.js'
import { buildBackup, serializeBackup, parseBackup, buildImportPatch } from '../sync/backup.js'
import { buildMigrationOps, migrationStatus, migrateLocalToCloud, MIGRATION_STAMP } from '../sync/migrateLocal.js'
import { createMemoryDatabase, createMemoryRemote } from '../sync/memoryRemote.mjs'
import { createSyncEngine } from '../sync/syncEngine.js'
import { SETTINGS_KEY } from '../sync/outbox.js'

const GUEST_KEY = 'spendy-storage-v2:guest'
const FINANCIAL = ['monthlyBudget', 'cycleStartDay', 'expenses', 'incomes', 'customCategories', 'goals', 'goalContributions', 'emergencyFundSaved', 'emergencyFundContributions']
const financialOf = (state) => JSON.stringify(Object.fromEntries(FINANCIAL.map((field) => [field, state[field]])))
let fresh = 0
const loadStore = async () => (await import(`../store/useAppStore.js?currency-test=${fresh += 1}`)).useAppStore

// =====================================================================
section('Modello: EUR, USD, GBP e un solo default')
// =====================================================================
check('tre valute: EUR €, USD $, GBP £', JSON.stringify(CURRENCIES) === JSON.stringify([{ code: 'EUR', symbol: '€' }, { code: 'USD', symbol: '$' }, { code: 'GBP', symbol: '£' }]))
check('EUR è il default', DEFAULT_CURRENCY === 'EUR')
check('codici riconosciuti', CURRENCY_CODES.every(isCurrency) && !isCurrency('€') && !isCurrency('eur') && !isCurrency('CHF'))
check('codici ISO (anche minuscoli o con spazi) → se stessi', ['EUR', 'USD', 'GBP', 'usd', ' gbp '].map(normalizeCurrency).join() === 'EUR,USD,GBP,USD,GBP')
check('simboli delle versioni precedenti: € → EUR, $ → USD, £ → GBP', ['€', '$', '£', ' € '].map(normalizeCurrency).join() === 'EUR,USD,GBP,EUR')
check('mancante, vuota o sconosciuta → EUR', [undefined, null, '', '   ', 'CHF', 'euro', 42, {}, ['USD']].every((value) => normalizeCurrency(value) === 'EUR'))
check('currencyInfo segue la stessa normalizzazione', currencyInfo('$').code === 'USD' && currencyInfo('£').symbol === '£' && currencyInfo('XYZ').code === 'EUR')

// =====================================================================
section('Store: setCurrency cambia solo la preferenza')
// =====================================================================
{
  const map = installFakeLocalStorage()
  const useAppStore = await loadStore()
  const S = useAppStore.getState
  check('valuta iniziale: EUR (anche con l\'app in inglese)', S().currency === 'EUR')
  useAppStore.setState({ today: '2026-10-20' })
  S().addSalary({ amount: 2000, date: '2026-10-01' })
  S().addExpense({ amount: 1234.56, categoryId: 'casa', description: 'affitto', date: '2026-10-02' })
  S().addGoal({ emoji: '✈️', label: 'Viaggio', target: 2500, etaMonths: 6 })
  S().contributeToGoal(S().goals[0].id, 300.5)
  S().contributeToEmergencyFund(1000)
  const before = financialOf(S())
  const settingsOps = () => S().sync.outbox.filter((op) => op.collection === SETTINGS_KEY)
  S().setCurrency('USD')
  check('setCurrency("USD") → USD', S().currency === 'USD')
  check('   nessun importo convertito: stipendio 2000, spesa 1234.56, obiettivo, fondo identici', financialOf(S()) === before && S().incomes[0].amount === 2000 && S().expenses[0].amount === 1234.56)
  const op = settingsOps()[0]
  check('   l\'operazione sulle impostazioni (la stessa del budget) porta USD, il resto invariato',
    settingsOps().length === 1 && op.row.currency === 'USD' && op.row.monthlyBudget === S().monthlyBudget && op.row.cycleStartDay === S().cycleStartDay)
  check('   salvata nel contenitore locale', JSON.parse(map.get(GUEST_KEY)).state.currency === 'USD')
  S().setCurrency('GBP')
  check('setCurrency("GBP") → GBP', S().currency === 'GBP')
  const opNow = settingsOps()[0]
  for (const bad of ['£', 'gbp', 'CHF', '', null, undefined]) S().setCurrency(bad)
  check('codice non supportato (o simbolo): ignorato, nessuna operazione', S().currency === 'GBP' && settingsOps()[0] === opNow)
  S().setCurrency('GBP')
  check('stessa valuta: nessuna operazione', settingsOps()[0] === opNow)
  const language = S().language
  S().setCurrency('EUR')
  check('la lingua non cambia con la valuta', S().language === language && S().currency === 'EUR')
  S().setLanguage('fr')
  check('la valuta non cambia con la lingua', S().currency === 'EUR' && S().language === 'fr')
  check('nessun importo toccato da tutti i cambi', financialOf(S()) === before)
}

// =====================================================================
section('Persistenza: la scelta resta dopo il ricaricamento')
// =====================================================================
{
  const map = installFakeLocalStorage()
  let useAppStore = await loadStore()
  useAppStore.getState().setCurrency('USD')
  useAppStore = await loadStore()
  check('USD salvato → dopo il ricaricamento è ancora USD', useAppStore.getState().currency === 'USD')
  const saved = JSON.parse(map.get(GUEST_KEY))
  const legacy = (currency) => JSON.stringify({ ...saved, state: { ...saved.state, currency, monthlyBudget: 1794, expenses: [{ id: 'e1', amount: 1234.56, categoryId: 'casa', description: '', date: '2026-09-28' }] } })
  for (const [stored, expected] of [['€', 'EUR'], ['$', 'USD'], ['£', 'GBP'], ['GBP', 'GBP'], ['', 'EUR'], ['CHF', 'EUR']]) {
    map.set(GUEST_KEY, legacy(stored))
    await useAppStore.persist.rehydrate()
    const state = useAppStore.getState()
    check(`contenitore con "${stored}" → ${expected}, importi invariati`, state.currency === expected && state.monthlyBudget === 1794 && state.expenses[0].amount === 1234.56)
  }
  const noCurrency = JSON.parse(legacy('€'))
  delete noCurrency.state.currency
  map.set(GUEST_KEY, JSON.stringify(noCurrency))
  await useAppStore.persist.rehydrate()
  check('contenitore senza valuta (versioni molto vecchie) → EUR', useAppStore.getState().currency === 'EUR')
  map.set(GUEST_KEY, legacy('€'))
  await useAppStore.persist.rehydrate()
  check('la lettura di "€" non accoda niente per il cloud (coda uguale a quella salvata)', JSON.stringify(useAppStore.getState().sync.outbox) === JSON.stringify(JSON.parse(legacy('€')).state.sync.outbox))
}

// =====================================================================
section('Sync: profili vecchi ("€") e nuovi (codici ISO)')
// =====================================================================
{
  const row = (currency) => ({ id: 'u1', monthly_budget: '1794.00', currency, cycle_start_day: 27, amount_hidden: false, client_updated_at: '2026-10-01T10:00:00.000Z' })
  check('dal cloud: "€" (default della colonna) → EUR', settingsToLocal(row('€')).currency === 'EUR')
  check('   "USD", "GBP", "$", "£" → USD, GBP, USD, GBP', ['USD', 'GBP', '$', '£'].map((c) => settingsToLocal(row(c)).currency).join() === 'USD,GBP,USD,GBP')
  check('   mancante o sconosciuta → EUR', settingsToLocal(row(undefined)).currency === 'EUR' && settingsToLocal(row('CHF')).currency === 'EUR')
  check('   il budget resta 1794 (nessuna conversione)', settingsToLocal(row('USD')).monthlyBudget === 1794)
  const out = (currency) => settingsToRemote({ monthlyBudget: 1794, currency, cycleStartDay: 27, amountHidden: false, updatedAt: '2026-10-01T10:00:00.000Z' }, 'u1')
  check('verso il cloud: sempre il codice ISO ("€" locale → "EUR")', out('€').currency === 'EUR' && out('USD').currency === 'USD' && out('GBP').currency === 'GBP' && out(undefined).currency === 'EUR')
  check('   andata e ritorno: la valuta resta la stessa', CURRENCY_CODES.every((code) => settingsToLocal(out(code)).currency === code))
  check('   monthly_budget invariato', out('GBP').monthly_budget === 1794)
}

// =====================================================================
section('Backup e ripristino')
// =====================================================================
{
  const state = { expenses: [{ id: 'e1', amount: 1234.56, categoryId: 'casa', description: '', date: '2026-09-28' }], incomes: [], goals: [], goalContributions: [], customCategories: [], emergencyFundContributions: [], emergencyFundSaved: 0, monthlyBudget: 1794, currency: 'USD', cycleStartDay: 27, amountHidden: false }
  const parsed = parseBackup(serializeBackup(buildBackup(state)))
  check('il backup esporta la valuta (USD) e la rilegge uguale', buildBackup(state).data.currency === 'USD' && parsed.ok && parsed.snapshot.currency === 'USD')
  const oldFile = (currency) => JSON.stringify({ app: 'spendy', backupVersion: 1, data: { ...buildBackup(state).data, currency } })
  check('backup delle versioni precedenti: "€" → EUR, senza valuta → EUR', parseBackup(oldFile('€')).snapshot.currency === 'EUR' && parseBackup(oldFile(undefined)).snapshot.currency === 'EUR')
  check('   "£" → GBP, sconosciuta → EUR', parseBackup(oldFile('£')).snapshot.currency === 'GBP' && parseBackup(oldFile('CHF')).snapshot.currency === 'EUR')
  check('   importi del backup invariati', parseBackup(oldFile('£')).snapshot.expenses[0].amount === 1234.56 && parseBackup(oldFile('£')).snapshot.monthlyBudget === 1794)
  const local = { ...state, currency: 'EUR', expenses: [] }
  const snapshot = parseBackup(oldFile('GBP')).snapshot
  check('ripristino "unisci": la valuta di questo dispositivo resta (EUR), come budget e giorno di ciclo', buildImportPatch(local, snapshot, 'merge').patch.currency === 'EUR')
  check('ripristino "sostituisci": la valuta del backup (GBP)', buildImportPatch(local, snapshot, 'replace').patch.currency === 'GBP')
}

// =====================================================================
section('Da ospite ad account: la valuta scelta viaggia anche senza budget')
// =====================================================================
{
  const empty = { expenses: [], incomes: [], goals: [], goalContributions: [], customCategories: [], emergencyFundContributions: [], monthlyBudget: 0, cycleStartDay: null, amountHidden: false, sync: { lastSyncAt: null } }
  const settingsOp = (state) => buildMigrationOps(state).find((op) => op.collection === SETTINGS_KEY)
  const needed = (state) => migrationStatus(state, 'u-nuovo').needed
  // A, B: ospite senza budget né ciclo, con USD o GBP.
  for (const code of ['USD', 'GBP']) {
    const op = settingsOp({ ...empty, currency: code })
    check(`${code}, senza budget né ciclo: migrazione necessaria e riga impostazioni con ${code}`, needed({ ...empty, currency: code }) && op?.row.currency === code)
    check(`   ${code}: budget 0 e ciclo non impostato, come in locale (nessun valore inventato)`, op.row.monthlyBudget === 0 && op.row.cycleStartDay === null && op.updatedAt === undefined && op.row.updatedAt === MIGRATION_STAMP)
  }
  check('   anche scritte alla vecchia maniera ("$", "£")', settingsOp({ ...empty, currency: '$' })?.row.currency === 'USD' && settingsOp({ ...empty, currency: '£' })?.row.currency === 'GBP')
  // C, E: EUR, "€", mancante o sconosciuta → il default: nessuna migrazione per la sola valuta.
  for (const currency of ['EUR', '€', undefined, '', 'CHF']) {
    check(`valuta ${JSON.stringify(currency)} senza budget né ciclo: nessuna migrazione (è il default EUR)`, !needed({ ...empty, currency }) && settingsOp({ ...empty, currency }) === undefined)
  }
  // D: con budget o ciclo, come prima (la valuta viaggia con il resto).
  const withBudget = { ...empty, monthlyBudget: 1794, cycleStartDay: 27 }
  check('con budget e ciclo: come prima, riga impostazioni con budget 1794 e ciclo 27', settingsOp({ ...withBudget, currency: '€' })?.row.monthlyBudget === 1794 && settingsOp({ ...withBudget, currency: '€' })?.row.cycleStartDay === 27)
  check('   la valuta legacy "€" arriva come "EUR", USD come USD', settingsOp({ ...withBudget, currency: '€' }).row.currency === 'EUR' && settingsOp({ ...withBudget, currency: 'USD' }).row.currency === 'USD')
  check('   solo il ciclo (budget 0): come prima', settingsOp({ ...empty, cycleStartDay: 5, currency: 'EUR' })?.row.cycleStartDay === 5)
  check('un dispositivo che ha già sincronizzato: nessuna migrazione, nemmeno per USD (le impostazioni arrivano dal cloud)', !needed({ ...empty, currency: 'USD', sync: { lastSyncAt: '2026-10-01T10:00:00.000Z' } }) && settingsOp({ ...empty, currency: 'USD', sync: { lastSyncAt: '2026-10-01T10:00:00.000Z' } }) === undefined)
  check('una sola riga impostazioni per migrazione (nessun doppione)', buildMigrationOps({ ...withBudget, currency: 'GBP' }).filter((op) => op.collection === SETTINGS_KEY).length === 1)
}

// =====================================================================
section('Da ospite ad account: fino al cloud (database in memoria con last-write-wins)')
// =====================================================================
{
  const guestState = (map, currency) => map.set(GUEST_KEY, JSON.stringify({ state: { monthlyBudget: 0, currency, cycleStartDay: null, amountHidden: false, expenses: [], incomes: [], goals: [], goalContributions: [], customCategories: [], emergencyFundContributions: [], emergencyFundSaved: 0 }, version: 0 }))
  const device = async (userId, currency, db) => {
    const map = installFakeLocalStorage()
    guestState(map, currency)
    const useAppStore = await loadStore()
    const engine = createSyncEngine({ store: useAppStore, remote: createMemoryRemote(db, userId, {}), autoFlushMs: 10_000 })
    useAppStore.getState().setSyncUser(userId)
    return { useAppStore, engine }
  }
  const profileOf = (db, userId) => db.rows('profiles').find((row) => row.id === userId)

  // A (fino al cloud): account nuovo, nessuna riga profiles → la valuta dell'ospite arriva.
  const db = createMemoryDatabase()
  const nuovo = await device('u-nuovo-usd', 'USD', db)
  const before = financialOf(nuovo.useAppStore.getState())
  const esito = await migrateLocalToCloud({ store: nuovo.useAppStore, engine: nuovo.engine, userId: 'u-nuovo-usd' })
  check('account nuovo: migrazione completata, nel cloud currency = "USD"', esito.migrated === true && profileOf(db, 'u-nuovo-usd')?.currency === 'USD', JSON.stringify(profileOf(db, 'u-nuovo-usd')))
  check('   budget 0 e ciclo non impostato nel cloud; nessun dato finanziario cambiato in locale', Number(profileOf(db, 'u-nuovo-usd').monthly_budget) === 0 && profileOf(db, 'u-nuovo-usd').cycle_start_day === null && financialOf(nuovo.useAppStore.getState()) === before)
  check('   la valuta locale resta USD', nuovo.useAppStore.getState().currency === 'USD')

  // F: account esistente, con un profilo già salvato (EUR, budget 2500) → vince il cloud, come per il budget.
  const db2 = createMemoryDatabase()
  db2.upsert('profiles', [{ id: 'u-esistente', monthly_budget: 2500, currency: 'EUR', cycle_start_day: 10, amount_hidden: false, client_updated_at: '2026-09-01T10:00:00.000Z' }], 'u-esistente')
  const esistente = await device('u-esistente', 'GBP', db2)
  check('   (preparazione) l\'account esistente ha già il suo profilo EUR', profileOf(db2, 'u-esistente')?.currency === 'EUR')
  await migrateLocalToCloud({ store: esistente.useAppStore, engine: esistente.engine, userId: 'u-esistente' })
  const kept = profileOf(db2, 'u-esistente')
  check('account esistente: il suo profilo resta (EUR, budget 2500, ciclo 10): la migrazione è la più vecchia e non lo schiaccia', kept.currency === 'EUR' && Number(kept.monthly_budget) === 2500 && kept.cycle_start_day === 10, JSON.stringify(kept))
}

report('Valuta dell\'account (Fase 3B + 3C)')
