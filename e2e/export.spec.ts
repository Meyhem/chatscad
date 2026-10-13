import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { openWithStarter, watchCspViolations } from './support'

async function openExport(page: Page, tab: string) {
  await openWithStarter(page)
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

test('the image preview fits inside its box at every size', async ({ page }) => {
  const dialog = await openExport(page, 'Image')
  for (const label of ['1080 × 1080 px', '1920 × 1080 px', '800 × 600 px']) {
    await dialog.getByLabel('Size').selectOption({ label })
    const preview = dialog.getByRole('img', { name: `Preview of the ${label} image` })
    await expect(preview).toBeVisible()
    const box = (await preview.locator('..').boundingBox())!
    const canvas = (await preview.boundingBox())!
    expect(canvas.y).toBeGreaterThanOrEqual(box.y)
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(box.y + box.height + 0.5)
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
  }
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

test('saves a dimensioned drawing with the model in the front view', async ({ page }) => {
  const csp = watchCspViolations(page)
  const dialog = await openExport(page, 'Drawing')
  const preview = dialog.getByRole('img', { name: 'Preview of the drawing' })
  await expect(preview).toBeVisible()
  // The filament is orange (red well above blue); paper and ink are grey, so only the model qualifies.
  const modelPixels = await preview.evaluate((el) => {
    const c = el as HTMLCanvasElement
    const { data } = c.getContext('2d')!.getImageData(0, c.height / 2, c.width / 2, c.height / 2)
    let n = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] - data[i + 2] > 60) n++
    return n
  })
  expect(modelPixels).toBeGreaterThan(100)

  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Save PNG' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('model-drawing.png')
  const bytes = await readFile((await file.path())!)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.readUInt32BE(16)).toBe(2339)
  expect(bytes.readUInt32BE(20)).toBe(1654)
  expect(csp).toEqual([])
})
