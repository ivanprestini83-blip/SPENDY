import { readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Il Finder di macOS crea file .DS_Store anche dentro public/, e Vite copia
// public/ così com'è nella build. Questo plugin toglie solo quelle copie da
// dist/ a build finita: i file in public/ restano dove sono.
function dropDsStore() {
  let outDir
  const sweep = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) sweep(path)
      else if (entry.name === '.DS_Store') rmSync(path)
    }
  }
  return {
    name: 'spendy-drop-ds-store',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      sweep(outDir)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropDsStore()],
  // host: true binds the dev server to 0.0.0.0 (not just localhost), so a
  // phone on the same Wi-Fi can reach it at http://<mac-lan-ip>:5173 —
  // `npm run dev` alone is now equivalent to `vite --host 0.0.0.0`.
  server: {
    host: true,
  },
})
