// La mappa delle spese per categoria in Analisi: una treemap vera.
// `npm test`, senza rete.
//
//   1. utils/treemap.js (squarified): aree proporzionali agli importi,
//      nessuna sovrapposizione, nessuno spazio vuoto, tessere quasi quadrate,
//      casi limite (zero, negativi, NaN, una sola categoria, molte);
//   2. quanto contenuto ci sta in una tessera (tileDensity);
//   3. il VERO CategoryTreemap.jsx (Vite): una tessera per categoria, di
//      dimensioni diverse, contenuto adatto allo spazio, etichette complete
//      per gli screen reader, testi nelle quattro lingue.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, section, report } from '../../sync/testkit.mjs'
import { squarifiedTreemap, treemapHeight, tileDensity, groupSmallTiles, OTHERS_ID } from '../../utils/treemap.js'
import { MESSAGES } from '../../i18n/translate.js'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const EPS = 1e-6

// I valori dell'esempio di Ivan (solo per i test, mai nel codice dell'app).
const SAMPLE = [417, 300, 225, 200, 176.63, 67, 50, 33].map((value, index) => ({ id: `c${index}`, value }))
const overlap = (a, b) => a.x + EPS < b.x + b.width && b.x + EPS < a.x + a.width && a.y + EPS < b.y + b.height && b.y + EPS < a.y + a.height
const ratio = (r) => Math.max(r.width, r.height) / Math.min(r.width, r.height)

const verify = (label, items, width, height) => {
  const rects = squarifiedTreemap(items, width, height)
  const valid = items.filter((item) => Number.isFinite(item.value) && item.value > 0)
  const total = valid.reduce((sum, item) => sum + item.value, 0)
  const areaOk = rects.every((r) => Math.abs((r.width * r.height) / (width * height) - r.value / total) < 1e-6)
  const inside = rects.every((r) => r.x >= -EPS && r.y >= -EPS && r.x + r.width <= width + 1e-6 && r.y + r.height <= height + 1e-6 && r.width > 0 && r.height > 0)
  const noOverlap = rects.every((a, i) => rects.every((b, j) => i === j || !overlap(a, b)))
  const covered = Math.abs(rects.reduce((sum, r) => sum + r.width * r.height, 0) - width * height) < 1e-3
  check(`${label}: una tessera per categoria valida`, rects.length === valid.length, rects.length)
  check(`   area di ogni tessera proporzionale all'importo`, areaOk)
  check('   tutte dentro la mappa, nessuna sovrapposizione, nessuno spazio vuoto', inside && noOverlap && covered)
  return rects
}

