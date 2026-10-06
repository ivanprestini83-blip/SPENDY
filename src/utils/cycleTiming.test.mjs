// Il tempo del ciclo di budget impostato dall'utente — una sola fonte
// (cycle.js getCycleTiming) per coach, BehaviorEngine/HumorEngine e Spendy AI.
// `npm test`, senza rete.
//
// Il bug di partenza: ciclo 7 settembre → 6 ottobre, oggi 6 ottobre, Spendy
// diceva "abbiamo superato i tre quarti e la strada è ancora lunga" (frase
// fissa del coach) e l'AI riceveva daysRemaining = 1 invece di 0.

import { check, section, report, installFakeLocalStorage } from '../sync/testkit.mjs'
import { getCycleTiming, getCycleRange, isWithinRange } from './cycle.js'
import { buildFinancialData } from './budgetCalculations.js'
import { getSpendyCoach } from './spendyCoach.js'
import { generateJokeCandidates } from './humorEngine.js'
import { humorLibrary } from './humorLibrary.js'
import { BEHAVIOR_TYPES, analyzeBehavior } from './behaviorEngine.js'
import { buildSpendyAIContext } from '../ai/spendyAIContext.js'
import { prepareSpendyVoice } from '../ai/spendyVoice.js'
import { createSpendyAI } from '../ai/spendyAI.js'
import { createMockProvider } from '../ai/providers/mockProvider.js'
import {
  sanitizeSpendyContext, validateSpendyResponse, contradictsCyclePhase, SPENDY_PERSONALITY,
} from '../../supabase/functions/_shared/spendyAIRules.js'
import { CYCLE_PHASES, LATE_PHASES } from '../../supabase/functions/_shared/cyclePhases.js'

const timingOf = (today, day) => {
  const t = getCycleTiming(today, day)
  return `${t.start}→${t.lastDay} ${t.dayOfCycle}/${t.cycleDays} rest:${t.daysRemaining} incl:${t.daysLeftIncludingToday} ${t.phase}`
}
let seq = 0
const expense = (date, amount, categoryId = 'spesa') => ({ id: `e-${seq++}`, date, amount, categoryId, description: '' })

// =====================================================================
section('getCycleTiming: ciclo 7 settembre → 6 ottobre')
// =====================================================================
check('6 ottobre: ultimo giorno, daysRemaining 0', timingOf('2026-10-06', 7) === '2026-09-07→2026-10-06 30/30 rest:0 incl:1 last_day', timingOf('2026-10-06', 7))
check('5 ottobre: 1 giorno dopo oggi, ultimi giorni', timingOf('2026-10-05', 7) === '2026-09-07→2026-10-06 29/30 rest:1 incl:2 final_days', timingOf('2026-10-05', 7))
check('22 settembre: metà ciclo, 14 giorni dopo oggi', timingOf('2026-09-22', 7) === '2026-09-07→2026-10-06 16/30 rest:14 incl:15 mid', timingOf('2026-09-22', 7))
check('7 settembre: primo giorno, nuovo ciclo', timingOf('2026-09-07', 7) === '2026-09-07→2026-10-06 1/30 rest:29 incl:30 new_cycle', timingOf('2026-09-07', 7))
check('7 ottobre: parte il ciclo nuovo (7 ottobre → 6 novembre)', timingOf('2026-10-07', 7) === '2026-10-07→2026-11-06 1/31 rest:30 incl:31 new_cycle', timingOf('2026-10-07', 7))
check('fasi intermedie: 10 set start, 15 set first_half, 28 set second_half',
  getCycleTiming('2026-09-10', 7).phase === 'start' && getCycleTiming('2026-09-15', 7).phase === 'first_half' && getCycleTiming('2026-09-28', 7).phase === 'second_half')
check('3 ottobre: ultimi giorni (3 dopo oggi), 2 ottobre: ancora seconda metà',
  getCycleTiming('2026-10-03', 7).phase === 'final_days' && getCycleTiming('2026-10-02', 7).phase === 'second_half')

