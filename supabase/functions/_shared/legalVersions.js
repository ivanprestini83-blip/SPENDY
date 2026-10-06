// Versioni correnti dei documenti legali di SPENDY — UNICA fonte, condivisa
// dall'app (src/legal/legal.js) e dal server (supabase/functions/accept-legal).
// Cambiando il testo di public/termini.html o public/privacy.html si cambia la
// versione qui: chi ha accettato quella precedente dovrà riaccettare.
export const LEGAL_VERSIONS = Object.freeze({
  terms: '2026-10-06',
  privacy: '2026-10-06',
})
