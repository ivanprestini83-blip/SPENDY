// Un DOM minimo per far girare il VERO react-dom/client dentro i test, senza
// jsdom e senza aggiungere dipendenze (il progetto non ne ha una). Basta per
// disegnare l'app e leggerne il contenuto; non simula layout, eventi nativi né CSS.
//
// Solo per i test: nessun file dell'app lo importa.
//
// installFakeDom(map) va chiamato PRIMA di importare react-dom/client, e
// `map` è il contenuto del localStorage finto (così un test può guardarci dentro).

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
  focus() {}
  blur() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  get textContent() { return this.childNodes.map((child) => child.textContent).join('') }
  set textContent(value) {
    this.childNodes.forEach((child) => { child.parentNode = null })
    this.childNodes = []
    if (value !== '' && value != null) this.appendChild(new FakeText(this.ownerDocument, value))
  }
}

export function installFakeDom(map = new Map()) {
  const localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
  const window = {
    event: undefined,
    HTMLIFrameElement: class {},
    localStorage,
    location: { search: '', href: 'http://localhost/', reload() {} },
    addEventListener() {},
    removeEventListener() {},
    getSelection: () => null,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  }
  const document = {
    nodeType: 9,
    defaultView: window,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    createElement: (tag) => new FakeElement(document, tag),
    createElementNS: (namespace, tag) => new FakeElement(document, tag),
    createTextNode: (data) => new FakeText(document, data),
  }
  document.documentElement = new FakeElement(document, 'html')
  document.body = new FakeElement(document, 'body')
  window.document = document

  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  for (const [name, value] of [
    ['window', window], ['document', document], ['localStorage', localStorage],
    ['requestAnimationFrame', window.requestAnimationFrame], ['cancelAnimationFrame', window.cancelAnimationFrame],
    ['matchMedia', window.matchMedia],
  ]) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }

  const toHtml = (node) => {
    if (node.nodeType === 3) return node.data
    const attrs = [...node.attributes].map(([key, value]) => ` ${key}="${value}"`).join('')
    return `<${node.localName}${attrs}>${node.childNodes.map(toHtml).join('')}</${node.localName}>`
  }
  return { window, document, localStorage, toHtml, createContainer: () => document.createElement('div') }
}
