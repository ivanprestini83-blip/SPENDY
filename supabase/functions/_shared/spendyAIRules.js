// SPENDY AI — REGOLE CONDIVISE tra app e server.
//
// Un solo file, importato da due parti:
//   - l'app (src/ai/spendyAIGuard.js, spendyPersonality.js, i provider);
//   - la Supabase Edge Function (supabase/functions/spendy-ai/).
// Sta qui, dentro supabase/functions/_shared/, perché una Edge Function
// può importare solo file sotto supabase/functions; l'app invece può
// importare qualunque file del progetto. Così personalità, prompt,
// vocabolari e controlli (numeri inventati, tono, struttura) non possono
// divergere tra client e server.
//
// JavaScript puro, zero dipendenze, niente API di Node o di Deno.

// --- Vocabolari --------------------------------------------------------

import { CYCLE_PHASES, EARLY_PHASES, LATE_PHASES } from './cyclePhases.js'

export const AI_STATES = ['happy', 'attentive', 'concerned', 'celebrating', 'advisor', 'ironic']
export const AI_TONES = ['friendly', 'playful', 'ironic', 'celebratory', 'concerned', 'helpful']
export const AI_ANIMATIONS = ['gentle', 'playful', 'celebrate', 'concerned']
export const AI_LAYOUTS = ['left', 'right', 'center', 'overlap']
export const BUDGET_BANDS = ['ok', 'warning', 'high', 'exceeded']

// Le lingue in cui Spendy AI risponde: le stesse dell'app (LANGUAGE_CODES,
// che una Edge Function non può importare; un test verifica che coincidano).
// Qualunque altro valore, o nessun valore, vale l'italiano: la lingua cambia
// solo le parole della risposta, mai consenso, quota o regole.
export const SPENDY_LOCALES = ['it', 'en', 'es', 'fr']
export const DEFAULT_SPENDY_LOCALE = 'it'
export const normalizeSpendyLocale = (value) => (SPENDY_LOCALES.includes(value) ? value : DEFAULT_SPENDY_LOCALE)

// La valuta dell'account (le stesse di src/utils/currency.js, che una Edge
// Function non può importare; un test verifica che coincidano). Indipendente
// dalla lingua: gli importi del contesto sono numeri in questa valuta, mai
// convertiti. Il server non si fida del client: codice ISO o vecchio simbolo
// ('€', '$', '£'); qualunque altro valore, o nessuno, vale EUR.
export const SPENDY_CURRENCIES = { EUR: '€', USD: '$', GBP: '£' }
export const DEFAULT_SPENDY_CURRENCY = 'EUR'
export function normalizeSpendyCurrency(value) {
  if (typeof value !== 'string') return DEFAULT_SPENDY_CURRENCY
  const text = value.trim()
  if (Object.hasOwn(SPENDY_CURRENCIES, text.toUpperCase())) return text.toUpperCase()
  return Object.keys(SPENDY_CURRENCIES).find((code) => SPENDY_CURRENCIES[code] === text) ?? DEFAULT_SPENDY_CURRENCY
}

export const MAX_MESSAGE_LENGTH = 240
export const MAX_SENTENCES = 3
export const REPEAT_SIMILARITY = 0.85
export const RECENT_WINDOW = 5

const TONE_BY_STATE = {
  happy: 'friendly',
  attentive: 'helpful',
  concerned: 'concerned',
  celebrating: 'celebratory',
  advisor: 'helpful',
  ironic: 'ironic',
}

const ANIMATION_BY_TONE = {
  friendly: 'gentle',
  helpful: 'gentle',
  playful: 'playful',
  ironic: 'playful',
  celebratory: 'celebrate',
  concerned: 'concerned',
}

export const defaultToneFor = (state) => TONE_BY_STATE[state] ?? 'friendly'
export const defaultAnimationFor = (tone) => ANIMATION_BY_TONE[tone] ?? 'gentle'

// --- Tono e sicurezza --------------------------------------------------

const RISKY_ADVICE = /\b(investi\w*|azion[ie]|borsa|crypto\w*|cripto\w*|bitcoin|trading|forex|prestit\w*|finanziament\w*|mutuo|scommess\w*|gratta e vinci|lotteri\w*|leva finanziaria)\b/i
const FEAR_OR_JUDGMENT = /\b(rovin\w*|fallit\w*|fallimento|bancarott\w*|disastr\w*|vergogn\w*|irresponsabil\w*|spendaccion\w*|sprecon\w*|colpa tua|dovresti sentirti|scelta sbagliata|hai sbagliato)\b/i
// Stesse famiglie di JokeEvaluator (insulti, aggressività, contenuti
// espliciti, temi protetti), qui in forma autonoma per il server.
const OFFENSIVE = /\b(idiot\w*|stupid\w*|scem\w*|cretin\w*|imbecill\w*|deficient\w*|incapac\w*|patetic\w*|devi smettere|basta con|non capisci|che vergogna|non hai imparato|sesso|porno|nud[oa]|erotic\w*|sexy|religion\w*|etnia|razza|orientamento sessuale|disabilità|identità di genere|nazionalità)\b/i

// Le stesse famiglie in inglese, spagnolo e francese (Spendy AI risponde
// nella lingua dell'utente). Confini di parola Unicode: \b non conosce le
// lettere accentate.
const word = (alternatives) => new RegExp(`(?<![\\p{L}])(?:${alternatives})(?![\\p{L}])`, 'iu')
const RISKY_ADVICE_INTL = word([
  'invest\\p{L}*', 'stocks?', 'crypto\\p{L}*', 'bitcoin', 'trading', 'forex', 'loans?', 'mortgages?', 'gambl\\p{L}*', 'betting', 'lotter(?:y|ies)',
  'invertir', 'inversi[oó]n\\p{L}*', 'criptomoneda\\p{L}*', 'pr[eé]stamos?', 'hipoteca\\p{L}*', 'apuestas?', 'loter[ií]a\\p{L}*',
  'investir', 'investissement\\p{L}*', 'bourse', 'emprunts?', 'hypoth[eè]que\\p{L}*', 'paris sportifs', 'loterie\\p{L}*',
].join('|'))
const FEAR_OR_JUDGMENT_INTL = word([
  'ruin\\p{L}*', 'bankrupt\\p{L}*', 'disaster\\p{L}*', 'shame\\p{L}*', 'irresponsib\\p{L}*', 'spendthrift', 'your fault', 'you should feel', 'wrong choice', 'you made a mistake',
  'arruin\\p{L}*', 'bancarrota', 'desastr\\p{L}*', 'verg[uü]enza', 'irresponsable\\p{L}*', 'derrochador\\p{L}*', 'culpa tuya', 'deber[ií]as sentirte', 'mala decisi[oó]n', 'te has equivocado',
  'faillite', 'd[ée]sastr\\p{L}*', 'honte\\p{L}*', 'irresponsable\\p{L}*', 'd[ée]pensi[eè]r\\p{L}*', 'ta faute', 'votre faute', 'vous devriez vous sentir', 'mauvais choix', 'vous vous [eê]tes tromp[ée]\\p{L}*',
].join('|'))
const OFFENSIVE_INTL = word([
  'idiot\\p{L}*', 'stupid\\p{L}*', 'dumb', 'moron\\p{L}*', 'pathetic', 'loser', 'sex', 'porn\\p{L}*', 'nude', 'erotic\\p{L}*', 'religio\\p{L}*', 'ethnicity', 'sexual orientation', 'disabilit\\p{L}*', 'gender identity', 'nationality',
  'idiota', 'est[uú]pid\\p{L}*', 'imb[eé]cil\\p{L}*', 'pat[eé]tic\\p{L}*', 'sexo', 'desnud\\p{L}*', 'er[oó]tic\\p{L}*', 'religi[oó]n', 'orientaci[oó]n sexual', 'discapacidad', 'identidad de g[eé]nero', 'nacionalidad',
  'stupide\\p{L}*', 'cr[eé]tin\\p{L}*', 'imb[eé]cile\\p{L}*', 'd[eé]bile\\p{L}*', 'path[eé]tique', 'sexe', '[eé]rotique', 'ethnie', 'orientation sexuelle', 'handicap\\p{L}*', 'identit[eé] de genre', 'nationalit[eé]',
].join('|'))
const isRiskyAdvice = (text) => RISKY_ADVICE.test(text) || RISKY_ADVICE_INTL.test(text)
const isFearOrOffensive = (text) => FEAR_OR_JUDGMENT.test(text) || OFFENSIVE.test(text) || FEAR_OR_JUDGMENT_INTL.test(text) || OFFENSIVE_INTL.test(text)

export function passesToneRules(text) {
  return !isRiskyAdvice(text) && !isFearOrOffensive(text)
}

// --- Valuta ------------------------------------------------------------

// Le valute nominate in una risposta (simbolo, codice o nome, in it/en/es/fr).
// Una risposta parla solo della valuta del contesto: un'altra valuta, anche
// accanto a quella giusta ("2000 €, circa $2,150"), è un errore. Una risposta
// senza simboli (solo numeri) va bene.
//
// Il controllo lavora su una COPIA del testo (quello mostrato non cambia):
//   - normalizzata NFKC, così "＄" e "￡" (a larghezza piena) sono "$" e "£";
//     "₤" (lira/sterlina) conta come sterlina;
//   - senza i nomi scelti dall'utente che il contesto conosce (obiettivo,
//     categorie): un obiettivo "Euro Disney" non è una valuta. Si toglie solo
//     il nome: un importo accanto ("1000 € per Euro Disney") resta controllato.
// Parole sempre monetarie: simboli, codici, euro/euri, dollaro/dólar,
// sterlina, "pound(s) sterling", "livre(s) sterling", "libra(s) esterlina(s)".
// Parole che possono voler dire altro ("pounds" peso, "libra" segno zodiacale,
// "quid", "bucks") contano solo subito dopo un numero ("120 quid"), e
// "pounds" non quando è un peso ("5 pounds of", "lost 2 pounds"). "Livre" da
// sola è un libro: non conta.
const CURRENCY_MENTIONS = {
  EUR: word('€|eur|euros?|euri'),
  USD: word('\\$|us\\$|usd|d[oó]ll?ar\\p{L}*'),
  GBP: word('£|₤|gbp|sterlin\\p{L}*|pounds? sterling|livres? sterling|libras? esterlinas?'),
}
const AMBIGUOUS_AMOUNT = /(\d[\d.,  ]*)[   ]?(pounds?|quid|bucks|libras?)(?![\p{L}])/giu
const AMBIGUOUS_CURRENCY = { pound: 'GBP', pounds: 'GBP', quid: 'GBP', libra: 'GBP', libras: 'GBP', bucks: 'USD' }
const WEIGHT_BEFORE = /(?:lost|lose|losing|gained|gain|gaining|weighs?|weighed|weighing)\s+$/i
const WEIGHT_AFTER = /^\s+of(?![\p{L}])/iu
// Conversioni: Spendy non conosce i tassi di cambio e non deve inventarli.
const EXCHANGE_RATE = word('tass[oi] di cambio|cambio valut\\p{L}*|exchange rates?|conversion rates?|tipos? de cambio|taux de change')

function currencyText(message, labels) {
  let text = String(message ?? '').normalize('NFKC')
  for (const label of labels) {
    const name = String(label ?? '').normalize('NFKC').trim()
    if (name.length < 3) continue
    text = text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ' ')
  }
  return text
}

function mentionedCurrencies(text) {
  const found = new Set(Object.keys(CURRENCY_MENTIONS).filter((code) => CURRENCY_MENTIONS[code].test(text)))
  for (const match of text.matchAll(AMBIGUOUS_AMOUNT)) {
    const word = match[2].toLowerCase()
    const before = text.slice(0, match.index)
    const after = text.slice(match.index + match[0].length)
    if (word.startsWith('pound') && (WEIGHT_BEFORE.test(before) || WEIGHT_AFTER.test(after))) continue
    found.add(AMBIGUOUS_CURRENCY[word])
  }
  return found
}

// `labels`: i nomi scelti dall'utente noti al contesto (vedi knownLabels).
export function currencyProblems(message, currency, labels = []) {
  const code = normalizeSpendyCurrency(currency)
  const text = currencyText(message, labels)
  const problems = []
  if ([...mentionedCurrencies(text)].some((other) => other !== code)) problems.push('wrong_currency')
  if (EXCHANGE_RATE.test(text)) problems.push('currency_conversion')
  return problems
}

// --- Numeri ------------------------------------------------------------

// Numeri scritti all'italiana: "1.179", "1.179,50", "66", "12,5".
// Lettura STORICA (arrotondata, senza segno), rimasta solo per compatibilità
// di extractNumbers(text) senza lingua: dalla Fase 2B.1 il controllo delle
// risposte non la usa più (vedi numberProblems e authorizedNumbers).
const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g

function extractLegacyNumbers(text) {
  return (text.match(NUMBER) ?? []).map((raw) => {
    const normalized = /^\d{1,3}(?:\.\d{3})+/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.')
    return Math.round(Math.abs(parseFloat(normalized)))
  })
}

