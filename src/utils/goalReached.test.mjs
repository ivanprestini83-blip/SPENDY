// Fase 2B.8: un obiettivo raggiunto si festeggia una volta (il giorno del
// raggiungimento e quello dopo), poi gli avvisi sul budget tornano davanti.
// `npm test`, senza rete.
//
// Verificato qui:
//   - reachedOn: derivato dai versamenti (più versamenti, stesso giorno,
//     obiettivo creato già completo, righe "gc-legacy-" delle vecchie
//     migrazioni, obiettivi non raggiunti), deterministico;
//   - lo store lo ricalcola in ogni percorso: creazione, versamento, riavvio
//     (persist.rehydrate), dati scaricati dal cloud (applyRemote), import di
//     un backup; non viaggia mai verso il server (toRemoteRow);
//   - la finestra: oggi, ieri, data "di domani" (fusi orari), fuori finestra;
//   - la priorità del budget: > 0 festa, = 0 frase sobria, < 0 avviso;
//   - coach locale ed eventi di Spendy AI scelgono lo stesso obiettivo, e fuori
//     finestra non nasce nessun evento goal_reached.

import { check, section, report, installFakeLocalStorage } from '../sync/testkit.mjs'
import { goalReachedOn, isInCelebrationWindow, findCelebratedGoal, GOAL_CELEBRATION_DAYS, LEGACY_CONTRIBUTION_PREFIX } from './goalReached.js'
import { getSpendyCoach } from './spendyCoach.js'
import { detectSpendyEvents } from '../ai/spendyEvents.js'
import { buildSpendyAIContext } from '../ai/spendyAIContext.js'
import { toRemoteRow } from '../sync/mappers.js'
import { buildImportPatch } from '../sync/backup.js'
import { translate } from '../i18n/translate.js'

const TODAY = '2026-10-11'
const YESTERDAY = '2026-10-10'
const TWO_DAYS_AGO = '2026-10-09'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const GUEST_KEY = 'spendy-storage-v2:guest'
let fresh = 0
const loadStore = async () => (await import(`../store/useAppStore.js?goal-reached-test=${fresh += 1}`)).useAppStore
const gc = (id, goalId, amount, date) => ({ id, goalId, amount, date, updatedAt: `${date}T10:00:00.000Z` })

