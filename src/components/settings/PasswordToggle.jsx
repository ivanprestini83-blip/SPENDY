import './PasswordToggle.css'

// Il pulsante "occhio" dentro un campo password (vedi .password-field).
// Solo presentazione: lo stato visibile/nascosto lo tiene il modulo che lo
// usa, così il campo resta un normale <input> e il valore non viene mai
// toccato. È un button type="button": premerlo non invia nessun modulo.
// onMouseDown evita che il campo perda il focus (su telefono la tastiera
// resta aperta); da tastiera si raggiunge con Tab e si usa con Invio/Spazio.
export function PasswordToggle({ visible, onToggle, controls }) {
  return (
    <button
      type="button"
      className="password-field__toggle"
      aria-label="Mostra password"
      aria-pressed={visible}
      aria-controls={controls}
      title={visible ? 'Nascondi password' : 'Mostra password'}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
    >
      {visible ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  )
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1" />
      <path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a9.9 9.9 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M2 2l20 20" />
    </svg>
  )
}
