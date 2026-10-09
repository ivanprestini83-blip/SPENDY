// Termini, Privacy Policy e accettazione alla registrazione. `npm test`.
// Nessuna rete, nessun account reale: il client Supabase è finto.
//
//   - regole pure (legal.js): due scelte distinte, mai implicite;
//   - spendySync.signUp vero: senza accettazione non parte nessuna chiamata,
//     con accettazione le versioni viaggiano nei metadati della registrazione;
//   - SyncCard vera (con il banco di prova di syncCard.test): caselle non
//     preselezionate, "Crea un account" bloccato finché non sono spuntate;
//   - migration SQL: tabella, trigger, permessi, nessuna operazione distruttiva;
//   - pagine pubbliche e link.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { check, section, report, ITALIAN_USE_LANGUAGE_FAKE, isUseLanguageImport } from '../sync/testkit.mjs'
import { LEGAL_DOCUMENTS, LEGAL_MESSAGES, canSignUp, buildSignUpMetadata } from './legal.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const readText = (path) => readFileSync(join(ROOT, path), 'utf8')
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// =====================================================================
section('Regole: due scelte distinte, esplicite')
// =====================================================================
{
  check('nessuna scelta → no', canSignUp({}) === false && canSignUp(null) === false && canSignUp(undefined) === false)
  check('solo Termini → no', canSignUp({ termsAccepted: true, privacyAcknowledged: false }) === false)
  check('solo Privacy → no', canSignUp({ termsAccepted: false, privacyAcknowledged: true }) === false)
  check('valori "quasi veri" → no', canSignUp({ termsAccepted: 'true', privacyAcknowledged: 1 }) === false)
  check('entrambe → sì', canSignUp({ termsAccepted: true, privacyAcknowledged: true }) === true)

  const now = new Date('2026-10-05T09:30:00.000Z')
  check('metadati assenti senza accettazione', buildSignUpMetadata({ termsAccepted: true }, now) === null)
  const meta = buildSignUpMetadata({ termsAccepted: true, privacyAcknowledged: true }, now)
  check('metadati: versioni dei due documenti', meta?.terms_version === LEGAL_DOCUMENTS.terms.version && meta?.privacy_version === LEGAL_DOCUMENTS.privacy.version)
  check('   con data e ora (ISO)', meta?.terms_accepted_at === '2026-10-05T09:30:00.000Z' && meta?.privacy_acknowledged_at === '2026-10-05T09:30:00.000Z')
  check('   nient\'altro (nessun dato personale)', JSON.stringify(Object.keys(meta).sort()) === JSON.stringify(['privacy_acknowledged_at', 'privacy_version', 'terms_accepted_at', 'terms_version']))
}

// =====================================================================
// spendySync vero, client Supabase finto
// =====================================================================
const SYNC_STUBS = {
  '../lib/supabase.js': `
    export const isSupabaseConfigured = true
    export const supabase = globalThis.__legal.supabase`,
  './supabaseRemote.js': 'export const createSupabaseRemote = () => ({})',
  './syncEngine.js': 'export const createSyncEngine = () => ({ start: () => ({}), stop: () => {}, syncNow: async () => ({}) })',
}

