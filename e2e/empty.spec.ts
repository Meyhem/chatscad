import { expect, test } from '@playwright/test'
import { createBlankProject } from './support'

test('a first visit opens the New project dialog instead of a blank project', async ({ page }) => {
  await page.goto('./')
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'Photos' })).toBeVisible()

  // Closing it leaves no project open; the card in the workbench's place reopens it.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'No project open' })).toBeVisible()
  await expect(page.locator('.cm-content')).toBeHidden()
  await page.getByRole('button', { name: 'New project…' }).click()
  await createBlankProject(page)
  await expect(page.getByRole('button', { name: 'Untitled project' })).toBeVisible()

  // Once a project exists, a reload opens it without the dialog.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Untitled project' })).toBeVisible()
  await expect(dialog).toBeHidden()
})

test('a new project opens empty, without rendering', async ({ page }) => {
  await page.goto('./')
  await createBlankProject(page)
  await expect(page.getByTestId('render-status')).toHaveText('Nothing to render')
  await expect(page.getByRole('heading', { name: 'Nothing to render yet' })).toBeVisible()
  await expect(page.locator('.cm-placeholder')).toHaveText('Write OpenSCAD here, or describe a part in the chat')
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeDisabled()
  await page.getByRole('button', { name: 'Browse examples' }).click()
  await expect(page.getByRole('heading', { name: 'Start from a working model' })).toBeVisible()
})
