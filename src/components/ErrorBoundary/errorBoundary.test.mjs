// Test di ErrorBoundary: un errore di rendering non deve lasciare la pagina bianca.
//
// Un error boundary funziona solo con il renderer "client" di React (con il
// rendering lato server gli errori non passano dai boundary), e il renderer
// client vuole un DOM. Nel progetto non c'è né jsdom né altro, e non se ne
// aggiungono: qui sotto c'è un DOM minimo, abbastanza per far girare il VERO
// react-dom/client. Quindi ciò che viene provato è React vero:
//   - un componente lancia durante il rendering, e React chiama il vero
//     getDerivedStateFromError / componentDidCatch del boundary;
//   - senza boundary, lo stesso errore svuota l'albero (la pagina bianca);
//   - ErrorBoundary.jsx viene caricato da Vite com'è, JSX compreso.

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, section, report } from '../../sync/testkit.mjs'

// --- DOM minimo --------------------------------------------------------------

class FakeNode {
  constructor(nodeType, ownerDocument) {
    this.nodeType = nodeType
    this.ownerDocument = ownerDocument
    this.parentNode = null
    this.childNodes = []
  }
  get firstChild() { return this.childNodes[0] ?? null }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null }
  get previousSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) - 1] ?? null }
  appendChild(child) {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }
  insertBefore(child, reference) {
    if (reference == null) return this.appendChild(child)
    child.parentNode?.removeChild(child)
    this.childNodes.splice(this.childNodes.indexOf(reference), 0, child)
    child.parentNode = this
    return child
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains?.(node)) }
  addEventListener() {}
  removeEventListener() {}
}

class FakeText extends FakeNode {
  constructor(ownerDocument, data) { super(3, ownerDocument); this.data = String(data) }
  get nodeValue() { return this.data }
  set nodeValue(value) { this.data = String(value) }
  get textContent() { return this.data }
  set textContent(value) { this.data = String(value) }
}

class FakeElement extends FakeNode {
  constructor(ownerDocument, tag) {
    super(1, ownerDocument)
    this.tagName = tag.toUpperCase()
    this.localName = tag
    this.namespaceURI = 'http://www.w3.org/1999/xhtml'
    this.attributes = new Map()
    this.style = { setProperty() {}, removeProperty() {} }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) { this.attributes.delete(name) }
  get textContent() { return this.childNodes.map((child) => child.textContent).join('') }
  set textContent(value) {
    this.childNodes.forEach((child) => { child.parentNode = null })
    this.childNodes = []
    if (value !== '' && value != null) this.appendChild(new FakeText(this.ownerDocument, value))
  }
}

const fakeWindow = {
  event: undefined,
  HTMLIFrameElement: class {},
  location: { reload() { fakeWindow.reloads += 1 } },
  reloads: 0,
  addEventListener() {},
  removeEventListener() {},
  getSelection: () => null,
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
}
const fakeDocument = {
  nodeType: 9,
  defaultView: fakeWindow,
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
  createElement: (tag) => new FakeElement(fakeDocument, tag),
  createElementNS: (namespace, tag) => new FakeElement(fakeDocument, tag),
  createTextNode: (data) => new FakeText(fakeDocument, data),
}
fakeDocument.documentElement = new FakeElement(fakeDocument, 'html')
fakeDocument.body = new FakeElement(fakeDocument, 'body')
fakeWindow.document = fakeDocument

// Serve a React come "ambiente browser". Va messo PRIMA di importare react-dom/client.
globalThis.window = fakeWindow
globalThis.document = fakeDocument
globalThis.IS_REACT_ACT_ENVIRONMENT = false

const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

// Il DOM finto come testo, per poterci guardare dentro.
function toHtml(node) {
  if (node.nodeType === 3) return node.data
  const attrs = [...node.attributes].map(([k, v]) => ` ${k}="${v}"`).join('')
  return `<${node.localName}${attrs}>${node.childNodes.map(toHtml).join('')}</${node.localName}>`
}
const findTag = (node, tag) => (node.localName === tag ? node : node.childNodes?.map((child) => findTag(child, tag)).find(Boolean) ?? null)
const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]

// --- il modulo vero, caricato da Vite --------------------------------------

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-errorboundary-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    {
      name: 'error-boundary-harness',
      enforce: 'pre',
      resolveId(source, importer) {
        return importer?.includes('ErrorBoundary.jsx') && source === './ErrorBoundary.css' ? '\0empty-css' : null
      },
      load(id) { return id === '\0empty-css' ? 'export default {}' : null },
    },
    reactPlugin(),
  ],
})

// --- componenti di prova -----------------------------------------------------

