// L'avanzamento di ogni obiettivo, così come sta nello store (saved /
// target): niente ricalcolo dai versamenti, niente scelta di "quello più
// vicino" (quella resta al BehaviorEngine e al Radar). Serve alla Home per
// mostrarli tutti, nell'ordine in cui l'utente li ha creati.
//
// Valori sporchi (NaN, negativi, target 0 o mancante) diventano 0: a
// schermo mai "NaN%" né percentuali sotto zero o sopra 100.

const amountOf = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function goalsProgress(goals = []) {
  return (Array.isArray(goals) ? goals : [])
    .filter((goal) => goal && typeof goal === 'object')
    .map((goal) => {
      const saved = amountOf(goal.saved)
      const target = amountOf(goal.target)
      const completed = target > 0 && saved >= target
      const ratio = target > 0 ? (saved / target) * 100 : 0
      // Intera, come in GoalCard; ma un obiettivo non finito non arriva mai
      // a "100%" per arrotondamento (99,6% → 99%).
      const percent = completed ? 100 : Math.min(99, Math.round(ratio))
      return { id: goal.id, emoji: goal.emoji ?? null, label: goal.label ?? '', saved, target, percent, completed }
    })
}
