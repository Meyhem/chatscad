import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { openWithStarter, replaceCode } from './support'

const RENDER_TIMEOUT = 90_000

function watchCspViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) violations.push(msg.text())
  })
  return violations
}

test('renders the default model in the real OpenSCAD WASM and exports binary STL', async ({ page }) => {
  const csp = watchCspViolations(page)
  await openWithStarter(page)
  await expect(page.getByTestId('render-status')).toHaveText(/^Rendered \d+ ms$/)
  await expect(page.getByTestId('dims-axes')).toHaveAttribute('aria-label', '20 × 20 × 10 mm')
  await expect(page.locator('canvas')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export STL' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('model.stl')
  const bytes = await readFile((await download.path())!)
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50)

  expect(csp).toEqual([])
})

test('pasted code re-renders with new dimensions', async ({ page }) => {
  await openWithStarter(page)
  await replaceCode(page, 'cube([30, 10, 5]);')
  await expect(page.getByTestId('dims')).toHaveText('30 × 10 × 5 mm', { timeout: RENDER_TIMEOUT })
})

test('a compile error shows the pill, gutter and inline callout, keeps the last mesh, and blocks STL export', async ({ page }) => {
  await openWithStarter(page)
  await replaceCode(page, 'cube([10, 10, 10]')
  await expect(page.getByTestId('render-status')).toHaveText(/^Failed · line \d+$/, { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('console')).toContainText('ERROR')
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible()
  await expect(page.locator('.cm-diag-callout')).toContainText(/^Line \d+: /)
  await expect(page.getByText('Showing v2, the last version that compiled')).toBeVisible()
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm')
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeDisabled()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})

test('follows the system colour scheme with the light theme as a full peer', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('./')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(238, 241, 244)') // bg (light)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(13, 16, 21)') // bg (dark)
})

test('loads every file from under the base path, as GitHub Pages requires', async ({ page, baseURL }) => {
  const basePath = new URL(baseURL!).pathname
  const outside: string[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.origin === new URL(baseURL!).origin && !url.pathname.startsWith(basePath)) outside.push(url.pathname)
  })
  await openWithStarter(page)
  expect(outside).toEqual([])
})
