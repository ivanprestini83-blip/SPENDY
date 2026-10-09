// Centro notifiche a schermo: la campanella con il suo badge e il pannello.
// L'App vera (Vite carica App.jsx e tutto ciò che importa, CSS escluso) sopra lo
// store vero, con il vero react-dom/client su un DOM minimo (store/fakeDom.mjs).
// I click sono eseguiti chiamando davvero gli onClick che React ha sul nodo.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report, italianDevice } from '../sync/testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'

const A = 'utente-a-0001'
const B = 'utente-b-0002'
const scopeFor = (userId) => `u:${userId}`

// Dispositivo di un utente italiano: i testi controllati sono quelli italiani.
const storageMap = italianDevice(new Map())
const dom = installFakeDom(storageMap)
// Registra i listener di documento (il DOM finto li ignora), per provare Esc.
const docListeners = []
dom.document.addEventListener = (type, fn) => docListeners.push({ type, fn })
dom.document.removeEventListener = (type, fn) => {
  const i = docListeners.findIndex((l) => l.type === type && l.fn === fn)
  if (i >= 0) docListeners.splice(i, 1)
}
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const { renderToStaticMarkup } = await import('react-dom/server')

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-notifui-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 4; i += 1) await tick() }

const walk = (node, visit) => { visit(node); (node.childNodes ?? []).forEach((child) => walk(child, visit)) }
const findAll = (root, predicate) => { const out = []; walk(root, (n) => { if (n.nodeType === 1 && predicate(n)) out.push(n) }); return out }
const hasClass = (n, cls) => (n.getAttribute('class') ?? '').split(/\s+/).includes(cls)
const byClass = (root, cls) => findAll(root, (n) => hasClass(n, cls))
const click = (el) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))
  el[key].onClick({ preventDefault() {}, stopPropagation() {} })
}

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { Header } = await server.ssrLoadModule('/src/components/Header/Header.jsx')
  const S = useAppStore.getState

  const uncaught = []
  const container = dom.createContainer()
  const root = createRoot(container, { onCaughtError: (e) => uncaught.push(e), onUncaughtError: (e) => uncaught.push(e), onRecoverableError: () => {} })
  const act = async (fn) => { flushSync(fn); await settle() }
  const bell = () => findAll(container, (n) => n.localName === 'button' && hasClass(n, 'header__icon-button'))[0]
  const badge = () => byClass(container, 'header__badge')[0]
  const html = (el) => dom.toHtml(el)
  const panel = () => byClass(container, 'notifications-screen')[0]

  // =====================================================================
  section('1. La campanella (Header)')
  // =====================================================================
  {
    const render = (n) => renderToStaticMarkup(h(Header, { unreadCount: n }))
    const zero = render(0)
    check('0 non lette: nessun badge', !zero.includes('header__badge'))
    check('   aria-label "Notifiche, nessuna nuova notifica"', zero.includes('aria-label="Notifiche, nessuna nuova notifica"'))
    const tre = render(3)
    check('3 non lette: badge "3"', />3<\/span>/.test(tre) && tre.includes('header__badge'))
    check('   aria-label "Notifiche, 3 non lette"', tre.includes('aria-label="Notifiche, 3 non lette"'))
    check('99 → "99", 100 → "99+"', render(99).includes('>99</span>') && render(100).includes('>99+</span>') && render(500).includes('>99+</span>'))
    check('il badge non mostra mai "0" e il vecchio pallino decorativo non c\'è', !render(0).includes('>0<') && !/header__badge"[^>]*><\/span>/.test(render(5)))
    check('il pulsante è un vero <button> con il suo label (le impostazioni restano)', render(2).includes('<button') && render(2).includes('aria-label="Impostazioni"'))
  }

  // =====================================================================
  section('2. App: badge, apertura del pannello, stato vuoto')
  // =====================================================================
  S().switchScope(scopeFor(A))
  await tick()
  await act(() => root.render(h(App)))
  check('l\'app si monta senza errori', uncaught.length === 0 && html(container).includes('app-shell'))
  check('senza notifiche: nessun badge', !badge())
  check('   campanella: "Notifiche, nessuna nuova notifica"', html(container).includes('aria-label="Notifiche, nessuna nuova notifica"'))

  await act(() => click(bell()))
  check('premere la campanella apre il pannello "Notifiche"', Boolean(panel()) && html(panel()).includes('>Notifiche</h2>'))
  check('   è un dialogo accessibile', panel().getAttribute('role') === 'dialog' && panel().getAttribute('aria-modal') === 'true' && panel().getAttribute('aria-label') === 'Notifiche')
  check('stato vuoto: "Non ci sono nuove notifiche."', html(panel()).includes('Non ci sono nuove notifiche.'))
  const markAllBtn = () => findAll(container, (n) => n.localName === 'button' && html(n).includes('Segna tutte come lette'))[0]
  check('   "Segna tutte come lette" disabilitato', markAllBtn().hasAttribute('disabled'))
  check('   pulsante di chiusura con aria-label', findAll(panel(), (n) => n.getAttribute('aria-label') === 'Chiudi').length === 1)

  // =====================================================================
  section('3. Con notifiche: elenco, letto/non letto, tempo, azione')
  // =====================================================================
  const nowIso = Date.now()
  S().addNotification(scopeFor(A), { type: 'budget', eventKey: 'budget:over:x', title: 'Budget', message: 'Budget mensile superato.', action: { kind: 'tab', target: 'home', label: 'Vai alla Home' } })
  S().addNotification(scopeFor(A), { type: 'goal', eventKey: 'goal:1:50', title: 'Vacanza', message: 'Sei arrivato al 50% del tuo obiettivo.', action: { kind: 'tab', target: 'goals', label: 'Vedi obiettivo' } })
  S().addNotification(scopeFor(A), { type: 'sync', eventKey: 'sync:error:x', title: 'Sincronizzazione', message: 'Non siamo riusciti a sincronizzare i tuoi dati. Riproveremo da soli.', action: { kind: 'modal', target: 'settings', label: 'Apri Impostazioni' } })
  S().addNotification(scopeFor(A), { type: 'ai', eventKey: 'ai:k:d', title: 'Spendy', message: 'Una frase di Spendy.' })
  await settle()
  const items = () => byClass(panel(), 'notifications-screen__item')
  const itemOf = (text) => items().find((i) => html(i).includes(text))
  check('quattro elementi in elenco', items().length === 4)
  check('badge sulla campanella: "4" (aggiornato subito)', badge() && html(badge()).includes('>4<'))
  check('   aria-label "Notifiche, 4 non lette"', bell().getAttribute('aria-label') === 'Notifiche, 4 non lette')
  check('non letta: classe --unread, punto indicatore, titolo marcato, testo per lettori di schermo',
    items().every((i) => hasClass(i, 'notifications-screen__item--unread') && byClass(i, 'notifications-screen__dot').length === 1)
    && html(items()[0]).includes('Non letta.'))
  check('ogni elemento: categoria, titolo, messaggio, tempo relativo', html(itemOf('Budget mensile superato.')).includes('Budget</span>') && html(itemOf('Budget mensile superato.')).includes('adesso'))
  check('   l\'azione compare solo dove esiste (la notifica AI di prova non ne ha)', html(itemOf('Una frase di Spendy.')).includes('notifications-screen__action') === false && html(itemOf('Budget mensile superato.')).includes('Vai alla Home'))
  check('   ogni notifica ha un pulsante "Elimina" con nome accessibile', byClass(panel(), 'notifications-screen__delete').every((b) => /^Elimina la notifica: /.test(b.getAttribute('aria-label'))))
  void nowIso

  // =====================================================================
  section('4. Leggere, azioni, segna tutte, eliminare')
  // =====================================================================
  {
    // la notifica dell'obiettivo (Vacanza) → azione: tab Obiettivi
    await act(() => click(byClass(itemOf('Vacanza'), 'notifications-screen__main')[0]))
    check('tap su una notifica con azione: va al tab Obiettivi e chiude il pannello', S().activeTab === 'goals' && !panel())
    check('   la notifica è segnata come letta, il badge scende a 3 subito', S().notifications.find((n) => n.id === 'goal:1:50').read === true && html(badge()).includes('>3<'))

    await act(() => click(bell()))
    const sync = () => items().find((i) => html(i).includes('Sincronizzazione'))
    check('riaperto: quella letta non ha più punto né classe --unread', (() => { const v = items().find((i) => html(i).includes('Vacanza')); return !hasClass(v, 'notifications-screen__item--unread') && byClass(v, 'notifications-screen__dot').length === 0 })())
    await act(() => click(byClass(sync(), 'notifications-screen__main')[0]))
    check('azione "modale" (Impostazioni): si apre il modale e il pannello Notifiche si chiude', S().modal === 'settings' && !panel())
    await act(() => S().closeModal())
    check('   badge a 2', html(badge()).includes('>2<'))

    await act(() => click(bell()))
    await act(() => click(markAllBtn()))
    check('"Segna tutte come lette": tutte lette, nessun badge (sparisce subito)', S().notifications.every((n) => n.read) && !badge())
    check('   il pulsante torna disabilitato', markAllBtn().hasAttribute('disabled'))

    const before = Object.keys(S().notificationKeys).length
    await act(() => click(byClass(items()[0], 'notifications-screen__delete')[0]))
    check('eliminare (✕) toglie la notifica dall\'elenco', items().length === 3 && S().notifications.length === 3)
    check('   le chiavi restano (non rinasce)', Object.keys(S().notificationKeys).length === before)

    const escape = docListeners.filter((l) => l.type === 'keydown')
    check('tastiera: il pannello ascolta Esc (un solo listener) e si chiude', escape.length === 1)
    await act(() => escape[0].fn({ key: 'Escape' }))
    check('   Esc chiude il pannello e il listener viene tolto', !panel() && docListeners.filter((l) => l.type === 'keydown').length === 0)
  }

  // =====================================================================
  section('5. Cambio account: il badge e il pannello seguono lo scope')
  // =====================================================================
  {
    S().addNotification(scopeFor(A), { type: 'budget', eventKey: 'budget:near:y', title: 'Budget', message: 'Attenzione: hai utilizzato il 90% del budget.' })
    await settle()
    check('A ha 1 non letta: badge "1"', badge() && html(badge()).includes('>1<'))
    await act(() => S().switchScope('guest'))
    check('logout → guest: nessun badge', !badge())
    await act(() => S().switchScope(scopeFor(B)))
    check('B entra: nessun badge, nessuna notifica di A', !badge() && S().notifications.length === 0)
    await act(() => click(bell()))
    check('   il pannello di B è vuoto', html(panel()).includes('Non ci sono nuove notifiche.') && !html(panel()).includes('Budget'))
    check('   una risposta tardiva di A viene rifiutata e non compare', S().addNotification(scopeFor(A), { type: 'ai', eventKey: 'ai:tardiva', title: 'Spendy', message: 'Tardiva' }) === false && !html(container).includes('Tardiva'))
    await act(() => S().closeModal())
    await act(() => S().switchScope(scopeFor(A)))
    check('A rientra: ritrova le sue (badge "1")', badge() && html(badge()).includes('>1<'))
    check('nessun errore di rendering in tutto il percorso', uncaught.length === 0, uncaught[0]?.message)
  }

  await act(() => root.unmount())
  check('smontando l\'app il watcher si ferma (nessun listener visibilitychange residuo)', docListeners.filter((l) => l.type === 'visibilitychange').length === 0)
} finally {
  await server.close()
}

report('Centro notifiche (schermata)')
