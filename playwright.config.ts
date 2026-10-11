import { defineConfig, devices } from '@playwright/test'

// BASE_PATH is the sub-path the app is served from, e.g. /promptcad/ on GitHub Pages. Tests navigate relative to it.
const basePath = process.env.BASE_PATH ?? '/'
const baseURL = `http://localhost:4173${basePath}`

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL, acceptDownloads: true },
  webServer: {
    // Production build, so the CSP meta tag is active during the test.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
