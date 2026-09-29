// MOCK PROVIDER — si comporta come l'AI vera, senza rete e senza API key.
//
// Non è una lista di frasi a caso: legge il contesto come farebbe il
// modello e ne ricava una risposta con la stessa struttura
// ({ message, state, tone, priority, shouldShow, layout, animation }):
//
//   1. decide SE parlare (evento assente o poco importante → shouldShow: false)
//   2. per l'evento principale prepara più ANGOLI di lettura — una
//      domanda curiosa, un'osservazione sul comportamento, un commento
//      ironico, un aiuto concreto, una frase semplice — ognuno con stato
//      e tono suoi, scelti anche in base alla fascia del budget
//   3. PRIMA AIUTA: ogni angolo parte da un'informazione utile costruita
//      sui numeri del contesto (solo quelli presenti)
//   4. POI FA SORRIDERE, ma non sempre: con il budget stretto niente
//      battute; quando c'è, la battuta viene da HumorLibrary / reaction
//      library, riferimento di stile che l'AI può riprendere
//   5. SCARTA gli angoli che ripetono la frase precedente — anche solo
//      nella struttura (stesse regole del guard, spendyPersonality.js) —
//      e se non resta niente di nuovo da dire, preferisce tacere
//
// Stesso contesto + stessa frase precedente → stessa risposta (seed
// deterministico): niente frasi che cambiano a ogni render.
//
// `mode` simula i guasti del mondo reale, per i test e per provare la
// Home: 'offline' | 'timeout' | 'error' | 'rate_limited' | 'invalid' |
// 'hallucinate'. 'normal' è l'AI che funziona.
import { humorLibrary } from '../../utils/humorLibrary.js'
import { similarity } from '../../utils/jokeEvaluator.js'
import {
  SPESA_100, BUONA_SCELTA, RISPARMIO, SPESA_RIPETUTA, AUMENTO_ANOMALO,
} from '../../data/spendyReactionLibrary.js'
import { SPENDY_HERO_LAYOUT_BY_STATE } from '../../components/spendy/spendyHeroLayouts.js'
import { SPENDY_EVENTS as E } from '../spendyEvents.js'
import { passesToneRules } from '../spendyAIGuard.js'
import { narrativeFrames, structureProblems } from '../spendyPersonality.js'

export const MOCK_MODES = ['normal', 'offline', 'timeout', 'error', 'rate_limited', 'invalid', 'hallucinate']

// Sotto questa importanza Spendy preferisce tacere (0-100, stessa scala
// di importantEventSelector).
export const MOCK_SPEAK_THRESHOLD = 40

// Oltre questa somiglianza con una frase già detta, un candidato è
// "troppo simile" per il mock — più severo del guard (0.85): il mock
// cerca varietà, il guard blocca solo le ripetizioni vere.
const MOCK_SIMILARITY_LIMIT = 0.6
const MAX_LENGTH = 220

const LIB = humorLibrary.it
const euro = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })
const eur = (value) => `${euro.format(value)} €`
const lower = (label) => (label ? label.toLowerCase() : 'questa categoria')
const signed = (value) => `${value > 0 ? '+' : ''}${value}%`

function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const calmBudget = (ctx) => ctx.budget.band === 'ok'
const tightBudget = (ctx) => ctx.budget.band === 'warning' || ctx.budget.band === 'high'

// Le etichette della libreria sono per id di categoria; il contesto
// porta l'etichetta leggibile. Il confronto è sulle etichette note.
const LABEL_TO_ID = {
  ristorante: 'ristoranti', spesa: 'spesa', shopping: 'shopping', trasporti: 'trasporti',
  casa: 'casa', bollette: 'abbonamenti', tecnologia: 'tecnologia', salute: 'salute',
  svago: 'svago', viaggi: 'viaggi', altro: 'altro', carburante: 'trasporti',
}
const categoryIdOf = (label) => LABEL_TO_ID[lower(label)] ?? null

function categoryPools(label, direction, generic = []) {
  const bank = LIB.categories[categoryIdOf(label)]?.[direction]
  return bank?.length ? [bank] : generic
}

