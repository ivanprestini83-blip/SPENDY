import { MAX_AMOUNT, isOverLimit } from '../../utils/amounts.js'
import { formatCurrencyWhole } from '../../utils/format.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './AmountLimitHint.css'

// Sotto un campo importo: spiega perché il pulsante è spento quando l'importo
// supera il limite di SPENDY (utils/amounts.js). Niente se l'importo va bene.
// Il testo è `expenses.limit` con MAX_AMOUNT scritto nel formato della lingua
// (in italiano identico ad AMOUNT_LIMIT_MESSAGE: "Importo massimo: 1.000.000 €").
export function AmountLimitHint({ value }) {
  const { t, language } = useLanguage()
  if (!isOverLimit(value)) return null
  return <p className="amount-limit-hint" role="alert">{t('expenses.limit', { amount: formatCurrencyWhole(MAX_AMOUNT, language) })}</p>
}
