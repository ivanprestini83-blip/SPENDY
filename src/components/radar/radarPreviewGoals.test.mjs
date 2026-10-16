// My Radar in Home: tutti gli obiettivi, ognuno con i suoi importi e la sua
// percentuale. `npm test`, senza rete.
//
// Prima la Home mostrava, dentro My Radar, solo la scheda "obiettivo" del
// Radar: il BehaviorEngine (checkGoalProgress) ne sceglie UNO, il più vicino
// al traguardo. Qui si controlla che:
//   - goalsProgress (utils/goalProgress.js) legga saved/target dallo store
//     così come sono, senza NaN, negativi o percentuali oltre 100;
//   - il VERO RadarPreview.jsx (caricato da Vite) li disegni tutti;
//   - il motore del Radar resti com'era (una sola scheda obiettivo).

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, section, report } from '../../sync/testkit.mjs'
import { goalsProgress } from '../../utils/goalProgress.js'
import { goalIcon, iconForGoalLabel, DEFAULT_GOAL_EMOJI } from '../../utils/goalIcon.js'
import { buildRadar, RADAR_STATUS } from '../../utils/radarEngine.js'
import { BEHAVIOR_TYPES } from '../../utils/behaviorEngine.js'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
// La lingua da una variabile del test, con il translate vero (dizionari veri).
const USE_LANGUAGE_FAKE = `
  import { translate } from '/src/i18n/translate.js'
  export const useLanguage = () => {
    const language = globalThis.__radarGoalsTest.language
    return { language, currency: 'EUR', t: (key, params) => translate(language, key, params) }
  }`
const harnessPlugin = {
  name: 'radar-goals-harness',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer?.includes('RadarPreview.jsx') && source === '../../i18n/useLanguage.js') return '\0radar-goals:useLanguage'
    return null
  },
  load(id) {
    return id === '\0radar-goals:useLanguage' ? USE_LANGUAGE_FAKE : null
  },
}
globalThis.__radarGoalsTest = { language: 'it' }

const GOALS = [
  { id: 'g1', emoji: '🏖️', label: 'Vacanze', saved: 500, target: 2000 },
  { id: 'g2', emoji: '🚗', label: 'Nuova auto', saved: 3000, target: 10000 },
  { id: 'g3', emoji: '🛟', label: 'Fondo emergenze', saved: 750, target: 1500 },
]
const NEW_GOAL = { id: 'g4', emoji: '🎸', label: 'Chitarra', saved: 0, target: 800 }
const DONE_GOAL = { id: 'g5', emoji: '💻', label: 'PC', saved: 900, target: 900 }

