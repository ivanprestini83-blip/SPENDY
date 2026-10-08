// Fase 4B-2 del multilingue: Obiettivi, Fondo emergenza, Aggiungi spesa /
// guadagno ed Entrate in it / en / es / fr. `npm test`, senza rete.
//
// Monta l'App VERA (Vite, CSS escluso) sullo store vero e un DOM minimo, apre
// le schermate come farebbe la barra in basso, cambia lingua SENZA rimontare e
// guarda il testo che l'utente vedrebbe. Usa anche i flussi veri (crea
// obiettivo, versa, crea categoria, aggiungi spesa/entrata) per verificare che
// i dati salvati siano gli stessi in ogni lingua. Importi e date restano
// formattati come prima (fase date/numeri a parte).

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { check, section, report } from '../sync/testkit.mjs'
import { installFakeDom } from '../store/fakeDom.mjs'
import { MESSAGES, translate } from './translate.js'
import { EMOJI_GROUPS } from '../data/emojiPicker.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const code = (path) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const LANGS = ['it', 'en', 'es', 'fr']
const keysOf = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))
const lookup = (dictionary, key) => key.split('.').reduce((node, part) => node?.[part], dictionary)
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()

const AREAS = ['goalspage', 'emergency', 'quickadd', 'incomes']
const NEW_KEYS = keysOf(MESSAGES.it).filter((key) => AREAS.includes(key.split('.')[0]))
// Chiavi già esistenti riusate in questa fase.
const REUSED = ['common.close', 'common.back', 'common.confirm', 'common.save', 'common.cancel', 'common.edit', 'common.delete', 'home.nav.goals', 'home.emergency',
  'expenses.edit.amount', 'expenses.edit.date', 'expenses.edit.save', 'expenses.edit.confirm', 'categories.stipendio']
const SCREEN_KEYS = [...NEW_KEYS, ...REUSED]
const FILES = [
  'src/pages/GoalsPage.jsx', 'src/components/goals/GoalsSection.jsx', 'src/components/goals/EmergencyFundScreen.jsx',
  'src/components/modals/NewGoalModal.jsx', 'src/components/modals/ContributeToGoalModal.jsx', 'src/components/modals/AddTransactionTypeModal.jsx',
  'src/components/modals/QuickAddScreen.jsx', 'src/pages/IncomesPage.jsx', 'src/components/modals/EditIncomeModal.jsx',
]

// =====================================================================
section('1. Dizionari: nessuna chiave mancante, stessi segnaposto')
// =====================================================================
check(`chiavi nuove: ${NEW_KEYS.length} (${AREAS.map((a) => `${a} ${NEW_KEYS.filter((k) => k.startsWith(`${a}.`)).length}`).join(', ')})`, NEW_KEYS.length === 60)
for (const lang of LANGS) {
  const missing = SCREEN_KEYS.filter((key) => typeof lookup(MESSAGES[lang], key) !== 'string' || !lookup(MESSAGES[lang], key).trim())
  check(`${lang}: tutte presenti e non vuote (anche quelle riusate)`, missing.length === 0, missing.join(', '))
}
{
  const mismatched = NEW_KEYS.filter((key) => LANGS.some((lang) => placeholders(lookup(MESSAGES[lang], key)) !== placeholders(lookup(MESSAGES.it, key))))
  check('stessi segnaposto in ogni lingua', mismatched.length === 0, mismatched.join(', '))
  const used = new Set(FILES.flatMap((path) => [...code(path).matchAll(/'((?:goalspage|emergency|quickadd|incomes|common|home|expenses)\.[a-z.]+)'/g)].map((m) => m[1])))
  for (const group of EMOJI_GROUPS) used.add(`quickadd.emoji.${group.id}`)
  const orphans = NEW_KEYS.filter((key) => !used.has(key))
  const unknown = [...used].filter((key) => typeof lookup(MESSAGES.it, key) !== 'string')
  check('ogni chiave nuova è usata dai componenti', orphans.length === 0, orphans.join(', '))
  check('ogni chiave usata esiste', unknown.length === 0, unknown.join(', '))
  check('gruppi icone: una chiave per ogni gruppo, separata dai nomi delle categorie', EMOJI_GROUPS.every((g) => typeof lookup(MESSAGES.it, `quickadd.emoji.${g.id}`) === 'string')
    && translate('en', 'quickadd.emoji.casa') === 'Home' && translate('en', 'categories.casa') === 'Housing')
}

