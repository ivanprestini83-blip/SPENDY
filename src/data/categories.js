import { translate } from '../i18n/translate.js'

// The language the PREDEFINED category names are shown in. This module
// can't import the store (see the registry comment below), so the i18n
// layer registers where to read it (src/i18n/useLanguage.js); until then,
// and in tests that never load it, Italian.
let readLanguage = () => 'it'
export function setCategoryLanguageSource(read) {
  readLanguage = typeof read === 'function' ? read : () => 'it'
}

// `label` of a predefined category is a getter: the name in the current
// language (dictionary key categories.<id>), the Italian one as fallback.
// Data only ever stores the category's id, never this text, so ids,
// filters, totals, sync and history are untouched. Custom categories
// (registerCustomCategories) are plain objects and never translated.
function predefined({ id, label, ...rest }) {
  const category = Object.defineProperty({ id }, 'label', {
    enumerable: true,
    get: () => translate(readLanguage(), `categories.${id}`) || label,
  })
  return Object.assign(category, rest)
}

// Predefined expense categories — each carries its own `subcategories`
// list (empty today) so a future "manage categories" screen can add to
// it without changing this shape or anything that reads CATEGORIES.
export const CATEGORIES = [
  { id: 'casa', label: 'Casa', emoji: '🏠', subcategories: [] },
  { id: 'carburante', label: 'Carburante', emoji: '⛽', subcategories: [] },
  { id: 'spesa', label: 'Spesa', emoji: '🛒', subcategories: [] },
  { id: 'ristoranti', label: 'Ristorante', emoji: '🍕', subcategories: [] },
  { id: 'bar', label: 'Bar', emoji: '☕', subcategories: [] },
  { id: 'farmacia', label: 'Farmacia', emoji: '💊', subcategories: [] },
  { id: 'salute', label: 'Salute', emoji: '🏥', subcategories: [] },
  { id: 'trasporti', label: 'Trasporti', emoji: '🚗', subcategories: [] },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️', subcategories: [] },
  { id: 'tecnologia', label: 'Tecnologia', emoji: '📱', subcategories: [] },
  { id: 'abbonamenti', label: 'Bollette', emoji: '💡', subcategories: [] },
  { id: 'svago', label: 'Svago', emoji: '🎮', subcategories: [] },
  { id: 'viaggi', label: 'Viaggi', emoji: '✈️', subcategories: [] },
  { id: 'sport', label: 'Sport', emoji: '🏋️', subcategories: [] },
  { id: 'abbigliamento', label: 'Abbigliamento', emoji: '👕', subcategories: [] },
  { id: 'istruzione', label: 'Istruzione', emoji: '📚', subcategories: [] },
  { id: 'animali', label: 'Animali', emoji: '🐶', subcategories: [] },
  { id: 'altro', label: 'Altro', emoji: '💰', subcategories: [] },
].map(predefined)

// Predefined INCOME categories — separate list, deliberately small: a
// "stipendio" here is special (see useAppStore.setMonthlyBudget — it's
// the one that updates the recurring monthly budget), every other one
// is a one-off entry in `incomes`.
export const INCOME_CATEGORIES = [
  { id: 'stipendio', label: 'Stipendio', emoji: '💼', subcategories: [] },
  { id: 'extra', label: 'Extra', emoji: '💰', subcategories: [] },
  { id: 'investimenti', label: 'Investimenti', emoji: '📈', subcategories: [] },
  { id: 'regalo', label: 'Regalo', emoji: '🎁', subcategories: [] },
  { id: 'rimborso', label: 'Rimborso', emoji: '🔄', subcategories: [] },
].map(predefined)

// Custom categories the user creates (see AddCategoryScreen / the store's
// addCustomCategory) live in the store, not here — this module can't
// import the store directly (the store imports date utilities, and
// several pure utils import THIS module; a store<->categories cycle
// would be a mess). Instead, the store calls `registerCustomCategories`
// once on load and again every time a category is added, and every
// lookup below transparently includes whatever's currently registered.
// This is the ONE piece of mutable module state in the whole app,
// deliberately kept tiny and single-purpose.
let customCategoriesRegistry = []

export function registerCustomCategories(list) {
  customCategoriesRegistry = Array.isArray(list) ? list : []
}

export function getAllCategories() {
  return [...CATEGORIES, ...customCategoriesRegistry]
}

export function getCategory(id) {
  return (
    getAllCategories().find((category) => category.id === id)
    ?? INCOME_CATEGORIES.find((category) => category.id === id)
    ?? CATEGORIES[CATEGORIES.length - 1]
  )
}
