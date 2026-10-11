// Impostazioni → Valuta (Fase 3B + 3C): la conferma viene PRIMA del cambio,
// "Annulla" non cambia niente, i testi esistono nelle quattro lingue e
// nessun importo viene toccato. `npm test`, senza rete.
//
// Componente VERO (CurrencyCard) sullo store vero e un DOM minimo; i tocchi
// chiamano davvero l'onClick dei pulsanti, come in i18n.test.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../../sync/testkit.mjs'
import { installFakeDom } from '../../store/fakeDom.mjs'

const dom = installFakeDom(new Map())
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true, writable: true })
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const server = await createServer({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-currency-card-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})

const LANGS = ['it', 'en', 'es', 'fr']
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
const text = (node) => (typeof node?.data === 'string' ? node.data : (node?.childNodes ?? []).map(text).join(''))
const hasClass = (node, name) => (node.attributes?.get?.('class') ?? '').split(' ').includes(name)
const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { CurrencyCard } = await server.ssrLoadModule('/src/components/settings/CurrencyCard.jsx')
  const { MESSAGES, translate } = await server.ssrLoadModule('/src/i18n/translate.js')
  const { SETTINGS_KEY } = await server.ssrLoadModule('/src/sync/outbox.js')
  const S = useAppStore.getState
  const container = dom.createContainer()
  const caught = []
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const act = async (fn) => { flushSync(fn); for (let i = 0; i < 4; i += 1) await tick() }
  const FINANCIAL = ['monthlyBudget', 'cycleStartDay', 'expenses', 'incomes', 'goals', 'goalContributions', 'emergencyFundSaved', 'emergencyFundContributions']
  const dataOf = () => JSON.stringify(Object.fromEntries(FINANCIAL.map((field) => [field, S()[field]])))

  useAppStore.setState({ today: '2026-10-20' })
  S().addSalary({ amount: 2000, date: '2026-10-01' })
  S().addExpense({ amount: 1234.56, categoryId: 'casa', description: 'affitto', date: '2026-10-02' })
  await act(() => S().setLanguage('it'))
  await act(() => root.render(h(CurrencyCard)))
  const before = dataOf()

  const options = () => nodes(container).filter((n) => n.attributes?.get?.('role') === 'radio')
  const option = (code) => options().find((n) => text(n).endsWith(code))
  const checked = () => options().filter((n) => n.attributes.get('aria-checked') === 'true').map((n) => text(n).slice(-3))
  const dialog = () => nodes(container).find((n) => n.attributes?.get?.('role') === 'alertdialog')
  const button = (name) => nodes(container).find((n) => hasClass(n, name))
  const tap = (node) => act(() => propsOf(node).onClick({}))
  const settingsOp = () => S().sync.outbox.find((op) => op.collection === SETTINGS_KEY)

  // =====================================================================
  section('La card: tre valute, EUR selezionata')
  // =====================================================================
  check('tre opzioni: € Euro EUR, $ Dollaro statunitense USD, £ Sterlina britannica GBP', options().map(text).join(' | ') === '€EuroEUR | $Dollaro statunitenseUSD | £Sterlina britannicaGBP')
  check('EUR selezionata, nessuna conferma aperta', checked().join() === 'EUR' && !dialog() && text(container).includes('Valuta attuale: Euro (€)'))

  // =====================================================================
  section('La conferma viene prima del cambio')
  // =====================================================================
  const opBefore = settingsOp()
  check('prima del tocco c\'è già l\'operazione del budget (EUR): il confronto sotto non è a vuoto', opBefore?.row.currency === 'EUR')
  await tap(option('USD'))
  check('tocco su USD: si apre la conferma, la valuta resta EUR', Boolean(dialog()) && S().currency === 'EUR' && checked().join() === 'EUR' && settingsOp() === opBefore)
  check('   la conferma spiega: niente conversione, numeri invariati, tutto l\'account', text(dialog()).startsWith('Passare a USD ($)?')
    && text(dialog()).includes('non vengono convertiti') && text(dialog()).includes('i numeri restano gli stessi') && text(dialog()).includes('tutto l’account'))
  await tap(button('currency-card__confirm-no'))
  check('"Annulla": conferma chiusa, ancora EUR, nessuna operazione', !dialog() && S().currency === 'EUR' && settingsOp() === opBefore)
  await tap(option('EUR'))
  check('tocco sulla valuta già attiva: nessuna conferma', !dialog())
  await tap(option('USD'))
  await tap(button('currency-card__confirm-yes'))
  check('"Conferma": ora USD, selezionata nella card', S().currency === 'USD' && checked().join() === 'USD' && !dialog())
  check('   salvata con le impostazioni (sync per chi ha un account)', settingsOp()?.row.currency === 'USD')
  check('   "Valuta attuale: Dollaro statunitense ($)", e nessuna nota "per ora restano in euro" (gli importi seguono subito la valuta)', text(container).includes('Valuta attuale: Dollaro statunitense ($)')
    && !text(container).includes('prossimo aggiornamento') && !text(container).includes('in euro'))
  check('nessun importo toccato (stipendio 2000, spesa 1234.56)', dataOf() === before && S().incomes[0].amount === 2000 && S().expenses[0].amount === 1234.56)

  // =====================================================================
  section('Le quattro lingue')
  // =====================================================================
  const keysOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))
  const it = keysOf(MESSAGES.it.settings.currency)
  check(`stesse chiavi in IT, EN, ES, FR (${it.length})`, LANGS.every((lang) => JSON.stringify(keysOf(MESSAGES[lang].settings.currency)) === JSON.stringify(it)))
  check('   stessi segnaposto in ogni lingua', it.every((key) => new Set(LANGS.map((lang) => JSON.stringify([...translate(lang, `settings.currency.${key}`).matchAll(/\{(\w+)\}/g)].map((m) => m[1])))).size === 1))
  check('   nessun testo vuoto, e diverso dall\'italiano fuori da "Euro"', LANGS.every((lang) => it.every((key) => translate(lang, `settings.currency.${key}`).trim().length > 0))
    && ['en', 'es', 'fr'].every((lang) => it.filter((key) => key !== 'names.eur').every((key) => translate(lang, `settings.currency.${key}`) !== translate('it', `settings.currency.${key}`))))
  const EXPECTED = {
    en: ['Currency', 'Switch to GBP (£)?', 'won’t be converted'],
    es: ['Moneda', '¿Cambiar a GBP (£)?', 'no se convierten'],
    fr: ['Devise', 'Passer à GBP (£)\u00a0?', 'ne sont pas convertis'],
    it: ['Valuta', 'Passare a GBP (£)?', 'non vengono convertiti'],
  }
  for (const lang of ['en', 'es', 'fr', 'it']) {
    await act(() => S().setLanguage(lang))
    const [title, question, noConversion] = EXPECTED[lang]
    await tap(option('GBP'))
    check(`${lang}: "${title}", conferma "${question}" … "${noConversion}"`, text(container).startsWith(title) && text(dialog()).startsWith(question) && text(dialog()).includes(noConversion), text(dialog()))
    await tap(button('currency-card__confirm-no'))
    check(`   ${lang}: annullata, resta USD (la lingua non cambia la valuta)`, S().currency === 'USD' && !dialog())
  }
  check('nessun importo toccato da tutti i tocchi', dataOf() === before)
  check('nessun errore di rendering', caught.length === 0, caught[0]?.message)
  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Impostazioni → Valuta (Fase 3B + 3C)')