const Healthy = ({ label = 'Tutto a posto' }) => h('p', { className: 'healthy' }, label)
const Bomb = ({ message = 'boom' }) => { throw new Error(message) }
const ObjectAsChild = () => h('p', null, { pushed: 1, pulled: 34 }) // l'errore vero di "Sincronizza ora"

// Monta un albero con il vero React e restituisce cosa è successo.
function mount(tree) {
  const container = fakeDocument.createElement('div')
  const caught = []
  const uncaught = []
  const logged = []
  const originalError = console.error
  console.error = (...args) => { logged.push(args) }
  let root
  try {
    root = createRoot(container, {
      onCaughtError: (error) => caught.push(error),
      onUncaughtError: (error) => uncaught.push(error),
      onRecoverableError: () => {},
    })
    flushSync(() => root.render(tree))
  } finally {
    console.error = originalError
  }
  const rerender = (next) => {
    console.error = (...args) => { logged.push(args) }
    try { flushSync(() => root.render(next)) } finally { console.error = originalError }
  }
  return { container, html: () => toHtml(container), caught, uncaught, logged, rerender }
}

try {
  const { ErrorBoundary, ErrorFallback } = await server.ssrLoadModule('/src/components/ErrorBoundary/ErrorBoundary.jsx')
  const TITLE = 'Ops, qualcosa non è andato come previsto.'
  const TEXT = 'Prova a riaprire SPENDY.'

  // =====================================================================
  section('Il banco di prova è React vero')
  // =====================================================================
  {
    const app = mount(h(Healthy, { label: 'ciao' }))
    check('react-dom/client disegna nel DOM minimo', app.html() === '<div><p class="healthy">ciao</p></div>' || app.html().includes('<p class="healthy">ciao</p>'))
    const control = mount(h(Bomb))
    check('senza boundary, un errore di rendering svuota tutto (la pagina bianca)',
      control.uncaught.length === 1 && control.uncaught[0].message === 'boom' && control.container.childNodes.length === 0)
    const objectBug = mount(h(ObjectAsChild))
    check('   anche l\'errore di "Sincronizza ora" (oggetto come figlio) lo farebbe',
      /Objects are not valid as a React child/.test(objectBug.uncaught[0]?.message ?? '') && objectBug.container.childNodes.length === 0)
  }

  // =====================================================================
  section('1. Un errore di rendering viene intercettato')
  // =====================================================================
  {
    const app = mount(h(ErrorBoundary, null, h(Bomb, { message: 'errore nel rendering' })))
    check('React passa l\'errore al boundary (onCaughtError)', app.caught.length === 1 && app.caught[0].message === 'errore nel rendering')
    check('   nessun errore non gestito', app.uncaught.length === 0)
    const logged = app.logged.find((args) => String(args[0]).includes('[SPENDY] errore di rendering'))
    check('   componentDidCatch lo registra in console con la pila dei componenti',
      Boolean(logged) && logged[1]?.message === 'errore nel rendering' && typeof logged[2] === 'string' && logged[2].includes('Bomb'))
    check('   l\'albero NON è vuoto: niente pagina bianca', app.container.childNodes.length > 0)

    const objectBug = mount(h(ErrorBoundary, null, h(ObjectAsChild)))
    check('   l\'errore vero di "Sincronizza ora" (oggetto come figlio) è intercettato',
      objectBug.uncaught.length === 0 && /Objects are not valid as a React child/.test(objectBug.caught[0]?.message ?? ''))

    const nothing = mount(h(ErrorBoundary, null, h(() => { throw null })))
    check('   anche un throw di null (nessun oggetto errore) viene intercettato', nothing.caught.length === 1 && nothing.container.childNodes.length > 0)
  }

  // =====================================================================
  section('2. Viene mostrata la schermata di fallback')
  // =====================================================================
  {
    const app = mount(h(ErrorBoundary, null, h(Healthy), h(Bomb)))
    const html = app.html()
    check('titolo: "Ops, qualcosa non è andato come previsto."', html.includes(TITLE))
    check('messaggio: "Prova a riaprire SPENDY."', html.includes(TEXT))
    check('pulsante per riaprire l\'app', html.includes('<button') && html.includes('Riapri SPENDY'))
    check('annunciata come avviso (role="alert")', html.includes('role="alert"'))
    check('al posto dei contenuti normali, che non compaiono', !html.includes('Tutto a posto'))
    check('nessun dettaglio tecnico mostrato all\'utente', !html.includes('Bomb') && !html.includes('boom') && !html.includes('Error'))

    const markup = renderToStaticMarkup(h(ErrorFallback))
    check('il fallback da solo si disegna (non dipende da store, hook o rete)', markup.includes(TITLE) && markup.includes(TEXT))
    check('   usa le classi di stile del progetto', markup.includes('error-fallback__button') && markup.includes('error-fallback__mascot'))
  }
  {
    // Il pulsante: onReload se fornito, altrimenti window.location.reload().
    let reloads = 0
    const custom = mount(h(ErrorBoundary, { onReload: () => { reloads += 1 } }, h(Bomb)))
    propsOf(findTag(custom.container, 'button')).onClick()
    check('pulsante → chiama onReload', reloads === 1)

    fakeWindow.reloads = 0
    const standard = mount(h(ErrorBoundary, null, h(Bomb)))
    propsOf(findTag(standard.container, 'button')).onClick()
    check('   senza onReload → window.location.reload()', fakeWindow.reloads === 1)
  }

  // =====================================================================
  section('3. Il resto dell\'app continua a funzionare normalmente')
  // =====================================================================
  {
    const healthy = mount(h(ErrorBoundary, null, h('main', null, h(Healthy, { label: 'Home' }), h('nav', null, 'Menu'))))
    check('senza errori il boundary è trasparente: i figli si disegnano come sempre',
      healthy.html() === '<div><main><p class="healthy">Home</p><nav>Menu</nav></main></div>')
    check('   nessun errore e nessun fallback', healthy.caught.length === 0 && !healthy.html().includes('error-fallback'))
    healthy.rerender(h(ErrorBoundary, null, h('main', null, h(Healthy, { label: 'Analisi' }), h('nav', null, 'Menu'))))
    check('   gli aggiornamenti normali continuano a funzionare', healthy.html().includes('Analisi') && !healthy.html().includes('Home'))
  }
  {
    // Ciò che sta fuori dal boundary non viene toccato dall'errore.
    const app = mount(h('div', null,
      h(ErrorBoundary, null, h(Bomb)),
      h('aside', null, 'Resto dell\'app')))
    check('un errore dentro il boundary non tocca ciò che è fuori', app.html().includes('Resto dell\'app') && app.html().includes(TITLE))
    check('   e non viene segnalato come errore non gestito', app.uncaught.length === 0)
  }
  {
    // Boundary indipendenti: si rompe solo la parte che ha l'errore.
    const app = mount(h('div', null,
      h(ErrorBoundary, null, h(Healthy, { label: 'Parte sana' })),
      h(ErrorBoundary, null, h(Bomb))))
    check('due boundary indipendenti: la parte sana resta, solo l\'altra mostra il fallback',
      app.html().includes('Parte sana') && app.html().includes(TITLE) && app.caught.length === 1)
  }
  {
    // Il boundary non si blocca: se l'errore sparisce al prossimo disegno, il contenuto torna.
    const flaky = { broken: true }
    const Flaky = () => { if (flaky.broken) throw new Error('temporaneo'); return h(Healthy, { label: 'Tornato' }) }
    const app = mount(h(ErrorBoundary, { key: 'a' }, h(Flaky)))
    check('prima: fallback', app.html().includes(TITLE))
    flaky.broken = false
    app.rerender(h(ErrorBoundary, { key: 'b' }, h(Flaky)))
    check('dopo aver riaperto (nuovo boundary) e senza più l\'errore: il contenuto normale torna', app.html().includes('Tornato') && !app.html().includes(TITLE))
  }

  // =====================================================================
  section('4. Errore in una pagina: la navigazione resta utilizzabile')
  // =====================================================================
  {
    // Lo schema di App.jsx: intestazione e menu FUORI dal boundary di pagina,
    // il contenuto della pagina dentro, e tutto dentro il boundary globale.
    const shell = (tab, Page, Header = () => h('header', null, 'Intestazione')) => h(ErrorBoundary, null,
      h('div', { className: 'app-shell' },
        h(Header),
        h('main', null, h(ErrorBoundary, { variant: 'page', key: tab }, h(Page))),
        h('nav', null, 'Menu in basso')))

    const app = mount(shell('home', Bomb))
    const html = app.html()
    check('errore nella pagina: lo intercetta il boundary di pagina, non quello globale',
      app.caught.length === 1 && app.uncaught.length === 0 && !html.includes('Riapri SPENDY'))
    check('   il menu in basso e l\'intestazione restano al loro posto', html.includes('Menu in basso') && html.includes('Intestazione'))
    check('   il fallback sta dentro lo spazio della pagina, con il suo stile compatto',
      html.includes('<main><section class="error-fallback error-fallback--page"') && html.includes(TITLE))
    check('   un solo <main> (il fallback di pagina non ne annida un altro)', html.split('<main').length === 2)
    check('   pulsante "Riprova" (non ricarica la pagina)', html.includes('Riprova') && !html.includes('Riapri SPENDY'))

    // Cambiando sezione dal menu la pagina nuova parte pulita (key = activeTab).
    app.rerender(shell('analytics', Healthy))
    check('cambiando sezione dal menu la nuova pagina si vede subito', app.html().includes('Tutto a posto') && !app.html().includes(TITLE))
    check('   e il menu è sempre lì', app.html().includes('Menu in basso'))
  }
  {
    // "Riprova" ridisegna solo la pagina, senza ricaricare l'app.
    const flaky = { broken: true }
    const Flaky = () => { if (flaky.broken) throw new Error('pagina rotta'); return h(Healthy, { label: 'Pagina di nuovo a posto' }) }
    const tree = h(ErrorBoundary, null, h('div', null, h('main', null, h(ErrorBoundary, { variant: 'page' }, h(Flaky))), h('nav', null, 'Menu in basso')))
    fakeWindow.reloads = 0
    const app = mount(tree)
    const press = () => {
      const original = console.error // componentDidCatch registra l'errore atteso: non sporcare l'output
      console.error = () => {}
      try { flushSync(() => propsOf(findTag(app.container, 'button')).onClick()) } finally { console.error = original }
    }
    check('prima: fallback di pagina', app.html().includes('Riprova'))
    press()
    check('"Riprova" con l\'errore ancora presente → il fallback ricompare, il menu resta', app.html().includes('Riprova') && app.html().includes('Menu in basso'))
    flaky.broken = false
    press()
    check('"Riprova" dopo che l\'errore è sparito → la pagina torna', app.html().includes('Pagina di nuovo a posto') && !app.html().includes(TITLE))
    check('   senza ricaricare l\'app e con il menu sempre presente', fakeWindow.reloads === 0 && app.html().includes('Menu in basso'))
  }
  {
    // Un errore FUORI dal boundary di pagina (qui l'intestazione) lo prende il globale.
    const tree = h(ErrorBoundary, null,
      h('div', null,
        h(Bomb),
        h('main', null, h(ErrorBoundary, { variant: 'page' }, h(Healthy))),
        h('nav', null, 'Menu in basso')))
    const app = mount(tree)
    check('errore fuori dal boundary di pagina → lo cattura ancora il boundary principale', app.caught.length === 1 && app.html().includes('Riapri SPENDY'))
    check('   schermata intera al posto dell\'app', !app.html().includes('Menu in basso') && app.uncaught.length === 0)

    // Se il fallback di pagina stesso non può disegnarsi, il globale lo prende.
    const again = mount(h(ErrorBoundary, null, h('main', null, h(ErrorBoundary, { variant: 'page' }, h(Bomb)))))
    check('errore di pagina: il globale NON interviene', again.caught.length === 1 && !again.html().includes('Riapri SPENDY'))
  }
  {
    const page = renderToStaticMarkup(h(ErrorFallback, { variant: 'page' }))
    check('fallback di pagina: stesso titolo, "Riprova", niente <main> né h1',
      page.includes(TITLE) && page.includes('Riprova') && page.includes('role="alert"') && !page.includes('<main') && !page.includes('<h1'))
    check('   fallback dell\'app invariato: schermata intera con "Riapri SPENDY"',
      renderToStaticMarkup(h(ErrorFallback)).includes('<main class="error-fallback"') && renderToStaticMarkup(h(ErrorFallback)).includes('Riapri SPENDY'))
  }
  {
    // Come è montato davvero in App.jsx e main.jsx (controllo sul sorgente).
    const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8')
    const main = readFileSync(new URL('../../main.jsx', import.meta.url), 'utf8')
    const mainStart = app.indexOf('<main'), mainEnd = app.indexOf('</main>')
    const inside = app.slice(mainStart, mainEnd)
    check('App.jsx: ActivePage è dentro un ErrorBoundary di pagina, con key={activeTab}',
      /<ErrorBoundary variant="page" key=\{activeTab\}>\s*<ActivePage \/>\s*<\/ErrorBoundary>/.test(inside))
    check('   BottomNavigation e Header restano fuori da quel boundary',
      app.indexOf('<BottomNavigation') > mainEnd && app.indexOf('<Header') < mainStart && !inside.includes('BottomNavigation') && !inside.includes('<Header'))
    check('   i modali restano fuori dal boundary di pagina (vedono solo quello globale)', app.indexOf('<SettingsScreen') > mainEnd)
    check('main.jsx: il boundary principale avvolge tutta l\'app',
      /<ErrorBoundary>\s*<App \/>\s*<\/ErrorBoundary>/.test(main))
  }
} finally {
  await server.close()
}

report('ErrorBoundary')
