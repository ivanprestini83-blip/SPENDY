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

// L'altezza della treemap per una certa larghezza: più categorie, più
// spazio, così anche le piccole restano toccabili. Mai sotto i 220 px né
// sopra 1,4 volte la larghezza.
export function treemapHeight(width, count) {
  if (!(width > 0)) return 0
  const ratio = count <= 3 ? 0.62 : count <= 6 ? 0.85 : count <= 10 ? 1.05 : count <= 14 ? 1.2 : 1.4
  return Math.round(Math.max(220, width * ratio))
}

// Quanto contenuto ci sta in una tessera di queste dimensioni (px, già al
// netto dello spazio fra le tessere), sapendo quanti caratteri ha
// l'importo da scrivere. Le soglie vengono dallo spazio che serve davvero
// (icona 26–34 px, nome fino a due righe, importo a 15–18 px su una riga,
// percentuale, margini interni), così nessun testo si sovrappone e nessun
// importo viene tagliato:
//   full  → icona, nome, importo e percentuale
//   name  → icona, nome e importo
//   wide    → icona, importo e percentuale su una riga (basse e larghe)
//   compact → icona e importo su una riga
//   short   → icona e percentuale
//   icon  → solo l'icona (il resto nel dettaglio al tocco)
// Larghezza media di una cifra in Plus Jakarta Sans grassetto: ~0,62 em.
const DIGIT_EM = 0.62
const amountWidth = (chars, fontSize) => chars * DIGIT_EM * fontSize

export function tileDensity(width, height, amountChars = 9) {
  const chars = Number.isFinite(amountChars) && amountChars > 0 ? amountChars : 9
  if (height >= 128 && width >= Math.max(110, amountWidth(chars, 18) + 22)) return 'full'
  if (height >= 104 && width >= Math.max(84, amountWidth(chars, 15) + 22)) return 'name'
  // icona 26 + due spazi da 8 + percentuale ~34 + margini 20
  if (height >= 56 && width >= amountWidth(chars, 15) + 96) return 'wide'
  // icona 26 + uno spazio da 8 + margini 20
  if (height >= 48 && width >= amountWidth(chars, 15) + 54) return 'compact'
  if (height >= 52 && width >= 46) return 'short'
  return 'icon'
}
