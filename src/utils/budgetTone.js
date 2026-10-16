// Il "tono" della card del budget disponibile: quale colore deve avere,
// in base alla PERCENTUALE di budget che resta nel ciclo in corso — mai
// all'importo in euro (800 € su 1.000 e 50 € su 1.000 sono due situazioni
// diverse, 50 € su 60 no).
//
// Solo presentazione: riceve i due numeri che la Home già calcola con
// buildFinancialData (disponibile e speso del ciclo) e non ne ricalcola
// nessuno. Il budget del ciclo è quindi disponibile + speso, cioè lo
// stipendio del ciclo più le entrate extra, la stessa base del disponibile.
//
// Soglie (percentuale residua del budget del ciclo):
//   oltre il 50%            → good     (verde menta)
//   dal 25% al 50%          → caution  (giallo)
//   dal 10% al 25%          → warning  (arancione)
//   sotto il 10%            → danger   (corallo)
//   0 o meno (finito/sforato) → over   (corallo, con indicazione esplicita)
//   budget non disponibile  → neutral  (nessun colore di stato: niente
//                              rosso "per default" se non c'è un budget)
export const BUDGET_TONE_THRESHOLDS = {
  good: 50, // > 50%
  caution: 25, // 25% … 50%
  warning: 10, // 10% … < 25%
}

export const BUDGET_TONES = ['neutral', 'good', 'caution', 'warning', 'danger', 'over']

export function budgetTone({ available, spent } = {}) {
  const left = Number(available)
  const used = Number(spent)
  if (!Number.isFinite(left) || !Number.isFinite(used)) return { tone: 'neutral', remainingPercent: null }
  const total = left + Math.max(0, used)
  // Nessun budget (stipendio non inserito e nessuna entrata): nessuna
  // percentuale attendibile, nessun colore di allarme.
  if (!(total > 0)) return { tone: 'neutral', remainingPercent: null }
  if (left <= 0) return { tone: 'over', remainingPercent: 0 }

  const remainingPercent = (left / total) * 100
  const tone = remainingPercent > BUDGET_TONE_THRESHOLDS.good ? 'good'
    : remainingPercent >= BUDGET_TONE_THRESHOLDS.caution ? 'caution'
      : remainingPercent >= BUDGET_TONE_THRESHOLDS.warning ? 'warning'
        : 'danger'
  return { tone, remainingPercent }
}
