// Font: servito solo dall'app, mai da Google Fonts. `npm test`, senza rete.
//
// Plus Jakarta Sans è incluso come WOFF2 variabile in src/assets/fonts/
// (licenza SIL OFL 1.1 accanto ai file) e dichiarato con @font-face in
// src/index.css. Né i sorgenti né il build devono contattare
// fonts.googleapis.com o fonts.gstatic.com.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, section, report } from './sync/testkit.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GOOGLE = /fonts\.googleapis\.com|fonts\.gstatic\.com/
const FONTS = ['plus-jakarta-sans-latin-wght-normal.woff2', 'plus-jakarta-sans-latin-ext-wght-normal.woff2']

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})
const TEXT = new Set(['.js', '.jsx', '.mjs', '.ts', '.css', '.html', '.json', '.webmanifest', '.svg'])

// =====================================================================
section('Sorgenti: nessun riferimento a Google Fonts')
// =====================================================================
{
  const files = [
    ...walk(join(ROOT, 'src')).filter((p) => !p.endsWith('fonts.test.mjs')),
    ...walk(join(ROOT, 'public')),
    join(ROOT, 'index.html'),
    join(ROOT, 'vite.config.js'),
  ].filter((p) => TEXT.has(extname(p)))
  const hits = files.filter((p) => GOOGLE.test(readFileSync(p, 'utf8')))
  check('src/, public/, index.html e vite.config.js non contengono fonts.googleapis.com né fonts.gstatic.com', hits.length === 0, hits.join(','))
  const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8')
  check('index.css non importa fogli di stile esterni', !/@import\s+url\(\s*['"]?https?:/i.test(css))
}

// =====================================================================
section('Font locale: file, licenza e @font-face')
// =====================================================================
{
  for (const name of FONTS) {
    const path = join(ROOT, 'src/assets/fonts', name)
    const ok = existsSync(path)
    check(`${name}: presente`, ok)
    if (ok) {
      const bytes = readFileSync(path)
      check('   è un WOFF2 vero (firma wOF2) e non vuoto', bytes.subarray(0, 4).toString('latin1') === 'wOF2' && bytes.length > 10_000)
    }
  }
  const license = join(ROOT, 'src/assets/fonts/OFL.txt')
  check('licenza SIL Open Font License accanto ai file', existsSync(license) && readFileSync(license, 'utf8').includes('SIL Open Font License, Version 1.1'))

  const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8')
  const faces = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => m[1])
  check('due @font-face (latin e latin-ext)', faces.length === 2)
  check('   famiglia "Plus Jakarta Sans", stile normale, font-display swap',
    faces.every((f) => /font-family:\s*'Plus Jakarta Sans'/.test(f) && /font-style:\s*normal/.test(f) && /font-display:\s*swap/.test(f)))
  check('   variabile 200–800: copre i pesi 400, 500, 600, 700, 800 usati dall\'app', faces.every((f) => /font-weight:\s*200 800/.test(f)))
  check('   solo URL locali verso src/assets/fonts', faces.every((f) => [...f.matchAll(/url\(([^)]+)\)/g)].every((m) => /^'\.\/assets\/fonts\/[a-z-]+\.woff2'$/.test(m[1].trim()))))
  check('   il sottoinsieme latin include il simbolo €', faces.some((f) => f.includes('latin-wght') && /U\+20AC/.test(f)))
  check('la famiglia usata dall\'app è invariata', /font-family:\s*'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;/.test(css))
}

// =====================================================================
section('Build: font inclusi, nessun riferimento a Google Fonts')
// =====================================================================
{
  const dist = join(ROOT, 'dist')
  const fresh = existsSync(join(dist, 'index.html'))
    && statSync(join(dist, 'index.html')).mtimeMs >= statSync(join(ROOT, 'src/index.css')).mtimeMs
  if (fresh) {
    const files = walk(dist)
    const text = files.filter((p) => TEXT.has(extname(p)))
    const hits = text.filter((p) => GOOGLE.test(readFileSync(p, 'utf8')))
    check('dist/: nessun file contiene fonts.googleapis.com o fonts.gstatic.com', hits.length === 0, hits.join(','))
    const woff = files.filter((p) => p.endsWith('.woff2')).map((p) => p.split('/').pop())
    check('dist/: i due font WOFF2 sono nel build', FONTS.every((name) => woff.some((w) => w.startsWith(name.replace('.woff2', '-')))))
    const cssFiles = files.filter((p) => p.endsWith('.css')).map((p) => readFileSync(p, 'utf8')).join('\n')
    check('dist/: il CSS punta ai font del build', woff.every((w) => cssFiles.includes(w)))
  } else {
    check('build non ancora rifatto dopo index.css: controllo su dist rinviato a `npm run build`', true)
  }
}

// =====================================================================
section('Privacy Policy coerente: nessun Google Fonts tra i fornitori')
// =====================================================================
{
  const privacy = readFileSync(join(ROOT, 'public/privacy.html'), 'utf8')
  check('la Privacy Policy non nomina Google né Google Fonts', !/google/i.test(privacy))
  check('   e dice che il carattere è incluso nell\'app, senza servizi esterni', privacy.includes('Il carattere tipografico dell\'app è incluso nell\'app stessa'))
}

report('Font locale (niente Google Fonts)')
