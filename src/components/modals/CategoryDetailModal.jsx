import { Modal } from './Modal.jsx'
import { formatCurrency } from '../../utils/format.js'
import './CategoryDetailModal.css'

// Dettaglio di una categoria toccata in Analisi: le spese reali che
// compongono il suo totale nel periodo selezionato. `detail` arriva già
// calcolato da buildCategoryDetail (utils/categoryDetail.js); qui solo
// la presentazione. Stessa shell Modal del Radar: ✕, Esc o tocco fuori
// per tornare ad Analisi.
export function CategoryDetailModal({ detail, periodLabel, onClose }) {
  const { category, total, count, days } = detail

  return (
    <Modal title={`${category.emoji} ${category.label}`} onClose={onClose}>
      <div className="category-detail__summary">
        <p className="category-detail__total">{formatCurrency(total)}</p>
        <p className="category-detail__meta">
          {periodLabel} · {count === 1 ? '1 spesa' : `${count} spese`}
        </p>
      </div>

      {days.length === 0 ? (
        <p className="category-detail__empty">Nessuna spesa in questo periodo.</p>
      ) : (
        <div className="category-detail__days">
          {days.map((day) => (
            <section key={day.date} className="category-detail__day">
              <p className="category-detail__day-label">{day.label}</p>
              <ul className="category-detail__list">
                {day.items.map((item) => (
                  <li key={item.id} className="category-detail__item">
                    <div className="category-detail__item-main">
                      <span className="category-detail__amount">{formatCurrency(item.amount)}</span>
                      {item.time && <span className="category-detail__time">{item.time}</span>}
                    </div>
                    {item.note && <p className="category-detail__note">“{item.note}”</p>}
                    <p className="category-detail__category">
                      <span aria-hidden="true">{category.emoji}</span> {category.label}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  )
}
