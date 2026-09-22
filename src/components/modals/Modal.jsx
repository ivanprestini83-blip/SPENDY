import { useEffect } from 'react'
import './Modal.css'

// Shared shell for every modal in the app (AddExpense, NewGoal,
// RadarDetail...) — backdrop click and Escape both close it, so no modal
// has to reimplement that. Content is passed as children; `title` renders
// a consistent header with a close button.
export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-sheet__header">
          <p className="modal-sheet__title">{title}</p>
          <button type="button" className="modal-sheet__close" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </div>

        <div className="modal-sheet__body">{children}</div>
      </div>
    </div>
  )
}