// Numeri scritti nella lingua della risposta (context.locale):
//   it, es  1.794   1.794,50      en  1,794   1,794.50
//   fr      1 794   1 794,50 (spazio normale, NBSP o spazio stretto NNBSP)
// Una sequenza di cifre unite da un solo carattere ( . , ' ’ _ o uno spazio)
// si legge INTERA con la grammatica di quella lingua, mai con quella di
// un'altra: "€1,234" in inglese è 1234 (non 1,234 → 1); "1,794" in
// italiano e "1 794" in inglese non sono numeri validi. Un numero fuori
// grammatica, o con cifre non ASCII ("１２３４"), non viene reinterpretato:
// vale NaN, che nessun numero consentito eguaglia (risposta scartata).
// Senza lingua, extractNumbers legge come prima (all'italiana, arrotondato).
//
// Fase 2B.1: con la lingua il valore è ESATTO e CON SEGNO — "1.794,50" è
// 1794.5 (non 1795), "-150 €" è -150. Nessun arrotondamento, nessun
// valore assoluto: il confronto con il contesto avviene in centesimi.
//
// Un numero seguito da un moltiplicatore ("€40k", "40 mila €", "2 mil €",
// "40 k€", "€1M", "1,2 million €", "1,5 milliard") vale anch'esso NaN:
// "40k" non è 40, e il suo valore vero non si confronta (la risposta viene
// scartata anche quando sarebbe giusto). Basta una sola lettera o parola
// subito dopo la cifra, con al più uno spazio: "40 km", "2 kg", "9 mesi",
// "1 Monday", "2 miles", "3 milanesi" non contano (dopo la sigla o la
// parola viene un'altra lettera); "4K", "40 mila persone", "1 grand café",
// "2 mille-feuilles" invece sì, per prudenza. I numeri scritti in lettere
// hanno un controllo a parte (numberWordProblems).
const NUMBER_RUN = /\p{Nd}+(?:[.,'’_ \u00a0\u202f\u2009]\p{Nd}+)*/gu
const numberGrammar = (group, decimal) => new RegExp(`^(?:[0-9]{1,3}(?:${group}[0-9]{3})+|[0-9]+)(?:${decimal}[0-9]{1,2})?$`)
const NUMBER_FORMATS = {
  it: { grammar: numberGrammar('\\.', ','), group: /\./g, decimal: ',' },
  es: { grammar: numberGrammar('\\.', ','), group: /\./g, decimal: ',' },
  en: { grammar: numberGrammar(',', '\\.'), group: /,/g, decimal: '.' },
  fr: { grammar: numberGrammar('[ \\u00a0\\u202f]', ','), group: /[ \u00a0\u202f]/g, decimal: ',' },
}

const MULTIPLIER_LETTER = /^[ \u00a0\u202f\u2009]?(?:[kK]|M|B|bn|Mds?|Mrd)(?![\p{L}\p{N}])/u
const MULTIPLIER_WORD = /^[ \u00a0\u202f\u2009]?(?:thousands?|grand|millions?|billions?|mila|mille|migliaia|milion[ei]|miliard[oi]|mil|millar(?:es)?|mill[oó]n(?:es)?|millardos?|milliers?|milliards?)(?![\p{L}\p{N}])/iu
const hasMultiplier = (after) => MULTIPLIER_LETTER.test(after) || MULTIPLIER_WORD.test(after)

// Il segno meno. "-" e "−" valgono anche con uno spazio ("- 150 €"), come
// prima. I trattini e i meno tipografici o a larghezza piena (– — ‒ － ﹣)
// valgono come segno quando sono ATTACCATI alla cifra o al simbolo ("–494 €",
// "–€494", "€–494"): con uno spazio intorno sono punteggiatura ("Oggi – 150 €
// di shopping"). Fase 2B.3: prima "–494 €" si leggeva +494 (bypass R4).
// Un trattino fra due cifre ("10-20", "2026-10-11") o attaccato a una parola
// ("pre-150") non è un segno.
const SIGN_BEFORE = /(?:^|[^\p{L}\p{N}])(?:[-−][ \u00a0\u202f]?|[–—‒－﹣])(?:[€$£₤][ \u00a0\u202f]?)?$|[€$£₤][ \u00a0\u202f]?[-−–—‒－﹣]$/u

function readLocalizedNumber(raw, format, after) {
  if (!format.grammar.test(raw) || hasMultiplier(after)) return Number.NaN
  return parseFloat(raw.replace(format.group, '').replace(format.decimal, '.'))
}

const signedValue = (text, index, magnitude) => (SIGN_BEFORE.test(text.slice(0, index)) ? -magnitude : magnitude)

export function extractNumbers(text, locale) {
  if (locale === undefined) return extractLegacyNumbers(text)
  const format = NUMBER_FORMATS[normalizeSpendyLocale(locale)]
  return [...text.matchAll(NUMBER_RUN)].map(({ 0: raw, index }) => signedValue(text, index, readLocalizedNumber(raw, format, text.slice(index + raw.length))))
}

// Cifre che non sono 0-9 e che il lettore dei numeri non vede: apici (¹²³),
// pedici, cerchiate (①), frazioni (½), numeri romani Unicode (Ⅻ) — \p{No} e
// \p{Nl}. E caratteri invisibili o spazi insoliti ATTACCATI a una cifra
// (zero-width space, word joiner, soft hyphen, figure space, spazi
// tipografici): "150\u200b494 €" si vede come "150494 €" ma si leggerebbe 150
// e 494. Fase 2B.3 (R7, R8): un importo che non si legge senza ambiguità è
// malformed_number. Il resto del testo non viene toccato.
const ODD_NUMERAL = /[\p{No}\p{Nl}]/u
// "(€494)", "(,200)": tra parentesi con il simbolo davanti è il modo contabile
// di scrivere un importo NEGATIVO. Non si legge come positivo: ambiguo.
const ACCOUNTING_NEGATIVE = /\([ \u00a0\u202f]?[€$£₤][ \u00a0\u202f]?\p{Nd}[\p{Nd}., \u00a0\u202f]*\)/u
const INVISIBLE = '[\\p{Cf}\\u2000-\\u2008\\u200a\\u205f\\u3000\\u180e]'
const INVISIBLE_NEAR_DIGIT = new RegExp(`\\p{Nd}${INVISIBLE}|${INVISIBLE}\\p{Nd}`, 'u')

// --- Numeri: che cosa può dire la risposta ----------------------------
//
// Fase 2B.1. Un numero del contesto autorizza la risposta SOLO con il suo
// significato. Prima ogni numero valeva come importo: "72 €" passava perché
// 72 era l'importanza dell'evento, "2026 €" per la data di oggi, "108 € da
// spendere" per la percentuale del budget. Ora:
//   money    importi (esatti, in centesimi)
//   percent  percentuali
//   days     giorni del ciclo (giorni che restano, anche compreso oggi;
//            giorno del ciclo, primo giorno, durata)
//   count    conteggi (acquisti, piccole spese, cicli di fila)
//   date     oggi e le date del ciclo che ne derivano (inizio, fine, inizio
//            del prossimo): Fase 2B.3, FP4
// Non autorizzano NIENTE: version, importance (anche degli altri eventi),
// priority, suggestedState, le cifre dentro i nomi ("Vacanze 2027": il
// nome si può citare, la cifra non diventa un importo). Un campo nuovo del
// contesto non autorizza nulla finché non viene classificato qui.
//
// Fase 2B.3: con il budget SFORATO la risposta non contiene importi (vedi
// numberProblems): l'importo dello sforamento lo scrive l'app, non il modello.
//
// Fase 2B.4: le CIFRE DEL BUDGET (disponibile, quota giornaliera, budget del
// ciclo, totale speso nel ciclo) sono 'reserved': le scrive solo l'app, nella
// riga di fatti sotto la frase (spendyVoicePolicy.budgetFactLine). Il modello
// può scrivere gli importi dell'evento (spesa, categoria, media, differenza,
// spesa di oggi, quanto manca all'obiettivo), mai come saldo o disponibilità.
// Così "Hai in cassa 1.500 €" o "Il tuo saldo è 1.500 €" (1.500 = budget del
// ciclo) non passano qualunque parola si usi: 1.500 è una cifra riservata.
const EVENT_NUMBER_KINDS = {
  amount: 'money',
  streakCycles: 'count',
  expense: { amount: 'money', usualAmount: 'money', categoryCycleCurrent: 'money', categoryCycleUsual: 'money' },
  purchases: { current: 'count', usual: 'count' },
  singleExpense: { amount: 'money', usualAmount: 'money', changePercent: 'percent' },
  smallExpenses: { count: 'count', total: 'money' },
  cycle: { current: 'money', usual: 'money', difference: 'money', changePercent: 'percent' },
}
const CONTEXT_NUMBER_KINDS = {
  budget: {
    monthly: 'reserved', spent: 'reserved', available: 'reserved', dailyAllowance: 'reserved',
    spentPercent: 'percent', daysRemaining: 'days', dayOfCycle: 'days', cycleDays: 'days',
  },
  spending: { today: 'money', usualCycle: 'money' },
  primaryEvent: EVENT_NUMBER_KINDS,
  goal: { percent: 'percent', missing: 'money' },
}

// Gli importi si confrontano in centesimi interi: 150 ≠ 151, 1,5 ≠ 2,
// 150,00 = 150 (stesso valore, con certezza). Nessuna tolleranza.
const cents = (value) => Math.round(value * 100)

// Fase 2C: il RUOLO di ogni importo del contesto. "Hai speso 980 €" usa una
// cifra autorizzata (il totale della categoria nel ciclo), ma la presenta
// come la spesa appena fatta. Quando nel contesto c'è una spesa ('expense'),
// un importo che è SOLO una statistica deve stare in una parte di frase che
// nomina quel dato (ROLE_MARKERS): "di solito 120 €", "980 € in questo ciclo",
// "120 € in più". Senza, la risposta è ambigua e viene scartata
// (misattributed_amount): l'app mostra la frase locale. L'importo della spesa
// non ha bisogno di parole: è la lettura di default.
const EVENT_MONEY_ROLES = {
  amount: 'cycle_total', // acquisto insolito: totale della categoria nel ciclo
  expense: { amount: 'expense', usualAmount: 'usual', categoryCycleCurrent: 'cycle_total', categoryCycleUsual: 'usual' },
  singleExpense: { amount: 'expense', usualAmount: 'usual' },
  smallExpenses: { total: 'small_total' },
  cycle: { current: 'cycle_total', usual: 'usual', difference: 'difference' },
}
const CONTEXT_MONEY_ROLES = {
  spending: { today: 'today', usualCycle: 'usual' },
  primaryEvent: EVENT_MONEY_ROLES,
  goal: { missing: 'goal' },
}
// → Map<centesimi, Set<ruolo>>: lo stesso valore può avere più ruoli (una
// sola spesa oggi: 'expense' e 'today').
export function moneyRoles(context) {
  const roles = new Map()
  const visit = (value, spec) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const [key, role] of Object.entries(spec)) {
      const item = value[key]
      if (role && typeof role === 'object') visit(item, role)
      else if (typeof item === 'number' && Number.isFinite(item)) {
        const amount = cents(item)
        roles.set(amount, (roles.get(amount) ?? new Set()).add(role))
      }
    }
  }
  visit(context, CONTEXT_MONEY_ROLES)
  return roles
}
// Le parole che nominano un dato, in it/en/es/fr.
const roleWords = (words) => new RegExp(`(?<!\\p{L})(?:${words})(?!\\p{L})`, 'iu')
const ROLE_MARKERS = {
  usual: roleWords("solit\\p{L}*|di solito|media|medie|medio|in media|abitual\\p{L}*|normalmente|tipicamente|in genere|usual\\p{L}*|average|typical\\p{L}*|normally|on average|promedio|habitual\\p{L}*|por lo general|de costumbre|moyenne|habitu\\p{L}*|d['’]habitude|d['’]ordinaire|ordinaire\\p{L}*|en g[ée]n[ée]ral"),
  cycle_total: roleWords("cicl[oi]|totale|in tutto|finora|fin qui|complessiv\\p{L}*|cycles?|total|so far|altogether|en total|hasta ahora|en lo que va|au total|en tout|jusqu['’]ici|jusqu['’][àa] pr[ée]sent"),
  difference: roleWords("in più|di più|extra|rispetto|differenz\\p{L}*|in eccesso|more|above|over|difference|de más|más|diferencia|por encima|de plus|en plus|[ée]cart|au-dessus|suppl[ée]mentaire\\p{L}*"),
  today: roleWords("oggi|today|hoy|aujourd['’]hui"),
  small_total: roleWords("piccol\\p{L}*|in tutto|insieme|sommat\\p{L}*|small|little|together|add(?:s|ed)? up|in total|pequeñ\\p{L}*|junt[oa]s|en total|petit\\p{L}*|ensemble|au total|en tout"),
  goal: roleWords("obiettiv\\p{L}*|goal|target|objetivo|meta|objectif|manc\\p{L}*|missing|to go|falt\\p{L}*|manqu\\p{L}*"),
}
// "Mese / month / mes / mois" confermano il totale del CICLO solo se il ciclo
// è il mese di calendario corrente (cycleIsCalendarMonth) e la frase non parla
// di un mese passato.
const MONTH_WORD = roleWords('mese|month|mes|mois')
const PAST_PERIOD = roleWords("scors\\p{L}*|precedent\\p{L}*|passat\\p{L}*|last|previous|past|pasad\\p{L}*|anterior\\p{L}*|dernier|derni[èe]re|pr[ée]c[ée]dent\\p{L}*")
// "over / above" seguiti da un periodo ("over this cycle", "over the last
// week", "over 3 days") indicano una durata, non un confronto: lì decide la
// parola del periodo (ciclo, o mese solo se il ciclo è il mese di calendario).
const PERIOD_AFTER = '[ \\u00a0\\u202f]+(?:(?:this|the|that|these|those|a|an|its|your|each|every)[ \\u00a0\\u202f]+)?(?:(?:last|past|previous|current|whole|entire|full)[ \\u00a0\\u202f]+)?(?:\\d+[ \\u00a0\\u202f]+)?(?:cycles?|months?|weeks?|days?|periods?|years?)(?!\\p{L})'
// Un comparativo SUBITO dopo l'importo ("120 € più della media", "€120 over",
// "120 € más que", "120 € de plus que") lo presenta come una differenza.
const COMPARATIVE_AFTER = new RegExp(`^(?:[ \\u00a0\\u202f]?(?:[€$£₤]|(?:eur|euros?|euri|usd|gbp|dollar[is]?|dollaro|d[oó]lar(?:es)?|pounds?|sterlin\\p{L}*|libras?|livres?))(?!\\p{L}))?[ \\u00a0\\u202f]+(?:in più|di più|più(?=[ \\u00a0\\u202f](?:del|della|dello|dei|degli|delle|di|che)(?!\\p{L}))|more|(?:over|above)(?!${PERIOD_AFTER})|extra|de más|más(?=[ \\u00a0\\u202f](?:que|de|del)(?!\\p{L}))|de plus|en plus|plus(?=[ \\u00a0\\u202f](?:que|qu['’]|de)(?!\\p{L}))|au-dessus)(?!\\p{L})`, 'iu')
// "Una spesa media di 120 €", "an average purchase of €120", "un gasto medio",
// "une dépense moyenne": l'aggettivo descrive LA spesa, non è la media. Con
// l'articolo determinativo o il possessivo ("la tua spesa media è 120 €")
// resta una media.
const ADJECTIVE_AVERAGE = /(?<!\p{L})(?:(?:una|un|uno)[ \u00a0\u202f]+(?:spesa|acquisto|importo)[ \u00a0\u202f]+medi[oa]|an?[ \u00a0\u202f]+average[ \u00a0\u202f]+(?:purchase|expense|spend|amount|transaction)|(?:una|un)[ \u00a0\u202f]+(?:gasto|compra|importe)[ \u00a0\u202f]+medi[oa]|une?[ \u00a0\u202f]+(?:d[ée]pense|achat|montant)[ \u00a0\u202f]+moyen(?:ne)?)(?!\p{L})/giu

