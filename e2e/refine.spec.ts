import { replaceCode, waitForAppReady } from './support'
import { expect, test, type Page, type Route } from '@playwright/test'

const RENDER_TIMEOUT = 90_000
const BASE = 'https://fake-llm.test/v1'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

type ChatBody = { model: string; messages: Array<{ role: string; content: unknown }> }

const PEG = 'module peg() { translate([15, 15, 10]) cube([10, 10, 10]); }'
const TALLER_PEG = 'module peg() { translate([15, 15, 10]) cube([10, 10, 16]); }'
const TWO_PARTS = ['module plate() { cube([40, 40, 10]); }', PEG, 'union() {', '  plate();', '  peg();', '}', ''].join('\n')

/** A 4 × 4 px PNG. */
const PNG_4PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4UaEBRwzEcQBTUhaBGaoOzwAAAABJRU5ErkJggg==',
  'base64',
)

function sse(text: string): string {
  const chunks = [
    { choices: [{ index: 0, delta: { content: text } }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } },
  ]
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

/** A fake OpenAI-compatible API; chat requests get `replies` in order. Returns the recorded chat bodies. */
async function fakeLlm(page: Page, replies: string[]): Promise<ChatBody[]> {
  const bodies: ChatBody[] = []
  await page.route(`${BASE}/**`, async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (request.url().endsWith('/models')) {
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ id: 'fake-vision' }] }) })
    }
    bodies.push(request.postDataJSON() as ChatBody)
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(replies.shift() ?? 'No more replies.') })
  })
  return bodies
}

/** Writes a vision-capable fake profile into the app's database and makes it active. */
async function seedVisionProfile(page: Page) {
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible({ timeout: RENDER_TIMEOUT })
  await page.evaluate(async (baseUrl) => {
    const open = indexedDB.open('chatscad')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const tx = database.transaction(['providerProfiles', 'settings'], 'readwrite')
    const now = Date.now()
    tx.objectStore('providerProfiles').put({
      id: 'fake-vision',
      name: 'Fake vision',
      adapter: 'openai-compatible',
      baseUrl,
      apiKey: 'test-key',
      defaultModel: 'fake-vision',
      cachedModels: [{ id: 'fake-vision' }],
      capabilities: { streaming: true, vision: true, audio: false },
      priceTable: {},
      createdAt: now,
      updatedAt: now,
    })
    const settings = tx.objectStore('settings')
    const read = settings.get('app')
    read.onsuccess = () => {
      settings.put({ ...(read.result ?? {}), id: 'app', activeProfileId: 'fake-vision', activeModel: 'fake-vision', autoFixAttempts: 0 })
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    database.close()
  }, BASE)
  await page.reload()
  await waitForAppReady(page)
  // These tests are about picking and images: one builder turn each, without the agent.
  await page.getByRole('radio', { name: 'Edit' }).click()
}

test('tap a part, ask for a change, and only that part changes', async ({ page }) => {
  const bodies = await fakeLlm(page, [`Made the peg 6 mm taller.\n\n<<<<<<< SEARCH\n${PEG}\n=======\n${TALLER_PEG}\n>>>>>>> REPLACE\n`])
  await page.goto('./')
  await seedVisionProfile(page)
  await replaceCode(page, TWO_PARTS)
  await expect(page.getByTestId('dims')).toHaveText('40 × 40 × 20 mm', { timeout: RENDER_TIMEOUT })
  const viewer = page.getByTestId('viewer')
  await expect(viewer).toHaveAttribute('data-part-tags', 'ready', { timeout: RENDER_TIMEOUT })
  await page.getByRole('button', { name: 'Fit view' }).click()

  const box = (await viewer.locator('canvas').first().boundingBox())!
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const popover = page.getByRole('region', { name: 'Selected part' })

  // Tap the peg.
  await page.mouse.click(centre.x, centre.y)
  await expect(popover).toContainText('peg')
  await expect(popover).toContainText('module call · line 2')
  await expect(page.getByText('Tap empty space to clear · Esc')).toBeVisible()
  await expect(page.locator('.cm-pick-line')).toHaveText([PEG])

  // Esc and a tap on empty space clear it.
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await page.mouse.click(centre.x, centre.y)
  await expect(popover).toBeVisible()
  await page.mouse.click(box.x + 12, centre.y)
  await expect(popover).toHaveCount(0)

  // An orbit drag that ends on the model picks nothing.
  await page.mouse.move(box.x + 60, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x, centre.y, { steps: 8 })
  await page.mouse.up()
  await expect(popover).toHaveCount(0)

  // Pick again from the fitted view and ask for a scoped change.
  await page.getByRole('button', { name: 'Fit view' }).click()
  await page.mouse.click(centre.x, centre.y)
  await expect(popover).toBeVisible()
  await popover.getByRole('button', { name: 'Ask AI', exact: true }).click()
  const prompt = page.getByRole('textbox', { name: 'Prompt' })
  await expect(prompt).toBeFocused()
  await expect(page.getByText('peg · line 2')).toBeVisible()
  await expect(page.getByText('Only this part will change')).toBeVisible()

  await prompt.fill('Make the peg 6 mm taller')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByTestId('dims')).toHaveText('40 × 40 × 26 mm', { timeout: RENDER_TIMEOUT })

  const lines = (await page.locator('.cm-line').allInnerTexts()).map((l) => l.trimEnd()).filter((l) => l !== '')
  expect(lines).toEqual(TWO_PARTS.replace(PEG, TALLER_PEG).split('\n').filter((l) => l !== ''))
  expect(bodies).toHaveLength(1)
  expect(JSON.stringify(bodies[0])).toContain('Edit only line 2.')
  await expect(page.getByText('peg · line 2')).toHaveCount(0)
})

test('an attached image goes to the model as an image part', async ({ page }) => {
  const bodies = await fakeLlm(page, ['A 30 × 20 × 10 mm block.\n\n```openscad\ncube([30, 20, 10]);\n```\n'])
  await page.goto('./')
  await seedVisionProfile(page)

  await page.getByRole('button', { name: 'Attach image or sketch' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Image from device' }).click()
  await (await chooser).setFiles({ name: 'part.png', mimeType: 'image/png', buffer: PNG_4PX })
  await expect(page.getByRole('img', { name: 'part.png' })).toBeVisible()

  await page.getByRole('textbox', { name: 'Prompt' }).fill('A block like this, 30 by 20 by 10 mm')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByTestId('dims')).toHaveText('30 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })

  expect(bodies).toHaveLength(1)
  expect(bodies[0].messages.at(-1)?.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }),
    ]),
  )
  await expect(page.getByRole('img', { name: 'Attached image 1 of 1' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'part.png' })).toHaveCount(0)
})