// =====================================================================
section('1. Algoritmo (squarified)')
// =====================================================================
{
  const rects = verify('esempio (8 categorie, 350 × 330)', SAMPLE, 350, 330)
  check('   dal più grande al più piccolo, aree decrescenti', rects.every((r, i) => i === 0 || r.value <= rects[i - 1].value) && rects.every((r, i) => i === 0 || r.width * r.height <= rects[i - 1].width * rects[i - 1].height + EPS))
  check('   tessere di dimensioni diverse (non una griglia uguale)', new Set(rects.map((r) => Math.round(r.width * r.height))).size === rects.length)
  check('   tessere quasi quadrate: nessun lato oltre 3 volte l\'altro', rects.every((r) => ratio(r) <= 3), rects.map((r) => ratio(r).toFixed(2)).join(' '))
  check('   la più grande (417) prende il 28,4% dell\'area', Math.abs((rects[0].width * rects[0].height) / (350 * 330) - 417 / 1468.63) < 1e-9)
  check('   gli altri campi degli elementi passano intatti', squarifiedTreemap([{ id: 'x', value: 5, row: { tag: 1 } }], 100, 100)[0].row.tag === 1)
}
verify('una sola categoria', [{ id: 'solo', value: 42 }], 340, 220)
check('   una sola categoria occupa tutta la mappa', (() => { const [r] = squarifiedTreemap([{ id: 'solo', value: 42 }], 340, 220); return r.x === 0 && r.y === 0 && Math.abs(r.width - 340) < EPS && Math.abs(r.height - 220) < EPS })())
verify('due categorie uguali', [{ id: 'a', value: 10 }, { id: 'b', value: 10 }], 300, 200)
{
  const many = Array.from({ length: 18 }, (_, i) => ({ id: `m${i}`, value: Math.round(1000 / (i + 1)) / 10 }))
  const rects = verify('molte categorie (18, valori da 100 a 5,6)', many, 340, treemapHeight(340, 18))
  check('   anche con molte categorie le tessere restano compatte (lato ≤ 4 volte l\'altro)', rects.every((r) => ratio(r) <= 4), Math.max(...rects.map(ratio)).toFixed(2))
}
{
  const dirty = [{ id: 'ok', value: 10 }, { id: 'zero', value: 0 }, { id: 'neg', value: -5 }, { id: 'nan', value: Number.NaN }, null, { id: 'ok2', value: 5 }]
  const rects = squarifiedTreemap(dirty, 200, 200)
  check('zero, negativi, NaN e voci vuote non occupano spazio', rects.map((r) => r.id).join() === 'ok,ok2')
  check('nessun elemento, o dimensioni non valide → nessuna tessera', squarifiedTreemap([], 200, 200).length === 0 && squarifiedTreemap(SAMPLE, 0, 200).length === 0 && squarifiedTreemap(SAMPLE, 200, Number.NaN).length === 0 && squarifiedTreemap(null, 200, 200).length === 0)
  check('non modifica l\'elenco ricevuto (ordine compreso)', (() => { const input = [{ id: 'p', value: 1 }, { id: 'g', value: 9 }]; squarifiedTreemap(input, 100, 100); return input[0].id === 'p' })())
}
check('altezza: più categorie, più spazio; mai sotto 260 px né sopra 1,6 × larghezza', treemapHeight(340, 2) === 260 && treemapHeight(340, 8) > treemapHeight(340, 4) && treemapHeight(340, 30) === Math.round(340 * 1.6) && treemapHeight(0, 5) === 0)
{
  // Raggruppamento: le categorie troppo piccole per i loro numeri vanno in "Altre".
  const items = [320, 260, 213.35, 149.99, 129.3, 95, 89.99, 72, 62.5, 58.4, 48, 44.9, 39, 35, 31.5, 23.9, 12, 7.7].map((value, i) => ({ id: `g${i}`, value }))
  const sum = items.reduce((a, b) => a + b.value, 0)
  const fits = (r) => tileDensity(r.width, r.height, 7, `${Math.round((r.value / sum) * 100)}%`.length) !== null
  const { rects, grouped } = groupSmallTiles(items, 360, treemapHeight(360, 18), fits)
  const others = rects.find((r) => r.id === OTHERS_ID)
  check('raggruppamento: ogni tessera mostrata riesce a mostrare importo e percentuale', rects.every(fits))
  check('   le raccolte in "Altre" sono le più piccole, e solo quelle che non ci stavano', grouped.length > 0 && grouped.every((g) => g.value <= Math.min(...rects.filter((r) => r.id !== OTHERS_ID).map((r) => r.value))), grouped.map((g) => g.value).join(','))
  check('   "Altre" ha l\'area della somma (proporzioni vere) e nessuna categoria si perde', Math.abs(others.value - grouped.reduce((a, b) => a + b.value, 0)) < EPS && rects.length - 1 + grouped.length === items.length)
  const roomy = groupSmallTiles(items.slice(0, 5), 360, 360, fits)
  check('   con poche categorie e spazio sufficiente non si raggruppa niente', roomy.grouped.length === 0 && roomy.rects.length === 5)
  const single = groupSmallTiles([{ id: 's', value: 1 }], 10, 10, () => false)
  check('   una sola categoria non finisce mai in "Altre"', single.grouped.length === 0 && single.rects.length === 1)
}

// =====================================================================
section('2. Quanto contenuto ci sta in una tessera')
// =====================================================================
check('grande → icona, nome, importo grande e percentuale', tileDensity(170, 190, 7) === 'full')
check('media → icona, nome, importo e percentuale', tileDensity(95, 125, 7) === 'name')
check('bassa e larga → icona, importo e percentuale in riga', tileDensity(200, 60, 7) === 'wide')
check('media e bassa → icona accanto a importo e percentuale', tileDensity(110, 60, 7) === 'compact')
check('piccola e stretta → icona, importo e percentuale in colonna', tileDensity(64, 70, 7) === 'stack')
check('troppo piccola per importo e percentuale → null (va in "Altre")', tileDensity(30, 40, 7) === null && tileDensity(40, 80, 7) === null)
check('un importo lungo non entra in una tessera stretta: si scende di livello invece di tagliarlo', tileDensity(115, 140, 7) === 'full' && tileDensity(115, 140, 12) !== 'full' && tileDensity(180, 60, 7) === 'wide' && tileDensity(180, 60, 12) !== 'wide')

// =====================================================================
section('3. CategoryTreemap (componente vero)')
// =====================================================================
const USE_LANGUAGE_FAKE = `
  import { translate } from '/src/i18n/translate.js'
  import { setCurrentLanguageSource } from '/src/i18n/currentLanguage.js'
  setCurrentLanguageSource(() => globalThis.__treemapTest.language)
  export const useLanguage = () => {
    const language = globalThis.__treemapTest.language
    return { language, currency: 'EUR', t: (key, params) => translate(language, key, params) }
  }`