function budgetTail(budget) {
  if (budget.band === 'ok') return `Il budget regge: restano ${eur(budget.available)}.`
  if (budget.band === 'exceeded') return 'Da qui a fine ciclo conviene andarci piano.'
  if (budget.dailyAllowance != null) {
    return `Restano ${eur(budget.available)} per ${budget.daysRemaining} giorni, circa ${eur(budget.dailyAllowance)} al giorno.`
  }
  return `Restano ${eur(budget.available)} fino a fine ciclo.`
}

// --- Angoli ------------------------------------------------------------
//
// Ogni composer restituisce una LISTA di angoli possibili:
//   { id, state, tone, help, quipPools?, closer?, descriptive? }
// `help` è la parte utile; `quipPools` le librerie da cui pescare una
// battuta (vuoto = niente battuta); `closer` una chiusura fissa.
// `descriptive` = l'angolo, da solo, riporta il dato senza interpretarlo:
// è la rete di sicurezza ("meglio una frase semplice che una battuta
// forzata"), usata solo se nessun angolo interpretativo è ancora nuovo.

function categoryUpAngles(ctx, { trend = false } = {}) {
  const { cycle, category, expense } = ctx.primaryEvent
  const Cat = category ?? 'Una categoria'
  const cat = lower(category)
  const calm = calmBudget(ctx)
  const mood = calm ? { state: 'ironic', tone: 'playful' } : { state: 'attentive', tone: 'helpful' }

  if (!cycle) {
    if (expense?.amount) {
      return [
        { id: 'today', ...mood, help: `${Cat} sopra il tuo ritmo abituale, e oggi altri ${eur(expense.amount)}.` },
        { id: 'plain', ...mood, help: `Oggi ${eur(expense.amount)} in ${cat}.` },
      ]
    }
    return [{ id: 'plain', ...mood, help: `${Cat} sta correndo più del solito.` }]
  }

  const angles = [
    { id: 'plain', descriptive: true, ...mood, help: `${Cat}: ${eur(cycle.current)} in questo ciclo, di solito ${eur(cycle.usual)}.` },
  ]
  // Con il budget tranquillo Spendy può essere curioso o ironico; con il
  // budget stretto "prima aiuta" vuol dire un consiglio concreto.
  if (calm) {
    angles.push(
      {
        id: 'curious',
        ...mood,
        help: `${Cat} a ${eur(cycle.current)} contro i soliti ${eur(cycle.usual)}: ciclo speciale o nuovo ritmo?`,
      },
      {
        id: 'relaxed',
        ...mood,
        help: `${eur(cycle.difference)} in più del solito su ${cat}, e il budget regge: restano ${eur(ctx.budget.available)}.`,
        quipPools: categoryPools(category, 'high', [AUMENTO_ANOMALO]),
      },
      {
        id: 'percent',
        descriptive: true,
        ...mood,
        help: `${Cat} ${signed(cycle.changePercent)} rispetto al tuo solito.`,
        quipPools: categoryPools(category, 'high', [AUMENTO_ANOMALO]),
      },
    )
  } else {
    if (ctx.budget.dailyAllowance != null) {
      angles.push({
        id: 'daily',
        ...mood,
        help: `Con ${cat} a ${eur(cycle.current)} invece dei soliti ${eur(cycle.usual)}, restano circa ${eur(ctx.budget.dailyAllowance)} al giorno fino a fine ciclo.`,
      })
    }
    angles.push({
      id: 'lever',
      ...mood,
      help: `${eur(cycle.difference)} in più del solito su ${cat}: se vuoi respirare fino a fine ciclo, è la voce più facile da limare.`,
    })
  }
  if (trend) {
    angles.push({
      id: 'trend',
      ...mood,
      help: `${Cat} sale da qualche ciclo: ora ${eur(cycle.current)}, la tua media è ${eur(cycle.usual)}. Più che uno sfizio, è una tendenza.`,
    })
  }
  return angles
}

