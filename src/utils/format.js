// Importi sempre con due decimali: 175,50 € resta 175,50 €, non diventa
// 176 €. Prima si arrotondava all'euro, e una correzione da 175,50
// spariva alla vista pur essendo salvata giusta — il numero a schermo
// deve coincidere con quello che l'utente ha scritto.
const currencyFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatCurrency(value) {
  return `${currencyFormatter.format(Number.isFinite(value) ? value : 0)} €`
}

export function formatSignedPercent(value) {
  const rounded = Math.round(value)
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}
