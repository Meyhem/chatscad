import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { RENDER_TIMEOUT, watchCspViolations } from './support'

// lz-string is CommonJS without named ESM exports; Playwright runs specs as ESM.
const LZString = createRequire(import.meta.url)('lz-string') as typeof import('lz-string')

test('a share link opens as a new project, and the link the app makes opens the same model', async ({ page, context }) => {
  const csp = watchCspViolations(page)
  const payload = { v: 1, name: 'Shared block', code: 'cube([12, 8, 4]);', params: {} }
  await page.goto(`./#s=${LZString.compressToEncodedURIComponent(JSON.stringify(payload))}`)

  await expect(page.getByTestId('dims')).toHaveText('12 × 8 × 4 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByText('Opened “Shared block” from a link')).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')

  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
  expect(link).toMatch(/#s=[A-Za-z0-9+\-$]+$/)

  const second = await context.newPage()
  await second.goto(link)
  await expect(second.getByTestId('dims')).toHaveText('12 × 8 × 4 mm', { timeout: RENDER_TIMEOUT })
  expect(csp).toEqual([])
})

test('a damaged link creates nothing and says why', async ({ page }) => {
  await page.goto('./#s=garbage!!')
  await expect(page.getByRole('alert')).toContainText('This link could not be opened')
  // No project was made, so the first visit asks for one.
  await expect(page.getByRole('dialog', { name: 'New project' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
})