function categoryDownAngles(ctx, { trend = false } = {}) {
  const { cycle, category } = ctx.primaryEvent
  const Cat = category ?? 'Una categoria'
  const cat = lower(category)
  const happy = { state: 'happy', tone: 'friendly' }
  if (!cycle) return [{ id: 'plain', ...happy, help: `${Cat} sta andando meglio del solito.` }]

  const angles = [
    { id: 'plain', descriptive: true, ...happy, help: `${Cat}: ${eur(cycle.current)} in questo ciclo, ${eur(cycle.difference)} meno del solito.` },
    { id: 'curious', ...happy, help: `${Cat} a ${eur(cycle.current)}, di solito ${eur(cycle.usual)}. Scelta voluta o ciclo tranquillo?` },
  ]
  if (ctx.goal) {
    angles.push({
      id: 'goal',
      state: 'advisor',
      tone: 'helpful',
      help: `${eur(cycle.difference)} in meno del solito su ${cat}. Su "${ctx.goal.label}" farebbero la loro figura.`,
    })
  } else {
    angles.push({
      id: 'method',
      ...happy,
      help: `${eur(cycle.difference)} in meno su ${cat}: più che fortuna, è metodo.`,
      quipPools: categoryPools(category, 'low', [BUONA_SCELTA]),
    })
  }
  if (trend) {
    angles.push({ id: 'trend', ...happy, help: `${Cat} scende da qualche ciclo: ora ${eur(cycle.current)}, la tua media è ${eur(cycle.usual)}.` })
  }
  return angles
}

// Una categoria che riappare dopo cicli di silenzio. Il dato vero è
// "spesa fuori dalle tue abitudini recenti": ogni angolo lo INTERPRETA
// (curiosità, calma, premura, abitudine) invece di annunciare che la
// categoria "è tornata". Niente battute dalla libreria: il suo gruppo
// unusual_purchase racconta tutto come ritorno/novità, proprio lo schema
// da non ripetere.
function unusualPurchaseAngles(ctx) {
  const { amount, category } = ctx.primaryEvent
  const Cat = category ?? 'Una categoria'
  const cat = lower(category)
  if (amount == null) {
    return [{ id: 'plain', state: 'attentive', tone: 'friendly', help: `Spesa in ${cat} fuori dalle tue abitudini recenti.` }]
  }
  const angles = [
    { id: 'plain', descriptive: true, state: 'attentive', tone: 'friendly', help: `${eur(amount)} spesi in ${cat} in questo ciclo.` },
    { id: 'curious', state: 'attentive', tone: 'playful', help: `${eur(amount)} in ${cat} questo ciclo. Regalo, imprevisto o nuova passione?` },
    {
      id: 'habit',
      state: 'advisor',
      tone: 'helpful',
      help: `${Cat}: ${eur(amount)} in questo ciclo. Se resta una tantum nessun problema, se diventa un'abitudine la teniamo d'occhio insieme.`,
    },
  ]
  // Quanto pesa sul ciclo: due numeri del contesto, e un giudizio a parole
  // (nessuna percentuale calcolata qui).
  if (ctx.budget.spent > 0 && amount <= ctx.budget.spent) {
    const weight = amount / ctx.budget.spent < 0.1 ? 'una voce piccola, niente che sposti il mese' : 'una voce che nel mese si fa sentire'
    angles.push({
      id: 'weight',
      state: 'attentive',
      tone: 'friendly',
      help: `Dei ${eur(ctx.budget.spent)} spesi in questo ciclo, ${eur(amount)} sono andati in ${cat}: ${weight}.`,
    })
  }
  if (calmBudget(ctx)) {
    angles.push({
      id: 'planned',
      state: 'happy',
      tone: 'friendly',
      help: `Se i ${eur(amount)} in ${cat} erano in programma, tutto regolare: il budget ha ancora ${eur(ctx.budget.available)} di margine.`,
    })
    angles.push({
      id: 'calm',
      state: 'ironic',
      tone: 'playful',
      help: `${eur(amount)} in ${cat}, e il budget non fa una piega: restano ${eur(ctx.budget.available)}.`,
    })
  }
  if (tightBudget(ctx) && ctx.budget.dailyAllowance != null) {
    angles.push({
      id: 'tight',
      state: 'attentive',
      tone: 'helpful',
      help: `${eur(amount)} in ${cat} proprio ora che il budget è stretto: restano circa ${eur(ctx.budget.dailyAllowance)} al giorno.`,
    })
  }
  return angles
}

