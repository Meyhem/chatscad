import { expect, test, type Page } from '@playwright/test'
import { openWithStarter } from './support'

test.use({ viewport: { width: 1440, height: 900 } })

function storedLayout(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chatscad')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const row = await new Promise<{ panelLayout?: unknown } | undefined>((resolve) => {
      const get = db.transaction('settings').objectStore('settings').get('app')
      get.onsuccess = () => resolve(get.result as { panelLayout?: unknown } | undefined)
    })
    db.close()
    return row?.panelLayout ?? null
  })
}

test('panel sizes survive a reload and reset from settings', async ({ page }) => {
  await openWithStarter(page)
  // Every column fills the window height.
  for (const name of ['Chat', '3D view', 'Code']) {
    const column = (await page.getByRole('region', { name }).boundingBox())!
    expect(Math.round(column.y + column.height)).toBe(900)
  }
  const splitter = page.getByRole('separator', { name: 'Resize chat' })
  await expect(splitter).toHaveAttribute('aria-valuenow', '360')
  const box = (await splitter.boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 100, y, { steps: 5 })
  await page.mouse.up()
  await expect(splitter).toHaveAttribute('aria-valuenow', '460')
  expect(Math.round((await page.getByRole('region', { name: 'Chat' }).boundingBox())!.width)).toBe(460)

  // The console grows from the keyboard, and the editor keeps its room.
  const consoleDivider = page.getByRole('separator', { name: 'Resize console' })
  await consoleDivider.focus()
  await page.keyboard.press('ArrowUp')
  await expect(consoleDivider).toHaveAttribute('aria-valuenow', '192')

  // The sizes are written to IndexedDB in the background; reload once they are stored.
  await expect.poll(() => storedLayout(page)).toMatchObject({ chatWidth: 460, consoleHeight: 192 })
  await page.reload()
  await expect(page.getByRole('separator', { name: 'Resize chat' })).toHaveAttribute('aria-valuenow', '460')
  await expect(page.getByRole('separator', { name: 'Resize console' })).toHaveAttribute('aria-valuenow', '192')

  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance' }).click()
  await page.getByRole('button', { name: 'Reset layout' }).click()
  await page.getByRole('tab', { name: 'Project' }).click()
  await expect(page.getByRole('separator', { name: 'Resize chat' })).toHaveAttribute('aria-valuenow', '360')
  await expect(page.getByRole('separator', { name: 'Resize console' })).toHaveAttribute('aria-valuenow', '176')
})
