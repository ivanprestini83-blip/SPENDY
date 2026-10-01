// Una richiesta a Spendy AI e il salvataggio del suo esito, in un posto solo
// e senza React, così si può provare da sola.
//
// L'AMBITO (guest o account, vedi store/scope.js) è quello con cui la
// richiesta è partita. Una risposta arriva dopo secondi: se nel frattempo
// l'utente è uscito ed è entrato qualcun altro, la memoria aggiornata finisce
// comunque nel contenitore di chi l'ha richiesta, mai in quello attivo.
import { requestSpendyVoice } from './spendyVoicePolicy.js'
import { saveVoiceCache } from './spendyVoiceCache.js'

export async function requestAndStoreVoice({ ai, context, meta, cache, today, scope, storage, now }) {
  const outcome = await requestSpendyVoice({ ai, context, meta, cache, today, ...(now === undefined ? {} : { now }) })
  saveVoiceCache(outcome.cache, storage, scope)
  return outcome
}
