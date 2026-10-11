/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cspPlugin } from './build/csp'

export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin()],
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
  },
})