// =====================================================================
section('2. Nessun testo italiano fisso rimasto nell\'area 4B-2')
// =====================================================================
for (const path of FILES) {
  const source = code(path)
  const jsxText = [...source.matchAll(/>([^<>{}]*)</g)].map((m) => m[1].trim()).filter((t) => /[A-Za-zÀ-ÿ]{3,}/.test(t) && !/[=;()&|]/.test(t))
  const attrs = [...source.matchAll(/(?:aria-label|title|placeholder|alt|label)="([^"]*[A-Za-zÀ-ÿ][^"]*)"/g)].map((m) => m[1])
  const asText = (p) => [`'${p}`, `"${p}`, `\`${p}`, `>${p}`, `> ${p}`, `} ${p}`].some((needle) => source.includes(needle))
  const fragments = NEW_KEYS.flatMap((key) => lookup(MESSAGES.it, key).split(/\{\w+\}/).map((p) => p.trim())).filter((p) => p.length >= 7 && asText(p))
  check(`${path.split('/').pop()}: nessun testo fisso`, jsxText.length === 0 && attrs.length === 0 && fragments.length === 0, [...jsxText, ...attrs, ...fragments].join(' | '))
}
check('logica invariata: lo store, i calcoli e le categorie non usano le chiavi della 4B-2', ['src/store/useAppStore.js', 'src/utils/budgetCalculations.js', 'src/utils/salary.js', 'src/data/categories.js'].every((p) => !/'(goalspage|quickadd|incomes|emergency)\./.test(read(p))))
check('italiano identico a prima (esempi)', translate('it', 'emergency.coach.started', { min: 10, max: 20 }) === 'Ottimo inizio. Provaci a metterne via il 10-20% del guadagno ogni mese, PRIMA di spendere il resto — non dopo.'
  && translate('it', 'incomes.empty', { income: 'Guadagno', salary: 'Stipendio' }) === 'Nessuna entrata registrata. Lo stipendio di ogni ciclo si inserisce da "+" → Guadagno → Stipendio.'
  && translate('it', 'goalspage.contribute.progress', { saved: '10,00 €', target: '20,00 €' }) === 'Hai risparmiato 10,00 € su 20,00 €.')

// =====================================================================
section('3. L\'app vera')
// =====================================================================
const dom = installFakeDom(new Map())
// Il DOM minimo non conosce <select> (usato nei dettagli di Aggiungi): il minimo che React usa.
{
  const createElement = dom.document.createElement.bind(dom.document)
  const descendants = (node) => node.childNodes.flatMap((child) => [child, ...descendants(child)])
  dom.document.createElement = (tag, ...rest) => {
    const element = createElement(tag, ...rest)
    if (tag === 'select') {
      element.multiple = false
      Object.defineProperty(element, 'options', { get: () => descendants(element).filter((n) => n.localName === 'option') })
      Object.defineProperty(element, 'value', {
        get: () => (element.options.find((o) => o.selected) ?? element.options[0])?.value ?? '',
        set: (value) => { for (const option of element.options) option.selected = option.value === String(value) },
      })
    }
    if (tag === 'option') {
      element.selected = false
      element.defaultSelected = false
      Object.defineProperty(element, 'value', { get: () => element.getAttribute('value') ?? '', set: (value) => element.setAttribute('value', value) })
    }
    return element
  }
}
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-i18n-goals-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    { name: 'css-stub', enforce: 'pre', load: (id) => (id.split('?')[0].endsWith('.css') ? 'export default {}' : null) },
    reactPlugin(),
  ],
})
const nodes = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) nodes(child, out); return out }
const text = (node) => (typeof node?.data === 'string' ? node.data : (node?.childNodes ?? []).map(text).join(''))
const cls = (node) => node.attributes?.get?.('class') ?? ''
const byClass = (root, name) => nodes(root).filter((n) => cls(n).split(' ').includes(name))
const one = (root, name) => byClass(root, name)[0]
const attr = (node, name) => node?.attributes?.get?.(name) ?? ''
const propsOf = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))]
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const act = async (fn) => { flushSync(fn); for (let i = 0; i < 5; i += 1) await tick() }
const leftover = (screenText, lang) => {
  const own = SCREEN_KEYS.map((key) => lookup(MESSAGES[lang], key)).join('\n')
  return [...new Set(SCREEN_KEYS.flatMap((key) => lookup(MESSAGES.it, key).split(/\{\w+\}/).map((p) => p.trim()))
    .filter((p) => p.length >= 6 && !own.includes(p) && screenText.includes(p)))]
}