// =====================================================================
section('1. goalsProgress: i numeri dello store, puliti')
// =====================================================================
check('nessun obiettivo → lista vuota', goalsProgress([]).length === 0 && goalsProgress(undefined).length === 0 && goalsProgress(null).length === 0)
{
  const [one] = goalsProgress([GOALS[0]])
  check('un obiettivo: nome, importi e 25%', goalsProgress([GOALS[0]]).length === 1 && one.label === 'Vacanze' && one.saved === 500 && one.target === 2000 && one.percent === 25 && !one.completed)
}
{
  const rows = goalsProgress(GOALS)
  check('tre obiettivi, nell\'ordine dello store', rows.map((r) => r.id).join() === 'g1,g2,g3')
  check('   percentuali di ciascuno: 25 / 30 / 50', rows.map((r) => r.percent).join() === '25,30,50', rows.map((r) => r.percent).join())
  check('   importi di ciascuno, non scambiati', rows.map((r) => `${r.saved}/${r.target}`).join() === '500/2000,3000/10000,750/1500')
}
{
  const [fresh] = goalsProgress([NEW_GOAL])
  check('obiettivo appena creato: 0%, non completato', fresh.percent === 0 && fresh.saved === 0 && !fresh.completed)
  const [freshNoSaved] = goalsProgress([{ id: 'x', label: 'Senza saved', target: 300 }])
  check('   anche senza il campo saved: 0, non NaN', freshNoSaved.percent === 0 && freshNoSaved.saved === 0)
}
{
  const [done] = goalsProgress([DONE_GOAL])
  check('obiettivo completato: 100% e completed', done.percent === 100 && done.completed)
  const [over] = goalsProgress([{ id: 'o', label: 'Oltre', saved: 1200, target: 1000 }])
  check('   versato più del previsto: resta 100%, non 120%', over.percent === 100 && over.completed)
  const [almost] = goalsProgress([{ id: 'a', label: 'Quasi', saved: 996, target: 1000 }])
  check('   99,6% non finito non diventa "100%"', almost.percent === 99 && !almost.completed)
}
{
  const dirty = goalsProgress([
    { id: 'n', label: 'NaN', saved: Number.NaN, target: 1000 },
    { id: 'z', label: 'Target zero', saved: 50, target: 0 },
    { id: 'm', label: 'Negativo', saved: -40, target: 200 },
    { id: 's', label: 'Stringhe', saved: '100', target: '400' },
    null,
  ])
  check('valori sporchi: mai NaN, mai negativi, sempre fra 0 e 100', dirty.every((r) => Number.isFinite(r.percent) && r.percent >= 0 && r.percent <= 100 && r.saved >= 0 && r.target >= 0))
  check('   NaN → 0%, target 0 → 0% (non completato), negativo → 0%, stringhe numeriche → 25%', dirty.map((r) => `${r.percent}${r.completed ? '!' : ''}`).join() === '0,0,0,25', dirty.map((r) => r.percent).join())
  check('   le voci non valide (null) sono ignorate', dirty.length === 4)
}
{
  const store = [{ ...GOALS[0] }]
  goalsProgress(store)
  check('non tocca gli obiettivi dello store', JSON.stringify(store) === JSON.stringify([GOALS[0]]))
}

// =====================================================================
section('1b. Icona dal nome dell\'obiettivo')
// =====================================================================
{
  const cases = [
    ['Casa', '🏠'], ['Vacanza', '🏖️'], ['Computer', '💻'], ['Vestito', '👗'],
    ['New laptop', '💻'], ['Holiday', '🏖️'], ['Vacaciones', '🏖️'], ['Vêtements', '👗'], ['Ordinateur portable', '💻'],
    ['Nuova auto', '🚗'], ['Fondo emergenze', '🚨'], ['Università', '🎓'], ['Viaggio in Giappone', '✈️'], ['Chitarra', '🎸'],
  ]
  const wrong = cases.filter(([label, icon]) => iconForGoalLabel(label) !== icon)
  check('casa, vacanza, computer, vestito… nelle quattro lingue', wrong.length === 0, wrong.map(([label]) => `${label}→${iconForGoalLabel(label)}`).join(', '))
  check('vince la parola che viene prima: "Casa vacanze" 🏠, "Vacanza a casa di Marta" 🏖️', iconForGoalLabel('Casa vacanze') === '🏠' && iconForGoalLabel('Vacanza a casa di Marta') === '🏖️')
  check('le espressioni vincono sulle parole: "Macchina fotografica" 📷, non 🚗', iconForGoalLabel('Macchina fotografica') === '📷')
  check('niente falsi positivi dentro altre parole ("Carta", "Pcx")', iconForGoalLabel('Carta') === DEFAULT_GOAL_EMOJI && iconForGoalLabel('Pcx') === DEFAULT_GOAL_EMOJI)
  check('nome sconosciuto, vuoto o mancante: 🎯', iconForGoalLabel('Qualcosa') === '🎯' && iconForGoalLabel('') === '🎯' && iconForGoalLabel(undefined) === '🎯')
  check('un\'emoji già scelta (diversa da 🎯) resta quella', goalIcon({ emoji: '✈️', label: 'Casa' }) === '✈️' && goalIcon({ emoji: '🎯', label: 'Casa' }) === '🏠' && goalIcon({ label: 'Casa' }) === '🏠')
}