// ---------------------------------------------------------------------------
section('reachedOn: il giorno in cui i versamenti raggiungono il target')
{
  const goal = { id: 'g1', target: 500 }
  check('più versamenti: il giorno di quello che supera il target', goalReachedOn(goal, [gc('a', 'g1', 200, '2026-09-01'), gc('b', 'g1', 200, '2026-09-20'), gc('c', 'g1', 150, '2026-10-05'), gc('d', 'g1', 50, '2026-10-08')]) === '2026-10-05')
  check('   esattamente il target conta come raggiunto', goalReachedOn(goal, [gc('a', 'g1', 300, '2026-09-01'), gc('b', 'g1', 200, '2026-10-02')]) === '2026-10-02')
  check('   l\'ordine dell\'array non conta (deterministico)', goalReachedOn(goal, [gc('d', 'g1', 50, '2026-10-08'), gc('c', 'g1', 150, '2026-10-05'), gc('b', 'g1', 200, '2026-09-20'), gc('a', 'g1', 200, '2026-09-01')]) === '2026-10-05')
  check('più versamenti nello stesso giorno: quel giorno', goalReachedOn(goal, [gc('a', 'g1', 100, TODAY), gc('b', 'g1', 250, TODAY), gc('c', 'g1', 150, TODAY)]) === TODAY)
  check('obiettivo creato già completo (versamento iniziale ≥ target): il giorno della creazione', goalReachedOn(goal, [gc('first', 'g1', 600, TODAY)]) === TODAY)
  check('obiettivo non raggiunto: null', goalReachedOn(goal, [gc('a', 'g1', 499.99, TODAY)]) === null && goalReachedOn(goal, []) === null)
  check('centesimi: 0,1 + 0,2 su un target di 0,3 è raggiunto (niente errori di virgola mobile)', goalReachedOn({ id: 'g', target: 0.3 }, [gc('a', 'g', 0.1, TODAY), gc('b', 'g', 0.2, TODAY)]) === TODAY)
  check('solo i versamenti di quell\'obiettivo', goalReachedOn(goal, [gc('a', 'g2', 900, TODAY), gc('b', 'g1', 100, TODAY)]) === null)
  check(`riga ricostruita da una vecchia migrazione ("${LEGACY_CONTRIBUTION_PREFIX}…"): data sconosciuta → null, nessuna festa`, goalReachedOn(goal, [{ id: 'gc-legacy-g1', goalId: 'g1', amount: 500, date: TODAY }]) === null)
  check('   ma se il target lo supera un versamento vero, dopo: la data di quello', goalReachedOn(goal, [{ id: 'gc-legacy-g1', goalId: 'g1', amount: 300, date: '2026-09-01' }, gc('b', 'g1', 200, YESTERDAY)]) === YESTERDAY)
  check('versamento senza data che fa superare il target: null', goalReachedOn(goal, [{ id: 'x', goalId: 'g1', amount: 500 }]) === null)
  check('target non valido: null', goalReachedOn({ id: 'g1', target: 0 }, [gc('a', 'g1', 10, TODAY)]) === null)
  check('target aumentato sopra il risparmiato: null (torna aperto); raggiunto di nuovo: la nuova data', goalReachedOn({ id: 'g1', target: 800 }, [gc('a', 'g1', 600, '2026-09-01')]) === null && goalReachedOn({ id: 'g1', target: 800 }, [gc('a', 'g1', 600, '2026-09-01'), gc('b', 'g1', 200, TODAY)]) === TODAY)
}

section('Finestra della festa: il giorno del raggiungimento e quello dopo')
{
  check(`GOAL_CELEBRATION_DAYS = 2`, GOAL_CELEBRATION_DAYS === 2)
  check('oggi e ieri: dentro', isInCelebrationWindow(TODAY, TODAY) && isInCelebrationWindow(YESTERDAY, TODAY))
  check('due giorni fa e prima: fuori', !isInCelebrationWindow(TWO_DAYS_AGO, TODAY) && !isInCelebrationWindow('2026-01-01', TODAY))
  check('a cavallo di mese e anno: 31/12 → 1/1 dentro, 30/12 → 1/1 fuori', isInCelebrationWindow('2026-12-31', '2027-01-01') && !isInCelebrationWindow('2026-12-30', '2027-01-01'))
  check('data "di domani" (versamento su un dispositivo con fuso più avanti): dentro; dopodomani no', isInCelebrationWindow('2026-10-12', TODAY) && !isInCelebrationWindow('2026-10-13', TODAY))
  check('date mancanti o non valide: fuori', !isInCelebrationWindow(null, TODAY) && !isInCelebrationWindow(TODAY, undefined) && !isInCelebrationWindow('11/10/2026', TODAY))
  const goals = [
    { id: 'old', label: 'Vecchio', target: 100, saved: 100, reachedOn: '2026-05-01' },
    { id: 'y', label: 'Ieri', target: 100, saved: 120, reachedOn: YESTERDAY },
    { id: 't', label: 'Oggi', target: 100, saved: 100, reachedOn: TODAY },
    { id: 'open', label: 'Aperto', target: 100, saved: 50, reachedOn: null },
  ]
  check('più obiettivi raggiunti: il più recente nella finestra', findCelebratedGoal(goals, TODAY)?.id === 't' && findCelebratedGoal(goals.filter((goal) => goal.id !== 't'), TODAY)?.id === 'y')
  check('solo obiettivi vecchi o aperti: nessuno', findCelebratedGoal([goals[0], goals[3]], TODAY) === null)
  check('obiettivo senza il campo reachedOn (dati costruiti a mano): come prima, si festeggia', findCelebratedGoal([{ id: 'x', label: 'X', target: 10, saved: 10 }], TODAY)?.id === 'x')
}

