import { normalizeLanguage } from './languages.js'

// Tiene `<html lang>` uguale alla lingua scelta (useAppStore `language`):
// screen reader, correttore ortografico e traduttori del browser leggono la
// lingua giusta. Lo imposta subito (caricamento, contenitore appena letto) e a
// ogni cambio, compreso il cambio di account. Legge soltanto lo store: non
// salva né modifica nulla. → funzione per fermarlo
export function startDocumentLanguage(store, { doc = globalThis.document } = {}) {
  const apply = (state) => {
    const root = doc?.documentElement
    if (!root) return
    const lang = normalizeLanguage(state.language)
    if (root.lang !== lang) root.lang = lang
  }
  apply(store.getState())
  return store.subscribe(apply)
}
