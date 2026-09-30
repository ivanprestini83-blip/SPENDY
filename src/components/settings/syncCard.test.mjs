// Test di SyncCard: il pulsante "Sincronizza ora" non deve far crollare l'app.
//
// Il bug (vedi commit del fix): il pulsante chiamava run(syncNow), ma
// syncNow restituisce un OGGETTO ({ pushed, pulled } / { skipped } /
// { pulled, error }), mentre run() tratta ogni valore "vero" come testo
// d'errore da mostrare. L'oggetto finiva in message.text e React lanciava
// "Objects are not valid as a React child": senza ErrorBoundary, pagina bianca.
//
// Nel progetto non ci sono jsdom né librerie per testare componenti, e non se
// ne aggiungono. Il banco di prova usa solo ciò che c'è già:
//   - Vite (devDependency) carica il VERO SyncCard.jsx, con JSX e tutto;
//   - i suoi import (react, store, supabase, spendySync, css) sono sostituiti
//     da moduli finti: hook minimi, una sessione già attiva, syncNow pilotato
//     dal test;
//   - il click è eseguito chiamando davvero l'onClick del pulsante;
//   - la vista risultante è disegnata con il VERO react-dom/server, che lancia
//     lo stesso errore di produzione se trova un oggetto come figlio.
// `?legacy` ricarica il componente con il vecchio comportamento (run riceve
// l'oggetto): serve a dimostrare che il test, sul codice di prima, fallisce.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, section, report } from '../../sync/testkit.mjs'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CARD = '/src/components/settings/SyncCard.jsx'

// --- moduli finti: solo ciò che SyncCard importa ---------------------------

const FAKE_MODULES = {
  react: `
    export const useState = (initial) => globalThis.__card.useState(initial)
    export const useEffect = (effect) => globalThis.__card.useEffect(effect)`,
  '../../store/useAppStore.js': `
    export const useAppStore = (selector) => selector(globalThis.__card.store)`,
  '../../lib/supabase.js': `
    export const supabase = {
      auth: {
        getSession: (...args) => globalThis.__card.supabase.auth.getSession(...args),
        onAuthStateChange: (...args) => globalThis.__card.supabase.auth.onAuthStateChange(...args),
      },
    }`,
  '../../sync/spendySync.js': `
    export const isSupabaseConfigured = true
    export const getMigrationStatus = () => ({ needed: false })
    export const runMigration = async () => ({ migrated: false })
    export const signIn = async () => null
    export const signUp = async () => null
    export const signOut = async () => null
    export const syncNow = (...args) => globalThis.__card.syncNow(...args)`,
  './SyncCard.css': 'export default {}',
}

const harnessPlugin = {
  name: 'sync-card-harness',
  enforce: 'pre',
  resolveId(source, importer) {
    // 'react' è un import "nudo": Vite lo darebbe per esterno (il React vero)
    // prima di interpellarci, quindi il transform qui sotto lo riscrive.
    if (source === '/__card-fake/react') return '\0card-fake:react'
    if (importer && importer.includes('SyncCard.jsx') && source in FAKE_MODULES) return `\0card-fake:${source}`
    return null
  },
  load(id) {
    return id.startsWith('\0card-fake:') ? FAKE_MODULES[id.slice('\0card-fake:'.length)] : null
  },
  transform(code, id) {
    if (!id.includes('SyncCard.jsx')) return null
    const reactImport = "from 'react'"
    if (!code.includes(reactImport)) throw new Error("SyncCard non importa più da 'react' come previsto: aggiornare questo test")
    let out = code.replace(reactImport, "from '/__card-fake/react'")
    // ?legacy: il pulsante torna a passare a run() l'oggetto di syncNow.
    if (id.includes('SyncCard.jsx?legacy')) {
      const fixed = 'return r?.error ? String(r.error) : null'
      if (!out.includes(fixed)) throw new Error('la riga corretta non è più nel pulsante: aggiornare questo test')
      out = out.replace(fixed, 'return r')
    }
    return out
  },
}

