// NOTIFICHE — il watcher. UN solo store.subscribe, avviato da App.jsx e
// fermato allo smontaggio; più il ritorno dell'app in primo piano
// (visibilitychange) per rivalutare la coda. Nessun timer, nessun polling.
//
//  - Reagisce solo a ciò che nasce su questo dispositivo (vedi isLocalChange):
//    i dati arrivati dal cloud non generano niente.
//  - Un cambio di ambito (logout/login) e la lettura del contenitore nuovo,
//    che avviene subito dopo nello stesso istante, vengono ignorati: caricare
//    un account non produce notifiche.
//  - Ogni notifica è scritta nell'ambito dello snapshot che l'ha generata, e
//    lo store rifiuta la scrittura se nel frattempo l'ambito attivo è un altro.

import { evaluateLocalChange, evaluateStale, evaluateSyncChange } from './notificationRules.js'

let stopCurrent = null

function emit(store, scope, candidates) {
  const { addNotification } = store.getState()
  for (const candidate of candidates) addNotification(scope, candidate)
}

export function startNotificationWatcher(store, { now = () => new Date(), doc = globalThis.document } = {}) {
  // Un solo watcher alla volta, anche se App si monta due volte (StrictMode).
  stopCurrent?.()

  let settling = false

  const unsubscribe = store.subscribe((next, prev) => {
    if (next.scopeId !== prev.scopeId) {
      settling = true
      queueMicrotask(() => { settling = false })
      return
    }
    if (settling) return

    const at = now()
    emit(store, next.scopeId, evaluateLocalChange(prev, next, at))
    // Stato della sync: solo quando cambia davvero (stato o coda), non per
    // ogni aggiornamento dello store (comprese le notifiche stesse).
    if (next.sync.status !== prev.sync.status || next.sync.outbox !== prev.sync.outbox) {
      emit(store, next.scopeId, evaluateSyncChange(prev, next, at))
    }
  })

  const onVisible = () => {
    if (doc?.visibilityState === 'hidden') return
    const state = store.getState()
    emit(store, state.scopeId, evaluateStale(state, now()))
  }
  doc?.addEventListener?.('visibilitychange', onVisible)

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    unsubscribe()
    doc?.removeEventListener?.('visibilitychange', onVisible)
    if (stopCurrent === stop) stopCurrent = null
  }
  stopCurrent = stop

  // All'avvio: una coda rimasta ferma dall'ultima volta.
  onVisible()
  return stop
}
