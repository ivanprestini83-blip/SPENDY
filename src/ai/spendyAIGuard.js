// PERSONALITY / SAFETY VALIDATION — l'ultima parola prima della Home.
//
//   risposta AI (qualunque) → QUESTO MODULO → risposta valida | rifiuto
//
// Vale per il mock e per la vera AI allo stesso modo: il frontend non si
// fida mai di quello che torna, nemmeno dal nostro server (che ha già
// validato con le stesse regole). Una risposta rifiutata non viene
// "aggiustata", viene scartata, e la Home mostra la frase locale.
//
// Le regole vivono in supabase/functions/_shared/spendyAIRules.js,
// condivise con la Edge Function: forma, stati/toni/layout ammessi,
// lunghezza, NUMERI INVENTATI, nomi tra virgolette sconosciuti,
// consigli rischiosi, giudizi, coerenza con il budget, ripetizioni di
// parole e di STRUTTURA. Qui l'app aggiunge solo la sua misura di
// somiglianza (quella di JokeEvaluator) e verifica che i vocabolari
// condivisi coincidano con quelli dell'app.
import { SPENDY_STATES } from '../utils/spendyCoach.js'
import { similarity } from '../utils/jokeEvaluator.js'
import { SPENDY_HERO_POSITIONS } from '../components/spendy/spendyHeroLayouts.js'
import {
  AI_STATES,
  AI_TONES,
  AI_ANIMATIONS,
  AI_LAYOUTS,
  MAX_MESSAGE_LENGTH,
  MAX_SENTENCES,
  defaultToneFor,
  defaultAnimationFor,
  passesToneRules,
  extractNumbers,
  allowedNumbers,
  validateSpendyResponse,
} from '../../supabase/functions/_shared/spendyAIRules.js'

export {
  AI_STATES,
  AI_TONES,
  AI_ANIMATIONS,
  AI_LAYOUTS,
  MAX_MESSAGE_LENGTH,
  MAX_SENTENCES,
  defaultToneFor,
  defaultAnimationFor,
  passesToneRules,
  extractNumbers,
  allowedNumbers,
}

// I vocabolari condivisi devono essere esattamente quelli dell'app: un
// settimo stato aggiunto a spendyCoach senza aggiornare il server
// verrebbe scartato in silenzio. Il test lo controlla.
export const VOCABULARY_IN_SYNC = sameSet(AI_STATES, Object.values(SPENDY_STATES)) && sameSet(AI_LAYOUTS, SPENDY_HERO_POSITIONS)

function sameSet(a, b) {
  return a.length === b.length && a.every((item) => b.includes(item))
}

// → { valid: true, response } | { valid: false, errors: [...] }
// `history` = messaggi già mostrati (stringhe), per la regola anti-ripetizione.
// `previous` = l'ultima frase che l'utente ha letto (AI o locale).
export function validateAIResponse(raw, context, { history = [], previous = null } = {}) {
  return validateSpendyResponse(raw, context, { history, previous, similarity })
}