// =====================================================================
section('getCycleTiming: giorno 1, mesi di 28/29/30/31 giorni, cambio d\'anno')
// =====================================================================
check('ciclo dal 1: 1 → 30 settembre, il 30 è l\'ultimo giorno', timingOf('2026-09-30', 1) === '2026-09-01→2026-09-30 30/30 rest:0 incl:1 last_day', timingOf('2026-09-30', 1))
check('ciclo dal 1: 1 → 31 ottobre', timingOf('2026-10-31', 1) === '2026-10-01→2026-10-31 31/31 rest:0 incl:1 last_day', timingOf('2026-10-31', 1))
check('ciclo dal 1: febbraio non bisestile (28)', timingOf('2026-02-28', 1) === '2026-02-01→2026-02-28 28/28 rest:0 incl:1 last_day', timingOf('2026-02-28', 1))
check('ciclo dal 1: febbraio bisestile (29)', timingOf('2028-02-29', 1) === '2028-02-01→2028-02-29 29/29 rest:0 incl:1 last_day', timingOf('2028-02-29', 1))
check('ciclo dal 15 a cavallo dell\'anno: 31 dicembre', timingOf('2026-12-31', 15) === '2026-12-15→2027-01-14 17/31 rest:14 incl:15 mid', timingOf('2026-12-31', 15))
check('   14 gennaio: ultimo giorno', timingOf('2027-01-14', 15) === '2026-12-15→2027-01-14 31/31 rest:0 incl:1 last_day', timingOf('2027-01-14', 15))
check('   15 gennaio: nuovo ciclo', getCycleTiming('2027-01-15', 15).phase === 'new_cycle' && getCycleTiming('2027-01-15', 15).start === '2027-01-15')
check('ciclo dal 31 in un mese di 30: il 30 aprile apre il proprio ciclo', timingOf('2026-04-30', 31) === '2026-04-30→2026-05-30 1/31 rest:30 incl:31 new_cycle', timingOf('2026-04-30', 31))
check('   e il 29 aprile chiude il precedente', timingOf('2026-04-29', 31) === '2026-03-31→2026-04-29 30/30 rest:0 incl:1 last_day', timingOf('2026-04-29', 31))
{
  let incoherent = 0
  for (let d = 1; d <= 31; d += 1) {
    for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2028, 11, 31); t += 86400000) {
      const day = new Date(t).toISOString().slice(0, 10)
      const x = getCycleTiming(day, d)
      if (!isWithinRange(day, getCycleRange(day, d)) || x.dayOfCycle < 1 || x.dayOfCycle > x.cycleDays
        || x.dayOfCycle + x.daysRemaining !== x.cycleDays || !CYCLE_PHASES.includes(x.phase)
        || (x.daysRemaining === 0) !== (x.phase === 'last_day' || (x.dayOfCycle === 1 && x.cycleDays === 1))) incoherent += 1
    }
  }
  check('3 anni × tutti i 31 giorni di inizio: ogni giorno nel suo ciclo, giorno + rimanenti = durata, fasi valide', incoherent === 0, String(incoherent))
}

// =====================================================================
section('buildFinancialData: una sola fonte per il tempo')
// =====================================================================
{
  const fd = buildFinancialData({ today: '2026-10-06', monthlyBudget: 1000, expenses: [expense('2026-09-08', 760)], incomes: [], goals: [], cycleStartDay: 7 })
  check('financialData.cycle = getCycleTiming(oggi, giorno di inizio)', JSON.stringify(fd.cycle) === JSON.stringify(getCycleTiming('2026-10-06', 7)))
  check('   speso e disponibile sul ciclo dell\'utente', fd.spentThisMonth === 760 && fd.available === 240)
  const before = buildFinancialData({ today: '2026-10-06', monthlyBudget: 1000, expenses: [expense('2026-09-06', 500)], incomes: [], goals: [], cycleStartDay: 7 })
  check('   una spesa del ciclo precedente (6 settembre) non conta', before.spentThisMonth === 0)
}

