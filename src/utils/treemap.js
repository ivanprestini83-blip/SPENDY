// Layout di una treemap "squarified" (Bruls, Huizing, van Wijk, 2000): il
// rettangolo dato viene diviso in tessere la cui AREA è proporzionale al
// valore di ciascun elemento, cercando di tenerle il più possibile vicine a
// dei quadrati (niente strisce sottili quando si può evitare). È lo stesso
// principio delle mappe di mercato finanziarie.
//
// Funzione pura: nessun DOM, nessuna dipendenza. Riceve gli elementi
// ({ id, value, ...qualsiasi altra cosa }) e le dimensioni in pixel, e
// restituisce un rettangolo per elemento ({ ...elemento, x, y, width,
// height }), dal più grande al più piccolo. Gli elementi con valore nullo,
// negativo o non numerico non occupano spazio e non vengono restituiti.

// Il rapporto peggiore (lato lungo / lato corto) di una fila di aree
// disposte lungo un lato di lunghezza `side`.
function worstRatio(areas, side) {
  if (areas.length === 0) return Infinity
  const sum = areas.reduce((total, area) => total + area, 0)
  const max = Math.max(...areas)
  const min = Math.min(...areas)
  const sideSquared = side * side
  const sumSquared = sum * sum
  return Math.max((sideSquared * max) / sumSquared, sumSquared / (sideSquared * min))
}

export function squarifiedTreemap(items, width, height) {
  if (!Array.isArray(items) || !(width > 0) || !(height > 0)) return []
  const valid = items
    .filter((item) => item && Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value)
  const total = valid.reduce((sum, item) => sum + item.value, 0)
  if (!(total > 0)) return []

  const scale = (width * height) / total
  const nodes = valid.map((item) => ({ item, area: item.value * scale }))
  const rects = []
  // Lo spazio ancora libero, che si restringe a ogni fila disposta.
  let x = 0
  let y = 0
  let w = width
  let h = height

  const layoutRow = (row) => {
    const sum = row.reduce((total, node) => total + node.area, 0)
    if (w >= h) {
      // Spazio più largo che alto: la fila diventa una colonna a sinistra.
      const columnWidth = sum / h
      let cursor = y
      row.forEach((node, index) => {
        const nodeHeight = index === row.length - 1 ? y + h - cursor : node.area / columnWidth
        rects.push({ ...node.item, x, y: cursor, width: columnWidth, height: nodeHeight })
        cursor += nodeHeight
      })
      x += columnWidth
      w -= columnWidth
    } else {
      // Più alto che largo: la fila diventa una riga in alto.
      const rowHeight = sum / w
      let cursor = x
      row.forEach((node, index) => {
        const nodeWidth = index === row.length - 1 ? x + w - cursor : node.area / rowHeight
        rects.push({ ...node.item, x: cursor, y, width: nodeWidth, height: rowHeight })
        cursor += nodeWidth
      })
      y += rowHeight
      h -= rowHeight
    }
  }

  let row = []
  let index = 0
  while (index < nodes.length) {
    const side = Math.min(w, h)
    const candidate = [...row, nodes[index]]
    // Si aggiunge alla fila finché le tessere diventano più "quadrate";
    // appena peggiorano, la fila si chiude e se ne apre un'altra.
    if (row.length === 0 || worstRatio(candidate.map((node) => node.area), side) <= worstRatio(row.map((node) => node.area), side)) {
      row = candidate
      index += 1
    } else {
      layoutRow(row)
      row = []
    }
  }
  if (row.length > 0) layoutRow(row)

  return rects
}

// L'altezza della treemap per una certa larghezza: è la protagonista della
// pagina, e più categorie ha più spazio prende. Mai sotto i 260 px né
// sopra 1,6 volte la larghezza.
export function treemapHeight(width, count) {
  if (!(width > 0)) return 0
  const ratio = count <= 3 ? 0.75 : count <= 6 ? 1 : count <= 10 ? 1.25 : count <= 14 ? 1.45 : 1.6
  return Math.round(Math.max(260, width * ratio))
}

