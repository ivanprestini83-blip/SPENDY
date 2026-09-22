import './FormField.css'

// Thin label+input wrapper shared by every modal form (AddExpense,
// NewGoal) so they all get the same field styling for free. `as="select"`
// renders a <select> instead of an <input> but keeps the same markup
// shape, so callers don't need a second component just for dropdowns.
export function FormField({ label, as = 'input', children, ...inputProps }) {
  const Tag = as

  return (
    <label className="form-field">
      <span className="form-field__label">{label}</span>
      <Tag className="form-field__control" {...inputProps}>
        {children}
      </Tag>
    </label>
  )
}