// =====================================================================
section('Contesto di Spendy AI: tempo corretto e coerente con l\'app')
// =====================================================================
function contextFor(today, { spent = 760, budget = 1000, cycleStartDay = 7 } = {}) {
  const expenses = [expense(getCycleTiming(today, cycleStartDay).start, spent)]
  const financialData = buildFinancialData({ today, monthlyBudget: budget, expenses, incomes: [], goals: [], cycleStartDay })
  const coach = getSpendyCoach(financialData, { expenses, today, monthlyBudget: budget, cycleStartDay, goals: [], jokeHistory: [], financialData })
  const prepared = prepareSpendyVoice({ coach, financialData, expenses, today, monthlyBudget: budget, cycleStartDay, goals: [] })
  return { financialData, coach, expenses, ...prepared }
}
{
  const last = contextFor('2026-10-06')
  check('6 ottobre: daysRemaining 0, last_day, giorno 30/30', last.context.budget.daysRemaining === 0 && last.context.budget.cyclePhase === 'last_day'
    && last.context.budget.dayOfCycle === 30 && last.context.budget.cycleDays === 30, JSON.stringify(last.context.budget))
  check('   quota giornaliera = tutto il disponibile (oggi conta)', last.context.budget.dailyAllowance === 240)
  check('   disponibile uguale a quello mostrato nell\'app', last.context.budget.available === Math.round(last.financialData.available))
  const fifth = contextFor('2026-10-05')
  check('5 ottobre: daysRemaining 1, final_days, quota su 2 giorni', fifth.context.budget.daysRemaining === 1 && fifth.context.budget.cyclePhase === 'final_days' && fifth.context.budget.dailyAllowance === 120)
  const mid = contextFor('2026-09-22')
  check('22 settembre: daysRemaining 14, mid, quota su 15 giorni', mid.context.budget.daysRemaining === 14 && mid.context.budget.cyclePhase === 'mid' && mid.context.budget.dailyAllowance === Math.floor(240 / 15))
  const fresh = contextFor('2026-10-07', { spent: 10 })
  check('7 ottobre: nuovo ciclo, giorno 1/31', fresh.context.budget.cyclePhase === 'new_cycle' && fresh.context.budget.dayOfCycle === 1 && fresh.context.budget.cycleDays === 31 && fresh.context.budget.daysRemaining === 30)
  const yearEnd = contextFor('2027-01-14', { cycleStartDay: 15 })
  check('ciclo a cavallo dell\'anno, 14 gennaio: last_day', yearEnd.context.budget.cyclePhase === 'last_day' && yearEnd.context.budget.daysRemaining === 0)
  const over = contextFor('2026-10-06', { spent: 1200 })
  check('budget superato nell\'ultimo giorno: nessuna quota giornaliera', over.context.budget.dailyAllowance === undefined && over.context.budget.cyclePhase === 'last_day')

  const sent = sanitizeSpendyContext(last.context)
  check('filtro del server: fase, giorno e durata arrivano ad Anthropic', sent.budget.cyclePhase === 'last_day' && sent.budget.dayOfCycle === 30 && sent.budget.cycleDays === 30 && sent.budget.daysRemaining === 0)
  check('   una fase inventata viene scartata', sanitizeSpendyContext({ ...last.context, budget: { ...last.context.budget, cyclePhase: 'fine_mese' } }).budget.cyclePhase === undefined)
  check('il prompt spiega le fasi e vieta "mese" e "strada lunga" a fine ciclo',
    /TEMPO/.test(SPENDY_PERSONALITY) && /last_day = ultimo giorno/.test(SPENDY_PERSONALITY) && /mai di "mese"/.test(SPENDY_PERSONALITY) && /non dire che la strada è lunga/.test(SPENDY_PERSONALITY))
}

