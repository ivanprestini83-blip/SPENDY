import { Modal } from './Modal.jsx'
import { useAppStore } from '../../store/useAppStore.js'
import { useLanguage } from '../../i18n/useLanguage.js'
import './AddTransactionTypeModal.css'

// Opened by the bottom nav's central "+" — a picker between the two
// icon-first quick-add flows (see QuickAddScreen.jsx). Picking either
// option just opens that same screen with `type` set accordingly —
// still one entry point, one transaction system underneath.
export function AddTransactionTypeModal({ onClose }) {
  const { t } = useLanguage()
  const openModal = useAppStore((state) => state.openModal)

  return (
    <Modal title={t('quickadd.choose.title')} onClose={onClose}>
      <div className="transaction-type__options">
        <button
          type="button"
          className="transaction-type__option transaction-type__option--expense"
          onClick={() => openModal('quickAdd', { type: 'expense' })}
        >
          <span className="transaction-type__icon" aria-hidden="true">🟢</span>
          <span className="transaction-type__label">{t('quickadd.choose.expense')}</span>
        </button>

        <button
          type="button"
          className="transaction-type__option transaction-type__option--income"
          onClick={() => openModal('quickAdd', { type: 'income' })}
        >
          <span className="transaction-type__icon" aria-hidden="true">🔵</span>
          <span className="transaction-type__label">{t('quickadd.choose.income')}</span>
        </button>
      </div>
    </Modal>
  )
}