// ---------------------------------------------------------------------------
section('Store: reachedOn in ogni percorso (creazione, versamento, riavvio, cloud, backup)')
{
  const map = installFakeLocalStorage()
  let useAppStore = await loadStore()
  const S = () => useAppStore.getState()
  useAppStore.setState({ today: TODAY })
  S().addGoal({ label: 'Bici', emoji: '🚲', target: 500, saved: 200 })
  const id = S().goals[0].id
  check('creazione con 200 su 500: non raggiunto (reachedOn null)', S().goals[0].reachedOn === null && S().goals[0].saved === 200)
  S().contributeToGoal(id, 300)
  check('versamento che arriva al target: reachedOn = oggi', S().goals[0].reachedOn === TODAY && S().goals[0].saved === 500)
  S().contributeToGoal(id, 50)
  check('versamento successivo: la data resta quella del raggiungimento', S().goals[0].reachedOn === TODAY)
  S().addGoal({ label: 'Già fatto', target: 100, saved: 150 })
  check('obiettivo creato già completo: reachedOn = oggi', S().goals.find((goal) => goal.label === 'Già fatto').reachedOn === TODAY)

  // Riavvio: il contenitore salvato ha un reachedOn sbagliato e un versamento "vecchio".
  const saved = JSON.parse(map.get(GUEST_KEY))
  saved.state.goals = saved.state.goals.map((goal) => ({ ...goal, reachedOn: '1999-01-01' }))
  saved.state.goalContributions = saved.state.goalContributions.map((row) => (row.goalId === id ? { ...row, date: '2026-09-01' } : row))
  map.set(GUEST_KEY, JSON.stringify(saved))
  await useAppStore.persist.rehydrate()
  check('riavvio: reachedOn ricalcolato dai versamenti salvati (il valore salvato non conta)', S().goals.find((goal) => goal.id === id).reachedOn === '2026-09-01')

  // Contenitore molto vecchio, senza versamenti: la migrazione crea la riga "gc-legacy-".
  const legacy = JSON.parse(map.get(GUEST_KEY))
  legacy.state.goals = [{ id: 'gold', label: 'Vecchio', emoji: '🎯', target: 300, saved: 300, updatedAt: '2026-01-01T00:00:00.000Z' }]
  legacy.state.goalContributions = []
  map.set(GUEST_KEY, JSON.stringify(legacy))
  await useAppStore.persist.rehydrate()
  const old = S().goals.find((goal) => goal.id === 'gold')
  check('vecchia migrazione: riga gc-legacy- ricostruita con data di oggi, ma nessuna festa (reachedOn null)', S().goalContributions.some((row) => row.id === 'gc-legacy-gold' && row.date === TODAY) && old.saved === 300 && old.reachedOn === null)

  // Dati dal cloud: un versamento fatto su un altro dispositivo ieri completa l'obiettivo.
  useAppStore = await loadStore()
  useAppStore.setState({ today: TODAY, goals: [], goalContributions: [] })
  // applyRemote riceve le righe COME ARRIVANO dal server (le converte lui con toLocalRow).
  S().applyRemote('goals', [{ id: 'gc1', label: 'Divano', emoji: '🛋️', target: '400.00', eta_months: 6, client_updated_at: '2026-09-01T00:00:00Z', deleted_at: null }])
  check('cloud: obiettivo senza versamenti → reachedOn null', S().goals[0]?.reachedOn === null, JSON.stringify(S().goals))
  S().applyRemote('goalContributions', [
    { id: 'r1', goal_id: 'gc1', amount: '250.00', date: '2026-09-15', client_updated_at: '2026-09-15T10:00:00Z', deleted_at: null },
    { id: 'r2', goal_id: 'gc1', amount: '150.00', date: YESTERDAY, client_updated_at: `${YESTERDAY}T10:00:00Z`, deleted_at: null },
  ])
  check('cloud: versamenti scaricati → reachedOn = ieri, come sull\'altro dispositivo', S().goals[0]?.reachedOn === YESTERDAY && S().goals[0].saved === 400, JSON.stringify(S().goals))

  // Payload verso il server: mai reachedOn (né saved).
  const remote = toRemoteRow('goals', { ...S().goals[0], reachedOn: TODAY }, 'user-1')
  check('toRemoteRow(goals): nessun reachedOn né saved nel payload', !('reachedOn' in remote) && !('reached_on' in remote) && !('saved' in remote) && same(Object.keys(remote).sort(), ['deleted_at', 'emoji', 'eta_months', 'id', 'label', 'target', 'user_id', 'client_updated_at'].sort()), JSON.stringify(remote))
  const contribution = toRemoteRow('goalContributions', S().goalContributions[0], 'user-1')
  check('toRemoteRow(goalContributions): invariato (nessun campo nuovo)', !('reachedOn' in contribution) && 'date' in contribution && 'goal_id' in contribution)
  const outbox = JSON.stringify(S().sync.outbox)
  check('nessun reachedOn nella coda di invio', !outbox.includes('reachedOn'))

  // Import di un backup: reachedOn ricalcolato, il valore nel file non conta.
  const state = S()
  const snapshot = { goals: [{ id: 'b1', label: 'Import', emoji: '🎯', target: 100, saved: 0, reachedOn: '1999-01-01' }], goalContributions: [gc('bc1', 'b1', 100, YESTERDAY)], expenses: [], incomes: [], customCategories: [], emergencyFundContributions: [] }
  const { patch } = buildImportPatch(state, snapshot, 'replace')
  check('import di un backup: reachedOn ricalcolato dai versamenti (ieri)', patch.goals.find((goal) => goal.id === 'b1')?.reachedOn === YESTERDAY, JSON.stringify(patch.goals))
}

