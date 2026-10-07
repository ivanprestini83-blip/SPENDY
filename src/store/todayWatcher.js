// Tiene `today` allineato al calendario mentre l'app resta aperta.
//
// `today` (useAppStore) è la data locale 'AAAA-MM-GG' su cui si basano
// "Spese di oggi" e il ciclo in corso. Leggerla solo all'avvio non basta: una
// PWA o l'app Android tornano in primo piano senza ripartire, e dopo la
// mezzanotte continuerebbero a mostrare come "oggi" il giorno prima. Qui si
// ricontrolla quando la pagina torna visibile, quando riprende il focus e una
// volta al minuto; refreshToday non fa nulla se il giorno è lo stesso.
export function startTodayWatcher(store, {
  doc = globalThis.document,
  win = globalThis.window,
  setTimer = globalThis.setInterval,
  clearTimer = globalThis.clearInterval,
  intervalMs = 60_000,
} = {}) {
  const refresh = () => store.getState().refreshToday()
  const onVisibility = () => {
    if (!doc || doc.visibilityState === undefined || doc.visibilityState === 'visible') refresh()
  }
  doc?.addEventListener?.('visibilitychange', onVisibility)
  win?.addEventListener?.('focus', refresh)
  const timer = setTimer ? setTimer(refresh, intervalMs) : null
  return () => {
    doc?.removeEventListener?.('visibilitychange', onVisibility)
    win?.removeEventListener?.('focus', refresh)
    if (timer !== null && clearTimer) clearTimer(timer)
  }
}