// --- hook minimi: stato per posizione, effetti eseguiti dopo il primo render ---

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function createCardRuntime({ syncNowResult }) {
  const slots = []
  let cursor = 0
  let effects = []
  const runtime = {
    slots,
    store: { sync: { status: 'synced', error: null, lastSyncAt: '2026-09-30T16:00:00.000Z', outbox: [] } },
    // Una sessione già attiva: SyncCard la legge da getSession() in un effetto.
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: { user: { email: 'prova@esempio.invalid' } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
    syncCalls: 0,
    syncNow: async () => {
      runtime.syncCalls += 1
      return typeof syncNowResult === 'function' ? syncNowResult() : syncNowResult
    },
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      const set = (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }
      return [slots[index], set]
    },
    useEffect(effect) { effects.push(effect) },
    render(Component) {
      cursor = 0
      effects = []
      return Component()
    },
    runEffects() {
      const pending = effects
      effects = []
      pending.forEach((effect) => effect())
    },
  }
  return runtime
}

// --- visita dell'albero di elementi React ---------------------------------

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit))
  if (node && typeof node === 'object' && node.props) {
    visit(node)
    walk(node.props.children, visit)
  }
  return undefined
}
const textOf = (node) => {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && node.props) return textOf(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function findAll(tree, predicate) {
  const found = []
  walk(tree, (node) => { if (predicate(node)) found.push(node) })
  return found
}
const findButton = (tree, label) => findAll(tree, (n) => n.type === 'button' && textOf(n).includes(label))[0]
const findMessage = (tree) => findAll(tree, (n) => n.type === 'p' && String(n.props.className ?? '').includes('sync-card__message'))[0]

// Monta la card con la sessione attiva e preme "Sincronizza ora".
async function pressSyncNow(SyncCard, syncNowResult) {
  const runtime = createCardRuntime({ syncNowResult })
  globalThis.__card = runtime
  runtime.render(SyncCard)
  runtime.runEffects()
  await tick()
  const before = runtime.render(SyncCard)
  const button = findButton(before, 'Sincronizza ora')
  if (!button) return { runtime, before, button: null, tree: before }
  await button.props.onClick()
  return { runtime, before, button, tree: runtime.render(SyncCard) }
}

// Ciò che fa React quando disegna la vista: lancia se trova un oggetto.
function draw(tree) {
  try {
    return { html: renderToStaticMarkup(tree), error: null }
  } catch (error) {
    return { html: null, error: String(error?.message ?? error) }
  }
}

// =====================================================================
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-synccard-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [harnessPlugin, react()],
})

