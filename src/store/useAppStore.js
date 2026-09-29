import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { todayStr } from '../utils/date.js'
import { registerCustomCategories } from '../data/categories.js'
import { buildImportPatch } from '../sync/backup.js'
import { newId, nowIso } from '../lib/ids.js'
import { SETTINGS_KEY, ackOps as ackOutboxOps, enqueueOp, hasPending, pendingIds } from '../sync/outbox.js'
import { mergeRemoteRows } from '../sync/syncEngine.js'
import { settingsToLocal } from '../sync/mappers.js'

const sumAmounts = (list) => list.reduce((total, entry) => total + entry.amount, 0)

// Ogni riga che cambia entra nella coda di invio (vedi sync/outbox.js).
// Un solo punto di accodamento per tutto lo store: se una mutazione non
// passa di qui, quella modifica non arriverebbe mai sugli altri
// dispositivi — ed è l'unico modo in cui un dato potrebbe "non
// sincronizzarsi" senza che nessuno se ne accorga.
const withOp = (sync, collection, row) => ({
  ...sync,
  outbox: enqueueOp(sync.outbox, { collection, rowId: row.id, row, updatedAt: row.updatedAt }),
})

const withOps = (sync, collection, rows) => rows.reduce((acc, row) => withOp(acc, collection, row), sync)

// Marca una riga come cancellata SENZA toglierla dal cloud: la
// cancellazione deve poter viaggiare fino agli altri dispositivi. Dagli
// array locali invece sparisce subito, perché tutti i calcoli (totali,
// BehaviorEngine, Radar) leggono quegli array così come sono.
const tombstone = (row) => {
  const at = nowIso()
  return { ...row, deletedAt: at, updatedAt: at }
}

// `saved` di un obiettivo non è più un numero che si incrementa: è
// sempre la somma dei suoi versamenti. È ciò che rende impossibile
// perdere un versamento fatto contemporaneamente da due dispositivi —
// due righe si sommano, due incrementi si sovrascrivono.
const recomputeGoals = (goals, goalContributions) =>
  goals.map((goal) => ({
    ...goal,
    saved: sumAmounts(goalContributions.filter((contribution) => contribution.goalId === goal.id)),
  }))

// Le impostazioni viaggiano come riga unica (tabella profiles).
// `amountHidden` è escluso di proposito: "nascondi gli importi" è una
// preferenza del singolo dispositivo (ha senso sul telefono in pubblico,
// non sul Mac di casa), quindi non accoda nulla e non arriva dal cloud.
const withSettingsOp = (state, patch) => {
  const row = {
    monthlyBudget: patch.monthlyBudget ?? state.monthlyBudget,
    currency: patch.currency ?? state.currency,
    cycleStartDay: 'cycleStartDay' in patch ? patch.cycleStartDay : state.cycleStartDay,
    amountHidden: state.amountHidden,
    updatedAt: nowIso(),
  }
  return {
    ...patch,
    sync: {
      ...state.sync,
      outbox: enqueueOp(state.sync.outbox, {
        collection: SETTINGS_KEY,
        rowId: 'me',
        row,
        updatedAt: row.updatedAt,
      }),
    },
  }
}

const INITIAL_SYNC = {
  userId: null,
  outbox: [],
  cursors: {},
  lastSyncAt: null,
  migratedAt: null,
  status: 'idle',
  error: null,
}