const COMPOSERS = {
  [E.GOAL_REACHED]: (ctx) => {
    const quipPools = [['Momento da screenshot. 📸', 'Questa me la segno sul calendario. 🎉', 'Io lo sapevo, eh. 😎']]
    const mood = { state: 'celebrating', tone: 'celebratory', quipPools }
    return [
      { id: 'steps', ...mood, help: `"${ctx.goal.label}" completato, un passo alla volta.` },
      { id: 'short', ...mood, help: `Traguardo raggiunto: "${ctx.goal.label}" è fatto.` },
    ]
  },

  [E.BUDGET_EXCEEDED]: (ctx) => {
    const over = eur(Math.abs(ctx.budget.available))
    const days = ctx.budget.daysRemaining
    const mood = { state: 'concerned', tone: 'concerned' }
    // niente battuta: prima si aiuta
    const helps = [
      `Siamo oltre il budget di ${over}${days > 0 ? `, con ${days} giorni ancora davanti` : ''}.`,
      days > 0 ? `Il budget è finito con ${days} giorni di anticipo: siamo sopra di ${over}.` : `Il ciclo chiude sopra il budget di ${over}.`,
    ]
    const closers = [
      'Nessun dramma: da qui conta ogni spesa piccola.',
      'Rallentiamo un attimo, il prossimo ciclo si riparte puliti.',
      'Guardiamo solo le prossime spese, al resto ci pensiamo dopo.',
    ]
    return helps.flatMap((help, i) => closers.map((closer, j) => ({ id: `over-${i}-${j}`, ...mood, help, closer })))
  },

  [E.BUDGET_NEAR_LIMIT]: (ctx) => {
    const high = ctx.budget.band === 'high' || ctx.budget.band === 'exceeded'
    const mood = { state: high ? 'concerned' : 'attentive', tone: 'helpful' }
    const angles = [
      {
        id: 'percent',
        ...mood,
        help: `Hai usato il ${ctx.budget.spentPercent}% del budget. ${budgetTail(ctx.budget)}`,
        quipPools: high ? [] : [LIB.types.budget_rising],
      },
    ]
    if (ctx.budget.dailyAllowance != null) {
      angles.push({
        id: 'daily',
        ...mood,
        help: `Restano ${eur(ctx.budget.available)} per ${ctx.budget.daysRemaining} giorni: circa ${eur(ctx.budget.dailyAllowance)} al giorno.`,
        quipPools: high ? [] : [LIB.types.budget_rising],
      })
    }
    if (high) {
      angles.push({
        id: 'weight',
        ...mood,
        help: `Siamo al ${ctx.budget.spentPercent}% del budget: da qui ogni spesa pesa un po' di più. Restano ${eur(ctx.budget.available)}.`,
      })
    }
    return angles
  },

  // Le frasi sulle spese grosse restano quelle di prima: funzionano.
  [E.BIG_EXPENSE]: (ctx) => {
    const { expense = {} } = ctx.primaryEvent
    const calm = calmBudget(ctx)
    const big = expense.amount >= 500
    const mood = {
      state: big && !calm ? 'concerned' : calm ? 'ironic' : 'attentive',
      tone: calm ? 'playful' : 'helpful',
      quipPools: calm ? [SPESA_100] : [],
    }
    return [
      { id: 'noticed', ...mood, help: `${eur(expense.amount)} di ${lower(expense.category)} oggi: si fa notare. ${budgetTail(ctx.budget)}` },
      { id: 'gone', ...mood, help: `Oggi sono partiti ${eur(expense.amount)} in ${lower(expense.category)}. ${budgetTail(ctx.budget)}` },
    ]
  },

  [E.GOAL_AT_RISK]: (ctx) => {
    const { expense = {} } = ctx.primaryEvent
    const goalPart = ctx.goal
      ? ` "${ctx.goal.label}" resta al ${ctx.goal.percent}%: mancano ${eur(ctx.goal.missing)}, niente che non si recuperi.`
      : ''
    return [{ id: 'goal', state: 'advisor', tone: 'helpful', help: `Spesa importante oggi, ${eur(expense.amount)}.${goalPart}` }]
  },

  [E.CATEGORY_ABOVE_USUAL]: (ctx) => categoryUpAngles(ctx),
  [E.CATEGORY_TREND_UP]: (ctx) => categoryUpAngles(ctx, { trend: true }),
  [E.EXPENSE_ABOVE_AVERAGE]: (ctx) => {
    const { singleExpense, category } = ctx.primaryEvent
    const mood = { state: calmBudget(ctx) ? 'ironic' : 'attentive', tone: 'playful' }
    return [
      {
        id: 'compare',
        descriptive: true,
        ...mood,
        help: `Una spesa da ${eur(singleExpense.amount)} in ${lower(category)}, di solito stai sui ${eur(singleExpense.usualAmount)}.`,
        quipPools: categoryPools(category, 'high'),
      },
      { id: 'curious', ...mood, help: `${eur(singleExpense.amount)} in un colpo solo per ${lower(category)}: occasione speciale?` },
    ]
  },

  [E.CATEGORY_BELOW_USUAL]: (ctx) => categoryDownAngles(ctx),
  [E.CATEGORY_TREND_DOWN]: (ctx) => categoryDownAngles(ctx, { trend: true }),
  [E.EXPENSE_BELOW_AVERAGE]: (ctx) => {
    const { singleExpense, category } = ctx.primaryEvent
    const mood = { state: 'happy', tone: 'friendly' }
    return [
      {
        id: 'compare',
        ...mood,
        help: `In ${lower(category)} te la sei cavata con ${eur(singleExpense.amount)}, di solito sono ${eur(singleExpense.usualAmount)}.`,
        quipPools: [BUONA_SCELTA],
      },
      { id: 'short', ...mood, help: `${eur(singleExpense.amount)} per ${lower(category)}, sotto il tuo solito. Buon colpo.` },
    ]
  },

  [E.SAVINGS_ABOVE_USUAL]: (ctx) => {
    const usual = ctx.spending.usualCycle
    const help = usual != null && usual > ctx.budget.spent
      ? `Questo ciclo sei a ${eur(ctx.budget.spent)}, di solito un ciclo intero ti costa circa ${eur(usual)}.`
      : 'Questo ciclo stai spendendo meno del solito.'
    if (ctx.goal) {
      return [{ id: 'goal', state: 'advisor', tone: 'helpful', help: `${help} Un pezzetto potrebbe andare su "${ctx.goal.label}".` }]
    }
    return [{ id: 'saving', state: 'happy', tone: 'friendly', help, quipPools: [LIB.types.savings_vs_usual, RISPARMIO] }]
  },

  [E.FREQUENCY_UP]: (ctx) => {
    const { purchases, category } = ctx.primaryEvent
    const mood = { state: 'ironic', tone: 'ironic' }
    if (!purchases) return [{ id: 'plain', ...mood, help: `Ultimamente ${lower(category)} compare spesso nelle tue spese.` }]
    return [
      {
        id: 'count',
        descriptive: true,
        ...mood,
        help: `${purchases.current} acquisti in ${lower(category)} questo ciclo, di solito ${purchases.usual}.`,
        quipPools: [LIB.types.unusual_frequency_high, SPESA_RIPETUTA],
      },
      { id: 'steady', ...mood, help: `${category} ti vede più spesso del solito: ${purchases.current} volte contro ${purchases.usual}. Piccole spese, ma costanti.` },
      { id: 'routine', ...mood, help: `${purchases.current} passaggi in ${lower(category)}, di solito ${purchases.usual}. Nuova routine?` },
    ]
  },

  [E.FREQUENCY_DOWN]: (ctx) => {
    const { purchases, category } = ctx.primaryEvent
    const mood = { state: 'happy', tone: 'friendly' }
    if (!purchases) return [{ id: 'plain', ...mood, help: `${category ?? 'Questa categoria'} si è presa una pausa.` }]
    return [
      {
        id: 'count',
        descriptive: true,
        ...mood,
        help: `Solo ${purchases.current} acquisti in ${lower(category)} questo ciclo, di solito ${purchases.usual}.`,
        quipPools: [LIB.types.unusual_frequency_low],
      },
      { id: 'pause', ...mood, help: `${category} più rara del solito: ${purchases.current} volte contro ${purchases.usual}. Pausa voluta?` },
    ]
  },

  [E.UNUSUAL_PURCHASE]: (ctx) => unusualPurchaseAngles(ctx),

  [E.SMALL_EXPENSES_ADD_UP]: (ctx) => {
    const { smallExpenses = {}, category } = ctx.primaryEvent
    const where = category ? `, soprattutto in ${lower(category)}` : ''
    const mood = { state: 'ironic', tone: 'ironic' }
    return [
      {
        id: 'count',
        ...mood,
        help: `${smallExpenses.count} piccole spese in questo ciclo${where}: ${eur(smallExpenses.total)} in tutto.`,
        quipPools: [LIB.types.small_expenses_add_up],
      },
      { id: 'sum', ...mood, help: `Una alla volta non pesano, insieme fanno ${eur(smallExpenses.total)}: ${smallExpenses.count} piccole spese in questo ciclo.` },
    ]
  },

  [E.POSITIVE_STREAK]: (ctx) => [{
    id: 'streak',
    state: 'celebrating',
    tone: 'celebratory',
    help: `${ctx.primaryEvent.streakCycles} cicli di fila con il budget sotto controllo.`,
    quipPools: [LIB.types.positive_streak],
  }],

  [E.NEGATIVE_STREAK]: (ctx) => [{
    id: 'streak',
    state: 'attentive',
    tone: 'helpful',
    help: `Da ${ctx.primaryEvent.streakCycles} cicli chiudi vicino al limite. Guardiamo insieme quale categoria pesa di più?`,
  }],

  [E.GOAL_NEAR]: (ctx) => goalProgressAngles(ctx, true),
  [E.GOAL_PROGRESS]: (ctx) => goalProgressAngles(ctx, false),
}

