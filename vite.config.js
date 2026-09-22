import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // host: true binds the dev server to 0.0.0.0 (not just localhost), so a
  // phone on the same Wi-Fi can reach it at http://<mac-lan-ip>:5173 —
  // `npm run dev` alone is now equivalent to `vite --host 0.0.0.0`.
  server: {
    host: true,
  },
})
