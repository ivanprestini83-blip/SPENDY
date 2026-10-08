import { isOverLimit } from '../../utils/amounts.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './AmountLimitHint.css'

// Sotto un campo importo: spiega perché il pulsante è spento quando l'importo
// supera il limite di SPENDY (utils/amounts.js). Niente se l'importo va bene.
// Il testo è `expenses.limit` (in italiano identico ad AMOUNT_LIMIT_MESSAGE).
export function AmountLimitHint({ value }) {
  const { t } = useLanguage()
  if (!isOverLimit(value)) return null
  return <p className="amount-limit-hint" role="alert">{t('expenses.limit')}</p>
}