// =====================================================================
section('Controllo delle frasi dell\'AI: niente contraddizioni con la fase')
// =====================================================================
{
  const base = { state: 'attentive', tone: 'helpful', layout: null, animation: 'gentle', priority: 50, shouldShow: true }
  const ctx = (phase) => ({ budget: { band: 'warning', available: 240, spentPercent: 76, daysRemaining: phase === 'last_day' ? 0 : 1, cyclePhase: phase } })
  const bug = 'Abbiamo superato i tre quarti del budget e la strada è ancora lunga.'
  check('la frase del bug nell\'ultimo giorno: rifiutata', validateSpendyResponse({ ...base, message: bug }, ctx('last_day')).errors?.includes('incoherent_cycle_phase'))
  check('   negli ultimi giorni: rifiutata', validateSpendyResponse({ ...base, message: bug }, ctx('final_days')).errors?.includes('incoherent_cycle_phase'))
  check('   a inizio ciclo: ammessa', contradictsCyclePhase(bug, 'start') === false)
  check('"il mese non è ancora finito" nell\'ultimo giorno: rifiutata', contradictsCyclePhase('Siamo al limite e il mese non è ancora finito.', 'last_day'))
  check('"metà ciclo" negli ultimi giorni: rifiutata', contradictsCyclePhase('Corriamo troppo per essere a metà ciclo.', 'final_days'))
  check('"restano N giorni" nell\'ultimo giorno: rifiutata', contradictsCyclePhase('Restano 240 € per 1 giorni.', 'last_day'))
  check('"ultimi giorni" a inizio ciclo: rifiutata', contradictsCyclePhase('Ultimi giorni del ciclo, tieni duro.', 'first_half'))
  check('"appena iniziato" nella seconda metà: rifiutata', contradictsCyclePhase('Il ciclo è appena iniziato.', 'second_half'))
  check('una frase coerente nell\'ultimo giorno passa', validateSpendyResponse({ ...base, message: 'Ultimo giorno del ciclo: restano 240 €. Domani si riparte.' }, ctx('last_day')).valid === true)
  check('senza fase nel contesto: nessun rifiuto per il tempo (contesti di prima)', contradictsCyclePhase(bug, undefined) === false)
}

// =====================================================================
section('Coach locale: soglie invariate, frase coerente con la fase')
// =====================================================================
{
  const cases = [
    ['2026-09-10', 'start'], ['2026-09-15', 'first_half'], ['2026-09-22', 'mid'], ['2026-09-28', 'second_half'],
    ['2026-10-04', 'final_days'], ['2026-10-05', 'final_days'], ['2026-10-06', 'last_day'], ['2026-10-07', 'new_cycle'],
  ]
  let contradictions = []
  for (const [today, phase] of cases) {
    for (const spent of [760, 900]) {
      const { coach } = contextFor(today, { spent })
      // Il primo giorno la spesa di prova è per forza di oggi: scatta prima la
      // reazione alla spesa grande (livello 2), come già succedeva. Lì si
      // controlla solo che la frase non contraddica la fase.
      if (phase !== 'new_cycle') {
        check(`${today} (${phase}) speso ${spent / 10}%: stesso livello di prima (${spent >= 850 ? 'budget_high' : 'budget_rising'})`, coach.reason === (spent >= 850 ? 'budget_high' : 'budget_rising'), coach.reason)
      }
      for (const text of [coach.message, coach.secondaryInsightText].filter(Boolean)) {
        if (contradictsCyclePhase(text, phase)) contradictions.push(`${today}/${spent}: ${text}`)
      }
    }
  }
  check('nessuna frase del coach contraddice la fase (frase principale e secondaria)', contradictions.length === 0, contradictions.join(' | '))
  const last = contextFor('2026-10-06').coach
  check('6 ottobre al 76%: niente "strada ancora lunga", si dice che è l\'ultimo giorno',
    ![last.message, last.secondaryInsightText].join(' ').includes('strada è ancora lunga') && /ultimo giorno del ciclo/i.test([last.message, last.secondaryInsightText].join(' ')))
  const early = contextFor('2026-09-10').coach
  check('10 settembre al 76%: la frase "strada ancora lunga" resta possibile', /strada è ancora lunga/.test([early.message, early.secondaryInsightText].join(' ')))
  check('le soglie non cambiano: al 69% nessun avviso sul budget', !['budget_high', 'budget_rising'].includes(contextFor('2026-10-06', { spent: 690 }).coach.reason))
}