// Un complemento iniziale senza cifre, separato da una virgola, vale per
// l'importo che segue: "Ce mois-ci, Shopping en est à 980 €", "In questo
// ciclo, …", "En moyenne, tu dépenses 120 €". Solo tempo (ciclo, oggi, mese) e
// media "pura": "Più del solito, hai speso 120 €" resta senza conferma.
const USUAL_ADVERBIAL = /^[ \u00a0\u202f]*(?:in media|di media|di solito|solitamente|normalmente|di norma|on average|usually|normally|typically|de media|en promedio|por lo general|habitualmente|en moyenne|d['’]habitude|habituellement|normalement)[ \u00a0\u202f]*$/iu
const FRONTED_ROLES = new Set(['cycle_total', 'today', 'usual'])
function precedingClause(text, index) {
  let start = 0
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    if (match.index + match[0].length <= index) start = match.index + match[0].length
    else break
  }
  return start > 0 ? clauseAt(text, start - 1) : ''
}

// Il ciclo del contesto è il mese di calendario di oggi? Le date del ciclo si
// ricavano come in getCycleTiming (src/utils/cycle.js): inizio = oggi meno
// (dayOfCycle - 1) giorni, fine (esclusa) = inizio + cycleDays, e daysRemaining
// deve tornare. Vero solo se l'inizio è il 1° del mese di oggi e la fine il 1°
// del mese dopo. Dati mancanti o incoerenti: non dimostrabile → false.
export function cycleIsCalendarMonth(context) {
  const today = typeof context?.today === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(context.today) : null
  const { dayOfCycle, cycleDays, daysRemaining } = context?.budget ?? {}
  if (!today || ![dayOfCycle, cycleDays, daysRemaining].every(Number.isInteger)) return false
  if (dayOfCycle < 1 || dayOfCycle > cycleDays || dayOfCycle + daysRemaining !== cycleDays) return false
  const [year, month, day] = [Number(today[1]), Number(today[2]), Number(today[3])]
  const start = new Date(Date.UTC(year, month - 1, day - (dayOfCycle - 1)))
  const end = new Date(start.getTime() + cycleDays * DAY_MS)
  return start.getUTCDate() === 1 && start.getUTCFullYear() === year && start.getUTCMonth() === month - 1
    && end.getUTCDate() === 1 && end.getUTCMonth() === (month % 12) && end.getUTCFullYear() === (month === 12 ? year + 1 : year)
}

// Budget sforato: disponibile negativo, o fascia "exceeded".
export function isOverBudget(context) {
  const available = context?.budget?.available
  return (typeof available === 'number' && available < 0) || context?.budget?.band === 'exceeded'
}

// Fase 2B.5: la CONDIZIONE del budget, dai dati verificati del contesto e
// dalle bande/fasi già esistenti (nessuna soglia nuova):
//   'over'       sforato: disponibile negativo (anche di pochi centesimi) o
//                fascia exceeded
//   'exhausted'  disponibile esattamente zero
//   'fast'       spesa troppo rapida: fascia high, o warning nella prima parte
//                del ciclo (EARLY_PHASES)
//   'ok'         il resto
export function budgetCondition(context) {
  if (isOverBudget(context)) return 'over'
  const budget = context?.budget
  if (budget?.available === 0) return 'exhausted'
  if (budget?.band === 'high' || (budget?.band === 'warning' && EARLY_PHASES.includes(budget?.cyclePhase))) return 'fast'
  return 'ok'
}

const DAY_MS = 86400000
const dayParts = (ms) => { const d = new Date(ms); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } }

// → { money: Set<centesimi> (importi che il modello può scrivere),
//     reserved: Set<centesimi> (cifre del budget: solo l'app),
//     percent, days, count: Set<valore>, today, dates: [{year, month, day}],
//     goalGap: Set<centesimi> (quanto manca all'obiettivo) }
export function authorizedNumbers(context) {
  const out = { money: new Set(), reserved: new Set(), percent: new Set(), days: new Set(), count: new Set(), today: null, dates: [], goalGap: new Set() }
  const visit = (value, spec) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const [key, kind] of Object.entries(spec)) {
      const item = value[key]
      if (kind && typeof kind === 'object') visit(item, kind)
      else if (typeof item === 'number' && Number.isFinite(item)) out[kind].add(kind === 'money' || kind === 'reserved' ? cents(item) : item)
    }
  }
  visit(context, CONTEXT_NUMBER_KINDS)
  const missing = context?.goal?.missing
  if (typeof missing === 'number' && Number.isFinite(missing)) out.goalGap.add(cents(missing))
  const remaining = context?.budget?.daysRemaining
  if (typeof remaining === 'number' && Number.isFinite(remaining)) out.days.add(remaining + 1) // compreso oggi
  if (out.days.size > 0) out.days.add(1) // il primo giorno del ciclo
  const today = typeof context?.today === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(context.today) : null
  if (today) {
    out.today = { year: Number(today[1]), month: Number(today[2]), day: Number(today[3]) }
    const ms = Date.UTC(out.today.year, out.today.month - 1, out.today.day)
    out.dates.push(out.today)
    const dayOfCycle = context?.budget?.dayOfCycle
    if (typeof dayOfCycle === 'number' && dayOfCycle >= 1) out.dates.push(dayParts(ms - (dayOfCycle - 1) * DAY_MS))
    if (typeof remaining === 'number' && remaining >= 0) out.dates.push(dayParts(ms + remaining * DAY_MS), dayParts(ms + (remaining + 1) * DAY_MS))
  }
  return out
}

// Gli importi che il MODELLO può scrivere (in euro/dollari/sterline). Prima
// della Fase 2B.1 conteneva ogni numero del contesto; dalla 2B.4 non contiene
// le cifre del budget, riservate all'app (authorizedNumbers().reserved).
export function allowedNumbers(context) {
  return new Set([...authorizedNumbers(context).money].map((value) => value / 100))
}

// Il significato di un numero nella risposta, da ciò che gli sta intorno.
// Ordine: percentuale, importo, giorni, conteggio, anno; altrimenti il
// numero nudo ("Restano 494.", "Hai speso 7 al bar") è un IMPORTO, e solo se
// è seguito da un nome ("7 caffè", "494 left") può essere anche un conteggio
// ('quantity'). "di solito 3" / "usually 3" eredita il significato del numero
// che lo precede nella frase. Le parole sono quelle di it/en/es/fr.
// Fase 2B.3 (R5, FP2): niente più "una parola qualsiasi + ciclo/spese" →
// conteggio ("Hai speso 7 questo ciclo" era un conteggio autorizzato).
const GAP = '[ \\u00a0\\u202f]'
const PERCENT_AFTER = new RegExp(`^${GAP}?(?:%|(?:per${GAP}?cento|percento|per${GAP}?cent|percent|por${GAP}?ciento|pour${GAP}?cent|pourcent)(?!\\p{L}))`, 'iu')
const CURRENCY_WORD = '(?:[€$£₤]|(?:eur|euros?|euri|usd|gbp|dollar[is]?|dollaro|d[oó]lar(?:es)?|pounds?|sterlin\\p{L}*|libras?|livres?|quid|bucks)(?!\\p{L}))'
const MONEY_AFTER = new RegExp(`^${GAP}?${CURRENCY_WORD}`, 'iu')
const MONEY_BEFORE = new RegExp(`(?:[€$£₤]|(?<!\\p{L})(?:eur|usd|gbp|us\\$))${GAP}?[-−–—‒－﹣]?${GAP}?$`, 'iu')
const DAY_WORD = '(?:giorn[oi]|days?|d[ií]as?|jours?)'
const DAYS_AFTER = new RegExp(`^(?:[°ºª]|st|nd|rd|th|er|re|e)?${GAP}${DAY_WORD}(?!\\p{L})`, 'iu')
const DAYS_BEFORE = new RegExp(`(?<!\\p{L})(?:giorno|day|d[ií]a|jour)${GAP}$|(?<!\\p{L})(?:giorno|day|d[ií]a|jour)${GAP}\\d+(?:${GAP}(?:su|di|of|de|sur)${GAP}|${GAP}?\\/${GAP}?)$`, 'iu')
const COUNT_WORD = '(?:acquist[oi]|spes[ae]|volt[ae]|transazion[ei]|cicli|purchases?|expenses?|times|transactions?|cycles|compras?|gastos?|veces|transacci[oó]n(?:es)?|ciclos|achats?|d[ée]penses?|fois)'
// Solo questi aggettivi fra il numero e il nome contato ("5 piccole spese").
const COUNT_ADJECTIVE = '(?:piccol[ei]|small|little|pequeñ[oa]s|petite?s|micro|nuov[ei]|new|nuev[oa]s|nouveaux|nouvelles)'
const COUNT_AFTER = new RegExp(`^${GAP}(?:${COUNT_ADJECTIVE}${GAP})?${COUNT_WORD}(?!\\p{L})`, 'iu')
const COUNT_BEFORE = new RegExp(`(?<!\\p{L})${COUNT_WORD}${GAP}(?:contro|vs\\.?|against|versus|frente a|contre|invece di|instead of|en vez de|au lieu de)${GAP}$`, 'iu')
// "di solito 55", "usually €55", "d'habitude 3": il numero eredita il significato.
const USUAL_BEFORE = new RegExp(`(?<!\\p{L})(?:di solito|solitamente|normalmente|in media|invece dei soliti|contro i soliti|usually|normally|typically|on average|lo habitual(?: son| es)?|habitualmente|de costumbre|por lo general|de media|d['’]habitude|habituellement|d['’]ordinaire|en moyenne)[ \\u00a0\\u202f,:]*$`, 'iu')
// Parole dopo cui un numero nudo resta un importo (preposizioni, articoli,
// avverbi di tempo, participi di spesa): "Hai speso 7 al bar" non è "7 cose".
const AFTER_MONEY_WORDS = new Set(`
  a ad al alla alle allo ai agli in nel nella nei per di del della dei da dal dalla su sul sulla con fino entro tra fra e ed o ma che questo questa quest quel quello quella
  oggi ieri domani ora già ancora solo circa più meno spesi spese speso tondi pieni netti
  at on for of to from by with and or but this that today yesterday tomorrow now so already still only about more less spent in total
  en de del la el los las por para con hasta y o pero este esta ese esa hoy ayer mañana ya todavía solo más menos gastados gastadas
  au aux à du des le les pour par avec jusqu et ou mais ce cet cette aujourd hier demain déjà encore seulement plus moins environ sur dans dépensés dépensées
`.trim().split(/\s+/))
const MONTHS = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, abril: 4, mayo: 5, junio: 6, julio: 7, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, décembre: 12, decembre: 12,
}
const MONTH = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')})`
// Solo parole che introducono un anno senza ambiguità: "of 2026", "de 2026",
// "in 2026" possono essere importi ("a total of 2026"), e restano importi.
const YEAR_BEFORE = new RegExp(`(?<!\\p{L})(?:nel|dal|since|desde|depuis|anno|year|año|année|${MONTH.slice(1, -1)})${GAP}$`, 'iu')

function numberKind(raw, before, after) {
  if (PERCENT_AFTER.test(after)) return 'percent'
  if (MONEY_AFTER.test(after) || MONEY_BEFORE.test(before)) return 'money'
  if (DAYS_AFTER.test(after) || DAYS_BEFORE.test(before)) return 'days'
  if (COUNT_AFTER.test(after) || COUNT_BEFORE.test(before)) return 'count'
  if (/^(?:19|20|21)\d{2}$/.test(raw) && YEAR_BEFORE.test(before)) return 'year'
  const next = /^[ \u00a0\u202f]+(\p{L}+)/u.exec(after)?.[1]?.toLowerCase()
  return next && !AFTER_MONEY_WORDS.has(next) ? 'quantity' : 'money'
}

// Le date: oggi e le date del ciclo che ne derivano (context.today,
// dayOfCycle, daysRemaining). "2026-10-11", "11/10", "11/10/2026" (in
// inglese anche "10/11"), "11 ottobre", "October 11", "11 de octubre de
// 2026", "11 octobre". Un'altra data, o una data senza context.today, è
// inventata. Una frazione di giorni ("giorno 21/30") non è una data. Gli
// orari ("13:30") non sono dati di Spendy: restano numeri non autorizzati.
const DATE_PATTERNS = [
  { re: /(?<![\p{Nd}\-/.])(\d{4})-(\d{1,2})-(\d{1,2})(?![\p{Nd}\-/])/gu, read: (m) => ({ year: m[1], month: m[2], day: m[3] }) },
  { re: /(?<![\p{Nd}/.,])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\p{Nd}/])/gu, read: (m) => ({ day: m[1], month: m[2], year: m[3], swap: true }) },
  { re: new RegExp(`(?<![\\p{Nd}.,])(\\d{1,2})(?:º|°|er)?${GAP}(?:de${GAP})?${MONTH}(?!\\p{L})(?:,?${GAP}(?:de${GAP})?(\\d{4})(?!\\p{Nd}))?`, 'giu'), read: (m) => ({ day: m[1], month: MONTHS[m[2].toLowerCase()], year: m[3] }) },
  { re: new RegExp(`(?<!\\p{L})${MONTH}${GAP}(\\d{1,2})(?:st|nd|rd|th)?(?![\\p{Nd}\\p{L}])(?:,?${GAP}(\\d{4})(?!\\p{Nd}))?`, 'giu'), read: (m) => ({ month: MONTHS[m[1].toLowerCase()], day: m[2], year: m[3] }) },
]

