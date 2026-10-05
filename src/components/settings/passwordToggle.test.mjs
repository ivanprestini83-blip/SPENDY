// Il pulsante "occhio" nei campi password. `npm test`, senza browser.
//
//   - PasswordToggle disegnato con il VERO react-dom/server: button
//     type="button", etichetta, aria-pressed, aria-controls, icona nascosta
//     agli screen reader;
//   - SyncCard e PasswordRecoveryScreen veri, con hook minimi (stesso banco
//     di prova di syncCard.test): di default type="password", il tocco mostra
//     e nasconde, il valore non cambia, ogni campo ha il suo occhio.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import { check, section, report } from '../../sync/testkit.mjs'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// --- hook minimi, uno stato per posizione ---------------------------------
function createRuntime() {
  const slots = []
  let cursor = 0
  let effects = []
  const runtime = {
    store: { sync: { status: 'idle', error: null, lastSyncAt: null, outbox: [] } },
    recovery: { kind: 'recovery' },
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useEffect(effect) { effects.push(effect) },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    render(Component, props = {}) { cursor = 0; effects = []; return Component(props) },
    runEffects() { const pending = effects; effects = []; pending.forEach((effect) => effect()) },
  }
  return runtime
}

const FAKES = {
  react: `
    export const useState = (initial) => globalThis.__pw.useState(initial)
    export const useEffect = (effect) => globalThis.__pw.useEffect(effect)
    export const useSyncExternalStore = (s, g) => globalThis.__pw.useSyncExternalStore(s, g)`,
  '../../store/useAppStore.js': 'export const useAppStore = (selector) => selector(globalThis.__pw.store)',
  '../../lib/supabase.js': `
    export const supabase = {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    }`,
  '../../sync/spendySync.js': `
    export const isSupabaseConfigured = true
    export const getMigrationStatus = () => ({ needed: false })
    export const runMigration = async () => ({ migrated: false })
    export const signIn = async () => null
    export const signUp = async () => null
    export const signOut = async () => null
    export const syncNow = async () => ({})`,
  '../../lib/passwordRecovery.js': `
    export const MESSAGES = { linkInvalid: 'Link non valido' }
    export const subscribeRecovery = () => () => {}
    export const getRecoveryState = () => globalThis.__pw.recovery
    export const setRecoveryState = () => {}
    export const clearRecoveryFromUrl = () => {}
    export const submitNewPassword = async () => ({ ok: true })`,
  './SyncCard.css': 'export default {}',
  './PasswordRecoveryScreen.css': 'export default {}',
}
const UNDER_TEST = ['SyncCard.jsx', 'PasswordRecoveryScreen.jsx']
const isUnderTest = (id) => UNDER_TEST.some((name) => (id ?? '').split('?')[0].endsWith(name))

const harness = {
  name: 'password-toggle-harness',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '/__pw-fake/react') return '\0pw:react'
    if (isUnderTest(importer) && source in FAKES) return `\0pw:${source}`
    return null
  },
  load: (id) => (id.startsWith('\0pw:') ? FAKES[id.slice('\0pw:'.length)] : null),
  transform(code, id) {
    if (!isUnderTest(id)) return null
    return code.replace("from 'react'", "from '/__pw-fake/react'")
  },
}

// --- visita dell'albero -----------------------------------------------------
const walk = (node, visit) => {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit))
  if (node && typeof node === 'object' && node.props) { visit(node); walk(node.props.children, visit) }
  return undefined
}
const findAll = (tree, predicate) => { const found = []; walk(tree, (n) => { if (predicate(n)) found.push(n) }); return found }
const isToggle = (n) => typeof n.type === 'function' && n.type.name === 'PasswordToggle'
const passwordInputs = (tree) => findAll(tree, (n) => n.type === 'input' && (n.props.type === 'password' || n.props.type === 'text'))

const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-password-toggle-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [harness, react()],
})

