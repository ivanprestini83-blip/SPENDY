// Le fasi del ciclo di budget impostato dall'utente (Impostazioni → giorno di
// inizio del ciclo) — condivise dall'app (src/utils/cycle.js getCycleTiming)
// e dal server (spendyAIRules: filtro del contesto e controllo delle frasi).
//
//   new_cycle    primo giorno: il ciclo precedente è finito ieri
//   start        primi giorni (fino al 15% del ciclo)
//   first_half   prima metà
//   mid          metà ciclo (45–55%)
//   second_half  seconda metà
//   final_days   ultimi giorni (1–3 giorni dopo oggi)
//   last_day     ultimo giorno del ciclo (0 giorni dopo oggi)
export const CYCLE_PHASES = Object.freeze(['new_cycle', 'start', 'first_half', 'mid', 'second_half', 'final_days', 'last_day'])

// Fasi in cui dire "c'è ancora tempo / la strada è lunga" è vero.
export const PHASES_WITH_TIME_LEFT = Object.freeze(['new_cycle', 'start', 'first_half', 'mid', 'second_half'])
// Fasi in cui dire "siamo alla fine / ultimi giorni" è falso.
export const EARLY_PHASES = Object.freeze(['new_cycle', 'start', 'first_half'])
// Fasi in cui NON si può dire che manchi ancora molto.
export const LATE_PHASES = Object.freeze(['final_days', 'last_day'])
