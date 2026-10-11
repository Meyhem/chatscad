import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { waitForFirstRender, watchCspViolations } from './support'

async function openExport(page: Page, tab: string) {
  await page.goto('./')
  await waitForFirstRender(page)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export and share' })
  await dialog.getByRole('tab', { name: tab }).click()
  return dialog
}

test('saves a PNG of the model at the chosen size', async ({ page }) => {
  const csp = watchCspViolations(page)
  const dialog = await openExport(page, 'Image')
  await dialog.getByLabel('Size').selectOption({ label: '800 × 600 px' })
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Save PNG' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('model.png')
  const bytes = await readFile((await file.path())!)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.readUInt32BE(16)).toBe(800)
  expect(bytes.readUInt32BE(20)).toBe(600)
  expect(csp).toEqual([])
})

test('saves a looping turntable GIF encoded in a worker', async ({ page }) => {
  const csp = watchCspViolations(page)
  const dialog = await openExport(page, 'Turntable')
  await dialog.getByLabel('Frames').fill('36')
  const download = page.waitForEvent('download', { timeout: 60_000 })
  await dialog.getByRole('button', { name: 'Save GIF' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('model-turntable.gif')
  const bytes = await readFile((await file.path())!)
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a')
  expect(bytes.readUInt16LE(6)).toBe(480)
  expect(bytes.includes(Buffer.from('NETSCAPE2.0'))).toBe(true)
  expect(csp).toEqual([])
})