function goalProgressAngles(ctx, near) {
  if (!ctx.goal) return []
  const mood = { state: near ? 'celebrating' : 'advisor', tone: near ? 'celebratory' : 'friendly', quipPools: [LIB.types.obiettivi] }
  return [
    { id: 'percent', ...mood, help: `"${ctx.goal.label}" è al ${ctx.goal.percent}%: mancano ${eur(ctx.goal.missing)}.` },
    { id: 'missing', ...mood, help: `Mancano ${eur(ctx.goal.missing)} a "${ctx.goal.label}": sei al ${ctx.goal.percent}%.` },
  ]
}

// --- Scelta ------------------------------------------------------------

// Una frase va bene se non ricalca niente di già detto: né le parole
// (similarity) né la struttura (spendyPersonality).
function isFresh(message, { history, previous }) {
  const said = [...history, ...(previous ? [previous] : [])]
  if (said.some((line) => similarity(message, line) >= MOCK_SIMILARITY_LIMIT)) return false
  return structureProblems(message, { previous, history }).length === 0
}

// Una battuta "di stile": niente segnaposto, niente numeri (i numeri li
// mette solo la parte utile), tono ammesso, e nessuno schema già usato
// dalla parte utile o dalla frase precedente.
function pickQuip(pools, help, seed, { history, previous }) {
  const helpFrames = narrativeFrames(help)
  const lines = pools.flat().filter((line) => (
    line
    && !/[{}\d]/.test(line)
    && line.length <= 110
    && passesToneRules(line)
    && ![...history, ...(previous ? [previous] : [])].some((said) => said.includes(line))
    && ![...narrativeFrames(line)].some((frame) => !frame.startsWith('open:') && helpFrames.has(frame))
  ))
  return lines.length > 0 ? lines[seed % lines.length] : null
}

