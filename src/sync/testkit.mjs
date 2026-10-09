// Utilità condivise dai test di questa cartella (backup.test.mjs,
// sync.test.mjs). Non fa parte del bundle dell'app: nessun file di
// src/ la importa, quindi vite non la include mai in produzione.

let passed = 0
let failed = 0
const failures = []

export const check = (name, condition, extra = '') => {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    failures.push(name)
    console.log(`  ✗ ${name} ${extra}`)
  }
}

export const section = (title) => console.log(`\n${title}`)

export const report = (suite) => {
  console.log(`\n${failed === 0 ? '✅' : '❌'}  ${suite}: ${passed} test superati, ${failed} falliti`)
  if (failed > 0) console.log(`   falliti: ${failures.join(' | ')}`)
  process.exit(failed === 0 ? 0 : 1)
}

// localStorage finto: serve per poter importare lo store vero (che usa
// il middleware persist) dentro Node, senza browser. I test toccano solo
// questa mappa in memoria, mai un file o uno storage reale.
export function installFakeLocalStorage(seed = null) {
  const map = new Map()
  if (seed) map.set('spendy-storage', JSON.stringify(seed))
  // Va definita con defineProperty, non con un'assegnazione: in Node
  // `globalThis.localStorage` e' una property con getter/setter nativi
  // (webstorage sperimentale, disattivato senza --localstorage-file), e
  // un semplice `=` finirebbe nel setter nativo lasciando in piedi quella
  // indisponibile — con il risultato che il middleware persist non
  // scriverebbe niente e i test sulla persistenza non proverebbero nulla.
  const fake = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true })

  // Il middleware persist di zustand legge `window.localStorage`, non il
  // globale: senza un window finto non persisterebbe niente in Node, e i
  // test sulla coda che sopravvive al riavvio non proverebbero nulla.
  // addEventListener/removeEventListener sono no-op ma devono esistere,
  // perche' il sync engine vi aggancia i listener 'online'/'offline'.
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: fake,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
    writable: true,
  })

  return map
}

// Un dispositivo di un utente italiano: la lingua del dispositivo
// (i18n/languagePreference.js) è l'italiano, come per chi usava SPENDY prima
// della scelta della lingua. Serve ai test che controllano i testi italiani:
// senza, un dispositivo nuovo parte in inglese (la lingua dei nuovi utenti).
// `target` è la Map dello storage finto (o un oggetto tipo localStorage).
export const ITALIAN_DEVICE_LANGUAGE = JSON.stringify({ language: 'it', chosenAt: null, source: 'inherited' })
export function italianDevice(target) {
  if (target instanceof Map) target.set('spendy-language', ITALIAN_DEVICE_LANGUAGE)
  else target?.setItem?.('spendy-language', ITALIAN_DEVICE_LANGUAGE)
  return target
}

// Un useLanguage finto in italiano, con i dizionari veri: per i banchi di
// prova che disegnano un componente chiamandolo direttamente (con hook finti),
// dove il vero useLanguage (hook di zustand) non può girare. Registra anche la
// lingua dei messaggi fuori da React, come fa quello vero.
export const ITALIAN_USE_LANGUAGE_FAKE = `
  import { translate } from '/src/i18n/translate.js'
  import { setCurrentLanguageSource } from '/src/i18n/currentLanguage.js'
  import { languageInfo } from '/src/i18n/languages.js'
  setCurrentLanguageSource(() => 'it')
  const t = (key, params) => translate('it', key, params)
  export const useLanguage = () => ({ language: 'it', info: languageInfo('it'), t, setLanguage: () => {}, previewLanguage: () => {}, confirmWelcomeLanguage: () => {} })`
// Il modulo da sostituire, per qualunque componente lo importi.
export const isUseLanguageImport = (source, importer) =>
  typeof source === 'string' && source.endsWith('/i18n/useLanguage.js') && /\/src\/components\//.test(importer ?? '')