// =====================================================================
section('2. Il motore del Radar resta com\'era')
// =====================================================================
const TODAY = '2026-10-16'
const radarWith = (goals) => buildRadar({ goals, today: TODAY, monthlyBudget: 2000, rng: () => 0, lang: 'it', currency: 'EUR', config: undefined })
{
  const radar = radarWith([...GOALS, NEW_GOAL, DONE_GOAL])
  const goalCards = radar.cards.filter((card) => card.type === BEHAVIOR_TYPES.GOAL_PROGRESS)
  check('buildRadar produce ancora UNA scheda obiettivo (la più vicina: 50%)', goalCards.length === 1 && goalCards[0].metric.value === '50%', goalCards.map((c) => c.metric.value).join())
}

// =====================================================================
section('3. RadarPreview (componente vero): tutti gli obiettivi')
// =====================================================================
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-radar-goals-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [harnessPlugin, react()],
})
try {
  const { RadarPreview } = await server.ssrLoadModule('/src/components/radar/RadarPreview.jsx')
  const render = (goals, radar = radarWith(goals)) => renderToStaticMarkup(h(RadarPreview, { radar, goals }))
  // L'area degli obiettivi dentro My Radar e le sue righe (una per obiettivo).
  const goalsOf = (html) => html.match(/<div class="radar-preview__goals">[\s\S]*?<\/ul><\/div>/)?.[0] ?? ''
  const itemsOf = (html) => goalsOf(html).match(/<li class="radar-preview__goal[ "][\s\S]*?<\/li>/g) ?? []
  const text = (fragment) => fragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const valueOf = (item) => text(item.match(/<span class="radar-preview__goal-percent">([\s\S]*?)<\/span>/)?.[1] ?? '')
  const nameOf = (item) => text(item.match(/<span class="radar-preview__goal-name">([\s\S]*?)<\/span>/)?.[1] ?? '')
  const iconOf = (item) => text(item.match(/<span class="radar-preview__goal-icon">([\s\S]*?)<\/span>/)?.[1] ?? '')
  const amountsOf = (item) => text(item.match(/<span class="radar-preview__goal-amounts">([\s\S]*?<\/span>[\s\S]*?)<\/span><\/span>/)?.[1] ?? '')
  const titleOf = (html) => text(goalsOf(html).match(/<p class="radar-preview__goals-title">([\s\S]*?)<\/p>/)?.[1] ?? '')
  const { formatCurrency } = await server.ssrLoadModule('/src/utils/format.js')

  {
    const html = render([])
    check('nessun obiettivo: niente area obiettivi, il resto di My Radar c\'è', !html.includes('radar-preview__goals') && html.includes('radar-preview__title'))
  }
  {
    const html = render([GOALS[0]])
    const items = itemsOf(html)
    check('un obiettivo: una riga, nessuna card per obiettivo', items.length === 1 && !html.includes('radar-preview__goals-tile') && !goalsOf(html).includes('radar-preview__tile'))
    check('   titolo "Obiettivo", percentuale, nome e importi', titleOf(html) === 'Obiettivo' && valueOf(items[0]) === '25%' && nameOf(items[0]) === 'Vacanze' && amountsOf(items[0]) === `${formatCurrency(500, 'it', 'EUR')} / ${formatCurrency(2000, 'it', 'EUR')}`, `${titleOf(html)} | ${valueOf(items[0])} | ${nameOf(items[0])} | ${amountsOf(items[0])}`)
    check('   la riga è un pulsante (porta alla scheda Obiettivi)', /<li[^>]*><button type="button" class="radar-preview__goal-row">/.test(items[0]))
  }
  {
    const html = render(GOALS)
    const items = itemsOf(html)
    check('tre obiettivi: tre righe in un\'unica area', items.length === 3 && (html.match(/class="radar-preview__goals"/g) ?? []).length === 1)
    check('   titolo al plurale', titleOf(html) === 'Obiettivi', titleOf(html))
    check('   un\'icona per obiettivo, quella del SUO nome', items.map(iconOf).join(' ') === `${goalIcon(GOALS[0])} ${goalIcon(GOALS[1])} ${goalIcon(GOALS[2])}`, items.map(iconOf).join(' '))
    const named = itemsOf(render([{ id: 'c', emoji: '🎯', label: 'Casa', saved: 0, target: 100 }, { id: 'v', emoji: '🎯', label: 'Vacanza', saved: 0, target: 100 }, { id: 'p', emoji: '🎯', label: 'Computer', saved: 0, target: 100 }])).map(iconOf)
    check('   obiettivi creati dall\'app (🎯): Casa 🏠, Vacanza 🏖️, Computer 💻', named.join(' ') === '🏠 🏖️ 💻', named.join(' '))
    check('   percentuali 25 / 30 / 50, ognuna col SUO nome', items.map((item) => `${valueOf(item)} ${nameOf(item)}`).join(' | ') === '25% Vacanze | 30% Nuova auto | 50% Fondo emergenze', items.map((item) => `${valueOf(item)} ${nameOf(item)}`).join(' | '))
  }
  {
    const html = render([...GOALS, NEW_GOAL, DONE_GOAL])
    const items = itemsOf(html)
    check('cinque obiettivi: cinque righe, tutte visibili, nell\'ordine dello store', items.length === 5 && ['Vacanze', 'Nuova auto', 'Fondo emergenze', 'Chitarra', 'PC'].every((label, i) => nameOf(items[i]) === label))
    const expected = ['25%', '30%', '50%', '0%', '100%']
    check('   ogni obiettivo ha la SUA percentuale', items.every((item, i) => valueOf(item) === expected[i]), items.map(valueOf).join(' | '))
    check('   appena creato: 0%', valueOf(items[3]) === '0%' && !items[3].includes('--done'))
    const amounts = [[500, 2000], [3000, 10000], [750, 1500], [0, 800], [900, 900]]
    const wrongAmounts = amounts.filter(([saved, target], i) => amountsOf(items[i]) !== `${formatCurrency(saved, 'it', 'EUR')} / ${formatCurrency(target, 'it', 'EUR')}`)
    check('   ogni obiettivo mostra i SUOI importi (risparmiato / totale, con i centesimi)', wrongAmounts.length === 0, items.map(amountsOf).join(' | '))
    const bars = items.map((item) => item.match(/<span class="radar-preview__goal-bar" role="progressbar"[^>]*aria-valuenow="(\d+)"[^>]*><span class="radar-preview__goal-bar-fill" style="width:(\d+)%"/)?.slice(1).join('/'))
    check('   ogni obiettivo ha la SUA barra (progressbar accessibile, larghezza = percentuale vera)', bars.join(' ') === '25/25 30/30 50/50 0/0 100/100', bars.join(' '))
    const rings = items.map((item) => item.match(/radar-preview__ring-fill"[^>]*style="stroke-dashoffset:(\d+)"/)?.[1])
    check('   ogni anello è riempito della SUA percentuale (a 0% solo la rotaia, nessun puntino)', rings.join(' ') === '75 70 50  0' && items[3].includes('radar-preview__ring-track'), rings.join(' '))
    check('   accenti a rotazione fra gli obiettivi', ['accent-0', 'accent-1', 'accent-2', 'accent-3', 'accent-0'].every((accent, i) => items[i].includes(`radar-preview__goal--${accent}`)))
    check('   completato: 100% segnato come tale (in verde)', valueOf(items[4]) === '100%' && items[4].includes('radar-preview__goal--done'))
    check('   nessun NaN, nessuna percentuale negativa', !/NaN|-\d+%/.test(text(html)))
  }
  {
    const decimals = itemsOf(render([{ id: 'd', emoji: '🎯', label: 'Deposito per la nuova casa a Milano', saved: 3333.33, target: 12345.67 }]))[0]
    check('importi decimali mostrati così come sono salvati (3.333,33 / 12.345,67) e 27%', amountsOf(decimals) === `${formatCurrency(3333.33, 'it', 'EUR')} / ${formatCurrency(12345.67, 'it', 'EUR')}` && valueOf(decimals) === '27%')
    check('   nome lungo: intero, mai tagliato', nameOf(decimals) === 'Deposito per la nuova casa a Milano')
    const css = (await import('node:fs')).readFileSync(join(ROOT, 'src/components/radar/RadarPreview.css'), 'utf8')
    check('CSS: la rotaia della barra e dell\'anello ha un colore suo (visibile a 0%)', /\.radar-preview__goal-bar \{[^}]*background: var\(--radar-track\)/.test(css) && /\.radar-preview__ring-track \{[^}]*stroke: var\(--radar-track\)/.test(css))
    check('CSS: barra con estremità arrotondate, nome senza ellissi', /\.radar-preview__goal-bar \{[^}]*border-radius: var\(--radius-pill\)/.test(css) && !/\.radar-preview__goal-name \{[^}]*ellipsis/.test(css))
  }
  {
    globalThis.__radarGoalsTest.language = 'en'
    const html = render(GOALS)
    check('in inglese: "Goals" come titolo, elenco con etichetta tradotta', titleOf(html) === 'Goals' && html.includes('aria-label="Your goals"'))
    globalThis.__radarGoalsTest.language = 'it'
  }
  {
    // Radar ancora in apprendimento (niente storico): gli obiettivi si vedono lo stesso.
    const radar = radarWith(GOALS)
    const html = render(GOALS, radar)
    check('Radar in apprendimento o tranquillo: gli obiettivi ci sono comunque', radar.status !== RADAR_STATUS.ACTIVE ? itemsOf(html).length === 3 : true, radar.status)
  }
  {
    // Senza storico l'unica scheda è quella dell'obiettivo (non richiede
    // cicli): il Radar è ACTIVE ma ancora in apprendimento.
    const radar = radarWith(GOALS)
    const html = render(GOALS, radar)
    const empty = text(html.match(/<button type="button" class="radar-preview__empty"[\s\S]*?<\/button>/)?.[0] ?? '')
    check('obiettivi senza storico: il Radar è ACTIVE con la sola scheda obiettivo', radar.status === RADAR_STATUS.ACTIVE && radar.cards.length === 1 && radar.cyclesSeen < radar.cyclesNeeded, `${radar.status} ${radar.cards.length} ${radar.cyclesSeen}`)
    check('   la Home dice "sto ancora imparando", non "niente da segnalare"', empty.includes('🔍') && empty.includes(`(${radar.cyclesSeen}/${radar.cyclesNeeded}`) && !empty.includes('✅'), empty)
    const withHistory = { ...radar, cyclesSeen: radar.cyclesNeeded, quietMessage: null }
    const quiet = text(render(GOALS, withHistory).match(/<button type="button" class="radar-preview__empty"[\s\S]*?<\/button>/)?.[0] ?? '')
    check('   con lo storico completo e solo la scheda obiettivo: "niente da segnalare"', quiet.startsWith('✅'), quiet)
    const noGoals = text(render([], radar).match(/<span class="radar-preview__tile-title">[\s\S]*?<\/span>/)?.[0] ?? '')
    check('   senza obiettivi la tessera del Radar resta quella di sempre', render([], radar).includes('radar-preview__tile--goal') && noGoals.length > 0)
  }
} finally {
  await server.close()
}

report('My Radar: tutti gli obiettivi')