// =====================================================================
section('HumorEngine: battute del budget coerenti con la fase, in 4 lingue')
// =====================================================================
{
  const LANGS = ['it', 'en', 'fr', 'es']
  const TYPES = [BEHAVIOR_TYPES.BUDGET_EXCEEDED, BEHAVIOR_TYPES.BUDGET_HIGH, BEHAVIOR_TYPES.BUDGET_RISING]
  // Affermazioni "c'è ancora tempo / siamo a metà / il periodo è un mese", in tutte le lingue.
  const TIME_CLAIM = /strada|non è finit|metà|prima della fine|appena|road is still long|more (cycle|month) left|cycle isn’t|month isn’t|bit (early|before)|before the end|route est encore longue|plus de (cycle|mois)|mais pas le (cycle|mois)|avant la fin|plus tôt|camino todavia es largo|mas (ciclo|mes) que|y el (ciclo|mes) no|antes (del final|de lo previsto)|ciclo che resta|accelerat/i
  const MONTH = /\b(mese|month|mois|mes)\b/i
  const insight = (type, cyclePhase) => ({ type, categoryId: null, category: null, current: 90, baseline: 100, changeAmount: -10, changePercent: -10, intensity: 'funny', significance: 120, cyclePhase })
  let leaks = []
  let months = []
  for (const lang of LANGS) {
    for (const type of TYPES) {
      for (const phase of LATE_PHASES) {
        const texts = generateJokeCandidates(insight(type, phase), lang).map((c) => c.text)
        leaks.push(...texts.filter((t) => TIME_CLAIM.test(t)).map((t) => `${lang}/${type}/${phase}: ${t}`))
      }
      const unknown = generateJokeCandidates(insight(type, null), lang).map((c) => c.text)
      leaks.push(...unknown.filter((t) => TIME_CLAIM.test(t)).map((t) => `${lang}/${type}/senza fase: ${t}`))
      for (const key of [type, `${type}_time_left`, 'budget_respected']) {
        months.push(...(humorLibrary[lang].types[key] ?? []).filter((t) => MONTH.test(t)).map((t) => `${lang}/${key}: ${t}`))
      }
    }
  }
  check('ultimi giorni, ultimo giorno o fase ignota: nessuna battuta "c\'è ancora tempo" (4 lingue × 3 tipi)', leaks.length === 0, leaks.join(' | '))
  check('le battute sul budget parlano di "ciclo", non di "mese" (4 lingue)', months.length === 0, months.join(' | '))
  for (const lang of LANGS) {
    const early = generateJokeCandidates(insight(BEHAVIOR_TYPES.BUDGET_RISING, 'first_half'), lang).map((c) => c.text)
    const late = generateJokeCandidates(insight(BEHAVIOR_TYPES.BUDGET_RISING, 'last_day'), lang).map((c) => c.text)
    check(`${lang}: nella prima metà le battute "c'è ancora tempo" tornano disponibili`, early.length > late.length && humorLibrary[lang].types.budget_rising_time_left.every((t) => early.includes(t)))
    check(`${lang}: ogni pool del budget ha ancora battute neutre`, TYPES.every((type) => generateJokeCandidates(insight(type, 'last_day'), lang).length >= 4))
  }
  const { financialData, expenses } = contextFor('2026-10-06', { spent: 760 })
  const budgetInsight = analyzeBehavior({ expenses, today: '2026-10-06', monthlyBudget: 1000, financialData, cycleStartDay: 7 })
    .find((i) => i.type === BEHAVIOR_TYPES.BUDGET_RISING)
  check('BehaviorEngine: l\'insight del budget porta la fase del ciclo', budgetInsight?.cyclePhase === 'last_day', JSON.stringify(budgetInsight?.cyclePhase))
}

// =====================================================================
section('"Budget rispettato": il ciclo concluso si dice solo alla fine')
// =====================================================================
{
  const DONE = /rispettato|completata|vinto la partita|tutto il ciclo|ringrazia personalmente per questo ciclo|respected|accomplished|won the game|all cycle|thanks you for this cycle|respecté|accomplie|gagné le match|tout le cycle|remercie personnellement pour ce cycle|respetado|cumplida|ganaste el partido|todo el ciclo|agradece personalmente este ciclo/i
  const respected = (cyclePhase) => ({ type: BEHAVIOR_TYPES.BUDGET_RESPECTED, categoryId: null, category: null, current: 30, baseline: 100, changeAmount: -70, changePercent: -70, intensity: 'strong', significance: 60, cyclePhase })
  for (const lang of ['it', 'en', 'fr', 'es']) {
    const earlyTexts = ['new_cycle', 'start', 'first_half', 'mid', 'second_half', null].flatMap((phase) => generateJokeCandidates(respected(phase), lang).map((c) => c.text))
    const lastTexts = generateJokeCandidates(respected('last_day'), lang).map((c) => c.text)
    check(`${lang}: prima degli ultimi giorni nessuna battuta di ciclo concluso`, !earlyTexts.some((t) => DONE.test(t)), earlyTexts.filter((t) => DONE.test(t)).join(' | '))
    check(`${lang}: negli ultimi giorni tornano disponibili`, humorLibrary[lang].types.budget_respected_cycle_end.every((t) => lastTexts.includes(t)))
  }
}