try {
  const { useAppStore } = await server.ssrLoadModule('/src/store/useAppStore.js')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { formatCurrency } = await server.ssrLoadModule('/src/utils/format.js')
  const S = useAppStore.getState
  const caught = []
  const container = dom.createContainer()
  const root = createRoot(container, { onCaughtError: (e) => caught.push(e), onUncaughtError: (e) => caught.push(e), onRecoverableError: () => {} })
  const html = () => dom.toHtml(container)
  const typeInto = async (input, value) => act(() => propsOf(input).onChange({ target: { value } }))

  S().switchScope('u:utente-fase-4b2')
  await act(() => root.render(h(App)))
  const today = S().today

  // =====================================================================
  section('4. Obiettivi: pagina, nuovo obiettivo, versamento')
  // =====================================================================
  await act(() => S().addGoal({ emoji: '✈️', label: 'Lisbona', target: 1000, etaMonths: 6 }))
  await act(() => S().setActiveTab('goals'))
  for (const lang of [...LANGS, 'it']) {
    await act(() => S().setLanguage(lang))
    check(`${lang}: titolo "🎯 ${translate(lang, 'goalspage.title')}" e "${translate(lang, 'goalspage.new')}"`, text(one(container, 'goals-section__title')) === `🎯 ${translate(lang, 'goalspage.title')}`
      && text(one(container, 'goals-section__new')).trim() === translate(lang, 'goalspage.new') && text(container).includes('Lisbona'))
  }
  // Nuovo obiettivo: testi della modale e creazione vera (in inglese).
  const goalsBefore = S().goals.length
  for (const lang of LANGS) {
    await act(() => { S().setLanguage(lang); S().openModal('newGoal') })
    const tr = (key) => translate(lang, key)
    const labels = byClass(container, 'form-field__label').map(text).join('|')
    const nameInput = nodes(one(container, 'modal-sheet')).find((n) => n.localName === 'input')
    check(`${lang}: modale "${tr('goalspage.modal.title')}" — campi, segnaposto, pulsante, Chiudi`, text(one(container, 'modal-sheet__title')) === tr('goalspage.modal.title')
      && labels === ['name', 'target', 'date', 'saved'].map((k) => tr(`goalspage.modal.${k}`)).join('|')
      && attr(nameInput, 'placeholder') === tr('goalspage.modal.nameplaceholder') && attr(one(container, 'modal-sheet__close'), 'aria-label') === tr('common.close')
      && text(one(container, 'modal-form__submit')).trim() === tr('goalspage.modal.create'))
    if (lang === 'en') {
      const inputs = nodes(one(container, 'modal-sheet')).filter((n) => n.localName === 'input')
      await typeInto(inputs[0], 'Bici')
      await typeInto(inputs[1], '500')
      await typeInto(inputs[3], '50')
      await act(() => propsOf(one(container, 'modal-form__submit')).onClick({}))
    } else {
      await act(() => S().closeModal())
    }
  }
  const bici = S().goals.find((g) => g.label === 'Bici')
  check('obiettivo creato dalla modale in inglese: stessi dati di sempre (nome, importi, eta 6, emoji)', S().goals.length === goalsBefore + 1 && bici?.target === 500 && bici.saved === 50 && bici.etaMonths === 6 && bici.emoji === '🎯')
  // Versamento: testo con importi e invio.
  for (const lang of LANGS) {
    const goal = S().goals.find((g) => g.label === 'Bici')
    await act(() => { S().setLanguage(lang); S().openModal('contributeGoal', goal) })
    const tr = (key, params) => translate(lang, key, params)
    check(`${lang}: versamento — "${tr('goalspage.contribute.progress', { saved: formatCurrency(goal.saved), target: formatCurrency(goal.target) })}"`, text(one(container, 'form-field__label')) === tr('goalspage.contribute.amount')
      && text(one(container, 'modal-form__hint')).trim() === tr('goalspage.contribute.progress', { saved: formatCurrency(goal.saved), target: formatCurrency(goal.target) })
      && text(one(container, 'modal-form__submit')).trim() === tr('goalspage.contribute.submit'))
    if (lang === 'fr') {
      await typeInto(nodes(one(container, 'modal-sheet')).find((n) => n.localName === 'input'), '25')
      await act(() => propsOf(one(container, 'modal-form__submit')).onClick({}))
    } else {
      await act(() => S().closeModal())
    }
  }
  check('versamento fatto in francese: +25 sull\'obiettivo, come sempre', S().goals.find((g) => g.label === 'Bici').saved === 75)

  // =====================================================================
  section('5. Fondo emergenza: frasi di Spendy, obiettivo, versamenti')
  // =====================================================================
  await act(() => useAppStore.setState({ monthlyBudget: 0, emergencyFundSaved: 0, emergencyFundContributions: [] }))
  await act(() => S().openModal('emergencyFund'))
  const message = () => text(one(container, 'spendy-speech__message') ?? one(container, 'emergency-fund-screen__spendy'))
  for (const lang of LANGS) {
    await act(() => S().setLanguage(lang))
    check(`${lang}: senza guadagno → frase "manca il guadagno" e "${translate(lang, 'emergency.nosalary')}"`, message().includes(translate(lang, 'emergency.coach.nosalary'))
      && text(one(container, 'emergency-fund-screen__target')) === translate(lang, 'emergency.nosalary') && text(one(container, 'emergency-fund-screen__title')) === `🚨 ${translate(lang, 'home.emergency')}`)
  }
  const target = 2000 * 6
  const stages = [[0, 'start', { min: 10 }], [1000, 'started', { min: 10, max: 20 }], [6000, 'half', {}], [12000, 'complete', { months: 6 }]]
  for (const [saved, stage, params] of stages) {
    await act(() => useAppStore.setState({ monthlyBudget: 2000, emergencyFundSaved: saved }))
    for (const lang of LANGS) {
      await act(() => S().setLanguage(lang))
      check(`${lang}: ${saved} € → frase "${stage}"`, message().includes(translate(lang, `emergency.coach.${stage}`, params))
        && text(one(container, 'emergency-fund-screen__target')) === translate(lang, 'emergency.target', { amount: formatCurrency(target), months: 6 }))
    }
  }
  await act(() => useAppStore.setState({ emergencyFundSaved: 0 }))
  // Versamento vero, poi storico con Annulla ultimo e le icone Modifica / Elimina / Salva / Annulla.
  const fundInput = () => nodes(one(container, 'emergency-fund-screen__input')).find((n) => n.localName === 'input')
  await typeInto(fundInput(), '120')
  await act(() => propsOf(one(container, 'emergency-fund-screen__cta')).onClick({}))
  check('versamento nel fondo: +120 €, una voce nello storico', S().emergencyFundSaved === 120 && S().emergencyFundContributions.length === 1)
  for (const lang of LANGS) {
    await act(() => S().setLanguage(lang))
    const tr = (key) => translate(lang, key)
    const item = one(container, 'emergency-fund-screen__history-item')
    const arias = nodes(item).filter((n) => n.localName === 'button').map((b) => attr(b, 'aria-label')).join('|')
    await act(() => propsOf(nodes(item).find((n) => n.localName === 'button')).onClick({}))
    const editArias = nodes(one(container, 'emergency-fund-screen__history-edit')).filter((n) => n.localName === 'button').map((b) => attr(b, 'aria-label')).join('|')
    await act(() => propsOf(nodes(one(container, 'emergency-fund-screen__history-edit')).filter((n) => n.localName === 'button')[1]).onClick({}))
    check(`${lang}: "${tr('emergency.addlabel')}", "${tr('emergency.add')}", "${tr('emergency.history')}", "↩️ ${tr('emergency.undo')}", icone`, text(container).includes(tr('emergency.addlabel'))
      && text(one(container, 'emergency-fund-screen__cta')).trim() === tr('emergency.add') && text(one(container, 'emergency-fund-screen__history-head')).includes(tr('emergency.history'))
      && text(one(container, 'emergency-fund-screen__undo')).trim() === `↩️ ${tr('emergency.undo')}`
      && arias === `${tr('common.edit')}|${tr('common.delete')}` && editArias === `${tr('common.save')}|${tr('common.cancel')}`
      && attr(one(container, 'emergency-fund-screen__back'), 'aria-label') === tr('common.close'))
    if (lang !== 'it') check(`   ${lang}: nessun testo italiano rimasto`, leftover(text(container) + html(), lang).length === 0, leftover(text(container) + html(), lang).join(' | '))
  }
  check('nessun dato del fondo cambiato dai cambi di lingua', S().emergencyFundSaved === 120 && S().emergencyFundContributions.length === 1)
  await act(() => S().closeModal())

  // =====================================================================
  section('6. Aggiungi: scelta, spesa, categoria personalizzata, gruppi icone, guadagno')
  // =====================================================================
  for (const lang of LANGS) {
    await act(() => { S().setLanguage(lang); S().openModal('addTransaction') })
    check(`${lang}: "${translate(lang, 'quickadd.choose.title')}" — "${translate(lang, 'quickadd.choose.expense')}" / "${translate(lang, 'quickadd.choose.income')}"`, text(one(container, 'modal-sheet__title')) === translate(lang, 'quickadd.choose.title')
      && byClass(container, 'transaction-type__label').map(text).join('|') === `${translate(lang, 'quickadd.choose.expense')}|${translate(lang, 'quickadd.choose.income')}`)
    await act(() => S().closeModal())
  }
  // Categoria personalizzata creata in spagnolo, poi la scelta e il passaggio importo.
  await act(() => { S().setLanguage('es'); S().openModal('quickAdd', { type: 'expense' }) })
  await act(() => propsOf(one(container, 'quick-add__tile--new')).onClick({}))
  {
    const tr = (key) => translate('es', key)
    const fields = byClass(container, 'quick-add__field')
    const tabs = byClass(container, 'quick-add__emoji-tab')
    check('es: "Nueva categoría", campi, segnaposto, 11 gruppi icone tradotti, "Crear categoría", "Volver"', text(one(container, 'quick-add__title')) === tr('quickadd.title.category')
      && text(fields[0]).startsWith(tr('quickadd.name')) && attr(nodes(fields[0]).find((n) => n.localName === 'input'), 'placeholder') === tr('quickadd.nameplaceholder')
      && text(fields[1]).startsWith(tr('quickadd.icon')) && attr(nodes(fields[1]).find((n) => n.localName === 'input'), 'placeholder') === tr('quickadd.iconplaceholder')
      && tabs.length === EMOJI_GROUPS.length && tabs.every((tab, i) => attr(tab, 'aria-label') === tr(`quickadd.emoji.${EMOJI_GROUPS[i].id}`) && attr(tab, 'title') === tr(`quickadd.emoji.${EMOJI_GROUPS[i].id}`))
      && text(nodes(container).filter((n) => cls(n) === 'quick-add__confirm')[0]).trim() === tr('quickadd.create') && attr(one(container, 'quick-add__back'), 'aria-label') === tr('common.back'))
    await typeInto(nodes(fields[0]).find((n) => n.localName === 'input'), 'Gimnasio')
    await typeInto(nodes(fields[1]).find((n) => n.localName === 'input'), '🏋️')
    await act(() => propsOf(byClass(container, 'quick-add__confirm')[0]).onClick({}))
  }
  const custom = S().customCategories.find((c) => c.label === 'Gimnasio')
  check('categoria personalizzata creata: nome ed emoji come scritti dall\'utente', Boolean(custom) && custom.emoji === '🏋️' && custom.type === 'expense')
  for (const lang of LANGS) {
    await act(() => S().setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    const tiles = byClass(container, 'quick-add__tile-label').map(text)
    check(`${lang}: griglia — categorie predefinite tradotte, "Gimnasio" invariata, aiuto 📌, aria elimina, "${tr('quickadd.addcategory')}"`, text(one(container, 'quick-add__title')) === tr('quickadd.title.expense')
      && tiles.includes('Gimnasio') && tiles.includes(tr('categories.casa')) && tiles.at(-1) === tr('quickadd.addcategory')
      && text(one(container, 'quick-add__grid-hint')).trim() === `📌 ${tr('quickadd.pinhint')}` && attr(one(container, 'quick-add__tile-delete'), 'aria-label') === tr('quickadd.deletecategory', { name: 'Gimnasio' })
      && attr(one(container, 'quick-add__back'), 'aria-label') === tr('common.close'))
  }
  // Scelta della categoria "casa" e passaggio importo.
  await act(() => propsOf(byClass(container, 'quick-add__tile').find((n) => text(n).includes(translate(S().language, 'categories.casa')))).onClick({}))
  for (const lang of LANGS) {
    await act(() => S().setLanguage(lang))
    const tr = (key) => translate(lang, key)
    const toggle = one(container, 'quick-add__details-toggle')
    const shown = text(toggle).trim()
    await act(() => propsOf(toggle).onClick({}))
    const hidden = text(one(container, 'quick-add__details-toggle')).trim()
    const labels = byClass(one(container, 'quick-add__details'), 'quick-add__field').map((f) => text(nodes(f).find((n) => n.localName === 'span'))).join('|')
    await act(() => propsOf(one(container, 'quick-add__details-toggle')).onClick({}))
    check(`${lang}: importo — "${tr('quickadd.prompt.expense')}", "${tr('common.confirm')}", dettagli "${shown}"/"${hidden}", campi`, text(one(container, 'quick-add__prompt')) === tr('quickadd.prompt.expense')
      && byClass(container, 'quick-add__confirm').map((n) => text(n).trim()).includes(tr('common.confirm')) && shown === tr('quickadd.details.show') && hidden === tr('quickadd.details.hide')
      && labels === `${tr('quickadd.note')}|${tr('expenses.edit.date')}|${tr('quickadd.category')}`)
  }
  await act(() => S().setLanguage('en'))
  await typeInto(nodes(one(container, 'quick-add__amount-input')).find((n) => n.localName === 'input'), '42.5')
  await act(() => propsOf(byClass(container, 'quick-add__confirm').find((n) => text(n).trim() === 'Confirm')).onClick({}))
  const added = S().expenses.find((e) => e.amount === 42.5)
  check('spesa aggiunta in inglese: importo, categoria (id), data di oggi', added?.categoryId === 'casa' && added.date === today, JSON.stringify(added))
  // Guadagno.
  for (const lang of LANGS) {
    await act(() => { S().setLanguage(lang); S().openModal('quickAdd', { type: 'income' }) })
    check(`${lang}: "${translate(lang, 'quickadd.title.income')}", categorie di entrata tradotte`, text(one(container, 'quick-add__title')) === translate(lang, 'quickadd.title.income')
      && byClass(container, 'quick-add__tile-label').map(text).includes(translate(lang, 'categories.stipendio')))
    await act(() => propsOf(byClass(container, 'quick-add__tile').find((n) => text(n).includes(translate(lang, 'categories.extra')))).onClick({}))
    check(`   ${lang}: "${translate(lang, 'quickadd.prompt.income')}"`, text(one(container, 'quick-add__prompt')) === translate(lang, 'quickadd.prompt.income'))
    if (lang === 'fr') {
      await typeInto(nodes(one(container, 'quick-add__amount-input')).find((n) => n.localName === 'input'), '80')
      await act(() => propsOf(byClass(container, 'quick-add__confirm').find((n) => text(n).trim() === translate('fr', 'common.confirm'))).onClick({}))
    } else {
      await act(() => S().closeModal())
    }
  }
  const extra = S().incomes.find((i) => i.amount === 80)
  check('guadagno aggiunto in francese: importo e categoria (id) corretti', extra?.categoryId === 'extra' && extra.date === today)

  // =====================================================================
  section('7. Entrate: pagina, stato vuoto, modifica')
  // =====================================================================
  await act(() => { S().closeModal(); useAppStore.setState({ incomes: [] }); S().setActiveTab('incomes') })
  for (const lang of LANGS) {
    await act(() => S().setLanguage(lang))
    const tr = (key, params) => translate(lang, key, params)
    check(`${lang}: stato vuoto con le etichette vere ("${tr('quickadd.choose.income')}" → "${tr('categories.stipendio')}")`, text(one(container, 'expenses-page__empty')).trim() === tr('incomes.empty', { income: tr('quickadd.choose.income'), salary: tr('categories.stipendio') })
      && text(one(container, 'expenses-page__summary-label')) === tr('incomes.title') && text(one(container, 'expenses-page__switch')).includes(tr('incomes.back'))
      && text(one(container, 'expenses-page__add')).trim() === tr('incomes.add'))
  }
  await act(() => S().addIncome({ amount: 300, categoryId: 'regalo', description: 'Compleanno', date: today }))
  for (const lang of LANGS) {
    await act(() => { S().setLanguage(lang); S().openModal('editIncome', S().incomes[0]) })
    const tr = (key) => translate(lang, key)
    const modal = one(container, 'edit-expense')
    const fieldLabels = byClass(modal, 'edit-expense__field').map((f) => text(nodes(f).find((n) => n.localName === 'span'))).join('|')
    const del = () => one(container, 'edit-expense__delete')
    const before = text(del()).trim()
    await act(() => propsOf(del()).onClick({}))
    check(`${lang}: modifica guadagno — "${tr('incomes.edit.title')}", campi, "${tr('expenses.edit.save')}", "${before}" → conferma`, text(one(modal, 'edit-expense__title')) === tr('incomes.edit.title')
      && fieldLabels === `${tr('expenses.edit.amount')}|${tr('expenses.edit.date')}` && text(one(modal, 'edit-expense__save')).trim() === tr('expenses.edit.save')
      && before === tr('incomes.edit.delete') && text(del()).trim() === tr('expenses.edit.confirm') && attr(one(modal, 'edit-expense__back'), 'aria-label') === tr('common.close')
      && text(container).includes('Compleanno') && text(container).includes(tr('categories.regalo')))
    await act(() => propsOf(one(container, 'edit-expense__back')).onClick({}))
  }
  check('nessun guadagno cancellato dal primo tocco su Elimina', S().incomes.length === 1 && S().incomes[0].amount === 300)
  await act(() => S().setLanguage('de'))
  check('lingua non valida → italiano', text(one(container, 'expenses-page__summary-label')) === 'Entrate di questo ciclo')
  check('nessun errore di rendering in tutto il percorso', caught.length === 0, caught[0]?.message)
  await act(() => root.unmount())
} finally {
  await server.close()
}

report('Multilingue — Fase 4B-2 (Obiettivi, Fondo emergenza, Aggiungi, Entrate)')