// Quanto contenuto ci sta in una tessera di queste dimensioni (px), sapendo
// quanti caratteri hanno l'importo e la percentuale. Importo e percentuale
// ci sono SEMPRE; cambia quanto altro ci sta. Le soglie vengono dallo
// spazio che serve davvero (icona, nome fino a due righe, importo su una
// riga, percentuale, margini interni), così nessun testo si sovrappone e
// nessun numero viene tagliato:
//   full    → icona, nome, importo grande e percentuale
//   name    → icona, nome, importo e percentuale
//   wide    → icona, importo e percentuale su una riga (basse e larghe)
//   compact → icona a sinistra, importo e percentuale uno sotto l'altro
//   stack   → icona, importo e percentuale in colonna, piccoli
//   null    → nemmeno importo e percentuale ci stanno: la categoria va
//             raccolta in "Altre" (groupSmallTiles qui sotto)
// Larghezza media di un carattere di cifre in Plus Jakarta Sans grassetto:
// ~0,62 em.
const DIGIT_EM = 0.62
const textWidth = (chars, fontSize) => chars * DIGIT_EM * fontSize

export function tileDensity(width, height, amountChars = 9, shareChars = 3) {
  const chars = Number.isFinite(amountChars) && amountChars > 0 ? amountChars : 9
  const share = Number.isFinite(shareChars) && shareChars > 0 ? shareChars : 3
  if (height >= 132 && width >= Math.max(110, textWidth(chars, 18) + 24)) return 'full'
  if (height >= 120 && width >= Math.max(84, textWidth(chars, 15) + 22)) return 'name'
  // icona 26 + due spazi da 8 + percentuale + margini 22
  if (height >= 50 && width >= textWidth(chars, 15) + textWidth(share, 12) + 64) return 'wide'
  // icona 24 + spazio 7 + importo a 14 px + margini 16
  if (height >= 44 && width >= textWidth(chars, 14) + 47) return 'compact'
  // icona 18 + importo a 12 px + percentuale a 11 px + margini 10
  if (height >= 58 && width >= textWidth(chars, 12) + 10) return 'stack'
  return null
}

// Le categorie troppo piccole per mostrare importo e percentuale non
// spariscono: si raccolgono in un'unica tessera "Altre", la cui area è la
// somma delle loro (le proporzioni restano vere). Si parte da tutte le
// categorie e, finché una tessera non riesce a mostrare i suoi numeri, la
// categoria più piccola passa nel gruppo e si ridispone tutto.
//
//   items  → [{ id, value, ... }] (qualsiasi ordine)
//   fits   → (rect) => true se in quella tessera ci stanno i suoi numeri
//            (rect ha anche `grouped` per la tessera "Altre")
// Restituisce { rects, grouped }: le tessere da disegnare (l'eventuale
// "Altre" ha id OTHERS_ID e `grouped` con le categorie raccolte) e le
// categorie raccolte, dalla più grande alla più piccola.
export const OTHERS_ID = '__others__'

export function groupSmallTiles(items, width, height, fits) {
  const valid = (Array.isArray(items) ? items : [])
    .filter((item) => item && Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value)
  let visible = valid
  let grouped = []
  for (;;) {
    const others = grouped.length > 0
      ? [{ id: OTHERS_ID, value: grouped.reduce((sum, item) => sum + item.value, 0), grouped }]
      : []
    const rects = squarifiedTreemap([...visible, ...others], width, height)
    const allFit = rects.every((rect) => fits(rect))
    // Una sola categoria rimasta (o nessuna): non c'è niente da raccogliere.
    if (allFit || visible.length <= 1) return { rects, grouped }
    grouped = [visible[visible.length - 1], ...grouped]
    visible = visible.slice(0, -1)
  }
}