try {
  const { PasswordToggle } = await server.ssrLoadModule('/src/components/settings/PasswordToggle.jsx')

  // =====================================================================
  section('Il pulsante: accessibile e mai di invio')
  // =====================================================================
  {
    const hidden = renderToStaticMarkup(h(PasswordToggle, { visible: false, onToggle: () => {}, controls: 'campo' }))
    const shown = renderToStaticMarkup(h(PasswordToggle, { visible: true, onToggle: () => {}, controls: 'campo' }))
    check('è un button type="button" (non invia moduli)', /^<button type="button"/.test(hidden))
    check('   etichetta "Mostra password"', hidden.includes('aria-label="Mostra password"'))
    check('   aria-pressed: false quando nascosta, true quando visibile', hidden.includes('aria-pressed="false"') && shown.includes('aria-pressed="true"'))
    check('   aria-controls punta al campo', hidden.includes('aria-controls="campo"'))
    check('   suggerimento che cambia (Mostra / Nascondi)', hidden.includes('title="Mostra password"') && shown.includes('title="Nascondi password"'))
    check('   icona nascosta agli screen reader, diversa nei due stati', hidden.includes('aria-hidden="true"') && hidden !== shown)
    check('   raggiungibile da tastiera (nessun tabindex negativo)', !/tabindex="-1"/i.test(hidden))
    let prevented = false
    PasswordToggle({ visible: false, onToggle: () => {} }).props.onMouseDown({ preventDefault: () => { prevented = true } })
    check('   premendolo il campo non perde il focus (tastiera del telefono aperta)', prevented)
  }

  // =====================================================================
  section('Accesso / registrazione (SyncCard)')
  // =====================================================================
  {
    const runtime = createRuntime()
    globalThis.__pw = runtime
    const { SyncCard } = await server.ssrLoadModule('/src/components/settings/SyncCard.jsx')
    runtime.render(SyncCard)
    runtime.runEffects()
    await tick()
    let tree = runtime.render(SyncCard)
    const [field] = passwordInputs(tree)
    check('un solo campo password, di default type="password"', passwordInputs(tree).length === 1 && field.props.type === 'password')
    field.props.onChange({ target: { value: 'Segreta-123' } })
    tree = runtime.render(SyncCard)
    const toggles = findAll(tree, isToggle)
    check('   con il suo occhio, collegato al campo', toggles.length === 1 && toggles[0].props.controls === passwordInputs(tree)[0].props.id && toggles[0].props.visible === false)
    toggles[0].props.onToggle()
    tree = runtime.render(SyncCard)
    check('tocco: la password diventa visibile (type="text")', passwordInputs(tree)[0].props.type === 'text' && findAll(tree, isToggle)[0].props.visible === true)
    check('   il valore non cambia', passwordInputs(tree)[0].props.value === 'Segreta-123')
    check('   niente maiuscole o correzioni automatiche mentre è visibile', passwordInputs(tree)[0].props.autoCapitalize === 'none' && passwordInputs(tree)[0].props.autoCorrect === 'off' && passwordInputs(tree)[0].props.spellCheck === false)
    findAll(tree, isToggle)[0].props.onToggle()
    tree = runtime.render(SyncCard)
    check('secondo tocco: di nuovo oscurata, stesso valore', passwordInputs(tree)[0].props.type === 'password' && passwordInputs(tree)[0].props.value === 'Segreta-123')
    check('   autoComplete current-password invariato', passwordInputs(tree)[0].props.autoComplete === 'current-password')
    check('nessun <form> che il tocco potrebbe inviare', findAll(tree, (n) => n.type === 'form').length === 0)
    const html = renderToStaticMarkup(tree)
    check('la card completa si disegna senza errori, con l\'occhio dentro il campo', html.includes('class="password-field"') && html.includes('class="password-field__toggle"'))
  }

  // =====================================================================
  section('Nuova password (PasswordRecoveryScreen)')
  // =====================================================================
  {
    const runtime = createRuntime()
    globalThis.__pw = runtime
    const { PasswordRecoveryScreen } = await server.ssrLoadModule('/src/components/settings/PasswordRecoveryScreen.jsx')
    let tree = runtime.render(PasswordRecoveryScreen, { client: null })
    let fields = passwordInputs(tree)
    check('due campi, entrambi type="password" di default', fields.length === 2 && fields.every((f) => f.props.type === 'password'))
    fields[0].props.onChange({ target: { value: 'Nuova-456' } })
    fields[1].props.onChange({ target: { value: 'Nuova-456' } })
    tree = runtime.render(PasswordRecoveryScreen, { client: null })
    const toggles = findAll(tree, isToggle)
    fields = passwordInputs(tree)
    check('   ogni campo ha il suo occhio', toggles.length === 2 && toggles[0].props.controls === fields[0].props.id && toggles[1].props.controls === fields[1].props.id && fields[0].props.id !== fields[1].props.id)
    toggles[1].props.onToggle()
    tree = runtime.render(PasswordRecoveryScreen, { client: null })
    fields = passwordInputs(tree)
    check('mostrare la conferma non mostra la nuova password', fields[0].props.type === 'password' && fields[1].props.type === 'text')
    check('   valori invariati', fields[0].props.value === 'Nuova-456' && fields[1].props.value === 'Nuova-456')
    findAll(tree, isToggle)[0].props.onToggle()
    findAll(tree, isToggle)[1].props.onToggle()
    tree = runtime.render(PasswordRecoveryScreen, { client: null })
    fields = passwordInputs(tree)
    check('si possono mostrare e nascondere indipendentemente', fields[0].props.type === 'text' && fields[1].props.type === 'password')
    check('   autoComplete new-password invariato', fields.every((f) => f.props.autoComplete === 'new-password'))
  }
} finally {
  await server.close()
  delete globalThis.__pw
}

report('Mostra/nascondi password')
