// `isAction: true` marks a bottom-nav item that doesn't navigate to a
// page at all — BottomNavigation calls onAction(id) for it instead of
// onSelect(id), and it never lights up as "active" since activeTab never
// becomes its id. `isPrimary: true` additionally renders it with the
// green-circled, premium "+" styling (see BottomNavigation.css), inline
// in the same row as every other tab. It opens AddTransactionTypeModal,
// a picker between Spesa/Guadagno.
//
// Order is deliberate: exactly 2 regular tabs on each side (Home/Analisi
// left, Obiettivi/Spendy right) with the "+" as the 3rd of 5 — that's
// what makes 4 equal-width flex:1 items put it at the true horizontal
// center of the bar, not just "wherever it falls in the row".
export const mockNavItems = [
  { id: 'home', emoji: '🏠', label: 'Home', labelKey: 'home.nav.home' },
  { id: 'analytics', emoji: '📊', label: 'Analisi', labelKey: 'home.nav.analytics' },
  { id: 'addTransaction', emoji: '➕', label: 'Aggiungi', labelKey: 'home.nav.add', isAction: true, isPrimary: true },
  { id: 'goals', emoji: '🎯', label: 'Obiettivi', labelKey: 'home.nav.goals' },
  { id: 'spendy', emoji: '😈', label: 'Spendy' },
]
