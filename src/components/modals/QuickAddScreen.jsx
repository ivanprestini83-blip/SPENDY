import { useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore.js'
import { CATEGORIES, INCOME_CATEGORIES } from '../../data/categories.js'
import { EMOJI_GROUPS } from '../../data/emojiPicker.js'
import './QuickAddScreen.css'
import { isValidAmount } from '../../utils/amounts.js'
import { AmountLimitHint } from '../AmountLimitHint/AmountLimitHint.jsx'

// "tenendole premute" — how long a press on a custom category tile has
// to hold before it counts as a long-press (pin/unpin) instead of a tap
// (pick the category). Matches the ~500ms most touch UIs use.
const LONG_PRESS_MS = 500
// A real finger held "still" on a touchscreen is never perfectly
// stationary — sensor jitter alone generates a few px of pointermove
// every hold, which used to cancel the timer before it ever fired
// (exactly why long-press wasn't working at all on a real device, only
// in synthetic tests with no intermediate move events). This tolerance
// matches how native long-press gesture recognizers behave (e.g. iOS's
// default ~10pt allowable movement).
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

// The whole point of this screen: registrare una spesa in 2 passaggi —
// tap an icon, type an amount, confirm. No dropdown, no required
// description/date. Reuses the exact same store actions the old
// AddExpenseModal/SetBudgetModal used (addExpense/addIncome/
// setMonthlyBudget) — this is a new SHELL around existing actions, not a
// second transaction system. Once confirmed, the store update alone is
// what makes budget/Analisi/donut/Radar/Spendy's joke all react —
// HomePage/AnalyticsPage/SpendyPage already recompute everything from
// the store on every render, so nothing here needs to "push" to them.
export function QuickAddScreen({ type, onClose }) {
  const today = useAppStore((state) => state.today)
  const monthlyBudget = useAppStore((state) => state.monthlyBudget)
  const customCategories = useAppStore((state) => state.customCategories)
  const addExpense = useAppStore((state) => state.addExpense)
  const addIncome = useAppStore((state) => state.addIncome)
  const setMonthlyBudget = useAppStore((state) => state.setMonthlyBudget)
  const addCustomCategory = useAppStore((state) => state.addCustomCategory)
  const deleteCustomCategory = useAppStore((state) => state.deleteCustomCategory)
  const togglePinCategory = useAppStore((state) => state.togglePinCategory)

  const [step, setStep] = useState('pick') // 'pick' | 'amount' | 'newCategory'
  const [category, setCategory] = useState(null)
  const [amount, setAmount] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(today)
  const [categoryOverride, setCategoryOverride] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('')
  const [emojiGroupId, setEmojiGroupId] = useState(EMOJI_GROUPS[0].id)

  // Long-press tracking — refs (not state) since none of this drives a
  // render of its own; it only decides whether the click right after a
  // long-press should be suppressed (see handlePick) and whether
  // pointermove has moved far enough to count as a drag/scroll rather
  // than a held-still press (see handleTilePointerMove).
  const longPressTimer = useRef(null)
  const longPressFired = useRef(false)
  const longPressStart = useRef(null)

  const isExpense = type === 'expense'
  const baseCategories = isExpense ? CATEGORIES : INCOME_CATEGORIES
  const ownCustomCategories = customCategories.filter((entry) => entry.type === type)
  const pinnedCustom = ownCustomCategories.filter((entry) => entry.pinned)
  const unpinnedCustom = ownCustomCategories.filter((entry) => !entry.pinned)
  // "spostare in alto per averle subito in vista" — a pinned custom
  // category goes ahead of even the predefined ones, at the very front
  // of the grid, so it's the first tile on screen with no scrolling.
  const gridCategories = [...pinnedCustom, ...baseCategories, ...unpinnedCustom]
  const customIds = new Set(ownCustomCategories.map((entry) => entry.id))
  const pinnedIds = new Set(pinnedCustom.map((entry) => entry.id))

  const amountValue = parseFloat(amount.replace(',', '.'))
  const canConfirm = isValidAmount(amountValue)

  const handlePick = (pickedCategory) => {
    // A long-press that just fired pin/unpin still ends in the same
    // click the browser sends on release — swallow that one click
    // instead of also opening the amount step.
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    setCategory(pickedCategory)
    setCategoryOverride('')
    setAmount(pickedCategory.id === 'stipendio' && monthlyBudget > 0 ? String(monthlyBudget) : '')
    setDescription('')
    setDate(today)
    setShowDetails(false)
    setStep('amount')
  }

  const handleTilePointerDown = (cat, event) => {
    if (!customIds.has(cat.id)) return
    longPressFired.current = false
    longPressStart.current = { x: event.clientX, y: event.clientY }
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      togglePinCategory(cat.id)
    }, LONG_PRESS_MS)
  }

  // Cancels the pending long-press only once the pointer has moved
  // further than LONG_PRESS_MOVE_TOLERANCE_PX from where it went down —
  // a real scroll/drag gesture moves well past that within a few
  // milliseconds, while ordinary finger jitter during a held-still press
  // stays well under it.
  const handleTilePointerMove = (event) => {
    if (!longPressTimer.current || !longPressStart.current) return
    const dx = event.clientX - longPressStart.current.x
    const dy = event.clientY - longPressStart.current.y
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
      clearLongPress()
    }
  }

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    longPressStart.current = null
  }

  const handleBackFromAmount = () => {
    setCategory(null)
    setStep('pick')
  }

  const handleConfirm = () => {
    if (!canConfirm || !category) return
    const finalCategoryId = categoryOverride || category.id
    if (isExpense) {
      addExpense({ amount: amountValue, categoryId: finalCategoryId, description: description.trim() || category.label, date })
    } else if (finalCategoryId === 'stipendio') {
      setMonthlyBudget(amountValue, date)
    } else {
      addIncome({ amount: amountValue, categoryId: finalCategoryId, description: description.trim() || category.label, date })
    }
    onClose()
  }

  const handleCreateCategory = () => {
    if (!newName.trim() || !newEmoji.trim()) return
    addCustomCategory({ label: newName.trim(), emoji: newEmoji.trim(), type })
    setNewName('')
    setNewEmoji('')
    setStep('pick')
  }

  return (
    <div className="quick-add">
      <div className="quick-add__header">
        <button
          type="button"
          className="quick-add__back"
          onClick={step === 'pick' ? onClose : step === 'newCategory' ? () => setStep('pick') : handleBackFromAmount}
          aria-label={step === 'pick' ? 'Chiudi' : 'Torna indietro'}
        >
          {step === 'pick' ? '✕' : '←'}
        </button>
        <p className="quick-add__title">
          {step === 'newCategory' ? 'Nuova categoria' : isExpense ? 'Nuova spesa' : 'Nuovo guadagno'}
        </p>
      </div>

      {step === 'pick' && (
        <div className="quick-add__grid">
          {ownCustomCategories.length > 0 && (
            <p className="quick-add__grid-hint">
              📌 Tieni premuta una tua categoria per portarla in cima
            </p>
          )}

          {gridCategories.map((cat) => (
            <div key={cat.id} className="quick-add__tile-wrap">
              <button
                type="button"
                className="quick-add__tile"
                onClick={() => handlePick(cat)}
                onPointerDown={(event) => handleTilePointerDown(cat, event)}
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
                onPointerMove={handleTilePointerMove}
              >
                <span className="quick-add__tile-emoji" aria-hidden="true">{cat.emoji}</span>
                <span className="quick-add__tile-label">{cat.label}</span>
              </button>

              {/* Only a pinned custom category gets this — "tenendole
                  premute, spostare in alto" needs some visible sign that
                  it worked, and that a second long-press undoes it. */}
              {pinnedIds.has(cat.id) && (
                <span className="quick-add__tile-pin" aria-hidden="true">📌</span>
              )}

              {/* Only a custom category gets this — "devo poter
                  cancellare una categoria appena creata". A sibling
                  button, not nested inside the tile's own button, so the
                  two taps never fight over the same click. */}
              {customIds.has(cat.id) && (
                <button
                  type="button"
                  className="quick-add__tile-delete"
                  aria-label={`Elimina categoria ${cat.label}`}
                  onClick={() => deleteCustomCategory(cat.id)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <button type="button" className="quick-add__tile quick-add__tile--new" onClick={() => setStep('newCategory')}>
            <span className="quick-add__tile-emoji" aria-hidden="true">＋</span>
            <span className="quick-add__tile-label">Aggiungi categoria</span>
          </button>
        </div>
      )}

      {step === 'newCategory' && (
        <div className="quick-add__new-category">
          <label className="quick-add__field">
            <span>Nome categoria</span>
            <input
              type="text"
              placeholder="Es. Parrucchiere"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>

          <label className="quick-add__field">
            <span>Icona</span>
            <input
              type="text"
              placeholder="Es. 💇"
              value={newEmoji}
              onChange={(event) => setNewEmoji(event.target.value)}
              maxLength={4}
            />
          </label>

          {/* WhatsApp-style picker: tabs by group, then a scrollable grid for
              the selected group — many more choices than a single flat row,
              without dumping 200+ emoji on screen at once. */}
          <div className="quick-add__emoji-picker">
            <div className="quick-add__emoji-tabs">
              {EMOJI_GROUPS.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={`quick-add__emoji-tab${group.id === emojiGroupId ? ' quick-add__emoji-tab--active' : ''}`}
                  onClick={() => setEmojiGroupId(group.id)}
                  aria-label={group.label}
                  title={group.label}
                >
                  {group.icon}
                </button>
              ))}
            </div>

            <div className="quick-add__emoji-grid">
              {(EMOJI_GROUPS.find((group) => group.id === emojiGroupId) ?? EMOJI_GROUPS[0]).emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`quick-add__emoji-chip${emoji === newEmoji ? ' quick-add__emoji-chip--active' : ''}`}
                  onClick={() => setNewEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="quick-add__confirm"
            disabled={!newName.trim() || !newEmoji.trim()}
            onClick={handleCreateCategory}
          >
            Crea categoria
          </button>
        </div>
      )}

      {step === 'amount' && category && (
        <div className="quick-add__amount-step">
          <div className="quick-add__picked">
            <span className="quick-add__picked-emoji" aria-hidden="true">{category.emoji}</span>
            <span className="quick-add__picked-label">{category.label}</span>
          </div>

          <p className="quick-add__prompt">{isExpense ? 'Quanto hai speso?' : 'Quanto hai guadagnato?'}</p>

          <div className="quick-add__amount-input">
            <span>€</span>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the whole point of this screen is landing straight in the amount field */}
            <input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              autoFocus
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <AmountLimitHint value={amountValue} />

          <button type="button" className="quick-add__confirm" disabled={!canConfirm} onClick={handleConfirm}>
            Conferma
          </button>

          <button type="button" className="quick-add__details-toggle" onClick={() => setShowDetails((value) => !value)}>
            {showDetails ? 'Nascondi altri dettagli' : 'Altri dettagli'}
          </button>

          {showDetails && (
            <div className="quick-add__details">
              <label className="quick-add__field">
                <span>Nota (opzionale)</span>
                <input
                  type="text"
                  placeholder={category.label}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label className="quick-add__field">
                <span>Data</span>
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>

              <label className="quick-add__field">
                <span>Categoria</span>
                <select value={categoryOverride || category.id} onChange={(event) => setCategoryOverride(event.target.value)}>
                  {gridCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.emoji} {cat.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