// =====================================================================
section('Nessun "questo mese / questa settimana" riferito al ciclo di budget')
// =====================================================================
{
  const { readFileSync } = await import('node:fs')
  const PERIOD = /\b(questo mese|questa settimana|this month|this week|ce mois-ci|cette semaine|este mes|esta semana)\b/i
  const files = ['src/utils/humorLibrary.js', 'src/data/spendyReactionLibrary.js', 'src/utils/spendyCoach.js', 'src/utils/radarEngine.js',
    'src/ai/providers/mockProvider.js', 'src/utils/affordability.js', 'src/utils/expenseReactionEngine.js', 'supabase/functions/_shared/spendyAIRules.js']
  for (const file of files) {
    const code = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')
    const strings = [...code.matchAll(/(['"`])((?:(?!\1).)*?)\1/g)].map((m) => m[2])
    const hits = strings.filter((t) => PERIOD.test(t))
    check(`${file}: nessuna frase con "questo mese / questa settimana"`, hits.length === 0, hits.join(' | '))
  }
}

// =====================================================================
section('AI finta (sviluppo): niente giorni che restano nell\'ultimo giorno')
// =====================================================================
{
  const ai = createSpendyAI({ provider: createMockProvider({ mode: 'normal', latencyMs: 0 }), timeoutMs: 1000 })
  for (const [today, spent] of [['2026-10-06', 760], ['2026-10-06', 900], ['2026-10-06', 1200], ['2026-10-05', 760], ['2026-09-10', 760]]) {
    const { context } = contextFor(today, { spent })
    const phase = context.budget.cyclePhase
    const outcomes = await Promise.all(Array.from({ length: 6 }, (_, i) => ai.generate(context, { history: [], previous: null, seed: i })))
    const texts = outcomes.filter((o) => o.ok && o.response.shouldShow).map((o) => o.response.message)
    const bad = texts.filter((t) => contradictsCyclePhase(t, phase))
    check(`${today} (${phase}) speso ${spent / 10}%: ${texts.length} frasi, nessuna in contraddizione`, bad.length === 0, bad.join(' | '))
  }
}

// =====================================================================
section('Cambio automatico del ciclo e uso senza account')
// =====================================================================
{
  installFakeLocalStorage()
  const { useAppStore } = await import('../store/useAppStore.js?cycle-timing=1')
  const S = useAppStore.getState
  check('senza account (ambito guest)', S().scopeId === 'guest')
  S().setCycleStartDay(7)
  useAppStore.setState({ today: '2026-10-06', monthlyBudget: 1000, expenses: [expense('2026-09-08', 760)] })
  const view = () => buildFinancialData({ today: S().today, monthlyBudget: S().monthlyBudget, expenses: S().expenses, incomes: S().incomes, goals: S().goals, cycleStartDay: S().cycleStartDay })
  let fd = view()
  check('6 ottobre: ultimo giorno, speso 760', fd.cycle.phase === 'last_day' && fd.spentThisMonth === 760)
  useAppStore.setState({ today: '2026-10-07' }) // come refreshToday a mezzanotte
  fd = view()
  check('7 ottobre: nuovo ciclo da solo, speso ripartito da zero', fd.cycle.phase === 'new_cycle' && fd.cycle.start === '2026-10-07' && fd.spentThisMonth === 0 && fd.available === 1000)
  const context = buildSpendyAIContext({ events: [], coach: null, financialData: fd, expenses: S().expenses, today: S().today, cycleStartDay: S().cycleStartDay, goals: [] }).context
  check('   e l\'AI riceve il ciclo nuovo', context.budget.cyclePhase === 'new_cycle' && context.budget.dayOfCycle === 1 && context.budget.daysRemaining === 30)
}

report('Ciclo di budget: tempo e fasi')