function isAllowedDate({ day, month, year, swap }, dates, locale) {
  return dates.some((allowed) => {
    const sameYear = year === undefined || Number(year) === allowed.year || (String(year).length === 2 && Number(year) === allowed.year % 100)
    const matches = (d, m) => Number(d) === allowed.day && Number(m) === allowed.month
    return sameYear && (matches(day, month) || (swap && locale === 'en' && matches(month, day)))
  })
}

// Una copia del testo senza i nomi scelti dall'utente (obiettivo,
// categorie): le cifre di "Vacanze 2027" non sono numeri della risposta.
// Spazi della stessa lunghezza, così le posizioni restano quelle del testo.
// Fase 2B.3 (R9): un nome con lettere si toglie solo come parola intera
// ("Bar" non dentro "Barcellona"); un nome fatto solo di cifre e simboli
// ("500") solo tra virgolette: prima cancellava ogni "500 €" della risposta.
function withoutLabels(text, labels) {
  let out = text
  for (const label of labels) {
    const name = String(label ?? '').trim()
    if (name.length < 3) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = /\p{L}/u.test(name)
      ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')
      : new RegExp(`(?<=["“«]${GAP}?)${escaped}(?=${GAP}?["”»])`, 'giu')
    out = out.replace(re, (found) => ' '.repeat(found.length))
  }
  return out
}

// I numeri della risposta con il loro significato:
// → [{ index, value (esatto, con segno; NaN se fuori grammatica), kind, ok? }]
// `dates`: le date ammesse (authorizedNumbers); `today` resta per chi la passa da sola.
export function readNumbers(text, locale, { today = null, dates = [], labels = [], cycleDays = null } = {}) {
  const code = normalizeSpendyLocale(locale)
  const format = NUMBER_FORMATS[code]
  const allowedDates = [...(today ? [today] : []), ...dates]
  let work = withoutLabels(String(text ?? ''), labels)
  const tokens = []
  for (const { re, read } of DATE_PATTERNS) {
    work = work.replace(re, (...args) => {
      // args = [testo trovato, ...gruppi, posizione, testo intero]
      const found = args[0]
      const index = args.at(-2)
      if (found.includes('/') && DAYS_BEFORE.test(`${work.slice(0, index)}${found.split('/')[0]}/`)) return found
      tokens.push({ index, value: Number.NaN, kind: 'date', ok: isAllowedDate(read(args), allowedDates, code) })
      return ' '.repeat(found.length)
    })
  }
  const numbers = []
  for (const { 0: raw, index } of work.matchAll(NUMBER_RUN)) {
    const before = work.slice(0, index)
    const after = work.slice(index + raw.length)
    numbers.push({ index, end: index + raw.length, before, value: signedValue(work, index, readLocalizedNumber(raw, format, after)), kind: numberKind(raw, before, after) })
  }
  numbers.forEach((token, i) => {
    const previous = numbers[i - 1]
    // "5 su 31", "day 5 of 31": giorni quando il secondo è la durata del ciclo.
    const next = numbers[i + 1]
    if (next && cycleDays !== null && next.value === cycleDays && /^[ \u00a0\u202f]*(?:su|of|de|sur|\/)[ \u00a0\u202f]*$/iu.test(work.slice(token.end, next.index))
      && ['money', 'quantity'].includes(token.kind) && ['money', 'quantity'].includes(next.kind)) {
      token.kind = 'days'
      next.kind = 'days'
    }
    // "di solito 3": il significato del numero precedente nella stessa frase.
    if (previous && ['money', 'quantity'].includes(token.kind) && USUAL_BEFORE.test(token.before) && !/[.!?]/.test(work.slice(previous.end, token.index))) token.kind = previous.kind
  })
  for (const { index, end, value, kind } of numbers) tokens.push({ index, end, value, kind })
  return tokens.sort((a, b) => a.index - b.index)
}

// Le parti di una frase in cui un importo "vive": separate da punteggiatura
// (non quella dentro un numero), trattini, "ma/but/pero/mais", "e/and/y/et".
const CLAUSE_BREAK = /[;:!?…]|[.,](?!\p{Nd})|[ \u00a0\u202f][-–—][ \u00a0\u202f]|[ \u00a0\u202f](?:ma|però|but|pero|mais|e|and|y|et)[ \u00a0\u202f]/giu
function clauseAt(text, index) {
  let start = 0
  let end = text.length
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    if (match.index + match[0].length <= index) start = match.index + match[0].length
    else if (match.index >= index) { end = match.index; break }
  }
  return text.slice(start, end)
}

