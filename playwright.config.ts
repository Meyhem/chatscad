import { defineConfig, devices } from '@playwright/test'

// BASE_PATH is the sub-path the app is served from, e.g. /chatscad/ on GitHub Pages. Tests navigate relative to it.
const basePath = process.env.BASE_PATH ?? '/'
const baseURL = `http://localhost:4173${basePath}`

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  // CI runners are slower and less predictable. Retries keep one slow run from blocking a deploy; the github
  // reporter turns failures and flaky passes into run annotations that are readable without signing in.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // Service workers would answer requests before page.route sees them; pwa.spec.ts turns them on for itself.
  use: { baseURL, acceptDownloads: true, serviceWorkers: 'block' },
  webServer: {
    // Production build, so the CSP meta tag and the service worker are the deployed ones.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec\.ts/ },
  ],
})
