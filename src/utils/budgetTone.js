// Il livello del budget del ciclo in corso: UNA sola scala, usata sia dalla
// Home (colore della card, messaggio di stato) sia da Andamento (colore
// della barra, sintesi, "Ritmo di spesa"), così le due schermate dicono
// sempre la stessa cosa con lo stesso colore.
//
// La base è la percentuale di budget SPESO, cioè speso ÷ stipendio del
// ciclo × 100: lo stesso `spentRatio` della BudgetCard e lo stesso
// `budgetUsed` di Andamento (andamentoEngine). Mai l'importo in euro: 50 €
// rimasti su 1.000 e 50 € su 60 sono due situazioni diverse.
//
// Soglie (percentuale spesa):
//   sotto il 60%     → ok       (verde: in linea)
//   dal 60% al 75%   → caution  (giallo)
//   dal 75% al 90%   → warning  (arancione)
//   dal 90% al 100%  → danger   (rosso: quasi finito)
//   100% e oltre     → over     (rosso, con indicazione esplicita)
//   nessun budget    → neutral  (nessun colore di stato: niente rosso
//                                "per default" senza uno stipendio)
//
// Solo presentazione: nessun calcolo finanziario nuovo, si leggono numeri
// già calcolati altrove.
export const BUDGET_LEVEL_THRESHOLDS = {
  caution: 60,
  warning: 75,
  danger: 90,
  over: 100,
}

export const BUDGET_LEVELS = ['neutral', 'ok', 'caution', 'warning', 'danger', 'over']

export function budgetLevel(spentPercent) {
  if (spentPercent === null || spentPercent === undefined) return 'neutral'
  const value = Number(spentPercent)
  if (!Number.isFinite(value)) return 'neutral'
  if (value >= BUDGET_LEVEL_THRESHOLDS.over) return 'over'
  if (value >= BUDGET_LEVEL_THRESHOLDS.danger) return 'danger'
  if (value >= BUDGET_LEVEL_THRESHOLDS.warning) return 'warning'
  if (value >= BUDGET_LEVEL_THRESHOLDS.caution) return 'caution'
  return 'ok'
}

// La percentuale spesa, dai due numeri che la Home ha già (speso del ciclo
// e stipendio del ciclo). null senza uno stipendio: nessuna percentuale
// attendibile.
export function spentPercentOf({ spent, monthlyBudget } = {}) {
  const used = Number(spent)
  const budget = Number(monthlyBudget)
  if (!Number.isFinite(used) || !Number.isFinite(budget) || budget <= 0) return null
  return (Math.max(0, used) / budget) * 100
}

// Il tono della card della Home: il livello qui sopra (ok si chiama "good"
// nelle classi CSS) e quanto resta in percentuale, mai negativo.
export const BUDGET_TONES = ['neutral', 'good', 'caution', 'warning', 'danger', 'over']

export function budgetTone({ spent, monthlyBudget } = {}) {
  const spentPercent = spentPercentOf({ spent, monthlyBudget })
  const level = budgetLevel(spentPercent)
  if (level === 'neutral') return { tone: 'neutral', level, remainingPercent: null }
  return {
    tone: level === 'ok' ? 'good' : level,
    level,
    remainingPercent: Math.max(0, 100 - spentPercent),
  }
}
