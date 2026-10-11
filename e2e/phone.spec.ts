import { expect, test } from '@playwright/test'
import { waitForFirstRender } from './support'

test('switches between Chat, Code and 3D, with the symbol key row in Code', async ({ page }) => {
  await page.goto('./')
  await waitForFirstRender(page)
  const tabs = page.getByRole('tablist', { name: 'Views' })
  await expect(tabs).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible()

  await tabs.getByRole('tab', { name: '3D' }).click()
  await expect(page.getByTestId('viewer')).toBeVisible()
  await expect(page.getByTestId('dims-axes')).toHaveAttribute('aria-label', '20 × 20 × 10 mm')
  const fit = await page.getByRole('button', { name: 'Fit view' }).boundingBox()
  expect(fit!.height).toBeGreaterThanOrEqual(44)

  await tabs.getByRole('tab', { name: 'Code' }).click()
  await expect(page.getByTestId('viewer')).toBeHidden()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.getByRole('toolbar', { name: 'Code symbols' }).getByRole('button', { name: ';' }).click()
  await expect(page.locator('.cm-content')).toBeFocused()
  await expect(page.locator('.cm-line').last()).toHaveText(';')

  await tabs.getByRole('tab', { name: 'Chat' }).click()
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible()
})
