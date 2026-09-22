// The emoji picker for a CUSTOM category — deliberately curated, not a
// clone of a full WhatsApp-style emoji keyboard. Every entry here is
// something someone could plausibly want as a SPENDING CATEGORY icon
// (a vehicle, a utility, a sport, a pet...); there are no generic
// smileys, hearts, individual fruits/vegetables or symbols with no
// obvious category meaning — those made the picker wide but not useful.
// Grouped by theme so it's still tabbed/browsable, just aimed at "which
// icon fits my category" instead of "every emoji that exists".
export const EMOJI_GROUPS = [
  {
    id: 'popolari',
    label: 'Popolari',
    icon: '⭐',
    emojis: ['🏠', '⚡', '💧', '🔥', '🍕', '☕', '🚗', '🏍️', '🚲', '🏋️', '🐶', '🐱', '🏨', '🎬', '💻', '🎁', '💰', '💸'],
  },
  {
    id: 'finanza',
    label: 'Finanza',
    icon: '💰',
    emojis: ['💰', '💸', '💵', '💶', '💷', '💴', '🪙', '💳', '🧾', '🤑', '📈', '📉', '🏦'],
  },
  {
    id: 'casa',
    label: 'Casa',
    icon: '🏠',
    emojis: ['🏠', '🏡', '🔌', '⚡', '💧', '🔥', '🛠️', '🧹', '🪑', '🛋️', '🚪', '🔑', '🧺', '♻️', '🌡️', '🧯'],
  },
  {
    id: 'cibo',
    label: 'Cibo',
    icon: '🍕',
    emojis: ['🍕', '🍔', '🌮', '🍜', '🍣', '🍰', '🍩', '☕', '🍺', '🍷', '🍽️', '🥡', '🍳', '🥗', '🧁', '🍦'],
  },
  {
    id: 'trasporti',
    label: 'Trasporti',
    icon: '🚗',
    emojis: ['🚗', '🚙', '🏍️', '🛵', '🚲', '🚌', '🚆', '🚕', '🛻', '⛽', '🅿️', '🚤', '🚢', '✈️'],
  },
  {
    id: 'sport',
    label: 'Sport',
    icon: '🏃',
    emojis: ['🏃', '🏊', '🚴', '⚽', '🏀', '🎾', '🏋️', '🧘', '🥊', '⛳', '🏓', '🥋', '⛸️', '🛼'],
  },
  {
    id: 'animali',
    label: 'Animali',
    icon: '🐶',
    emojis: ['🐶', '🐱', '🐹', '🐰', '🐦', '🐠', '🐢', '🦴', '🐾'],
  },
  {
    id: 'viaggi',
    label: 'Viaggi',
    icon: '🏨',
    emojis: ['🏨', '🧳', '✈️', '🚢', '🏖️', '🗺️', '⛺', '🎫', '🛫'],
  },
  {
    id: 'shopping',
    label: 'Shopping',
    icon: '🛍️',
    emojis: ['👕', '👟', '👜', '💻', '📱', '🎮', '📚', '🎁', '🛒', '💍', '👓', '🕶️', '⌚'],
  },
  {
    id: 'salute',
    label: 'Salute',
    icon: '💊',
    emojis: ['💊', '🏥', '🩺', '🦷', '💉', '🧴', '💇', '🧖', '🩹'],
  },
  {
    id: 'svago',
    label: 'Svago',
    icon: '🎬',
    emojis: ['🎬', '🎭', '🎨', '🎵', '🎸', '📖', '🎲', '🎉', '🎟️', '🎳'],
  },
]

// Flat fallback list, kept for anywhere that just wants "some good
// defaults" without the tabbed UI.
export const EMOJI_SUGGESTIONS = EMOJI_GROUPS[0].emojis
