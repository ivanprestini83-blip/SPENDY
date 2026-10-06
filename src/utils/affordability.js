// Deliberately simple, non-AI simulation: it only ever looks at numbers
// already in the store (remaining budget this month + the closest goal),
// never an external model. See AffordabilityScreen for the disclaimer
// shown alongside this result.
export function evaluateAffordability({ amount, availableBudget, goals }) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      level: 'yellow',
      title: 'Inserisci un importo',
      message: 'Dimmi quanto vuoi spendere e ti dico cosa ne penso.',
    }
  }

  const remainingAfter = availableBudget - amount
  const ratio = availableBudget > 0 ? amount / availableBudget : Infinity

  const closestGoal = [...goals].sort((a, b) => (a.target - a.saved) - (b.target - b.saved))[0]
  const goalHint = closestGoal
    ? ` Occhio anche a "${closestGoal.label}": ci stai ancora lavorando.`
    : ''

  if (remainingAfter < 0) {
    return {
      level: 'red',
      title: 'Meglio aspettare',
      message: `Con questa spesa sforeresti il budget di ${Math.round(-remainingAfter)} €.${goalHint}`,
    }
  }

  if (ratio <= 0.3) {
    return {
      level: 'green',
      title: 'Puoi permettertelo',
      message: `Ti restano ${Math.round(remainingAfter)} € in questo ciclo: una spesa gestibile.`,
    }
  }

  if (ratio <= 0.7) {
    return {
      level: 'yellow',
      title: 'Puoi farlo, ma attenzione',
      message: `Dopo questa spesa ti resterebbero solo ${Math.round(remainingAfter)} € fino alla fine del ciclo.${goalHint}`,
    }
  }

  return {
    level: 'red',
    title: 'Meglio aspettare',
    message: `Questa spesa da sola userebbe quasi tutto il budget rimanente (${Math.round(availableBudget)} €).${goalHint}`,
  }
}