// SyncCard vera con hook minimi (stesso banco di prova di syncCard.test).
const CARD_FAKES = {
  react: `
    export const useState = (initial) => globalThis.__legalCard.useState(initial)
    export const useEffect = (effect) => globalThis.__legalCard.useEffect(effect)`,
  '../../store/useAppStore.js': 'export const useAppStore = (selector) => selector(globalThis.__legalCard.store)',
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
    export const signIn = async (...args) => { globalThis.__legalCard.signInCalls.push(args); return null }
    export const signUp = async (...args) => { globalThis.__legalCard.signUpCalls.push(args); return null }
    export const signOut = async () => null
    export const syncNow = async () => ({})`,
  './SyncCard.css': 'export default {}',
}

const harness = {
  name: 'legal-harness',
  enforce: 'pre',
  resolveId(source, importer) {
    const from = importer?.split('?')[0] ?? ''
    if (from.endsWith('/src/sync/spendySync.js') && source in SYNC_STUBS) return `\0legal-sync:${source}`
    if (source === '/__legal-fake/react') return '\0legal-card:react'
    // La card e i suoi pezzi parlano italiano (dizionari veri).
    if (isUseLanguageImport(source, from)) return '\0legal-card:useLanguage'
    if (from.endsWith('SyncCard.jsx') && source in CARD_FAKES) return `\0legal-card:${source}`
    return null
  },
  load(id) {
    if (id.startsWith('\0legal-sync:')) return SYNC_STUBS[id.slice('\0legal-sync:'.length)]
    if (id === '\0legal-card:useLanguage') return ITALIAN_USE_LANGUAGE_FAKE
    if (id.startsWith('\0legal-card:')) return CARD_FAKES[id.slice('\0legal-card:'.length)]
    return null
  },
  transform(code, id) {
    if (!id.split('?')[0].endsWith('SyncCard.jsx')) return null
    return code.replace("from 'react'", "from '/__legal-fake/react'")
  },
}

const server = await createServer({
  root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-legal-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [harness, react()],
})

try {
  // =====================================================================
  section('1–4. spendySync.signUp: niente registrazione senza accettazione')
  // =====================================================================
  {
    const calls = []
    globalThis.__legal = {
      supabase: {
        auth: {
          signUp: async (args) => { calls.push(args); return { error: null } },
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
      },
    }
    const sync = await server.ssrLoadModule('/src/sync/spendySync.js')

    check('senza accettazione: rifiutata', await sync.signUp('a@esempio.invalid', 'password1') === LEGAL_MESSAGES.acceptanceRequired)
    check('solo Termini accettati: rifiutata', await sync.signUp('a@esempio.invalid', 'password1', { termsAccepted: true, privacyAcknowledged: false }) === LEGAL_MESSAGES.acceptanceRequired)
    check('solo Privacy presa visione: rifiutata', await sync.signUp('a@esempio.invalid', 'password1', { termsAccepted: false, privacyAcknowledged: true }) === LEGAL_MESSAGES.acceptanceRequired)
    check('   in nessuno di questi casi parte una chiamata a Supabase', calls.length === 0)

    const before = Date.now()
    const ok = await sync.signUp('a@esempio.invalid', 'password1', { termsAccepted: true, privacyAcknowledged: true })
    check('Termini accettati + Privacy presa visione: registrazione consentita', ok === null && calls.length === 1)
    const data = calls[0]?.options?.data ?? {}
    check('   email e password passate così come sono', calls[0]?.email === 'a@esempio.invalid' && calls[0]?.password === 'password1')
    check('   versioni salvate nei metadati della registrazione',
      data.terms_version === LEGAL_DOCUMENTS.terms.version && data.privacy_version === LEGAL_DOCUMENTS.privacy.version)
    const at = Date.parse(data.terms_accepted_at)
    check('   con data e ora di adesso', Number.isFinite(at) && at >= before - 1000 && at <= Date.now() + 1000 && data.privacy_acknowledged_at === data.terms_accepted_at)
  }

  // =====================================================================
  section('Modulo di registrazione (SyncCard vera)')
  // =====================================================================
  {
    const slots = []
    let cursor = 0
    let effects = []
    const runtime = {
      store: { sync: { status: 'idle', error: null, lastSyncAt: null, outbox: [] } },
      signUpCalls: [],
      signInCalls: [],
      useState(initial) {
        const index = cursor++
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
        return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
      },
      useEffect(effect) { effects.push(effect) },
    }
    globalThis.__legalCard = runtime
    const { SyncCard } = await server.ssrLoadModule('/src/components/settings/SyncCard.jsx')
    // Le caselle stanno in LegalConsentFields (senza hook): la si espande
    // nell'albero per verificare quello che l'utente vede davvero.
    const expand = (node) => {
      if (Array.isArray(node)) return node.map(expand)
      if (!node || typeof node !== 'object' || !node.props) return node
      if (typeof node.type === 'function' && node.type.name === 'LegalConsentFields') return expand(node.type(node.props))
      return { ...node, props: { ...node.props, children: expand(node.props.children) } }
    }
    const render = () => { cursor = 0; effects = []; return expand(SyncCard()) }

    const walk = (node, visit) => {
      if (Array.isArray(node)) return node.forEach((child) => walk(child, visit))
      if (node && typeof node === 'object' && node.props) { visit(node); walk(node.props.children, visit) }
      return undefined
    }
    const textOf = (node) => {
      if (Array.isArray(node)) return node.map(textOf).join('')
      if (node && typeof node === 'object' && node.props) return textOf(node.props.children)
      return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
    }
    const findAll = (tree, predicate) => { const found = []; walk(tree, (n) => { if (predicate(n)) found.push(n) }); return found }
    const button = (tree, label) => findAll(tree, (n) => n.type === 'button' && textOf(n).includes(label))[0]
    const boxes = (tree) => findAll(tree, (n) => n.type === 'input' && n.props.type === 'checkbox')
    const labelOf = (tree, box) => findAll(tree, (n) => n.type === 'label' && findAll(n.props.children, (c) => c === box).length > 0)[0]

    render()
    effects.forEach((effect) => effect())
    await tick()
    let tree = render()
    const inputs = findAll(tree, (n) => n.type === 'input' && (n.props.type === 'email' || n.props.type === 'password'))
    inputs.find((n) => n.props.type === 'email').props.onChange({ target: { value: 'nuovo@esempio.invalid' } })
    inputs.find((n) => n.props.type === 'password').props.onChange({ target: { value: 'password1' } })
    tree = render()

    const [termsBox, privacyBox] = boxes(tree)
    check('due caselle distinte', boxes(tree).length === 2)
    check('   nessuna preselezionata', termsBox?.props.checked === false && privacyBox?.props.checked === false)
    check('   testo dei Termini', textOf(labelOf(tree, termsBox)).includes('Ho letto e accetto i Termini di utilizzo'))
    check('   testo della Privacy Policy', textOf(labelOf(tree, privacyBox)).includes('Ho preso visione della Privacy Policy'))
    const links = findAll(tree, (n) => n.type === 'a')
    check('12. link cliccabili alle pagine corrette, in una nuova scheda',
      links.some((a) => a.props.href === '/termini.html' && textOf(a) === 'Termini di utilizzo' && a.props.target === '_blank')
      && links.some((a) => a.props.href === '/privacy.html' && textOf(a) === 'Privacy Policy' && a.props.target === '_blank'))

    check('senza spunte: "Crea un account" disabilitato', button(tree, 'Crea un account')?.props.disabled === true)
    check('   "Accedi" invece resta disponibile (il login non richiede di riaccettare)', button(tree, 'Accedi')?.props.disabled === false)
    termsBox.props.onChange({ target: { checked: true } })
    tree = render()
    check('solo Termini spuntati: ancora disabilitato', button(tree, 'Crea un account')?.props.disabled === true)
    boxes(tree)[1].props.onChange({ target: { checked: true } })
    tree = render()
    check('entrambe spuntate: abilitato', button(tree, 'Crea un account')?.props.disabled === false)
    await button(tree, 'Crea un account').props.onClick()
    check('   e la registrazione riceve le due scelte', runtime.signUpCalls.length === 1
      && runtime.signUpCalls[0][2]?.termsAccepted === true && runtime.signUpCalls[0][2]?.privacyAcknowledged === true)

    tree = render()
    await button(tree, 'Accedi').props.onClick()
    check('login: nessuna accettazione chiesta né inviata', runtime.signInCalls.length === 1 && runtime.signInCalls[0].length === 2)
  }
} finally {
  await server.close()
  delete globalThis.__legal
  delete globalThis.__legalCard
}

// =====================================================================
section('4. Migration: versioni e date registrate lato server')
// =====================================================================
{
  const sql = readText('supabase/privacy_consent.sql')
  const table = /create table if not exists public\.legal_acceptances\s*\(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? ''
  check('tabella legal_acceptances', table.length > 0)
  check('   una riga per utente, eliminata con l\'account (ON DELETE CASCADE)', /user_id\s+uuid\s+primary key references auth\.users\(id\) on delete cascade/.test(table))
  check('   versioni e date (orario del server)', /terms_version\s+text\s+not null/.test(table) && /terms_accepted_at\s+timestamptz\s+not null default now\(\)/.test(table)
    && /privacy_version\s+text\s+not null/.test(table) && /privacy_acknowledged_at\s+timestamptz\s+not null default now\(\)/.test(table))
  check('RLS attiva, lettura solo della propria riga', /alter table public\.legal_acceptances enable row level security/.test(sql) && /for select to authenticated using \(auth\.uid\(\) = user_id\)/.test(sql))
  check('nessuna scrittura dal client', /revoke insert, update, delete, truncate on public\.legal_acceptances from anon, authenticated/.test(sql) && !/create policy[^;]*legal_acceptances[^;]*for (insert|update|delete|all)/i.test(sql))
  check('trigger alla creazione dell\'utente', /after insert on auth\.users/.test(sql) && /execute function public\.spendy_record_legal_acceptance\(\)/.test(sql))
  check('   security definer con search_path vuoto, non eseguibile dai client', /security definer\s+set search_path = ''/.test(sql) && /revoke all on function public\.spendy_record_legal_acceptance\(\) from public, anon, authenticated/.test(sql))
  check('   le date principali NON vengono dal client', !/terms_accepted_at,\s*privacy_version,\s*privacy_acknowledged_at\)/.test(sql) && /client_terms_accepted_at, client_privacy_acknowledged_at/.test(sql))
  check('   senza metadati, o con versioni vuote/null, non scrive e non blocca la creazione dell\'utente',
    /nullif\(btrim\(coalesce\(new\.raw_user_meta_data ->> 'terms_version', ''\)\), ''\) is not null/.test(sql)
    && /nullif\(btrim\(coalesce\(new\.raw_user_meta_data ->> 'privacy_version', ''\)\), ''\) is not null/.test(sql)
    && !/raise exception/i.test(sql))
  check('account esistenti: nessuna accettazione inserita d\'ufficio', !/insert into public\.legal_acceptances[\s\S]*?select[\s\S]*?from auth\.users/i.test(sql) && (sql.match(/insert into public\.legal_acceptances/g) ?? []).length === 1)
  check('   un errore imprevisto nel trigger non blocca la registrazione', /exception when others then\s+raise warning[^;]*;\s+return new;/.test(sql))
  check('profiles.spendy_ai_enabled: aggiunta, default false', /alter table public\.profiles add column if not exists spendy_ai_enabled boolean not null default false/.test(sql))
  check('nessuna operazione distruttiva', !/\b(drop table|drop column|truncate table|delete from|update public\.)/i.test(sql.replace(/--.*$/gm, '')))
}

// =====================================================================
section('12–13. Pagine pubbliche e link')
// =====================================================================
{
  const pages = { privacy: 'public/privacy.html', terms: 'public/termini.html', deletion: 'public/elimina-account.html' }
  check('i link dell\'app puntano a file esistenti in public/',
    existsSync(join(ROOT, 'public', LEGAL_DOCUMENTS.privacy.url)) && existsSync(join(ROOT, 'public', LEGAL_DOCUMENTS.terms.url)))
  for (const [name, path] of Object.entries(pages)) {
    const html = readText(path)
    check(`${name}: presente, con titolo e viewport`, /<title>[^<]+<\/title>/.test(html) && /name="viewport"/.test(html))
    check(`   nessun segnaposto rimasto, nessun testo nascosto`, !html.includes('DA COMPLETARE') && !html.includes('class="todo"') && !/display:\s*none/.test(html))
    check(`   versione ${LEGAL_DOCUMENTS.privacy.version} indicata`, html.includes(LEGAL_DOCUMENTS.privacy.version))
    check(`   collega le altre pagine`, Object.values(pages).filter((p) => p !== path).every((p) => html.includes(`href="/${p.slice('public/'.length)}"`)))
  }
  const privacy = readText(pages.privacy)
  const terms = readText(pages.terms)
  check('privacy: versione tecnica uguale a quella registrata', privacy.includes(LEGAL_DOCUMENTS.privacy.version))
  check('termini: versione tecnica uguale a quella registrata', terms.includes(LEGAL_DOCUMENTS.terms.version))
  for (const [name, html] of [['privacy', privacy], ['termini', terms]]) {
    check(`${name}: Versione e Ultimo aggiornamento compilati`, html.includes(`<p>Versione: ${LEGAL_DOCUMENTS.privacy.version}</p>`) && html.includes('<p>Ultimo aggiornamento: 6 ottobre 2026</p>'))
  }
  check('privacy e termini: stessa versione registrata alla registrazione', LEGAL_DOCUMENTS.privacy.version === '2026-10-06' && LEGAL_DOCUMENTS.terms.version === '2026-10-06')
  check('termini: niente consulenza finanziaria, anche per le frasi AI', /non costituiscono consulenza finanziaria/.test(terms) && /Spendy AI/.test(terms))
  check('SyncCard.jsx: le caselle vengono da LegalConsentFields, nessun indirizzo scritto a mano',
    readText('src/components/settings/SyncCard.jsx').includes('<LegalConsentFields') && !/href="\/(privacy|termini)/.test(readText('src/components/settings/SyncCard.jsx')))
  for (const file of ['src/components/settings/LegalConsentFields.jsx', 'src/components/settings/PrivacyCard.jsx', 'src/components/settings/SpendyAICard.jsx']) {
    const source = readText(file)
    check(`${file.split('/').pop()}: link presi da LEGAL_DOCUMENTS, nessun indirizzo scritto a mano`,
      source.includes('LEGAL_DOCUMENTS') && !/href="\/(privacy|termini)/.test(source))
  }
  const viteConfig = readText('vite.config.js')
  check('Vite copia public/ nel build (publicDir non disattivato)', !/publicDir\s*:\s*false/.test(viteConfig))
  const dist = join(ROOT, 'dist')
  const fresh = existsSync(join(dist, 'index.html')) && statSync(join(dist, 'index.html')).mtimeMs >= statSync(join(ROOT, pages.privacy)).mtimeMs
  if (fresh) {
    check('build: le tre pagine sono nel build', ['privacy.html', 'termini.html', 'elimina-account.html'].every((f) => existsSync(join(dist, f))))
  } else {
    check('build non ancora rifatto dopo le pagine: controllo su dist rinviato a `npm run build`', true)
  }
}

report('Termini, Privacy e registrazione')
