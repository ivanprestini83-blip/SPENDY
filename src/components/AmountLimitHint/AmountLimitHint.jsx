import { AMOUNT_LIMIT_MESSAGE, isOverLimit } from '../../utils/amounts.js'
import './AmountLimitHint.css'

// Sotto un campo importo: spiega perché il pulsante è spento quando l'importo
// supera il limite di SPENDY (utils/amounts.js). Niente se l'importo va bene.
export function AmountLimitHint({ value }) {
  if (!isOverLimit(value)) return null
  return <p className="amount-limit-hint" role="alert">{AMOUNT_LIMIT_MESSAGE}</p>
}
