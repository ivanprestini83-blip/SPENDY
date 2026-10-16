// L'icona di un obiettivo ricavata dal suo nome ("Casa al mare" → 🏠,
// "New laptop" → 💻), nelle quattro lingue dell'app. Solo per mostrarla:
// lo store, il database e la sincronizzazione non cambiano.
//
// Chi crea un obiettivo dall'app riceve sempre 🎯 (NewGoalModal): quella è
// l'emoji "di default" e si può sostituire. Un'emoji diversa, scelta altrove,
// resta com'è.

export const DEFAULT_GOAL_EMOJI = '🎯'

// Parole chiave già normalizzate (minuscole, senza accenti). "vacanz*" vale
// per ogni parola che inizia così; senza asterisco la parola dev'essere
// quella (o il suo plurale con -s), così "pc" o "car" non scattano dentro
// altre parole.
const ICON_KEYWORDS = [
  ['🏠', ['casa', 'case', 'appartament*', 'mutuo', 'affitto', 'home', 'house', 'apartment', 'flat', 'rent', 'mortgage', 'piso', 'hogar', 'alquiler', 'hipoteca', 'maison', 'appartement', 'loyer', 'logement']],
  ['🏖️', ['vacanz*', 'ferie', 'mare', 'spiaggia', 'holiday', 'vacation', 'beach', 'vacacion*', 'playa', 'vacance*', 'plage']],
  ['✈️', ['viagg*', 'volo', 'voli', 'travel', 'trip', 'flight', 'viaje', 'vuelo', 'voyage', 'vol']],
  ['💻', ['computer', 'pc', 'laptop', 'portatile', 'notebook', 'mac', 'macbook', 'ordenador', 'portatil', 'ordinateur']],
  ['📱', ['telefon*', 'cellulare', 'smartphone', 'iphone', 'phone', 'movil', 'portable']],
  ['👟', ['scarpe', 'sneaker*', 'shoe*', 'zapato*', 'zapatilla*', 'chaussure*']],
  ['👗', ['vestit*', 'abito', 'abiti', 'outfit', 'dress', 'clothes', 'clothing', 'ropa', 'vestido*', 'robe', 'vetement*']],
  ['🚗', ['auto', 'macchina', 'car', 'coche', 'voiture']],
  ['🏍️', ['moto', 'scooter', 'motorbike', 'motorcycle']],
  ['🚲', ['bici', 'bicicletta', 'bike', 'bicycle', 'bicicleta', 'velo']],
  ['💍', ['matrimonio', 'nozze', 'anello', 'wedding', 'ring', 'boda', 'anillo', 'mariage', 'bague']],
  ['👶', ['bambin*', 'neonat*', 'figli*', 'baby', 'bebe', 'nino', 'enfant']],
  ['🎓', ['universit*', 'studi*', 'master', 'corso', 'scuola', 'college', 'school', 'course', 'escuela', 'curso', 'ecole', 'etudes', 'formation']],
  ['🚨', ['emergenz*', 'emergenc*', 'urgence*', 'imprevist*']],
  ['🐶', ['cane', 'cani', 'gatto', 'gatti', 'dog', 'cat', 'perro', 'gato', 'chien', 'chat', 'pet']],
  ['🎸', ['chitarra', 'guitar', 'guitarra', 'guitare', 'basso', 'batteria', 'drums']],
  ['🎹', ['piano', 'pianoforte', 'tastiera', 'keyboard']],
  ['🎮', ['playstation', 'ps5', 'xbox', 'nintendo', 'switch', 'console', 'videogioc*', 'videogame*', 'videojuego*', 'gaming']],
  ['📷', ['fotocamera', 'macchina fotografica', 'appareil photo', 'camera', 'reflex', 'camara']],
  ['⌚', ['orologio', 'watch', 'reloj', 'montre']],
  ['💪', ['palestra', 'gym', 'gimnasio', 'fitness']],
  ['🎁', ['regal*', 'gift*', 'present', 'cadeau*', 'natale', 'christmas', 'navidad', 'noel']],
  ['🎉', ['festa', 'party', 'compleanno', 'birthday', 'cumpleanos', 'fiesta', 'anniversaire', 'fete']],
  ['🛋️', ['divano', 'mobili', 'arredament*', 'sofa', 'furniture', 'mueble*', 'meuble*', 'canape']],
  ['🍳', ['cucina', 'kitchen', 'cocina', 'cuisine']],
  ['📺', ['tv', 'televisore', 'televisione', 'television', 'tele']],
  ['🦷', ['dentista', 'denti', 'dentist', 'dentiste', 'apparecchio']],
  ['🩺', ['salute', 'medic*', 'health', 'salud', 'sante']],
  ['💰', ['risparmi*', 'saving*', 'ahorro*', 'epargne', 'investiment*', 'investment*', 'inversion*', 'pensione', 'pension']],
]

const normalize = (text) => String(text ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')

const tokensOf = (text) => normalize(text).split(/[^a-z0-9]+/).filter(Boolean)

const matches = (token, keyword) => (keyword.endsWith('*')
  ? token.startsWith(keyword.slice(0, -1))
  : token === keyword || token === `${keyword}s`)

// Le espressioni di più parole vincono sulle singole parole: "macchina
// fotografica" è una fotocamera, non un'auto.
const PHRASES = ICON_KEYWORDS.flatMap(([icon, keywords]) => keywords.filter((keyword) => keyword.includes(' ')).map((phrase) => [icon, phrase]))

// Altrimenti l'icona della parola che compare PRIMA nel nome: "Casa vacanze"
// è una casa, "Vacanza a casa di Marta" una vacanza.
export function iconForGoalLabel(label) {
  const tokens = tokensOf(label)
  const joined = ` ${tokens.join(' ')} `
  const phrase = PHRASES.find(([, words]) => joined.includes(` ${words} `))
  if (phrase) return phrase[0]
  for (const token of tokens) {
    for (const [icon, keywords] of ICON_KEYWORDS) {
      if (keywords.some((keyword) => !keyword.includes(' ') && matches(token, keyword))) return icon
    }
  }
  return DEFAULT_GOAL_EMOJI
}

export function goalIcon(goal) {
  const emoji = goal?.emoji
  if (emoji && emoji !== DEFAULT_GOAL_EMOJI) return emoji
  return iconForGoalLabel(goal?.label)
}
