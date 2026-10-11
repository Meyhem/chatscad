import { expect, test } from '@playwright/test'
import { waitForAppReady } from './support'

test('a new project opens empty, without rendering', async ({ page }) => {
  await page.goto('./')
  await waitForAppReady(page)
  await expect(page.getByTestId('render-status')).toHaveText('Nothing to render')
  await expect(page.getByRole('heading', { name: 'Nothing to render yet' })).toBeVisible()
  await expect(page.locator('.cm-placeholder')).toHaveText('Write OpenSCAD here, or describe a part in the chat')
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeDisabled()
  await page.getByRole('button', { name: 'Browse examples' }).click()
  await expect(page.getByRole('heading', { name: 'Start from a working model' })).toBeVisible()
})
