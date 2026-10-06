// Il limite degli importi di SPENDY — un solo posto per interfaccia e store.
//
// 1.000.000 € basta per qualunque spesa, entrata, stipendio, obiettivo o
// versamento personale, e resta molto sotto il massimo che il database può
// salvare (numeric(12,2): 9.999.999.999,99). Un importo oltre il database
// verrebbe rifiutato dal server: qui non si arriva mai a quel punto.
export const MAX_AMOUNT = 1_000_000

export const AMOUNT_LIMIT_MESSAGE = 'Importo massimo: 1.000.000 €'

// Il testo di un campo importo ("12,50") → numero (NaN se non è un numero).
export const parseAmountInput = (text) => parseFloat(String(text ?? '').replace(',', '.'))

// Spese, entrate, versamenti, obiettivi: maggiore di zero e non oltre il limite.
export const isValidAmount = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT

// Stipendio/budget mensile: come sopra, ma zero è ammesso (budget eliminato).
export const isValidBudget = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT

export const isOverLimit = (value) => typeof value === 'number' && Number.isFinite(value) && value > MAX_AMOUNT
