import { expect, test } from '@playwright/test'
import { RENDER_TIMEOUT, routeFakeLlm, seedFakeProvider, watchCspViolations } from './support'

test('asks for three variants, renders them in the background and uses the picked one', async ({ page }) => {
  const csp = watchCspViolations(page)
  const llm = await routeFakeLlm(page, ['cube([10, 10, 10]);', 'cube([20, 10, 10]);', 'cube([30, 10, 10]);'])
  await seedFakeProvider(page, { variantCount: 1 })

  const count = page.getByRole('button', { name: 'Variants per prompt' })
  await expect(count).toHaveText(/^Variants\s*1$/)
  await count.click()
  await expect(count).toHaveText(/^Variants\s*3$/)

  await page.getByRole('textbox', { name: 'Prompt' }).fill('A test block')
  await page.getByRole('button', { name: 'Send' }).click()

  const dialog = page.getByRole('dialog', { name: 'Pick a variant' })
  await expect(dialog).toBeVisible()
  for (const dims of ['10 × 10 × 10 mm', '20 × 10 × 10 mm', '30 × 10 × 10 mm']) {
    await expect(dialog.getByRole('option').filter({ hasText: dims })).toHaveCount(1, { timeout: RENDER_TIMEOUT })
  }
  expect(llm.requests).toBe(3)
  // The main view was not disturbed by the background renders.
  await expect(page.getByTestId('render-status')).toHaveText('Nothing to render')

  const widest = dialog.getByRole('option').filter({ hasText: '30 × 10 × 10 mm' })
  await widest.locator('.pc-variant-meta').first().click()
  await expect(widest).toHaveAttribute('aria-selected', 'true')
  await dialog.getByRole('button', { name: /^Use variant [ABC]$/ }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('dims')).toHaveText('30 × 10 × 10 mm', { timeout: RENDER_TIMEOUT })
  expect(csp).toEqual([])
})