try {
  const { SyncCard } = await server.ssrLoadModule(CARD)
  const { SyncCard: LegacySyncCard } = await server.ssrLoadModule(`${CARD}?legacy`)

  // =====================================================================
  section('Banco di prova: la card con sessione attiva')
  // =====================================================================
  {
    const { before, button } = await pressSyncNow(SyncCard, { pushed: 0, pulled: 0 })
    check('il componente vero si monta con la sessione attiva', textOf(before).includes('prova@esempio.invalid'))
    check('   compare il pulsante "Sincronizza ora"', Boolean(button))
    check('   e "Esci dall\'account"', Boolean(findButton(before, 'Esci dall')))
    check('   all\'inizio nessun messaggio', !findMessage(before))
  }

  // =====================================================================
  section('1. Sincronizzazione riuscita: nessun oggetto in message.text')
  // =====================================================================
  for (const [label, result] of [
    ['{ pushed, pulled }', { pushed: 2, pulled: 34 }],
    ['{ pushed: 0, pulled: 0 }', { pushed: 0, pulled: 0 }],
    ['{ skipped: "offline" }', { skipped: 'offline' }],
    ['{ skipped: "sync non attivo" }', { skipped: 'sync non attivo' }],
    ['undefined', undefined],
  ]) {
    const { runtime, tree } = await pressSyncNow(SyncCard, result)
    const drawn = draw(tree)
    check(`syncNow → ${label}: syncNow chiamato una volta`, runtime.syncCalls === 1)
    check('   nessun messaggio mostrato', !findMessage(tree))
    check('   nessun oggetto finisce nello stato della card',
      runtime.slots.every((value) => !(value && typeof value === 'object' && 'text' in value && typeof value.text !== 'string')))
    check('   la schermata si disegna senza errori e resta a posto',
      drawn.error === null && drawn.html.includes('Sincronizza ora') && !drawn.html.includes('[object'))
  }

  // =====================================================================
  section('2. Errore di sincronizzazione: mostrato come testo')
  // =====================================================================
  {
    const { runtime, tree } = await pressSyncNow(SyncCard, { pulled: 0, error: 'expenses: JWT expired' })
    const message = findMessage(tree)
    const drawn = draw(tree)
    check('messaggio presente, con tono "error"', Boolean(message) && String(message.props.className).includes('sync-card__message--error'))
    check('   il contenuto è una stringa', typeof message?.props.children === 'string')
    check('   è proprio il testo dell\'errore', message?.props.children === 'expenses: JWT expired')
    check('   si disegna a schermo con quel testo', drawn.error === null && drawn.html.includes('expenses: JWT expired'))
    check('   nessun oggetto nello stato della card',
      runtime.slots.filter((value) => value && typeof value === 'object' && 'text' in value).every((value) => typeof value.text === 'string'))
  }
  {
    const { tree } = await pressSyncNow(SyncCard, { pushed: 1, error: new Error('rete assente') })
    const message = findMessage(tree)
    check('errore che è un oggetto Error → convertito in testo', message?.props.children === 'Error: rete assente' && draw(tree).error === null)
  }
  {
    const { tree } = await pressSyncNow(SyncCard, { error: 'nessun utente' })
    check('errore con testo semplice → mostrato', findMessage(tree)?.props.children === 'nessun utente')
  }

  // =====================================================================
  section('3. La schermata non va più in crash')
  // =====================================================================
  {
    // Con il vecchio comportamento (run riceve l'oggetto) il test DEVE fallire:
    // è la prova che sta misurando il bug giusto.
    const ok = await pressSyncNow(LegacySyncCard, { pushed: 2, pulled: 34 })
    const okMessage = findMessage(ok.tree)
    check('controllo sul codice di prima: l\'oggetto finiva in message.text', typeof okMessage?.props.children === 'object')
    const crash = draw(ok.tree)
    check('   e React andava in errore ("Objects are not valid as a React child")',
      crash.error !== null && /Objects are not valid as a React child/.test(crash.error), crash.error ?? '')

    const err = await pressSyncNow(LegacySyncCard, { pulled: 0, error: 'expenses: JWT expired' })
    check('   lo stesso con { pulled, error }, l\'errore visto nel pannello',
      /Objects are not valid as a React child \(found: object with keys \{pulled, error\}\)/.test(draw(err.tree).error ?? ''))
  }
  {
    // Sul codice attuale, tutti i tipi di risultato di syncNow si disegnano.
    const results = [{ pushed: 2, pulled: 34 }, { pulled: 0, error: 'expenses: JWT expired' }, { skipped: 'offline' }, { skipped: 'nessun utente' }, undefined, null]
    const errors = []
    for (const result of results) {
      const { tree } = await pressSyncNow(SyncCard, result)
      const drawn = draw(tree)
      if (drawn.error) errors.push(`${JSON.stringify(result)} → ${drawn.error}`)
    }
    check('codice attuale: nessun risultato di syncNow manda in crash la card', errors.length === 0, errors.join(' | '))

    const { runtime } = await pressSyncNow(SyncCard, { pushed: 1, pulled: 1 })
    const pressed = runtime.slots.find((value) => typeof value === 'boolean')
    check('   dopo la sincronizzazione il pulsante non resta bloccato (busy = false)', pressed === false)
  }
} finally {
  await server.close()
}

report('SyncCard')
