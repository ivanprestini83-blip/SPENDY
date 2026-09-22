// Generatore di id per le righe sincronizzate.
//
// Perché non più `${prefix}-${Date.now()}` come prima: con due
// dispositivi quell'id non è più unico. Samsung e Mac offline che
// inseriscono una spesa nello stesso millisecondo producono lo stesso
// id, e al momento del sync una delle due spese sovrascrive l'altra
// senza che nessuno se ne accorga. Con un UUID la probabilità è nulla.
//
// Il prefisso ('e-', 'i-', 'g-'…) resta: non serve al database, serve a
// un umano che apre il JSON di backup e vuole capire cosa sta guardando.

// crypto.randomUUID() esiste SOLO in contesto sicuro (https o localhost).
// Aprendo l'app dal Samsung su http://192.168.1.x:5173 è `undefined`, e
// senza questo fallback l'inserimento di una spesa andrebbe in errore.
// crypto.getRandomValues invece è disponibile ovunque, quindi il v4 lo
// si costruisce a mano con la stessa qualità di casualità.
function randomUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // versione 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variante RFC 4122
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  // Ultima spiaggia (browser molto vecchi): peggiore come casualità, ma
  // sempre meglio di un contatore basato sull'orologio.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

export function newId(prefix) {
  const uuid = randomUuid()
  return prefix ? `${prefix}-${uuid}` : uuid
}

// Un solo punto in cui si legge l'orologio del dispositivo per marcare
// una modifica. È il valore su cui si decide chi vince un conflitto, e
// averlo qui rende banale congelarlo nei test.
export function nowIso() {
  return new Date().toISOString()
}