// ---------------------------------------------------------------------------
section('Coach: festa nella finestra, poi la cascata; il budget prevale')
{
  const goal = (reachedOn, extra = {}) => ({ id: 'g1', label: 'Bici', target: 500, saved: 500, reachedOn, ...extra })
  const coachFor = (available, goals, lang = 'it') => getSpendyCoach(
    { monthlyBudget: 1500, available, spentRatio: ((1500 - available) / 1500) * 100, spentThisMonth: 1500 - available, goals },
    { today: TODAY, expenses: [], cycleStartDay: 7, jokeHistory: [], lang },
  )
  for (const [when, reachedOn] of [['oggi', TODAY], ['ieri', YESTERDAY]]) {
    check(`raggiunto ${when}, disponibile > 0: festa (celebrating, frase di sempre)`, coachFor(1200, [goal(reachedOn)]).reason === 'goal_reached' && coachFor(1200, [goal(reachedOn)]).state === 'celebrating' && coachFor(1200, [goal(reachedOn)]).message === translate('it', 'coach.goalreached', { goal: 'Bici' }))
    check(`raggiunto ${when}, disponibile = 0: frase sobria che dice "esaurito" (advisor)`, coachFor(0, [goal(reachedOn)]).state === 'advisor' && coachFor(0, [goal(reachedOn)]).message === translate('it', 'coach.goalreachedtight', { goal: 'Bici' }) && /esaurito/.test(coachFor(0, [goal(reachedOn)]).message))
    check(`raggiunto ${when}, disponibile < 0 (anche -0,40): avviso di budget superato, nessuna festa`, ['budget_exceeded'].includes(coachFor(-120, [goal(reachedOn)]).reason) && coachFor(-0.4, [goal(reachedOn)]).reason === 'budget_exceeded' && !coachFor(-120, [goal(reachedOn)]).message.includes('Bici'))
  }
  check('la frase sobria dice "esaurito" nelle 4 lingue', ['it', 'en', 'es', 'fr'].every((lang) => /esaurito|used up|agotado|épuisé/.test(coachFor(0, [goal(TODAY)], lang).message)), ['it', 'en', 'es', 'fr'].map((lang) => coachFor(0, [goal(TODAY)], lang).message).join(' | '))
  check('disponibile -0,001 (zero al centesimo, come la card): frase sobria, non avviso', coachFor(-0.001, [goal(TODAY)]).state === 'advisor')
  check('raggiunto due giorni fa: nessuna festa; budget sano → on_track', coachFor(1200, [goal(TWO_DAYS_AGO)]).reason === 'on_track')
  check('   budget esaurito → budget_high; superato → budget_exceeded', coachFor(0, [goal(TWO_DAYS_AGO)]).reason === 'budget_high' && coachFor(-120, [goal(TWO_DAYS_AGO)]).reason === 'budget_exceeded')
  check('obiettivo della vecchia migrazione (reachedOn null): nessuna festa, mai', coachFor(1200, [goal(null)]).reason === 'on_track' && coachFor(0, [goal(null)]).reason === 'budget_high')
  check('obiettivi non raggiunti: comportamento invariato (on_track)', coachFor(1200, [{ id: 'o', label: 'Aperto', target: 500, saved: 100, reachedOn: null }]).reason === 'on_track')
  const many = [goal(TWO_DAYS_AGO, { id: 'a', label: 'Vecchio' }), goal(YESTERDAY, { id: 'b', label: 'Ieri' }), goal(TODAY, { id: 'c', label: 'Oggi' })]
  check('più obiettivi: si festeggia il più recente', coachFor(1200, many).message.includes('Oggi'))
}

