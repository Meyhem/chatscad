/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cspPlugin } from './build/csp'
import { pwaHeadPlugin, pwaOptions } from './build/pwa'

// Sub-path the app is served from; the Pages workflow sets it (e.g. /promptcad/). Local dev and tests use /.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), cspPlugin(), pwaHeadPlugin(base), VitePWA(pwaOptions(base))],
  worker: { format: 'es' },
  build: {
    // Never inline fonts as data: URIs; the CSP allows fonts from 'self' only.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'build/**/*.test.ts'],
    // The PWA plugin's virtual module only exists in a Vite build or dev server; unit tests use a stand-in.
    alias: { 'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/pwaRegisterStub.ts', import.meta.url)) },
  },
})