function candidatesFor(angle, seed, memory) {
  const quip = angle.closer ?? (angle.quipPools?.length ? pickQuip(angle.quipPools, angle.help, seed, memory) : null)
  const withQuip = quip ? `${angle.help} ${quip}` : null
  const out = []
  if (withQuip && withQuip.length <= MAX_LENGTH) out.push({ ...angle, message: withQuip, plain: false })
  // La versione semplice c'è sempre: "meglio una frase semplice che una
  // battuta forzata".
  // Con la battuta anche un dato secco diventa un commento; senza, un
  // angolo descrittivo resta una semplice constatazione.
  out.push({ ...angle, message: angle.help, plain: Boolean(angle.descriptive) })
  return out
}

function silent(ctx) {
  return {
    message: '',
    state: ctx?.suggestedState ?? 'happy',
    tone: 'friendly',
    priority: ctx?.primaryEvent?.importance ?? 0,
    shouldShow: false,
    layout: null,
    animation: 'gentle',
  }
}

const ANIMATION_BY_TONE = {
  celebratory: 'celebrate', playful: 'playful', ironic: 'playful', concerned: 'concerned', helpful: 'gentle', friendly: 'gentle',
}

// Il "ragionamento" del mock, esportato per i test.
// `history` = frasi già dette dall'AI, `previous` = l'ultima letta dall'utente.
export function composeMockResponse(context, history = [], previous = null) {
  const event = context?.primaryEvent
  if (!event || (event.importance ?? 0) < MOCK_SPEAK_THRESHOLD) return silent(context)

  const angles = COMPOSERS[event.id]?.(context) ?? []
  if (angles.length === 0) return silent(context)

  const memory = { history, previous }
  const seed = hash(`${event.id}|${event.category ?? ''}|${context.today}|${history.length}|${previous ?? ''}`)

  // Ogni angolo, con e senza battuta; restano solo quelli che non
  // ricalcano niente di già detto. Prima si prova a INTERPRETARE; la
  // semplice constatazione solo se non resta altro di nuovo da dire.
  const all = angles.flatMap((angle, i) => candidatesFor(angle, seed + i, memory))
  const fresh = all.filter((candidate) => candidate.message.length <= MAX_LENGTH && isFresh(candidate.message, memory))
  const interpretive = fresh.filter((candidate) => !candidate.plain)
  const pool = interpretive.length > 0 ? interpretive : fresh
  // Niente di nuovo da dire senza ripetersi: Spendy tace (la Home
  // mostrerà la frase locale).
  if (pool.length === 0) return silent(context)

  const choice = pool[seed % pool.length]
  const layout = choice.state === 'celebrating'
    ? 'center'
    : SPENDY_HERO_LAYOUT_BY_STATE[choice.state]?.position ?? 'left'

  return {
    message: choice.message,
    state: choice.state,
    tone: choice.tone,
    priority: event.importance,
    shouldShow: true,
    layout,
    animation: ANIMATION_BY_TONE[choice.tone] ?? 'gentle',
  }
}

function providerError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer)
      reject(providerError('aborted', 'aborted'))
    })
  })
}

export function createMockProvider({ mode = 'normal', latencyMs = 450 } = {}) {
  return {
    name: `mock:${mode}`,
    available: mode !== 'offline',
    async generate(context, { signal, history = [], previous = null } = {}) {
      if (mode === 'timeout') {
        await new Promise((_, reject) => signal?.addEventListener?.('abort', () => reject(providerError('aborted', 'aborted'))))
      }
      await wait(latencyMs, signal)
      if (mode === 'error') throw providerError('server_error', 'Mock: errore del modello')
      if (mode === 'rate_limited') throw providerError('rate_limited', 'Mock: limite API raggiunto')
      if (mode === 'invalid') return { message: 42, state: 'furious', shouldShow: 'yes' }

      const response = composeMockResponse(context, history, previous)
      if (mode === 'hallucinate' && response.shouldShow) {
        // Il tipico errore di un modello: numeri e nomi che nei dati non ci sono.
        return { ...response, message: 'Hai speso 987 € in ristoranti e "Casa al mare" è al 73%!' }
      }
      return response
    },
  }
}