section('Coach ed eventi di Spendy AI: stesso obiettivo, nessuna festa fuori finestra')
{
  const goals = [
    { id: 'a', label: 'Vecchio', target: 300, saved: 300, reachedOn: '2026-08-01' },
    { id: 'b', label: 'Ieri', target: 200, saved: 250, reachedOn: YESTERDAY },
  ]
  const financialData = { monthlyBudget: 1500, available: 1200, spentRatio: 20, spentThisMonth: 300, goals }
  const behavior = { today: TODAY, expenses: [], cycleStartDay: 7, jokeHistory: [], lang: 'it' }
  const coach = getSpendyCoach(financialData, behavior)
  const events = detectSpendyEvents({ coach, insights: [], expenses: [], today: TODAY, goals, financialData })
  const goalEvent = events.find((event) => event.id === 'goal_reached')
  check('nella finestra: coach ed evento AI sullo stesso obiettivo ("Ieri", non il primo della lista)', coach.reason === 'goal_reached' && coach.message.includes('Ieri') && goalEvent?.goal?.id === 'b', JSON.stringify(goalEvent?.goal))
  const { context } = buildSpendyAIContext({ events, coach, financialData, expenses: [], today: TODAY, cycleStartDay: 7, goals, locale: 'it', currency: 'EUR' })
  check('   e il contesto mandato al modello parla di quello', context.goal?.label === 'Ieri', JSON.stringify(context.goal))

  const later = { ...behavior, today: '2026-10-12' }
  const coachLater = getSpendyCoach(financialData, later)
  const eventsLater = detectSpendyEvents({ coach: coachLater, insights: [], expenses: [], today: '2026-10-12', goals, financialData })
  check('fuori finestra: il coach non festeggia e nessun evento goal_reached', coachLater.reason !== 'goal_reached' && !eventsLater.some((event) => event.id === 'goal_reached'), `${coachLater.reason} ${JSON.stringify(eventsLater.map((event) => event.id))}`)

  const overData = { ...financialData, available: -50, spentRatio: 103, spentThisMonth: 1550 }
  const coachOver = getSpendyCoach(overData, behavior)
  const eventsOver = detectSpendyEvents({ coach: coachOver, insights: [], expenses: [], today: TODAY, goals, financialData: overData })
  check('budget superato nella finestra: coach ed eventi AI parlano del budget, nessun goal_reached', coachOver.reason === 'budget_exceeded' && !eventsOver.some((event) => event.id === 'goal_reached'), `${coachOver.reason} ${JSON.stringify(eventsOver.map((event) => event.id))}`)
}

report('Obiettivi raggiunti: una festa sola (Fase 2B.8)')
