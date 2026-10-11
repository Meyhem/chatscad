import { waitForAppReady } from './support'
import { expect, test, type Page } from '@playwright/test'

const RENDER_TIMEOUT = 90_000

function watchCspViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) violations.push(msg.text())
  })
  return violations
}

const versionRow = (page: Page, label: string) =>
  page.locator('.pc-version').filter({ has: page.locator('.t', { hasText: new RegExp(`^${label.replace('.', '\\.')}( · current)?$`) }) })

test('start from a gallery model, tune a slider, restore an older version, and keep it all after a reload', async ({ page }) => {
  const csp = watchCspViolations(page)
  await page.goto('./')
  await waitForAppReady(page)

  await page.getByRole('button', { name: 'Untitled project' }).click()
  await page.getByRole('menuitem', { name: 'Examples' }).click()
  await expect(page.getByRole('heading', { name: 'Start from a working model' })).toBeVisible()
  await page.getByRole('article', { name: 'Box with lid' }).getByRole('button', { name: 'Start from this' }).click()

  await expect(page.getByTestId('dims')).toHaveText('138 × 44 × 32 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByRole('button', { name: 'Box with lid' })).toBeVisible()
  await expect(page.getByTestId('version-caption')).toHaveText('v1 · from an example')

  await page.getByRole('slider', { name: 'inner_width' }).fill('80')
  await expect(page.getByTestId('dims')).toHaveText('178 × 44 × 32 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('version-caption')).toHaveText('v2 · edited by slider')

  await page.getByRole('tab', { name: 'History' }).click()
  await expect(page.getByText('2 versions')).toBeVisible()
  await expect(versionRow(page, 'v2').locator('.m')).toHaveText('inner_width 60 → 80')
  await versionRow(page, 'v1').click()
  await expect(page.getByText('Preview · v1')).toBeVisible()
  await page.getByRole('button', { name: 'Restore v1' }).click()

  await expect(page.getByTestId('dims')).toHaveText('138 × 44 × 32 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('version-caption')).toHaveText('v3 · restored')

  await page.reload()
  await expect(page.getByRole('button', { name: 'Box with lid' })).toBeVisible()
  await expect(page.getByTestId('dims')).toHaveText('138 × 44 × 32 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('version-caption')).toHaveText('v3 · restored')
  await page.getByRole('tab', { name: 'History' }).click()
  await expect(page.getByText('3 versions')).toBeVisible()
  await expect(versionRow(page, 'v3').locator('.m')).toHaveText('Restored v1')
  await expect(versionRow(page, 'v3').locator('.pc-thumb img')).toBeVisible({ timeout: RENDER_TIMEOUT })

  expect(csp).toEqual([])
})

test('a project with BOSL2 enabled renders include <BOSL2/std.scad> through the worker', async ({ page }) => {
  const csp = watchCspViolations(page)
  await page.goto('./')
  await waitForAppReady(page)
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Libraries' }).click()
  await page.getByRole('checkbox', { name: 'BOSL2' }).check({ force: true })
  await page.getByRole('tab', { name: 'Project' }).click()

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText('include <BOSL2/std.scad>\ncuboid([10, 20, 30], rounding = 2);')
  await expect(page.getByTestId('dims')).toHaveText('10 × 20 × 30 mm', { timeout: RENDER_TIMEOUT })
  expect(csp).toEqual([])
})
