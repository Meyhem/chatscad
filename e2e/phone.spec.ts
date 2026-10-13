import { expect, test } from '@playwright/test'
import { replaceCode, STARTER_CODE, waitForAppReady, waitForFirstRender } from './support'

test('switches between Agent, Code and 3D, with the symbol key row in Code', async ({ page }) => {
  await page.goto('./')
  await waitForAppReady(page)
  const tabs = page.getByRole('tablist', { name: 'Panels' })
  await expect(tabs).toBeVisible()
  await tabs.getByRole('tab', { name: 'Code' }).click()
  await replaceCode(page, STARTER_CODE)
  await tabs.getByRole('tab', { name: 'Agent' }).click()
  await waitForFirstRender(page)
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

  await tabs.getByRole('tab', { name: 'Agent' }).click()
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible()

  const views = page.getByRole('tablist', { name: 'Views' })
  await views.getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible()
  await expect(tabs).toHaveCount(0)
  await views.getByRole('tab', { name: 'Project' }).click()
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible()
})