// --- Budget: chi può dire che cosa ------------------------------------
//
// Fase 2B.3 (R1–R3). La garanzia principale è STRUTTURALE, non un elenco di
// parole: con il budget sforato il modello non scrive importi (né in cifre,
// né a parole, né con un simbolo di valuta) e l'app aggiunge da sola, sotto
// la frase, "Budget superato di 120 €" calcolato dai suoi dati
// (spendyVoicePolicy.js). Così un saldo negativo non può diventare
// "disponibile", qualunque verbo usi il modello. Prima l'importo si
// autorizzava con parole di sforamento ("oltre", "over", "de plus"), e quelle
// stesse parole aggiravano il controllo (R2).
// Gli elenchi qui sotto sono una difesa in più, non la garanzia:
//   PERMISSION  "puoi spendere / can spend / puedes gastar / tu peux dépenser /
//               margine": vietato a budget sforato anche senza importi;
//   REMAINING   "restano / left / quedan / il reste": a budget sforato non
//               accanto a "soldi / money / dinero / argent"; a budget sano,
//               se la frase ha importi, uno deve essere il disponibile, la
//               quota giornaliera o quanto manca all'obiettivo;
//   OVER_BUDGET "sopra il budget / over budget / por encima del presupuesto /
//               budget dépassé": vietato a budget sano (R3).
const REMAINING = /(?<!\p{L})(?:rest(?:a|ano|ava|avano)|rimang\p{L}*|rimast\p{L}*|hai ancora|disponibil\p{L}*|da spendere|a disposizione|avanz\p{L}*|left|remain\p{L}*|still (?:have|got)|to spend|available|leftover|qued(?:a|an|ar[aá]n?)|sobra\p{L}*|todav[ií]a tienes|a[uú]n tienes|para gastar|restante\p{L}*|reste\p{L}*|restant\p{L}*|[àa] d[ée]penser)(?!\p{L})/iu
// Fase 2B.5 (falsi positivi): "rimast*" in un modo di dire ("ti è rimasta
// impressa", "ci sono rimasto male") e "left" come verbo dopo un soggetto ("You
// left €1,500 at the agency") non dicono quanto resta. Si tolgono SOLO queste
// forme dalla copia usata per REMAINING: "€494 left", "you have €494 left",
// "left to spend", "ti sono rimasti 160 €" restano affermazioni di disponibilità.
const NOT_REMAINING = /(?<!\p{L})rimast[oaie] (?:impress[oaie]|colpit[oaie]|sorpres[oaie]|stupit[oaie]|male|senza parole|di stucco|a bocca aperta)(?!\p{L})|(?<!\p{L})(?:you|i|we|they|he|she)(?:['’]ve)? left(?!\p{L})/giu
const remainingText = (text) => text.replace(NOT_REMAINING, (found) => ' '.repeat(found.length))
const PERMISSION = /(?<!\p{L})(?:puoi (?:ancora |anche |tranquillamente )?(?:spendere|permetterti|concederti)|ti puoi (?:ancora )?permettere|(?:hai|c['’]è) (?:ancora )?(?:margine|spazio)|margine|budget libero|can (?:still |easily |safely )?(?:spend|afford)|room (?:to spend|in (?:your|the) budget)|free to spend|puedes (?:todav[ií]a |a[uú]n )?(?:gastar|permitirte)|te puedes permitir|margen|(?:tu peux|vous pouvez) (?:encore )?(?:d[ée]penser|te permettre|vous permettre)|marge)(?!\p{L})/iu
// Fase 2B.4: il saldo, il conto, la cassa. Con REMAINING e PERMISSION formano
// le affermazioni di DISPONIBILITÀ: a budget sano nessun importo scritto dal
// modello può accompagnarle (il disponibile lo scrive l'app), salvo "quanto
// manca" quando la frase parla dell'obiettivo.
const BALANCE = /(?<!\p{L})(?:saldo|in cassa|sul conto|nel conto|conto corrente|in tasca|nel portafoglio|balance|in (?:your|the) (?:account|bank|wallet|pocket)|en (?:tu |la |el )?(?:cuenta|caja|banco|bolsillo|cartera)|solde|sur (?:ton|votre) compte|en caisse|dans (?:ton|votre) (?:portefeuille|poche))(?!\p{L})/iu
const GOAL_WORD = /(?<!\p{L})(?:obiettiv\p{L}*|goal|target|objetivo|meta|objectif)(?!\p{L})/iu
// Fase 2B.5: il budget descritto come SANO o sotto controllo. Vietato quando la
// condizione (budgetCondition) è over, exhausted o fast. È una difesa a parole
// che si aggiunge a quelle tipizzate (stato, tono e animazione della mascotte;
// importi riservati): da sola non basterebbe, insieme riduce le contraddizioni
// con la riga di fatti che l'app scrive sotto la frase.
const HEALTHY_CLAIM = /(?<!\p{L})(?:sotto controllo|(?:il )?budget (?:regge|tiene|è in salute|sta bene)|regge alla grande|va tutto bene|tutto (?:ok|bene|a posto)|in perfetta salute|nessun problema col budget|under control|on track|(?:the )?budget is (?:holding up|fine|healthy|in great shape)|all good|doing great|in great shape|nothing to worry about|bajo control|(?:el )?presupuesto (?:aguanta|está bien|va bien)|todo (?:bien|en orden)|vas (?:muy )?bien|sous contrôle|(?:le )?budget tient(?: bon)?|tout va bien|tout roule|en (?:bonne|pleine) (?:santé|forme))(?!\p{L})/iu
const MONEY_NOUN = /(?<!\p{L})(?:soldi|denaro|contanti|money|cash|funds|dinero|plata|argent|sous|fonds)(?!\p{L})/iu
const OVER_BUDGET_CLAIM = /(?<!\p{L})(?:(?:sopra|oltre|fuori)(?: (?:il|al|dal))? budget|sforat\p{L}* (?:il )?budget|superat\p{L}* (?:il )?budget|budget (?:è )?(?:sforat|superat|finit|esaurit|sfondat)\p{L}*|in rosso|over(?:[- ](?:your |the )?)budget|exceeded (?:your |the )?budget|budget (?:is |has been )?(?:exceeded|blown|gone)|overspent|in the red|por encima del presupuesto|superad\p{L}* (?:el )?presupuesto|presupuesto (?:est[aá] )?(?:superado|agotado|excedido)|excedid\p{L}* (?:el |del )?presupuesto|te pasaste del presupuesto|en (?:n[uú]meros )?rojos?|au-dessus du budget|d[ée]pass\p{L}* (?:le |ton |votre )?budget|budget (?:est )?d[ée]pass[ée]\p{L}*|hors budget|dans le rouge|[àa] d[ée]couvert)(?!\p{L})/iu
const CURRENCY_MARK = /[€$£₤]|(?<!\p{L})(?:eur|usd|gbp)(?!\p{L})/iu

// --- Numeri scritti in lettere -----------------------------------------
//
// "mille euro", "a thousand euros", "mil euros", "mille euros", "cento
// euro", "one hundred euros", "cien euros", "cent euros", "duecentocinquanta
// euro", "two hundred and fifty dollars", "doscientos cincuenta euros",
// "deux mille cinq cents euros", "quatre-vingt-dix euros", "migliaia di
// euro", "hundreds of euros", "cinquanta per cento"...: un importo (o una
// percentuale) a parole non si può confrontare con il contesto, quindi la
// risposta si scarta e resta la frase locale. Conta:
//   - una sequenza di parole numeriche attaccata a una valuta (prima o dopo,
//     anche con "di/de/of/d'", con un trattino: "thousand-euro", o con UNA
//     parola in mezzo: "mille bei euro") o a "per cento / percent";
//   - Fase 2B.3 (R6): una parola di GRANDEZZA o approssimativa (cento, mille,
//     hundred, thousand, mil, cent, centinaio, ventina, vingtaine, decena...)
//     nella stessa parte di frase di un verbo di spesa: "Hai speso mille in
//     shopping", "You dropped a thousand on clothes".
// Restano libere: "tre volte", "un caffè", "one more", "cent fois", "mille
// grazie", "two pounds" (peso), "un livre" (libro), "150 € une belle somme"
// (Fase 2B.3, FP1: il simbolo DOPO un importo non apre un numero a parole).
// Limiti (documentati): solo it/en/es/fr; frazioni a parole ("a quarter of a
// euro"), ordinali, forme arcaiche e gergo non elencato non sono coperti;
// "un euro" viene scartato anche quando sarebbe vero (prudenza).
const NUMBER_WORD_PARTS = [
  // it (le forme composte si scrivono attaccate: "duecentocinquanta")
  'zero', 'uno', 'una', 'un', 'due', 'tre', 'tré', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici',
  'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove', 'venti', 'vent', 'trenta', 'trent', 'quaranta', 'quarant',
  'cinquanta', 'cinquant', 'sessanta', 'sessant', 'settanta', 'settant', 'ottanta', 'ottant', 'novanta', 'novant', 'cento', 'cent', 'mille',
  'mila', 'milione', 'milioni', 'miliardo', 'miliardi', 'centinaio', 'centinaia', 'migliaio', 'migliaia', 'mezzo',
  'decina', 'decine', 'ventina', 'trentina', 'quarantina', 'cinquantina', 'sessantina', 'settantina', 'ottantina', 'novantina', 'dozzina', 'dozzine',
  // en
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred',
  'hundreds', 'thousand', 'thousands', 'million', 'millions', 'billion', 'billions', 'dozen', 'dozens',
  // es ("doscientos" = dos + cientos, "veintidós" = veinti + dós, "veintiún")
  'cero', 'unos', 'unas', 'dos', 'dós', 'tres', 'trés', 'cuatro', 'cinco', 'seis', 'séis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece',
  'catorce', 'quince', 'dieciséis', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veinti', 'ún', 'treinta', 'cuarenta',
  'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento', 'cientos', 'cientas', 'quinientos', 'quinientas', 'setecientos',
  'setecientas', 'novecientas', 'mil', 'miles', 'millón', 'millon', 'millones', 'millar', 'millares', 'medio',
  'decena', 'decenas', 'docena', 'docenas', 'veintena', 'treintena', 'centenar', 'centenares',
  // fr ("quatre-vingt-dix", "vingt-et-un")
  'zéro', 'une', 'deux', 'trois', 'quatre', 'cinq', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'vingt',
  'vingts', 'trente', 'quarante', 'cinquante', 'soixante', 'cents', 'millier', 'milliers', 'milliard', 'milliards', 'centaine', 'centaines', 'demi',
  'dizaine', 'dizaines', 'douzaine', 'douzaines', 'quinzaine', 'vingtaine', 'trentaine', 'quarantaine', 'cinquantaine', 'soixantaine',
]
const NUMBER_WORD = `(?:${[...new Set(NUMBER_WORD_PARTS)].sort((a, b) => b.length - a.length).join('|')})+`
const NUMBER_WORD_TOKEN = `${NUMBER_WORD}(?:-(?:et-)?${NUMBER_WORD})*`
const NUMBER_WORDS = `(?<![\\p{L}\\p{N}])${NUMBER_WORD_TOKEN}(?:${GAP}+(?:(?:e|and|y|et)${GAP}+)?${NUMBER_WORD_TOKEN})*(?![\\p{L}\\p{N}])`
// Senza "pound / libra / livre" da soli: dopo una parola numerica sono più
// spesso un peso ("two pounds"), un segno zodiacale o un libro ("un livre").
// Con "sterling / esterlina" invece sono sempre denaro. "balles / pavos /
// pelas": gergo per euro (fr, es).
const WORDS_CURRENCY = `(?:[€$£₤]|(?:eur|euros?|euri|usd|gbp|dollar[is]?|dollaro|d[oó]lar(?:es)?|sterlin\\p{L}*|pounds?${GAP}sterling|livres?${GAP}sterling|libras?${GAP}esterlinas?|quid|bucks|balles|pavos|pelas|centesim[oi]|cents?|c[eé]ntimos?|centimes?)(?!\\p{L}))`
const WORDS_PERCENT = `(?:%|(?:per${GAP}?cento|percento|per${GAP}?cent|percent|por${GAP}?ciento|pour${GAP}?cent|pourcent)(?!\\p{L}))`
const AMOUNT_IN_WORDS = new RegExp(
  `${NUMBER_WORDS}(?:${GAP}+\\p{L}+)?(?:${GAP}*|-)(?:(?:di|de|of|del)${GAP}+|d['’])?(?:${WORDS_CURRENCY}|${WORDS_PERCENT})|(?<!\\p{Nd}${GAP}?)[€$£₤]${GAP}*${NUMBER_WORDS}`,
  'iu',
)
const NUMBER_WORDS_ALL = new RegExp(NUMBER_WORDS, 'giu')
const MAGNITUDE = /cent|mille|mila|milion|miliard|migliai|hundred|thousand|million|billion|cien|mil|mill[oó]n|millar|millier|milliard|decin|dozzin|ventin|trentin|quarantin|cinquantin|sessantin|settantin|ottantin|novantin|dizaine|douzaine|quinzaine|vingtaine|trentaine|quarantaine|cinquantaine|soixantaine|decena|docena|veintena|treintena|centenar/iu
const SPENDING = /(?<!\p{L})(?:spes[oaie]|spendere|spendi|spendo|spend|spends|spending|spent|dropped|blew|paid|pay|pays|paying|cost|costs|costa|costano|costato|costata|costati|pagat[oaie]|sborsat[oaie]|gastad[oa]s?|gastaste|gastas|gastar|gastaron|gast[oó]|pagad[oa]s?|pagaste|d[ée]pens[ée]e?s?|d[ée]penser|d[ée]penses|d[ée]pensez|pay[ée]e?s?)(?!\p{L})/iu
// "two grand" (gergo inglese per duemila) è sempre denaro; "a grand" / "one
// grand" solo accanto a un verbo di spesa ("a grand total", "a grand piano").
const GRAND = /(?<!\p{L})(?:two|three|four|five|six|seven|eight|nine|ten|a few|a couple of|several) grand(?!\p{L})/iu
const ONE_GRAND = /(?<!\p{L})(?:a|one) grand(?!\p{L})(?! total)/iu

export function numberWordProblems(message, labels = []) {
  // Il testo di un modello non supera mai qualche centinaio di caratteri:
  // il limite tiene il controllo sempre rapido anche su un testo enorme
  // (che verrebbe comunque rifiutato come too_long).
  const text = withoutLabels(String(message ?? ''), labels).normalize('NFKC').slice(0, 4 * MAX_MESSAGE_LENGTH)
  if (AMOUNT_IN_WORDS.test(text)) return ['number_in_words']
  for (const match of text.matchAll(NUMBER_WORDS_ALL)) {
    if (MAGNITUDE.test(match[0]) && SPENDING.test(clauseAt(text, match.index))) return ['number_in_words']
  }
  if (GRAND.test(text)) return ['number_in_words']
  for (const match of text.matchAll(new RegExp(ONE_GRAND, 'giu'))) {
    if (SPENDING.test(clauseAt(text, match.index))) return ['number_in_words']
  }
  return []
}

// Tutti i problemi di numeri di una risposta, con codici senza cifre tranne
// invented_numbers (che il server non scrive nei log: vedi logErrorCodes).
export function numberProblems(message, context) {
  const labels = [...knownLabels(context)]
  const allowed = authorizedNumbers(context)
  const locale = normalizeSpendyLocale(context?.locale)
  const text = String(message ?? '')
  const work = withoutLabels(text, labels)
  const cycleDays = typeof context?.budget?.cycleDays === 'number' ? context.budget.cycleDays : null
  const tokens = readNumbers(text, locale, { dates: allowed.dates, labels, cycleDays })
  const over = isOverBudget(context)
  const condition = budgetCondition(context)
  // Disponibile zero o negativo: nessun permesso di spesa, nessun "resto" (2B.5).
  const noMoneyLeft = condition === 'over' || condition === 'exhausted'
  const workForRemaining = remainingText(work)
  const problems = []
  const invented = []
  let moneyWhenOver = over && CURRENCY_MARK.test(work)
  let incoherent = false
  let badDate = false
  let reservedAmount = false
  const moneyByClause = new Map()
  const statedAmounts = [] // importi autorizzati scritti dal modello, per il controllo dei ruoli

  for (const token of tokens) {
    if (token.kind === 'date') { if (!token.ok) badDate = true; continue }
    const { value, kind } = token
    if (Number.isNaN(value)) continue
    // Un numero nudo seguito da un nome è un conteggio solo se la frase non
    // parla di spesa: "Hai speso 7 bei cicli" resta un importo (R5).
    const isCount = kind === 'quantity' && allowed.count.has(value) && !SPENDING.test(clauseAt(work, token.index))
    if (kind === 'money' || (kind === 'quantity' && !isCount)) {
      // Importo. A budget sforato nessuno: lo scrive l'app.
      if (over) { moneyWhenOver = true; continue }
      // Una cifra del budget (anche giusta) la scrive solo l'app (2B.4).
      if (!allowed.money.has(cents(value))) {
        if (allowed.reserved.has(cents(value))) reservedAmount = true
        else invented.push(value)
      } else statedAmounts.push(token)
      const clause = clauseAt(work, token.index)
      const entry = moneyByClause.get(clause) ?? { amounts: [], index: token.index }
      entry.amounts.push(cents(value))
      moneyByClause.set(clause, entry)
      continue
    }
    let ok
    if (kind === 'quantity') ok = true // isCount
    else if (kind === 'percent') ok = allowed.percent.has(value) || (value > 0 && allowed.percent.has(-value))
    else if (kind === 'days') ok = allowed.days.has(value)
    else if (kind === 'count') ok = allowed.count.has(value)
    else if (kind === 'year') { if (!allowed.dates.some((date) => date.year === value)) badDate = true; continue }
    if (!ok) invented.push(value)
  }

  // Chi dice "restano / puoi spendere", con quale importo.
  // Permessi di spesa: mai se il disponibile è zero o negativo, né se si sta
  // spendendo troppo in fretta (condizione 'fast'); liberi a budget sano.
  if (condition !== 'ok' && PERMISSION.test(work)) incoherent = true
  if (noMoneyLeft) {
    for (const match of workForRemaining.matchAll(new RegExp(REMAINING, 'giu'))) {
      if (MONEY_NOUN.test(clauseAt(work, match.index))) incoherent = true
    }
  }
  if (condition !== 'ok' && HEALTHY_CLAIM.test(work)) incoherent = true
  if (!over) {
    if (OVER_BUDGET_CLAIM.test(work)) incoherent = true
    // Disponibilità o saldo con un importo del modello: mai (lo scrive l'app).
    // Unica eccezione: quanto manca all'obiettivo, in una frase sull'obiettivo.
    for (const [clause, { amounts, index }] of moneyByClause) {
      const remainingClause = clauseAt(workForRemaining, index)
      if (!(REMAINING.test(remainingClause) || PERMISSION.test(clause) || BALANCE.test(clause))) continue
      const original = clauseAt(text, index).toLowerCase()
      const aboutGoal = GOAL_WORD.test(original) || labels.some((label) => label && original.includes(label))
      if (!(aboutGoal && amounts.every((amount) => allowed.goalGap.has(amount)))) incoherent = true
    }
  }

  const malformed = ODD_NUMERAL.test(work) || INVISIBLE_NEAR_DIGIT.test(work) || ACCOUNTING_NEGATIVE.test(work) || tokens.some((token) => token.kind !== 'date' && Number.isNaN(token.value))
  if (malformed) problems.push('malformed_number')
  if (invented.length > 0) problems.push(`invented_numbers:${invented.join(',')}`)
  if (misattributedAmount(statedAmounts, context, { text, work })) problems.push('misattributed_amount')
  if (reservedAmount) problems.push('reserved_amount')
  if (moneyWhenOver) problems.push('money_when_over_budget')
  if (incoherent) problems.push('incoherent_budget')
  if (badDate) problems.push('invented_date')
  problems.push(...numberWordProblems(text, labels))
  return problems
}

// Fase 2C: un importo autorizzato presentato con il ruolo sbagliato (vedi
// moneyRoles). Solo se nel contesto c'è una spesa: è con la spesa che una media
// o un totale si confondono. Un importo che è ANCHE la spesa va sempre bene.
function misattributedAmount(tokens, context, { text, work }) {
  const roles = moneyRoles(context)
  if (![...roles.values()].some((set) => set.has('expense'))) return false
  // Per "quanto manca" conta il nome dell'OBIETTIVO, non quello della categoria.
  const goalLabel = typeof context?.goal?.label === 'string' ? context.goal.label.toLowerCase() : null
  const calendarMonth = cycleIsCalendarMonth(context)
  return tokens.some((token) => {
    const own = roles.get(cents(token.value))
    if (!own || own.has('expense')) return false
    // Un comparativo subito dopo l'importo: vale solo se l'importo È la differenza.
    if (Number.isInteger(token.end) && COMPARATIVE_AFTER.test(work.slice(token.end, token.end + 40))) return !own.has('difference')
    const clause = clauseAt(work, token.index).replace(ADJECTIVE_AVERAGE, ' ')
    const original = clauseAt(text, token.index).toLowerCase()
    const before = precedingClause(work, token.index)
    const fronted = before && !/\p{Nd}/u.test(before) ? before : ''
    const names = (role, part) => (role === 'usual' ? (part === clause ? ROLE_MARKERS.usual.test(part) : USUAL_ADVERBIAL.test(part)) : ROLE_MARKERS[role].test(part))
      || (role === 'cycle_total' && calendarMonth && MONTH_WORD.test(part) && !PAST_PERIOD.test(part))
    return ![...own].some((role) => names(role, clause)
      || (fronted && FRONTED_ROLES.has(role) && names(role, fronted))
      || (role === 'goal' && goalLabel && original.includes(goalLabel)))
  })
}

// --- Riferimenti tra virgolette ---------------------------------------

function knownLabels(context) {
  const labels = new Set()
  const add = (value) => { if (typeof value === 'string' && value) labels.add(value.toLowerCase()) }
  add(context?.goal?.label)
  add(context?.primaryEvent?.category)
  add(context?.primaryEvent?.expense?.category)
  for (const event of context?.otherEvents ?? []) add(event.category)
  return labels
}

const QUOTED = /"([^"]+)"|“([^”]+)”|«([^»]+)»/g

function quotedNames(text) {
  return [...text.matchAll(QUOTED)].map((match) => (match[1] ?? match[2] ?? match[3]).trim().toLowerCase())
}

// "Ok... e poi?" è una frase sola: i puntini di sospensione non chiudono.
export function countSentences(text) {
  return text.split(/(?<=[^.][.!?])\s+/).map((part) => part.trim()).filter(Boolean).length
}

// Sovrapposizione di parole — usata dal server; l'app usa quella di
// JokeEvaluator, che misura la stessa cosa.
export function wordSimilarity(a, b) {
  const words = (text) => new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean))
  const wa = words(a)
  const wb = words(b)
  if (wa.size === 0 || wb.size === 0) return 0
  const shared = [...wa].filter((word) => wb.has(word)).length
  return shared / new Set([...wa, ...wb]).size
}

// --- Struttura narrativa ----------------------------------------------
//
// Una frase può cambiare tutte le parole e restare la stessa frase:
// "Ecco una categoria che non si vedeva da un po'", "Si vede che lo svago
// è tornato", "Rieccolo, lo shopping". Questi controlli guardano lo
// SCHEMA NARRATIVO, non il lessico.
const FRAME_PATTERNS = {
  comeback: /(\btorna\w*|\britorn\w*|\bbentornat\w*|\bricompar\w*|\briappar\w*|\brieccol\w*|rifatt\w* viv\w*|\bdi nuovo\b|non si vedeva|da un po[’']|dopo (diversi|tanti|parecchi|alcuni) cicli)/i,
  novelty: /(new entry|\bnovità|\bmai vist\w*|nuovo territorio|\bnuova entrata\b)/i,
  spotlight: /(^|[.!?…]\s+)(ed )?ecco\b|guarda (un po[’'] )?chi\b/i,
  inference: /\b(si vede che|a quanto pare|sembra (proprio )?che|evidentemente|pare che)\b/i,
  surprise: /^(ops|oops|wow|aspetta|ehi|oh|toh|ma dai)\b/i,
  question: /\?[\s\p{Extended_Pictographic}️]*$/u,
  labelColon: /^[\p{L}][\p{L} ]{1,30}:\s/u,
}

const STALE_PATTERNS = [
  /non si vedeva da un po/i,
  /\becco\b[^.!?]{0,40}\b(che )?(ri)?torna/i,
  /si vede che[^.!?]{0,40}\b(è )?(ri)?tornat/i,
  /(^|\s)(è|sono) (ri)?tornat\w* (tra le|nelle) tue spese/i,
  /guarda (un po[’'] )?chi (si rivede|è tornat)/i,
]

const ONCE_IN_A_WHILE = ['comeback', 'novelty']

function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .replace(/[^\p{L}#\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function openingOf(text) {
  return normalizeWords(text).slice(0, 2).join(' ')
}

export function narrativeFrames(text) {
  const frames = new Set()
  if (typeof text !== 'string' || !text.trim()) return frames
  const trimmed = text.trim()
  for (const [name, pattern] of Object.entries(FRAME_PATTERNS)) {
    if (pattern.test(trimmed)) frames.add(name)
  }
  const opening = openingOf(trimmed)
  if (opening) frames.add(`open:${opening}`)
  return frames
}

export function hasStaleStructure(text) {
  return STALE_PATTERNS.some((pattern) => pattern.test(text))
}

export function structureProblems(text, { previous = null, history = [] } = {}) {
  const problems = []
  if (hasStaleStructure(text)) problems.push('stale_structure')

  const frames = narrativeFrames(text)
  if (previous) {
    const before = narrativeFrames(previous)
    const shared = [...frames].filter((frame) => before.has(frame))
    if (shared.length > 0) problems.push(`repeated_structure:${shared.join(',')}`)
  }

  const recent = [...history.slice(-RECENT_WINDOW), ...(previous ? [previous] : [])]
  for (const frame of ONCE_IN_A_WHILE) {
    if (frames.has(frame) && recent.some((line) => narrativeFrames(line).has(frame))) {
      problems.push(`overused_structure:${frame}`)
    }
  }
  return [...new Set(problems)]
}

// Fase 5B: gli schemi che structureProblems rifiuterebbe, detti al modello
// PRIMA della risposta (input.avoidStructures). Stessa logica e stessa
// finestra del controllo (narrativeFrames sulla frase precedente, gli schemi
// "una volta ogni tanto" sulle recenti): nessuna regola nuova, il validatore
// resta com'è.
//   opening  le prime due parole della frase precedente (ogni numero vale "#")
//   frames   gli altri schemi della precedente (question, labelColon, …) più
//            comeback / novelty se già usati nelle frasi recenti
// null se non c'è niente da evitare.
export function structuresToAvoid({ previous = null, history = [] } = {}) {
  const before = previous ? narrativeFrames(previous) : new Set()
  const recent = [...history.slice(-RECENT_WINDOW), ...(previous ? [previous] : [])]
  const opening = [...before].find((frame) => frame.startsWith('open:'))?.slice('open:'.length) ?? null
  const frames = new Set([...before].filter((frame) => !frame.startsWith('open:')))
  for (const frame of ONCE_IN_A_WHILE) {
    if (recent.some((line) => narrativeFrames(line).has(frame))) frames.add(frame)
  }
  if (!opening && frames.size === 0) return null
  return { opening, frames: [...frames] }
}

// --- Validazione della risposta ---------------------------------------
//
// → { valid: true, response } | { valid: false, errors: [...] }
// Stessa funzione sul server (prima di rispondere) e nell'app (prima di
// mostrare): il frontend non si fida mai di quello che torna.
// --- Coerenza con la fase del ciclo ----------------------------------
// Frasi che affermano un momento del ciclo (in italiano, la lingua di Spendy
// AI e dei messaggi locali): vietate quando la fase dice il contrario. Usata
// dal controllo delle risposte AI e dai test dei messaggi locali.
const TIME_LEFT_CLAIM = /strada\s+(è\s+)?(ancora\s+)?lunga|(ancora|tanta|molta)\s+strada|ha\s+ancora\s+strada|(il\s+)?(mese|ciclo)\s+non\s+è\s+(ancora\s+)?finit|(il\s+)?(mese|ciclo)\s+è\s+(ancora\s+)?lung|metà\s+(del\s+)?(mese|ciclo)|ancora\s+(molti|tanti|parecchi)\s+giorni|più\s+(mese|ciclo)\s+che\s+budget|appena\s+(iniziat|cominciat|partit)|inizio\s+(del\s+)?(mese|ciclo)|primi\s+giorni/i
const END_CLAIM = /ultim[oi]\s+giorn|agli\s+sgoccioli|quasi\s+(alla\s+)?fine\s+(del\s+)?(mese|ciclo)|(mese|ciclo)\s+(sta\s+)?per\s+finire|fine\s+(del\s+)?(mese|ciclo)\s+è\s+vicin|mancano\s+pochi\s+giorni/i
const DAYS_LEFT_CLAIM = /(restano|mancano|ancora)\s+\d+\s+giorn|per\s+\d+\s+giorn|(i\s+)?prossimi\s+giorni/i
const JUST_STARTED_CLAIM = /appena\s+(iniziat|cominciat|partit)|inizio\s+(del\s+)?(mese|ciclo)|primi\s+giorni/i

// Le stesse affermazioni sul tempo in inglese, spagnolo e francese.
const TIME_LEFT_CLAIM_INTL = /long way to go|still (?:a lot of|plenty of|lots of) time|(?:cycle|month) (?:has |is )?(?:only )?just (?:started|begun)|beginning of the cycle|first (?:few )?days|halfway through|queda mucho camino|todav[ií]a (?:queda|hay) mucho|(?:el )?ciclo (?:acaba de|reci[eé]n) empez|principio del ciclo|primeros d[ií]as|mitad del ciclo|encore (?:un )?long chemin|la route est (?:encore )?longue|(?:le )?cycle vient (?:juste |tout juste )?de commencer|d[ée]but du cycle|premiers jours|moiti[ée] du cycle/i
const END_CLAIM_INTL = /last days?|almost (?:at )?the end of the cycle|(?:cycle|month) is (?:almost|nearly) over|only a few days left|[uú]ltimos? d[ií]as?|casi al final del ciclo|el ciclo est[aá] por terminar|quedan pocos d[ií]as|derniers? jours?|presque (?:à )?la fin du cycle|(?:le )?cycle (?:touche|arrive) à sa fin|il (?:ne )?reste (?:que )?(?:quelques|peu de) jours/i
const DAYS_LEFT_CLAIM_INTL = /\d+ days? (?:left|to go)|for \d+ days|(?:the )?next few days|quedan \d+ d[ií]as|durante \d+ d[ií]as|pr[oó]ximos d[ií]as|il (?:te |vous )?reste \d+ jours|pendant \d+ jours|prochains jours/i
const JUST_STARTED_CLAIM_INTL = /just (?:started|begun)|beginning of the cycle|first (?:few )?days|acaba de empezar|principio del ciclo|primeros d[ií]as|vient (?:juste |tout juste )?de commencer|d[ée]but du cycle|premiers jours/i
const claims = (italian, intl, message) => italian.test(message) || intl.test(message)

export function contradictsCyclePhase(message, phase) {
  if (typeof message !== 'string' || !CYCLE_PHASES.includes(phase)) return false
  if (LATE_PHASES.includes(phase) && claims(TIME_LEFT_CLAIM, TIME_LEFT_CLAIM_INTL, message)) return true
  if (phase === 'last_day' && claims(DAYS_LEFT_CLAIM, DAYS_LEFT_CLAIM_INTL, message)) return true
  if (EARLY_PHASES.includes(phase) && claims(END_CLAIM, END_CLAIM_INTL, message)) return true
  if ((phase === 'mid' || phase === 'second_half') && claims(JUST_STARTED_CLAIM, JUST_STARTED_CLAIM_INTL, message)) return true
  return false
}

export function validateSpendyResponse(raw, context, { history = [], previous = null, similarity = wordSimilarity } = {}) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { valid: false, errors: ['not_an_object'] }
  if (typeof raw.shouldShow !== 'boolean') errors.push('shouldShow_missing')

  const state = raw.state
  if (!AI_STATES.includes(state)) errors.push('invalid_state')
  const tone = raw.tone ?? defaultToneFor(state)
  if (!AI_TONES.includes(tone)) errors.push('invalid_tone')
  const layout = raw.layout ?? null
  if (layout !== null && !AI_LAYOUTS.includes(layout)) errors.push('invalid_layout')
  const animation = raw.animation ?? defaultAnimationFor(tone)
  if (!AI_ANIMATIONS.includes(animation)) errors.push('invalid_animation')
  const priority = parsePriority(raw.priority)
  if (priority === undefined) errors.push('invalid_priority')

  // Spendy ha deciso di stare zitto: il messaggio non conta.
  if (raw.shouldShow === false && errors.length === 0) {
    return { valid: true, response: { message: '', state, tone, layout, animation, priority, shouldShow: false } }
  }

  const message = typeof raw.message === 'string' ? raw.message.trim() : null
  if (!message) errors.push('empty_message')
  if (errors.length > 0) return { valid: false, errors }

  if (message.length > MAX_MESSAGE_LENGTH) errors.push('too_long')
  if (countSentences(message) > MAX_SENTENCES) errors.push('too_many_sentences')
  if (/[*_`#]|^\s*[-•]/m.test(message)) errors.push('markdown')

  // Numeri nella lingua della risposta (senza lingua: italiano), ognuno con
  // il suo significato, confrontati esatti e con segno (Fase 2B.1: vedi
  // numberProblems). Un numero fuori grammatica: malformed_number, senza cifre.
  errors.push(...numberProblems(message, context))
  // Solo la valuta dell'account, mai conversioni (senza riportare il testo).
  errors.push(...currencyProblems(message, context?.currency, knownLabels(context)))

  const labels = knownLabels(context)
  if (quotedNames(message).some((name) => !labels.has(name))) errors.push('unknown_reference')

  if (isRiskyAdvice(message)) errors.push('risky_advice')
  if (isFearOrOffensive(message)) errors.push('offensive_or_judgmental')

  const band = context?.budget?.band
  // Disponibile zero o negativo: niente mascotte festosa o rassicurante, né nello
  // stato né nel tono o nell'animazione (Fase 2B.5; prima solo band exceeded e
  // solo lo stato). Restano liberi attentive, concerned, advisor, ironic.
  const condition = budgetCondition(context)
  if ((band === 'exceeded' || condition === 'over' || condition === 'exhausted')
    && (state === 'celebrating' || state === 'happy' || tone === 'celebratory' || animation === 'celebrate')) errors.push('incoherent_state')
  if (contradictsCyclePhase(message, context?.budget?.cyclePhase)) errors.push('incoherent_cycle_phase')

  const said = [...history, ...(previous ? [previous] : [])].filter((line) => typeof line === 'string')
  if (said.some((line) => similarity(message, line) >= REPEAT_SIMILARITY)) errors.push('repeated')
  errors.push(...structureProblems(message, { previous, history }))

  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, response: { message, state, tone, layout, animation, priority, shouldShow: true } }
}

// null = non indicata; undefined = sbagliata. Accetta anche "72".
function parsePriority(value) {
  if (value === undefined || value === null) return null
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(100, Math.round(n)))
}

// --- Contesto: solo ciò che è ammesso ---------------------------------
//
// Lista bianca di ciò che il contesto di Spendy può contenere (la forma
// prodotta da src/ai/spendyAIContext.js). Tutto il resto viene scartato:
// anche se un giorno un bug nell'app mandasse le transazioni, al modello
// non arriverebbero. Usata dall'app prima di inviare e dal server
// prima di chiamare il modello.
const MAX_LABEL = 60

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined)
// Gli importi tengono i centesimi (Fase 2B.1): "1.234,56" si confronta con
// 1234.56, non con 1235. L'app oggi manda importi interi; se un giorno ne
// manda con i decimali, il controllo resta esatto.
const money = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined)
const str = (value, max = MAX_LABEL) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined)
const oneOf = (value, list) => (list.includes(value) ? value : undefined)
const EVENT_ID = /^[a-z_]{3,40}$/

function pick(source, spec) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined
  const out = {}
  for (const [key, clean] of Object.entries(spec)) {
    const value = clean(source[key])
    if (value !== undefined) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const obj = (spec) => (value) => pick(value, spec)

const EVENT_SPEC = {
  id: (v) => (typeof v === 'string' && EVENT_ID.test(v) ? v : undefined),
  importance: num,
  category: str,
  amount: money,
  streakCycles: num,
  expense: obj({ amount: money, category: str, usualAmount: money, categoryCycleCurrent: money, categoryCycleUsual: money }),
  purchases: obj({ current: num, usual: num }),
  singleExpense: obj({ amount: money, usualAmount: money, changePercent: num }),
  smallExpenses: obj({ count: num, total: money }),
  cycle: obj({ current: money, usual: money, difference: money, changePercent: num }),
}

export function sanitizeSpendyContext(input) {
  if (!input || typeof input !== 'object') return null
  const budget = pick(input.budget, {
    monthly: money,
    spent: money,
    available: money,
    spentPercent: num,
    daysRemaining: num,
    dailyAllowance: money,
    cyclePhase: (v) => oneOf(v, CYCLE_PHASES),
    dayOfCycle: num,
    cycleDays: num,
    band: (v) => oneOf(v, BUDGET_BANDS),
  })
  if (!budget || budget.band === undefined || budget.available === undefined) return null

  const primaryEvent = pick(input.primaryEvent, EVENT_SPEC)
  return {
    version: num(input.version) ?? 1,
    locale: normalizeSpendyLocale(input.locale),
    currency: normalizeSpendyCurrency(input.currency),
    today: typeof input.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.today) ? input.today : undefined,
    budget,
    spending: pick(input.spending, { today: money, usualCycle: money }) ?? {},
    primaryEvent: primaryEvent?.id ? primaryEvent : null,
    otherEvents: (Array.isArray(input.otherEvents) ? input.otherEvents : [])
      .slice(0, 2)
      .map((event) => pick(event, { id: EVENT_SPEC.id, importance: num, category: str }))
      .filter((event) => event?.id),
    goal: pick(input.goal, { label: str, percent: num, missing: money }) ?? null,
    suggestedState: oneOf(input.suggestedState, AI_STATES) ?? null,
  }
}

export function sanitizeMessages(list, limit = RECENT_WINDOW) {
  return (Array.isArray(list) ? list : [])
    .filter((line) => typeof line === 'string' && line.trim())
    .slice(-limit)
    .map((line) => line.trim().slice(0, MAX_MESSAGE_LENGTH))
}

// --- Personalità e prompt ---------------------------------------------

export const SPENDY_PERSONALITY = `Sei Spendy, la volpe di SPENDY: un amico sveglio che conosce le abitudini di spesa dell'utente e ogni tanto gli dice una cosa, dentro un fumetto nell'app.
Non sei un commercialista, una banca, un consulente, un predicatore, un chatbot generico, né un bambino che racconta barzellette.

PRIMA AIUTA, POI FA SORRIDERE.
Ricevi un riassunto della situazione (contesto), non le spese. Leggilo tutto insieme: l'evento principale, la categoria, quanto si scosta dall'abitudine, il budget e quanto ne resta, i giorni al termine del ciclo, l'obiettivo se c'è, lo stato suggerito e gli altri eventi. Poi decidi tu come reagire: ironico, serio, incoraggiante, attento, festoso, o una semplice osservazione.
- Interpreta, non fare il resoconto. "Hai fatto una spesa di 150 € per Shopping." è un report: non va bene. "150 € di shopping oggi: si fa notare. Il budget regge… ma quanto entusiasmo avevi?" è Spendy.
- Una spesa alta con il budget sano può essere presa con ironia. La stessa spesa con il budget al limite merita un aiuto concreto (quanto resta, per quanti giorni). Se è molto sopra la tua media, o in una categoria dove di solito spendi poco, dillo a modo tuo.
- Budget stretto o superato: niente battute, solo un aiuto concreto e un tono incoraggiante.
- L'obiettivo, se c'è, usalo solo quando rende la frase più viva o più utile.
- Una frase semplice e naturale è meglio di una battuta forzata. Se non c'è niente di interessante da dire: shouldShow = false.

STILE
- Lingua naturale (quella indicata in LINGUA), 1-3 frasi brevi, massimo 220 caratteri: una battuta da fumetto, non un paragrafo.
- Ironia leggera, curiosità, sorpresa. Mai insulti, giudizi, paura, sensi di colpa o moralismi.
- Non dire mai che una scelta è giusta o sbagliata. Niente consigli finanziari professionali, investimenti, crediti, trading, scommesse, cosa comprare o vendere, niente diagnosi.

DATI
- Usa SOLO i numeri che compaiono nel contesto, scritti come sono. Non fare calcoli, non inventare spese, saldi, percentuali o nomi.
- Se un dato non c'è, non usarlo.
- Le cifre del budget (budget.available, budget.dailyAllowance, budget.monthly, budget.spent) le scrive l'app sotto la tua frase: non scriverle tu, e non dire con un importo quanto resta, il saldo, quanto c'è sul conto o quanto si può spendere. Puoi usare gli importi dell'evento (spesa, categoria, media, differenza), la spesa di oggi, quanto manca all'obiettivo, le percentuali (con %) e i giorni (con la parola giorni).
- importance, priority e version non sono dati da citare; le cifre dentro un nome restano nel nome.
- Scrivi i numeri in cifre, mai in lettere, con i decimali solo se sono nel contesto.
- budget.available negativo (band = exceeded) vuol dire budget superato: NON scrivere importi (né cifre di denaro, né importi a parole, né simboli di valuta) e non dire mai che restano soldi o che si può spendere. Di quanto è superato lo scrive l'app sotto la tua frase: tu aiuta a rallentare (giorni che restano, percentuale, prossime spese).
- Niente orari, date diverse da quelle del ciclo o durate inventate: non sono dati che hai.

TEMPO
- Il periodo è il ciclo di budget impostato dall'utente, non il mese solare: parla di "ciclo", mai di "mese".
- Per il tempo usa solo budget.cyclePhase, budget.dayOfCycle, budget.cycleDays e budget.daysRemaining (giorni DOPO oggi: 0 vuol dire che oggi è l'ultimo giorno del ciclo).
- cyclePhase: new_cycle = primo giorno di un nuovo ciclo, start = primi giorni, first_half = prima metà, mid = metà ciclo, second_half = seconda metà, final_days = ultimi giorni, last_day = ultimo giorno.
- In final_days e last_day non dire che la strada è lunga, che manca molto o che il ciclo è appena iniziato. In last_day non parlare di giorni che restano.
- In new_cycle, start e first_half non dire che siamo alla fine del ciclo o negli ultimi giorni.

VARIETÀ
- In "previous" trovi l'ultima frase che l'utente ha letto, in "recentMessages" le ultime dette: non ripeterne né le parole né la struttura (stessa apertura, stesso schema, stessa domanda finale). Se la situazione è simile, cerca un'angolazione diversa.
- Se c'è "avoidStructures", la risposta NON deve ripetere quegli schemi. "opening": non iniziare con quelle due parole; "#" è un numero qualsiasi, quindi "180 € di…" e "45 € di…" sono la stessa apertura. "frames": question = non chiudere con una domanda; labelColon = non aprire con "Parola: "; spotlight = niente "ecco…"; inference = niente "si vede che", "sembra che"; surprise = non aprire con "wow", "ops", "ehi" e simili; comeback = niente ritorni; novelty = niente "novità", "mai visto".
- Mai raccontare una categoria come "tornata": vietati "Ecco X che torna", "Guarda chi è tornato", "X è tornato", "Si vede che X è tornato", "Non si vedeva da un po'" e simili.
- "styleExamples" mostra il tono di Spendy: non copiarli.

RISPOSTA: soltanto l'oggetto JSON richiesto, senza markdown né spiegazioni.
state: happy | attentive | concerned | celebrating | advisor | ironic
tone: friendly | playful | ironic | celebratory | concerned | helpful
layout: left | right | center | overlap (dove sta Spendy: center per festeggiare, overlap per le preoccupazioni sul budget)
animation: gentle | playful | celebrate | concerned
priority: 0-100, quanto è importante che l'utente legga questa frase.`

// Pochi esempi di voce, non la libreria intera (HumorLibrary e reaction
// library restano nell'app come fallback locale). Ogni lingua ne ha 26;
// in una richiesta ne vanno 4 (pickStyleExamples), a rotazione, solo tra
// quelli adatti alla situazione (STYLE_EXAMPLE_FIT, stesso ordine).
export const STYLE_EXAMPLES = [
  '150 € di shopping oggi: si fa notare. Il budget regge… ma quanto entusiasmo avevi?',
  'Il Giappone si avvicina. E questa volta non è merito dello shopping.',
  'Hai offerto la cena anche al cuoco? 😂',
  'Il forno di casa ha lavorato più del delivery, stavolta.',
  'Mancano 9 giorni alla fine del ciclo: si può fare, con un po’ di calma.',
  'Le piccole spese non si notano una per una: si notano a fine ciclo.',
  'Hai speso meno del previsto. Mi sto emozionando.',
  'Oggi il portafoglio può dormire tranquillo.',
  // Dal nono in poi (Fase 5A): senza numeri né simboli di valuta, per variare il
  // tono senza toccare le regole sui numeri. Ne vanno 4 per richiesta, a rotazione.
  'Il caffè al bar è diventato un rito, vedo. Bello, finché il rito non diventa un abbonamento.',
  'Spesa al supermercato sotto controllo: qualcuno ha fatto la lista e l’ha pure rispettata.',
  'Una categoria nuova nel ciclo: curiosità mia, è un regalo o un nuovo hobby?',
  'Il ciclo è appena iniziato e il budget è ancora intatto. Godiamoci il momento.',
  'Qualche piccola spesa di fila non fa una tempesta. Ma io l’ho vista. 👀',
  'Ristoranti in calo rispetto al solito: la cucina di casa sta vincendo ai punti.',
  'Ultimi giorni del ciclo: un po’ di calma adesso vale più di qualsiasi rinuncia dopo.',
  'Il tuo obiettivo fa un passo avanti. Piccolo, ma è quello che conta.',
  'Oggi niente spese. Il portafoglio ringrazia e io prendo appunti.',
  'Trasporti più alti del solito: settimana movimentata o è solo una mia impressione?',
  'Lo shopping si è preso una pausa. Non dirlo troppo forte, potrebbe sentirti.',
  'Il budget regge bene: è il momento giusto per pensare all’obiettivo, non alle vetrine.',
  'Le uscite di questi giorni si sentono, ma il ciclo è lungo: c’è spazio per riequilibrare.',
  'Spesa sopra la tua media, budget ancora sereno. Diciamo che te la sei concessa.',
  'Hai rallentato senza che te lo chiedessi. Mi piace questo ritmo.',
  'Una spesa così fuori dal solito merita una domanda: era prevista o è stata un colpo di testa?',
  // Due neutri in più (Fase 5A-ter): vanno bene anche a budget superato,
  // senza approvare, giudicare o raccontare cose che i dati non dicono.
  'Ogni spesa racconta qualcosa: io ascolto, senza giudicare.',
  'Passo dopo passo: tu decidi le mosse, io tengo il conto.',
]

// Gli stessi esempi di voce nelle altre lingue: il modello prende il tono
// dalla lingua in cui deve rispondere.
export const STYLE_EXAMPLES_BY_LOCALE = {
  it: STYLE_EXAMPLES,
  en: [
    '€150 of shopping today: hard to miss. The budget is holding up… but how excited were you?',
    'Japan is getting closer. And this time it’s not thanks to shopping.',
    'Did you buy the chef dinner too? 😂',
    'The oven at home worked harder than delivery this time.',
    '9 days to go in the cycle: doable, with a bit of calm.',
    'Small expenses don’t show one by one: they show at the end of the cycle.',
    'You spent less than expected. I’m getting emotional.',
    'Your wallet can sleep soundly today.',
    'Coffee at the bar has become a ritual, I see. Lovely, as long as the ritual doesn’t turn into a subscription.',
    'Groceries under control: someone made a list and actually stuck to it.',
    'A new category this cycle: just curious, is it a gift or a new hobby?',
    'The cycle has just started and the budget is still untouched. Let’s enjoy the moment.',
    'A few small expenses in a row don’t make a storm. But I noticed them. 👀',
    'Restaurants down compared to usual: home cooking is winning on points.',
    'Last days of the cycle: a bit of calm now is worth more than any sacrifice later.',
    'Your goal takes a step forward. Small, but that’s what counts.',
    'No spending today. Your wallet says thanks and I’m taking notes.',
    'Transport higher than usual: a busy week, or is it just me?',
    'Shopping has taken a break. Don’t say it too loud, it might hear you.',
    'The budget is holding up well: a good moment to think about your goal, not the shop windows.',
    'These days’ outings show, but the cycle is long: there’s room to rebalance.',
    'Above your average, budget still relaxed. Let’s call it a little treat.',
    'You slowed down without me asking. I like this pace.',
    'An expense this far from your usual deserves a question: was it planned or a spur-of-the-moment thing?',
    'Every expense tells a story: I listen, without judging.',
    'Step by step: you make the moves, I keep count.',
  ],
  es: [
    '150 € de compras hoy: se nota. El presupuesto aguanta… pero ¿cuánta ilusión tenías?',
    'Japón está más cerca. Y esta vez no es gracias a las compras.',
    '¿También le pagaste la cena al cocinero? 😂',
    'El horno de casa ha trabajado más que el delivery esta vez.',
    'Quedan 9 días de ciclo: se puede, con un poco de calma.',
    'Los gastos pequeños no se notan uno a uno: se notan al final del ciclo.',
    'Has gastado menos de lo previsto. Me estoy emocionando.',
    'Hoy la cartera puede dormir tranquila.',
    'El café en el bar se ha vuelto un ritual, veo. Genial, mientras el ritual no se convierta en una suscripción.',
    'Compra del súper bajo control: alguien hizo la lista y encima la respetó.',
    'Una categoría nueva en el ciclo: por curiosidad, ¿es un regalo o una nueva afición?',
    'El ciclo acaba de empezar y el presupuesto sigue intacto. Disfrutemos el momento.',
    'Unos cuantos gastos pequeños seguidos no hacen una tormenta. Pero yo los he visto. 👀',
    'Restaurantes a la baja respecto a lo habitual: la cocina de casa gana por puntos.',
    'Últimos días del ciclo: un poco de calma ahora vale más que cualquier renuncia después.',
    'Tu objetivo da un paso adelante. Pequeño, pero es lo que cuenta.',
    'Hoy nada de gastos. La cartera lo agradece y yo tomo nota.',
    'Transporte más alto de lo habitual: ¿semana movida o es solo impresión mía?',
    'Las compras se han tomado un descanso. No lo digas muy alto, que te pueden oír.',
    'El presupuesto aguanta bien: buen momento para pensar en tu objetivo, no en los escaparates.',
    'Las salidas de estos días se notan, pero el ciclo es largo: hay margen para reequilibrar.',
    'Por encima de tu media, presupuesto todavía tranquilo. Digamos que te lo has permitido.',
    'Has frenado sin que te lo pidiera. Me gusta este ritmo.',
    'Un gasto tan fuera de lo habitual merece una pregunta: ¿estaba previsto o fue un impulso?',
    'Cada gasto cuenta algo: yo escucho, sin juzgar.',
    'Paso a paso: tú decides los movimientos, yo llevo la cuenta.',
  ],
  fr: [
    '150 € de shopping aujourd’hui\u00a0: ça se remarque. Le budget tient bon… mais quel enthousiasme\u00a0!',
    'Le Japon se rapproche. Et cette fois, ce n’est pas grâce au shopping.',
    'Vous avez aussi offert le dîner au chef\u00a0? 😂',
    'Le four de la maison a travaillé plus que la livraison, cette fois.',
    'Encore 9 jours de cycle\u00a0: c’est faisable, avec un peu de calme.',
    'Les petites dépenses ne se voient pas une par une\u00a0: elles se voient en fin de cycle.',
    'Vous avez dépensé moins que prévu. Ça m’émeut.',
    'Aujourd’hui, le portefeuille peut dormir tranquille.',
    'Le café au bar est devenu un rituel, je vois. Très bien, tant que le rituel ne devient pas un abonnement.',
    'Courses sous contrôle\u00a0: quelqu’un a fait une liste et l’a même respectée.',
    'Une nouvelle catégorie ce cycle\u00a0: simple curiosité, c’est un cadeau ou un nouveau passe-temps\u00a0?',
    'Le cycle vient de commencer et le budget est encore intact. Profitons du moment.',
    'Quelques petites dépenses d’affilée ne font pas une tempête. Mais je les ai vues. 👀',
    'Restaurants en baisse par rapport à d’habitude\u00a0: la cuisine maison gagne aux points.',
    'Derniers jours du cycle\u00a0: un peu de calme maintenant vaut mieux que n’importe quel sacrifice plus tard.',
    'Votre objectif fait un pas en avant. Petit, mais c’est ce qui compte.',
    'Aucune dépense aujourd’hui. Le portefeuille vous remercie et je prends des notes.',
    'Transports plus élevés que d’habitude\u00a0: semaine chargée, ou c’est juste une impression\u00a0?',
    'Le shopping fait une pause. Ne le dites pas trop fort, il pourrait vous entendre.',
    'Le budget tient bien\u00a0: c’est le bon moment pour penser à votre objectif, pas aux vitrines.',
    'Les sorties de ces derniers jours se sentent, mais le cycle est long\u00a0: il y a de la marge pour rééquilibrer.',
    'Au-dessus de votre moyenne, budget encore serein. Disons que vous vous l’êtes accordé.',
    'Vous avez ralenti sans que je vous le demande. J’aime ce rythme.',
    'Une dépense aussi inhabituelle mérite une question\u00a0: c’était prévu ou un coup de tête\u00a0?',
    'Chaque dépense raconte quelque chose\u00a0: j’écoute, sans juger.',
    'Pas à pas\u00a0: vous décidez, je tiens les comptes.',
  ],
}

const LANGUAGE_NAMES = { it: 'italiano', en: 'inglese (English)', es: 'spagnolo (español)', fr: 'francese (français)' }

// La sezione LINGUA del prompt: la sola parte che cambia con la lingua.
export function spendyLanguageInstructions(locale) {
  const code = normalizeSpendyLocale(locale)
  const name = LANGUAGE_NAMES[code]
  const lines = [
    'LINGUA',
    `- Rispondi esclusivamente in ${name} (context.locale = "${code}"): tutto il campo message è in ${name}, anche se queste istruzioni sono scritte in italiano.`,
    '- Scrivi i numeri esattamente come compaiono nel contesto, senza separatori delle migliaia.',
  ]
  if (code !== 'it') {
    lines.push(`- Le regole di TEMPO e VARIETÀ valgono anche per le frasi equivalenti in ${name}: per "ciclo" usa la parola equivalente in ${name}.`)
    lines.push(`- I nomi delle categorie e degli obiettivi nel contesto si scrivono così come sono.`)
  }
  return lines.join('\n')
}

const CURRENCY_NAMES = { EUR: 'euro', USD: 'dollari statunitensi', GBP: 'sterline britanniche' }

// La sezione VALUTA del prompt: la valuta dell'account, indipendente dalla
// lingua. Gli importi del contesto sono già in questa valuta.
export function spendyCurrencyInstructions(currency) {
  const code = normalizeSpendyCurrency(currency)
  const symbol = SPENDY_CURRENCIES[code]
  const name = CURRENCY_NAMES[code]
  return [
    'VALUTA',
    `- La valuta dell'utente è ${name} (${code}, simbolo ${symbol}): context.currency = "${code}". Tutti gli importi del contesto sono in ${name}, qualunque sia la lingua della risposta.`,
    `- Per un importo usa solo il simbolo ${symbol}, nella posizione abituale della lingua della risposta: in inglese prima del numero (${symbol}150), in italiano, spagnolo e francese dopo (150 ${symbol}).`,
    '- Non usare mai un\'altra valuta, non convertire importi e non citare tassi di cambio.',
  ].join('\n')
}

// Personalità ed esempi scrivono gli importi in euro: per un'altra valuta si
// riscrive solo il simbolo (nella stessa posizione: "€150" → "$150",
// "150 €" → "150 £"), così il modello vede esempi nella valuta giusta.
const withCurrencySymbol = (text, currency) => text.replaceAll('€', SPENDY_CURRENCIES[normalizeSpendyCurrency(currency)])

// Quanti esempi di stile vanno in una richiesta, e in quanti gruppi è divisa
// la raccolta intera di ogni lingua (26 → 7 gruppi: gli esempi i, i+7, i+14, i+21).
export const STYLE_EXAMPLES_PER_REQUEST = 4
export const STYLE_EXAMPLE_GROUPS = Math.ceil(STYLE_EXAMPLES.length / STYLE_EXAMPLES_PER_REQUEST)

const dayNumber = (dateStr) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dateStr === 'string' ? dateStr : '')
  return match ? Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000) : 0
}
const textSeed = (text) => [...(typeof text === 'string' ? text : '')].reduce((sum, char) => sum + char.codePointAt(0), 0)

// Fase 5A-bis: in quali situazioni ogni esempio non contraddice i dati. Una
// voce per posizione, valida per tutte e quattro le lingue (le raccolte sono
// traduzioni nello stesso ordine). Campi assenti = va bene sempre.
//   budget    calm (fascia ok) | tight (warning o high) | over (sforato o a zero)
//   phase     early (EARLY_PHASES) | middle | late (LATE_PHASES)
//   quietDay  true = dice che oggi non si è speso: escluso se spending.today > 0
const CALM = 'calm', TIGHT = 'tight', OVER = 'over'
export const STYLE_EXAMPLE_FIT = Object.freeze([
  { budget: [CALM] }, //                                0 shopping, "il budget regge"
  { budget: [CALM] }, //                                1 obiettivo più vicino
  { budget: [CALM] }, //                                2 battuta sulla cena
  { budget: [CALM, TIGHT] }, //                         3 forno di casa
  { budget: [TIGHT], phase: ['middle'] }, //            4 "mancano 9 giorni… con calma"
  {}, //                                                5 piccole spese
  { budget: [CALM] }, //                                6 "meno del previsto"
  { budget: [CALM], quietDay: true }, //                7 portafoglio tranquillo oggi
  { budget: [CALM, TIGHT] }, //                         8 caffè al bar
  { budget: [CALM, TIGHT] }, //                         9 spesa sotto controllo
  {}, //                                               10 categoria nuova
  { budget: [CALM], phase: ['early'] }, //             11 ciclo appena iniziato, budget intatto
  { budget: [CALM, TIGHT] }, //                        12 piccole spese di fila
  { budget: [CALM, TIGHT] }, //                        13 ristoranti in calo
  { budget: [TIGHT, OVER], phase: ['late'] }, //       14 ultimi giorni, calma
  { budget: [CALM, TIGHT] }, //                        15 obiettivo fa un passo avanti
  { quietDay: true }, //                               16 oggi niente spese
  {}, //                                               17 trasporti più alti
  { budget: [CALM, TIGHT] }, //                        18 shopping in pausa
  { budget: [CALM] }, //                               19 "il budget regge bene"
  // 20 "il ciclo è lungo": non a fine ciclo; e non all'inizio, perché in francese
  // "ces derniers jours" suona come "ultimi giorni" (contradictsCyclePhase).
  { budget: [CALM, TIGHT], phase: ['middle'] },
  { budget: [CALM] }, //                               21 "budget ancora sereno"
  // 22 "hai rallentato… mi piace questo ritmo": approva, quindi mai a budget superato.
  { budget: [CALM, TIGHT] },
  {}, //                                               23 spesa fuori dal solito
  {}, //                                               24 ogni spesa racconta qualcosa
  {}, //                                               25 passo dopo passo
])
// Gli esempi neutri: adatti a qualunque budget, fase e giornata.
export const NEUTRAL_STYLE_EXAMPLES = Object.freeze(STYLE_EXAMPLE_FIT.flatMap((fit, i) => (Object.keys(fit).length === 0 ? [i] : [])))

// La situazione che conta per gli esempi, dai dati del contesto e dalle fasce
// già esistenti (budgetCondition, fasi del ciclo). null = dato assente: su
// quel punto non si esclude nulla.
export function styleSituation(context) {
  const budget = context?.budget && typeof context.budget === 'object' ? context.budget : null
  const condition = budget ? budgetCondition(context) : null
  const phase = budget?.cyclePhase
  const today = context?.spending?.today
  return {
    budget: !budget ? null
      : condition === 'over' || condition === 'exhausted' ? OVER
        : budget.band === 'warning' || budget.band === 'high' ? TIGHT
          : budget.band === 'ok' ? CALM : null,
    phase: EARLY_PHASES.includes(phase) ? 'early' : LATE_PHASES.includes(phase) ? 'late' : CYCLE_PHASES.includes(phase) ? 'middle' : null,
    spentToday: typeof today === 'number' && Number.isFinite(today) ? today : null,
  }
}

export function styleExampleFits(fit, situation) {
  return (!fit?.budget || !situation?.budget || fit.budget.includes(situation.budget))
    && (!fit?.phase || !situation?.phase || fit.phase.includes(situation.phase))
    && (!fit?.quietDay || !(situation?.spentToday > 0))
}

// Gli esempi di stile di UNA richiesta. Prima si tengono solo quelli che non
// contraddicono budget, fase del ciclo e spese di oggi (STYLE_EXAMPLE_FIT);
// se fossero meno di 4 si completano con quelli neutri. Poi la rotazione:
// la raccolta adatta è messa in un ordine a gruppi (gli esempi i, i+G, i+2G…)
// e ogni giorno si prendono i 4 successivi a quelli del giorno prima; il punto
// di partenza lo scelgono il giorno (context.today) e l'evento principale.
// Deterministico (stesso contesto → stessi esempi), mai casuale; con almeno 8
// esempi adatti due giorni di fila non condividono esempi, e in
// ceil(adatti / 4) giorni si usa tutta la raccolta adatta (26 → 7 giorni).
// Con 24 esempi la scelta è identica a quella della Fase 5A. Usa solo campi
// che il contesto ha già.
export function pickStyleExamples(pool, context) {
  if (!Array.isArray(pool) || pool.length === 0) return []
  const tagged = pool.length === STYLE_EXAMPLE_FIT.length
  const situation = styleSituation(context)
  const usable = pool.map((_, i) => i).filter((i) => !tagged || styleExampleFits(STYLE_EXAMPLE_FIT[i], situation))
  if (tagged && usable.length < STYLE_EXAMPLES_PER_REQUEST) usable.push(...NEUTRAL_STYLE_EXAMPLES.filter((i) => !usable.includes(i)))
  const groups = Math.max(1, Math.ceil(usable.length / STYLE_EXAMPLES_PER_REQUEST))
  const order = []
  for (let g = 0; g < groups; g += 1) for (let i = g; i < usable.length; i += groups) order.push(usable[i])
  const start = ((dayNumber(context?.today) + textSeed(context?.primaryEvent?.id)) * STYLE_EXAMPLES_PER_REQUEST) % order.length
  const count = Math.min(STYLE_EXAMPLES_PER_REQUEST, order.length)
  return Array.from({ length: count }, (_, k) => pool[order[(start + k) % order.length]])
}

// JSON Schema della risposta (per gli output strutturati del modello).
export const SPENDY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    state: { type: 'string', enum: AI_STATES },
    tone: { type: 'string', enum: AI_TONES },
    layout: { type: 'string', enum: AI_LAYOUTS },
    animation: { type: 'string', enum: AI_ANIMATIONS },
    priority: { type: 'integer' },
    shouldShow: { type: 'boolean' },
  },
  required: ['message', 'state', 'tone', 'layout', 'animation', 'priority', 'shouldShow'],
  additionalProperties: false,
}

export function buildSpendyPrompt(context, { previous = null, history = [], styleExamples } = {}) {
  const locale = normalizeSpendyLocale(context?.locale)
  const currency = normalizeSpendyCurrency(context?.currency)
  const examples = styleExamples ?? pickStyleExamples(STYLE_EXAMPLES_BY_LOCALE[locale], context).map((example) => withCurrencySymbol(example, currency))
  // Gli schemi da non ripetere, con la stessa logica del validatore: assente
  // se non c'è una frase precedente né schemi recenti da evitare.
  const avoidStructures = structuresToAvoid({ previous, history })
  return {
    system: `${withCurrencySymbol(SPENDY_PERSONALITY, currency)}\n\n${spendyLanguageInstructions(locale)}\n\n${spendyCurrencyInstructions(currency)}`,
    input: {
      context,
      previous,
      recentMessages: history.slice(-RECENT_WINDOW),
      styleExamples: examples.slice(0, 12),
      ...(avoidStructures ? { avoidStructures } : {}),
    },
  }
}