globalThis.__treemapTest = { language: 'it' }
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: join(tmpdir(), 'spendy-treemap-test-vite'),
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: 'treemap-harness',
    enforce: 'pre',
    resolveId(source, importer) {
      return importer?.includes('CategoryTreemap.jsx') && source === '../../i18n/useLanguage.js' ? '\0treemap:useLanguage' : null
    },
    load(id) {
      return id === '\0treemap:useLanguage' ? USE_LANGUAGE_FAKE : null
    },
  }, react()],
})
try {
  const { CategoryTreemap } = await server.ssrLoadModule('/src/components/analytics/CategoryTreemap.jsx')
  const { formatCurrency } = await server.ssrLoadModule('/src/utils/format.js')
  const LABELS = ['Bolletta luce', 'Acquisto azioni', 'Spesa', 'Fondo emergenza', 'Debiti papà', 'Ristorante', 'Donazioni', 'Altro']
  const EMOJI = ['⚡', '📈', '🛒', '🚨', '👨', '🍕', '🎁', '💰']
  const rows = SAMPLE.map((item, i) => ({ categoryId: `cat-${i}`, category: { label: LABELS[i], emoji: EMOJI[i] }, current: item.value, previous: i === 0 ? 300 : 0, changePercent: i === 0 ? 39 : 0, changeAmount: i === 0 ? 117 : 0 }))
  const total = rows.reduce((sum, row) => sum + row.current, 0)
  const render = (list = rows) => renderToStaticMarkup(h(CategoryTreemap, { rows: list, total: list.reduce((sum, row) => sum + row.current, 0) }))
  const tilesOf = (html) => html.match(/<button type="button" class="category-treemap__tile[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? []
  // React scrive 0 senza unità ("left:0"), gli altri valori in px.
  const styleOf = (tile) => Object.fromEntries([...tile.matchAll(/(left|top|width|height):([\d.]+)(?:px)?[;"]/g)].map((m) => [m[1], Number(m[2])]))
  const html = render()
  const tiles = tilesOf(html)
  // Nome, importo e percentuale di ogni tessera, dall'etichetta accessibile.
  const infoOf = (tile) => { const m = tile.match(/aria-label="([^"]+), ([^",]+(?:,\d+)?[^",]*), (\d+)%"/); return m ? { name: m[1], amount: m[2], share: Number(m[3]) } : null }
  const infos = tiles.map(infoOf)
  const othersInfo = infos.find((info) => /^Altre \d+$/.test(info.name))
  const groupedCount = othersInfo ? Number(othersInfo.name.split(' ')[1]) : 0
  check('ogni categoria ha la sua tessera o è contata in "Altre" (nessuna persa)', infos.every(Boolean) && infos.length - (othersInfo ? 1 : 0) + groupedCount === rows.length, `${infos.length} tessere, altre ${groupedCount}`)
  check('   ogni tessera posizionata (left/top/width/height)', tiles.every((tile) => ['left', 'top', 'width', 'height'].every((k) => k in styleOf(tile))))
  const areas = tiles.map((tile) => { const s = styleOf(tile); return s.width * s.height })
  check('   tessere attaccate: insieme riempiono esattamente la mappa (nessuno spazio fra loro)', Math.abs(areas.reduce((x, y) => x + y, 0) - 340 * treemapHeight(340, 8)) < 1)
  check('   le aree seguono gli importi (più spesa → tessera più grande)', areas.every((a, i) => i === 0 || a <= areas[i - 1] + 1) && Math.abs(areas[0] / areas.reduce((x, y) => x + y, 0) - 417 / total) < 0.01)
  check('   dimensioni diverse fra le tessere (una vera treemap)', new Set(areas.map(Math.round)).size === tiles.length)
  check('   colore su ogni tessera (fisso della categoria; lilla per "Altre")', tiles.every((tile) => /--tile-color:#[0-9a-f]{6}/i.test(tile)))
  check('   etichetta completa per gli screen reader: nome, importo, percentuale', tiles[0].includes(`aria-label="Bolletta luce, ${formatCurrency(417)}, 28%"`))
  check('   la più grande mostra icona, nome, importo e percentuale', tiles[0].includes('--full') && tiles[0].includes('⚡') && tiles[0].includes('>Bolletta luce<') && tiles[0].includes(`>${formatCurrency(417)}<`) && tiles[0].includes('>28%<'))
  check('   OGNI tessera mostra il suo importo e la sua percentuale', tiles.every((tile, i) => tile.includes(`>${infos[i].amount}<`) && tile.includes(`>${infos[i].share}%<`)))
  check('   importi e percentuali delle categorie sono quelli dei dati', infos.filter((info) => info !== othersInfo).every((info) => { const row = rows.find((r) => r.category.label === info.name); return row && info.amount === formatCurrency(row.current) && info.share === Math.round((row.current / total) * 100) }))
  if (othersInfo) {
    const groupedRows = [...rows].sort((a, b) => a.current - b.current).slice(0, groupedCount)
    check('   "Altre": somma e quota delle categorie raccolte (le più piccole)', othersInfo.amount === formatCurrency(groupedRows.reduce((a, r) => a + r.current, 0)) && othersInfo.share === Math.round((groupedRows.reduce((a, r) => a + r.current, 0) / total) * 100))
  }
  check('   il nome solo dove ci sta (tessere grandi e medie)', tiles.every((tile) => {
    const density = tile.match(/category-treemap__tile--(full|name|wide|compact|stack)/)[1]
    return tile.includes('category-treemap__name') === (density === 'full' || density === 'name')
  }))
  check('   ogni tessera è un pulsante (tocco = dettaglio)', tiles.every((tile) => tile.includes('aria-pressed="false"')))
  check('senza selezione: suggerimento "Tocca una categoria…"', html.includes(MESSAGES.it.analytics.treemap.hint))
  check('nessun NaN, nessuna percentuale o misura negativa', !/NaN|Infinity|-\d+(\.\d+)?px|-\d+%/.test(html))
  {
    const many = Array.from({ length: 18 }, (_, i) => ({ categoryId: `m-${i}`, category: { label: `Categoria ${i + 1}`, emoji: '🏷️' }, current: Math.round(1000 / (i + 1)) / 10, previous: 0, changePercent: 0, changeAmount: 0 }))
    const manyHtml = render(many)
    const manyTiles = tilesOf(manyHtml)
    const maxBottom = Math.max(...manyTiles.map((tile) => { const s = styleOf(tile); return s.top + s.height }))
    const maxRight = Math.max(...manyTiles.map((tile) => { const s = styleOf(tile); return s.left + s.width }))
    const othersTile = manyTiles.find((tile) => tile.includes('category-treemap__tile--others'))
    const shown = manyTiles.filter((tile) => !tile.includes('--others')).length
    const groupedCount = Number(othersTile?.match(/aria-label="Altre (\d+),/)?.[1])
    check('18 categorie: dentro la mappa, nessun overflow', maxRight <= 340.01 && maxBottom <= treemapHeight(340, 18) + 0.01)
    check('   le più piccole sono raccolte in "Altre N", nessuna persa', Boolean(othersTile) && shown + groupedCount === 18, `${shown} + ${groupedCount}`)
    check('   anche "Altre" mostra importo e percentuale', /category-treemap__amount">[^<]+</.test(othersTile) && /category-treemap__share">\d+%</.test(othersTile))
    check('   tutte le tessere sono pulsanti con etichetta completa', manyTiles.every((tile) => /aria-label="(Categoria \d+|Altre \d+), [^"]+, \d+%"/.test(tile)))
  }
  {
    const one = render([rows[0]])
    check('una sola categoria: una tessera grande che riempie la mappa', tilesOf(one).length === 1 && tilesOf(one)[0].includes('--full'))
  }
  for (const lang of ['en', 'es', 'fr']) {
    globalThis.__treemapTest.language = lang
    check(`${lang}: suggerimento e area tradotti`, render().includes(MESSAGES[lang].analytics.treemap.hint) && render().includes(`aria-label="${MESSAGES[lang].analytics.treemap.label}"`))
  }
  globalThis.__treemapTest.language = 'it'
  check('chiavi analytics.treemap.* in it/en/es/fr, stessi segnaposto', ['label', 'hint', 'share', 'previous', 'open', 'all', 'others'].every((key) => ['it', 'en', 'es', 'fr'].every((lang) => typeof MESSAGES[lang].analytics.treemap[key] === 'string' && MESSAGES[lang].analytics.treemap[key].trim()
    && (MESSAGES[lang].analytics.treemap[key].match(/\{\w+\}/g) ?? []).join() === (MESSAGES.it.analytics.treemap[key].match(/\{\w+\}/g) ?? []).join())))
  {
    const page = readFileSync(join(ROOT, 'src/pages/AnalyticsPage.jsx'), 'utf8')
    check('Analisi: treemap in alto, ciambella (stessi dati) sotto e più piccola, poi la lista completa espandibile', page.indexOf('<CategoryTreemap') < page.indexOf('<DonutChart') && page.indexOf('<DonutChart') < page.indexOf('<details') && /<DonutChart segments=\{segments\} size=\{176\}/.test(page) && page.includes('onOpenDetail={setOpenCategoryId}') && page.includes('analytics-page__legend-row--button'))
  }
} finally {
  await server.close()
}

report('Analisi: mappa delle categorie (treemap)')
