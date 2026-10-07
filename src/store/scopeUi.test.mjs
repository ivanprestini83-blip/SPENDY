// Dopo il logout NIENTE di chi è uscito resta a schermo.
//
// Questo test monta l'App VERA (Vite carica App.jsx e tutto ciò che importa,
// CSS escluso) sopra lo store vero, con il vero react-dom/client su un DOM
// minimo (fakeDom.mjs), e guarda il testo che l'utente vedrebbe:
//   A dentro → (A esce) → guest → (B entra) → (A rientra)
// L'App e il test condividono la stessa istanza dello store perché entrambi la
// caricano dallo stesso Vite.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import { installFakeDom } from './fakeDom.mjs'

const A = 'utente-a-0001'
const B = 'utente-b-0002'
const scopeFor = (userId) => `u:${userId}`

const storageMap = new Map()
const dom = installFakeDom(storageMap)
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-scopeui-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 4; i += 1) await tick() }

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const S = useAppStore.getState

  const caught = []
  const uncaught = []
  const container = dom.createContainer()
  const root = createRoot(container, {
    onCaughtError: (error) => caught.push(error),
    onUncaughtError: (error) => uncaught.push(error),
    onRecoverableError: () => {},
  })
  const screen = () => dom.toHtml(container)
  const visible = (text) => screen().includes(text)
  const act = async (fn) => { flushSync(fn); await settle() }

  const fill = (tag) => {
    const today = S().today
    S().addSalary({ amount: 3333, date: today }) // "+ → Guadagno → Stipendio"
    S().addExpense({ amount: 777.77, categoryId: 'spesa', description: `SEGRETO-${tag}`, date: today })
    S().addCustomCategory({ label: `Categoria-${tag}`, emoji: '🧪', type: 'expense' })
    S().addGoal({ emoji: '🎯', label: `Vacanza-${tag}`, target: 2000, etaMonths: 6, saved: 100 })
  }

  // =====================================================================
  section('A dentro: i suoi dati sono a schermo')
  // =====================================================================
  S().switchScope(scopeFor(A))
  fill('A')
  await act(() => root.render(h(App)))
  const shellDiA = container.childNodes[0]
  check('l\'app vera si monta senza errori di rendering', uncaught.length === 0 && caught.length === 0 && screen().includes('app-shell'), uncaught[0]?.message)
  check('Home: l\'obiettivo di A è visibile', visible('Vacanza-A'))
  await act(() => S().setActiveTab('expenses'))
  check('Spese: la spesa di A è visibile', visible('SEGRETO-A') || visible('777,77'))
  await act(() => S().openModal('settings'))
  check('Impostazioni: lo stipendio di A è visibile', /3\.?333/.test(screen()) && visible('settings-screen'))
  check('   nella sezione "Stipendio di questo ciclo", con Modifica ed Elimina', visible('Stipendio di questo ciclo') && visible('settings-screen__salary-edit') && visible('Elimina'))

  // =====================================================================
  section('A esce: nessun dato di A resta visibile')
  // =====================================================================
  await act(() => S().switchScope('guest'))
  const dopoLogout = screen()
  check('logout: niente dell\'obiettivo, della spesa, della categoria di A', !/Vacanza-A|SEGRETO-A|Categoria-A/.test(dopoLogout))
  check('   né il suo importo, né il suo stipendio', !dopoLogout.includes('777,77') && !/3\.?333/.test(dopoLogout))
  check('   il modale delle impostazioni si è chiuso e si riparte dalla Home', !dopoLogout.includes('settings-screen') && S().activeTab === 'home' && dopoLogout.includes('home-page'))
  check('   stato vuoto come un primo avvio', dopoLogout.includes('Sono in attesa'))
  check('nessun errore di rendering durante il cambio', uncaught.length === 0 && caught.length === 0)
  check('   l\'interfaccia è stata ricreata da zero (nessuno stato di componente di A sopravvive)', container.childNodes[0] !== shellDiA && container.childNodes[0] != null)
  await act(() => S().openModal('settings'))
  check('   anche riaprendo le Impostazioni non c\'è traccia di A', !/3\.?333|prova-a|Vacanza-A/.test(screen()) && visible('settings-screen'))
  await act(() => S().closeModal())

  // =====================================================================
  section('B entra: vede solo i suoi dati')
  // =====================================================================
  await act(() => S().switchScope(scopeFor(B)))
  check('B appena entrato: schermata vuota, niente di A', !/Vacanza-A|SEGRETO-A|Categoria-A/.test(screen()) && screen().includes('Sono in attesa'))
  await act(() => fill('B'))
  check('B: vede il proprio obiettivo', visible('Vacanza-B'))
  check('B: e ancora niente di A', !/Vacanza-A|SEGRETO-A|Categoria-A/.test(screen()))

  // =====================================================================
  section('A rientra: ritrova tutto, e B sparisce')
  // =====================================================================
  await act(() => S().switchScope(scopeFor(A)))
  check('A rientra: il suo obiettivo è di nuovo a schermo', visible('Vacanza-A'))
  check('   e non c\'è niente di B', !/Vacanza-B|SEGRETO-B|Categoria-B/.test(screen()))
  check('nessun errore di rendering in tutto il percorso', uncaught.length === 0 && caught.length === 0, (uncaught[0] ?? caught[0])?.message)
  check('i dati di A e di B stanno in contenitori diversi',
    storageMap.get(`spendy-storage-v2:${scopeFor(A)}`)?.includes('Vacanza-A') && !storageMap.get(`spendy-storage-v2:${scopeFor(A)}`)?.includes('Vacanza-B')
    && storageMap.get(`spendy-storage-v2:${scopeFor(B)}`)?.includes('Vacanza-B') && !storageMap.get(`spendy-storage-v2:${scopeFor(B)}`)?.includes('Vacanza-A'))
} finally {
  await server.close()
}

report('Isolamento account (schermata)')