// Single store for everything the app needs. Persisted to localStorage
// (see the `persist` wrapper below) — a real backend would later replace
// the persisted blob with a fetch/sync, but nothing that reads from this
// store needs to change either way.
//
// First-ever launch starts completely empty (0 spese, 0 guadagno,
// nessun obiettivo) — there is no seeded demo data. `today` is the REAL
// current date (todayStr()), not a fixed reference: this is what makes
// "torno nell'app e trovo le spese di ieri" actually true, instead of
// resetting to a demo snapshot on every reload.
export const useAppStore = create(
  persist(
    (set, get) => ({
      activeTab: 'home',
      setActiveTab: (tab) => set({ activeTab: tab }),

      today: todayStr(),
      // Called once on App mount (see App.jsx) so a tab left open across
      // midnight — or reopened days later — still reads the real date,
      // not whatever date happened to be current when the store was
      // first created this session.
      refreshToday: () => set({ today: todayStr() }),

      monthlyBudget: 0,
      currency: '€',
      // Which day-of-month the user's billing cycle starts on (1-31) —
      // null means "not set yet", which behaves exactly like calendar
      // months (cycle day 1) everywhere cycle.js is used. Auto-set the
      // first time a monthly budget is ever entered — "il mese parte da
      // quando inserisco lo stipendio" — from the STIPENDIO ENTRY'S OWN
      // date, not always today's: QuickAddScreen's "Altri dettagli" lets
      // the date be backdated (stipendio arrivato il 27, inserito l'8),
      // and that edited date needs a real effect or it's a dead control
      // — this is that effect. Stays explicitly overridable via
      // setCycleStartDay, and untouched on any LATER setMonthlyBudget
      // call once a cycleStartDay already exists.
      cycleStartDay: null,
      setMonthlyBudget: (monthlyBudget, date) =>
        set((state) =>
          withSettingsOp(state, {
            monthlyBudget,
            cycleStartDay: state.cycleStartDay ?? Number((date ?? state.today).slice(8, 10)),
          }),
        ),
      setCycleStartDay: (cycleStartDay) => set((state) => withSettingsOp(state, { cycleStartDay })),
      // "dammi la possibilità di cancellare uno stipendio già registrato"
      // — Stipendio has no per-entry list to delete a ROW from (it's a
      // single recurring figure, not a dated transaction like `incomes`,
      // see addIncome's own comment on why) — deleting it means resetting
      // that figure to unset. cycleStartDay resets too: it only ever
      // existed because a stipendio was entered, so removing the
      // stipendio removes the reason it was auto-set, letting a NEXT
      // stipendio re-derive it fresh from its own date instead of being
      // stuck on whatever day the deleted one happened to use.
      deleteMonthlyBudget: () => set((state) => withSettingsOp(state, { monthlyBudget: 0, cycleStartDay: null })),

      amountHidden: false,
      toggleAmountHidden: () => set((state) => ({ amountHidden: !state.amountHidden })),

      expenses: [],
      addExpense: (expense) =>
        set((state) => {
          const row = { id: newId('e'), date: state.today, ...expense, updatedAt: nowIso() }
          return { expenses: [row, ...state.expenses], sync: withOp(state.sync, 'expenses', row) }
        }),
      // "ho sbagliato a mettere una cifra, ma non ho modo di correggere" —
      // tapping any expense in ExpensesPage opens EditExpenseModal, which
      // calls these instead of a second, parallel way of touching the
      // list. Editing amount/date is exactly rewriting the same fields
      // addExpense set at creation time.
      editExpense: (id, updates) =>
        set((state) => {
          const target = state.expenses.find((expense) => expense.id === id)
          if (!target) return {}
          const row = { ...target, ...updates, updatedAt: nowIso() }
          return {
            expenses: state.expenses.map((expense) => (expense.id === id ? row : expense)),
            sync: withOp(state.sync, 'expenses', row),
          }
        }),
      deleteExpense: (id) =>
        set((state) => {
          const target = state.expenses.find((expense) => expense.id === id)
          if (!target) return {}
          return {
            expenses: state.expenses.filter((expense) => expense.id !== id),
            sync: withOp(state.sync, 'expenses', tombstone(target)),
          }
        }),

      // One-off income — "Extra"/"Investimenti"/"Regalo"/"Rimborso" and
      // any custom income category from the quick-add flow. "Stipendio"
      // is NOT one of these: it goes through setMonthlyBudget instead,
      // since it's the recurring figure the whole app's "disponibile"
      // is built on, not a single-cycle entry. Same shape/pattern as
      // addExpense on purpose — one mental model for "add a transaction",
      // just a second list instead of a signed amount on one list, so
      // every existing €-based calculation (totalForMonth, etc.) keeps
      // working unmodified on whichever list it's given.
      incomes: [],
      addIncome: (income) =>
        set((state) => {
          const row = { id: newId('i'), date: state.today, ...income, updatedAt: nowIso() }
          return { incomes: [row, ...state.incomes], sync: withOp(state.sync, 'incomes', row) }
        }),
      // "voglio poter modificare la data di un guadagno già inserito" —
      // same edit/delete pair as expenses (editExpense/deleteExpense),
      // for the exact same reason: a wrong amount or date entered earlier
      // needs a way back. Only ever applies to a ONE-OFF income here —
      // "Stipendio" isn't in this list at all (it goes through
      // setMonthlyBudget/cycleStartDay instead, see Settings), so there's
      // nothing in `incomes` for these to accidentally touch.
      editIncome: (id, updates) =>
        set((state) => {
          const target = state.incomes.find((income) => income.id === id)
          if (!target) return {}
          const row = { ...target, ...updates, updatedAt: nowIso() }
          return {
            incomes: state.incomes.map((income) => (income.id === id ? row : income)),
            sync: withOp(state.sync, 'incomes', row),
          }
        }),
      deleteIncome: (id) =>
        set((state) => {
          const target = state.incomes.find((income) => income.id === id)
          if (!target) return {}
          return {
            incomes: state.incomes.filter((income) => income.id !== id),
            sync: withOp(state.sync, 'incomes', tombstone(target)),
          }
        }),

      // Categories the user created from the quick-add screen's "+
      // Aggiungi categoria" — merged with the predefined CATEGORIES
      // everywhere a category is looked up (see categories.js's
      // getCategory/getAllCategories). `registerCustomCategories` keeps
      // that lookup in sync immediately, without waiting for a re-render.
      customCategories: [],
      addCustomCategory: (category) =>
        set((state) => {
          const newCategory = { id: newId('custom'), subcategories: [], pinned: false, ...category, updatedAt: nowIso() }
          const customCategories = [...state.customCategories, newCategory]
          registerCustomCategories(customCategories)
          return { customCategories, sync: withOp(state.sync, 'customCategories', newCategory) }
        }),
      // "devo poter cancellare una categoria appena creata" — only ever
      // called on a custom one (QuickAddScreen never shows this on a
      // predefined category's tile). Any existing expense/income already
      // using this categoryId is left as-is; getCategory's own registry
      // lookup already falls back to "altro" for an id it doesn't
      // recognize, so nothing else needs to change for those to still
      // render correctly.
      deleteCustomCategory: (id) =>
        set((state) => {
          const target = state.customCategories.find((category) => category.id === id)
          if (!target) return {}
          const customCategories = state.customCategories.filter((category) => category.id !== id)
          registerCustomCategories(customCategories)
          return { customCategories, sync: withOp(state.sync, 'customCategories', tombstone(target)) }
        }),
      // "tenendole premute, spostare in alto per averle subito in vista"
      // — long-press on a custom category tile (QuickAddScreen) toggles
      // this. Pinned ones move to the very front of the grid (see
      // QuickAddScreen's gridCategories), ahead of even the predefined
      // categories; unpinning just drops it back into the normal
      // "custom categories after the predefined ones" spot.
      togglePinCategory: (id) =>
        set((state) => {
          const target = state.customCategories.find((category) => category.id === id)
          if (!target) return {}
          const updated = { ...target, pinned: !target.pinned, updatedAt: nowIso() }
          const rest = state.customCategories.filter((category) => category.id !== id)
          const customCategories = updated.pinned ? [updated, ...rest] : [...rest, updated]
          registerCustomCategories(customCategories)
          return { customCategories, sync: withOp(state.sync, 'customCategories', updated) }
        }),

      goals: [],
      // I versamenti sugli obiettivi sono righe, non un numero che si
      // incrementa: vedi recomputeGoals più sopra e goal_contributions
      // nello schema. `goals[].saved` resta comunque valorizzato, perché
      // GoalCard e tutte le schermate lo leggono da sempre — solo che ora
      // è un valore derivato, non una fonte di verità.
      goalContributions: [],
      addGoal: (goal) =>
        set((state) => {
          const { saved: initialSaved = 0, ...rest } = goal
          const row = { id: newId('g'), ...rest, saved: 0, updatedAt: nowIso() }
          let sync = withOp(state.sync, 'goals', row)
          let goalContributions = state.goalContributions

          // Un obiettivo creato con un importo già da parte: quell'importo
          // non resta appiccicato all'obiettivo, diventa il suo primo
          // versamento. Un solo modo di rappresentare "soldi messi da
          // parte", quindi un solo modo di sincronizzarli.
          if (initialSaved > 0) {
            const contribution = { id: newId('gc'), goalId: row.id, amount: initialSaved, date: state.today, updatedAt: nowIso() }
            goalContributions = [contribution, ...goalContributions]
            sync = withOp(sync, 'goalContributions', contribution)
          }

          return { goals: recomputeGoals([...state.goals, row], goalContributions), goalContributions, sync }
        }),
      // The one place a goal's saved amount ever changes — GoalsPage's
      // "+ Aggiungi importo" and anything else that contributes money
      // toward an existing goal call this instead of touching `goals`
      // directly.
      contributeToGoal: (goalId, amount) =>
        set((state) => {
          const contribution = { id: newId('gc'), goalId, amount, date: state.today, updatedAt: nowIso() }
          const goalContributions = [contribution, ...state.goalContributions]
          return {
            goalContributions,
            goals: recomputeGoals(state.goals, goalContributions),
            sync: withOp(state.sync, 'goalContributions', contribution),
          }
        }),
      // "i nuovi obiettivi devo poterli anche eliminare" — GoalCard's own
      // delete button (GoalsPage only; the emergency-fund card on Home
      // reuses GoalCard with a synthetic object that was never in this
      // array, so onDelete is simply never passed there).
      deleteGoal: (goalId) =>
        set((state) => {
          const target = state.goals.find((goal) => goal.id === goalId)
          if (!target) return {}
          // Cancellare l'obiettivo cancella anche i suoi versamenti, o
          // resterebbero righe orfane che tornano a galla al prossimo pull.
          const orphans = state.goalContributions.filter((contribution) => contribution.goalId === goalId)
          let sync = withOp(state.sync, 'goals', tombstone(target))
          sync = withOps(sync, 'goalContributions', orphans.map(tombstone))
          return {
            goals: state.goals.filter((goal) => goal.id !== goalId),
            goalContributions: state.goalContributions.filter((contribution) => contribution.goalId !== goalId),
            sync,
          }
        }),

      // Fondo emergenza is deliberately NOT a generic goal (unlike
      // "Vacanza"/"Computer nuovo" in `goals`) — it has its own screen,
      // its own encouragement copy and a target that's a function of
      // income, so it gets its own pair of fields instead of being
      // shoehorned into the goals array.
      // `emergencyFundSaved` stays the single number every other screen
      // reads (HomePage's preview, this screen's progress bar) — it's
      // always kept in sync as the sum of `emergencyFundContributions`,
      // which is the actual editable history: every versamento gets its
      // own id+date so a wrong one can be corrected or undone instead of
      // only ever being able to add more on top.
      emergencyFundSaved: 0,
      emergencyFundContributions: [],
      contributeToEmergencyFund: (amount) =>
        set((state) => {
          const row = { id: newId('ef'), amount, date: state.today, updatedAt: nowIso() }
          const emergencyFundContributions = [row, ...state.emergencyFundContributions]
          return {
            emergencyFundContributions,
            emergencyFundSaved: sumAmounts(emergencyFundContributions),
            sync: withOp(state.sync, 'emergencyFundContributions', row),
          }
        }),
      editEmergencyFundContribution: (id, updates) =>
        set((state) => {
          const target = state.emergencyFundContributions.find((contribution) => contribution.id === id)
          if (!target) return {}
          const row = { ...target, ...updates, updatedAt: nowIso() }
          const emergencyFundContributions = state.emergencyFundContributions.map((contribution) =>
            contribution.id === id ? row : contribution,
          )
          return {
            emergencyFundContributions,
            emergencyFundSaved: sumAmounts(emergencyFundContributions),
            sync: withOp(state.sync, 'emergencyFundContributions', row),
          }
        }),
      deleteEmergencyFundContribution: (id) =>
        set((state) => {
          const target = state.emergencyFundContributions.find((contribution) => contribution.id === id)
          if (!target) return {}
          const emergencyFundContributions = state.emergencyFundContributions.filter(
            (contribution) => contribution.id !== id,
          )
          return {
            emergencyFundContributions,
            emergencyFundSaved: sumAmounts(emergencyFundContributions),
            sync: withOp(state.sync, 'emergencyFundContributions', tombstone(target)),
          }
        }),

      // modal: 'addTransaction' | 'quickAdd' | 'editExpense' | 'editIncome' | 'newGoal' | 'contributeGoal' | 'radar' | 'andamento' | 'affordability' | 'emergencyFund' | 'settings' | null
      modal: null,
      modalPayload: null,
      openModal: (modal, payload = null) => set({ modal, modalPayload: payload }),
      closeModal: () => set({ modal: null, modalPayload: null }),

      // Jokes Spendy's behavior-insight pipeline (see utils/behaviorEngine.js,
      // utils/humorEngine.js, utils/jokeEvaluator.js) has already shown, one
      // entry per joke, keyed "categoryId:type" — getSpendyCoach's tier 6
      // reads this to avoid repeating the same joke and to respect
      // cooldownDays. Capped so a long session can't grow this unbounded.
      spendyJokeHistory: [],
      recordSpendyJoke: (entry) =>
        set((state) => ({ spendyJokeHistory: [...state.spendyJokeHistory, entry].slice(-50) })),

      // ----------------------------------------------------------------
      // Sincronizzazione. Nessun componente della UI legge questi campi
      // se non la card in Impostazioni: le pagine continuano a leggere
      // `expenses`, `incomes`, `goals`… esattamente come prima, e le
      // engine (BehaviorEngine, HumorEngine, Radar, Coach) non sanno
      // nemmeno che il cloud esiste.
      // ----------------------------------------------------------------
      sync: INITIAL_SYNC,

      setSyncUser: (userId) => set((state) => ({ sync: { ...state.sync, userId } })),
      setSyncStatus: (patch) => set((state) => ({ sync: { ...state.sync, ...patch } })),
      setCursor: (table, iso) =>
        set((state) => ({ sync: { ...state.sync, cursors: { ...state.sync.cursors, [table]: iso } } })),
      ackOps: (ops) => set((state) => ({ sync: { ...state.sync, outbox: ackOutboxOps(state.sync.outbox, ops) } })),
      markMigrated: (iso) => set((state) => ({ sync: { ...state.sync, migratedAt: iso } })),
      // Usata solo dalla migrazione iniziale (sync/migrateLocal.js): mette
      // in coda righe già esistenti senza modificarle, così il primo
      // caricamento sul cloud passa dalla stessa strada di ogni altra
      // modifica invece di avere una scorciatoia tutta sua.
      enqueueMigration: (ops) =>
        set((state) => ({
          sync: ops.reduce((sync, op) => withOp(sync, op.collection, op.row), state.sync),
        })),

      // Porta dentro le righe arrivate dal cloud. Le righe con una
      // modifica locale ancora in coda vengono saltate: quella locale è
      // più recente e sta per partire, sovrascriverla significherebbe
      // vedersi annullare sotto gli occhi una spesa appena corretta.
      applyRemote: (collection, remoteRows) =>
        set((state) => {
          const merged = mergeRemoteRows(
            collection,
            state[collection],
            remoteRows,
            pendingIds(state.sync.outbox, collection),
          )
          if (merged === state[collection]) return {}

          const patch = { [collection]: merged }
          if (collection === 'customCategories') registerCustomCategories(merged)
          if (collection === 'emergencyFundContributions') patch.emergencyFundSaved = sumAmounts(merged)
          if (collection === 'goalContributions') patch.goals = recomputeGoals(state.goals, merged)
          if (collection === 'goals') patch.goals = recomputeGoals(merged, state.goalContributions)
          return patch
        }),

      applyRemoteSettings: (row) =>
        set((state) => {
          if (hasPending(state.sync.outbox, SETTINGS_KEY, 'me')) return {}
          const incoming = settingsToLocal(row)
          // `amountHidden` volutamente non applicato: resta la preferenza
          // di questo dispositivo (vedi withSettingsOp).
          return {
            monthlyBudget: incoming.monthlyBudget,
            currency: incoming.currency,
            cycleStartDay: incoming.cycleStartDay,
          }
        }),

      // Applica un backup importato (vedi sync/backup.js e la card
      // "Backup" in Impostazioni). Unico punto in cui uno stato arrivato
      // da FUORI entra nello store, quindi unico punto da guardare per
      // convincersi che un import non possa distruggere niente:
      //  - mode 'merge' (default) aggiunge solo le righe con un id che
      //    qui non esiste e non tocca le impostazioni già valorizzate;
      //  - mode 'replace' sostituisce, ed è raggiungibile solo dopo una
      //    conferma esplicita nella UI;
      //  - in entrambi i casi chi chiama ha già salvato una copia dello
      //    stato corrente su una chiave separata (saveAutoBackup).
      // Restituisce il resoconto di cosa è stato fatto, così la UI può
      // dire esattamente quante righe sono entrate invece di un generico
      // "fatto".
      importBackup: (snapshot, mode = 'merge') => {
        const previous = get()
        const { patch, report } = buildImportPatch(previous, snapshot, mode)
        // Le categorie personalizzate arrivate dal file devono finire
        // subito nel registro di categories.js, o le spese che le usano
        // verrebbero disegnate come "Altro" fino al prossimo reload.
        registerCustomCategories(patch.customCategories)

        // Le righe entrate con l'import sono modifiche locali come tutte
        // le altre: vanno in coda e raggiungeranno il cloud al prossimo
        // sync. Senza questo, un backup importato resterebbe su questo
        // solo dispositivo.
        const stampedAt = nowIso()
        let sync = previous.sync
        for (const collection of ['expenses', 'incomes', 'goals', 'goalContributions', 'customCategories', 'emergencyFundContributions']) {
          const before = new Map((previous[collection] ?? []).map((row) => [row.id, row]))
          const changed = patch[collection]
            .filter((row) => before.get(row.id) !== row)
            .map((row) => ({ ...row, updatedAt: row.updatedAt ?? stampedAt }))
          patch[collection] = patch[collection].map(
            (row) => changed.find((candidate) => candidate.id === row.id) ?? row,
          )
          sync = withOps(sync, collection, changed)
        }
        if (patch.monthlyBudget !== previous.monthlyBudget || patch.cycleStartDay !== previous.cycleStartDay) {
          sync = {
            ...sync,
            outbox: enqueueOp(sync.outbox, {
              collection: SETTINGS_KEY,
              rowId: 'me',
              row: {
                monthlyBudget: patch.monthlyBudget,
                currency: patch.currency,
                cycleStartDay: patch.cycleStartDay,
                amountHidden: previous.amountHidden,
                updatedAt: stampedAt,
              },
              updatedAt: stampedAt,
            }),
          }
        }

        set({ ...patch, sync })
        return report
      },
    }),
    {
      name: 'spendy-storage',
      // `today`, `activeTab`, `modal`/`modalPayload` are deliberately
      // excluded: `today` must always be re-derived from the real clock
      // on load (persisting it would freeze the app on whatever date it
      // was last closed), and the other three are transient UI state
      // that shouldn't survive a reload.
      partialize: (state) => ({
        monthlyBudget: state.monthlyBudget,
        currency: state.currency,
        cycleStartDay: state.cycleStartDay,
        amountHidden: state.amountHidden,
        expenses: state.expenses,
        incomes: state.incomes,
        customCategories: state.customCategories,
        goals: state.goals,
        goalContributions: state.goalContributions,
        emergencyFundSaved: state.emergencyFundSaved,
        emergencyFundContributions: state.emergencyFundContributions,
        spendyJokeHistory: state.spendyJokeHistory,
        // La coda di invio DEVE sopravvivere a un reload, alla chiusura
        // del browser e al riavvio del Mac: è ciò che garantisce che una
        // spesa inserita offline non si perda se l'app viene chiusa prima
        // che torni la connessione. `status` ed `error` invece no, sono
        // transienti: al riavvio si riparte da 'idle' e si ricontrolla.
        sync: {
          userId: state.sync.userId,
          outbox: state.sync.outbox,
          cursors: state.sync.cursors,
          lastSyncAt: state.sync.lastSyncAt,
          migratedAt: state.sync.migratedAt,
        },
      }),
      // Custom categories live in the store (so they persist) but are
      // READ through categories.js's own little registry (so pure utils
      // like behaviorEngine.js can resolve them without importing the
      // store) — this syncs that registry once, right after whatever was
      // saved last session is loaded back in.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (state.customCategories) registerCustomCategories(state.customCategories)

        // Il blob salvato non contiene `status`/`error` (vedi partialize)
        // e, se arriva da una versione precedente al sync, non contiene
        // `sync` affatto: si riparte dai valori iniziali e si sovrascrive
        // con ciò che era stato salvato davvero.
        state.sync = { ...INITIAL_SYNC, ...(state.sync ?? {}), status: 'idle', error: null }

        // Migrazione locale: sessioni salvate prima che i versamenti
        // sugli obiettivi fossero righe hanno solo `goal.saved`. Si
        // ricostruisce una voce "legacy" con id stabile — il totale non
        // cambia, ma da qui in poi è una riga sincronizzabile come le
        // altre. Nessun dato viene toccato o perso: si AGGIUNGE lo
        // storico che mancava.
        state.goalContributions = state.goalContributions ?? []
        const missing = (state.goals ?? [])
          .filter((goal) => goal.saved > 0 && !state.goalContributions.some((c) => c.goalId === goal.id))
          .map((goal) => ({
            id: `gc-legacy-${goal.id}`,
            goalId: goal.id,
            amount: goal.saved,
            date: state.today,
            // Nessun `updatedAt`: e' il segno che distingue una riga
            // storica (mai vista dal cloud) da una gia' sincronizzata.
            // Lo usa migrateLocal.js per capire cosa caricare.
          }))
        if (missing.length > 0) state.goalContributions = [...state.goalContributions, ...missing]
        if (state.goals) state.goals = recomputeGoals(state.goals, state.goalContributions)
        // Migration: sessions saved before emergencyFundContributions
        // existed have a plain emergencyFundSaved total with no history
        // behind it — seed one "legacy" entry so that total stays
        // correct and is now itself editable/deletable like any other.
        if (state.emergencyFundSaved > 0 && (state.emergencyFundContributions ?? []).length === 0) {
          state.emergencyFundContributions = [
            { id: 'ef-legacy', amount: state.emergencyFundSaved, date: state.today },
          ]
        }
      },
    },
  ),
)
