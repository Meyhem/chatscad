import { expect, test, type Page } from '@playwright/test'
import { FAKE_BASE, RENDER_TIMEOUT, seedFakeProvider, waitForAppReady } from './support'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
const FENCE = '```'
const REPLY = `Made a cube.\n\n${FENCE}openscad\ncube([20, 20, 10]);\n${FENCE}\n`

/** A fake OpenAI-compatible stream: reasoning first, then the reply. Records chat bodies. */
async function reasoningLlm(page: Page, models: unknown[]): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = []
  await page.route(`${FAKE_BASE}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (req.url().endsWith('/models')) {
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ data: models }) })
    }
    const body = req.postDataJSON() as Record<string, unknown>
    bodies.push(body)
    const chunks = [
      { choices: [{ index: 0, delta: { reasoning: 'The wall is 1.6 mm.\n' } }] },
      { choices: [{ index: 0, delta: { reasoning: 'A plain cube will do.' } }] },
      { choices: [{ index: 0, delta: { content: REPLY }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 900, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: 320 } } },
    ]
    const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse })
  })
  return bodies
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Prompt' }).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('reasoning streams into a collapsed box, expands, and survives a reload; no max_tokens is sent', async ({ page }) => {
  const bodies = await reasoningLlm(page, [{ id: 'fake-model' }])
  await seedFakeProvider(page)
  await send(page, 'A cube')

  const header = page.getByText(/^Thought for \d+ s · 320 tokens$/)
  await expect(header).toBeVisible({ timeout: RENDER_TIMEOUT })
  await expect(page.getByText('A plain cube will do.')).toBeHidden()
  await header.click()
  await expect(page.locator('.pc-reasoning-body')).toContainText('The wall is 1.6 mm.')
  await expect(page.locator('.pc-reasoning-body')).toContainText('A plain cube will do.')
  await page.locator('.pc-reasoning').screenshot({ path: 'test-results/reasoning-box.png' })
  expect(bodies[0]).not.toHaveProperty('max_tokens')

  await page.reload()
  await waitForAppReady(page)
  await expect(page.getByText(/^Thought for \d+ s · 320 tokens$/)).toBeVisible({ timeout: RENDER_TIMEOUT })
})

test('the effort picker appears for a reasoning model and its choice reaches the request', async ({ page }) => {
  const bodies = await reasoningLlm(page, [{ id: 'fake-model', supported_parameters: ['reasoning'] }])
  await seedFakeProvider(page)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chatscad')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = db.transaction('providerProfiles', 'readwrite')
    const store = tx.objectStore('providerProfiles')
    const row = await new Promise<Record<string, unknown>>((resolve) => {
      const r = store.get('fake-profile')
      r.onsuccess = () => resolve(r.result as Record<string, unknown>)
    })
    store.put({ ...row, cachedModels: [{ id: 'fake-model', reasoning: { efforts: true, canDisable: true, adaptive: false } }] })
    await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()))
    db.close()
  })
  await page.reload()
  await waitForAppReady(page)

  await page.getByRole('button', { name: 'Reasoning effort: Default' }).click()
  await page.locator('.pc-composer').screenshot({ path: 'test-results/effort-picker.png' })
  await page.getByRole('menuitemradio', { name: /High/ }).click()
  await expect(page.getByRole('button', { name: 'Reasoning effort: High' })).toBeVisible()

  await send(page, 'A cube')
  await expect(page.getByText(/^Thought for/)).toBeVisible({ timeout: RENDER_TIMEOUT })
  expect(bodies.at(-1)).toMatchObject({ reasoning_effort: 'high' })
})

test('a long model name and the effort chip stay on one line in the composer bar', async ({ page }) => {
  const long = 'deepseek/deepseek-r1-distill-llama-70b'
  await reasoningLlm(page, [{ id: long, supported_parameters: ['reasoning'] }])
  await seedFakeProvider(page, { activeModel: long })
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chatscad')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = db.transaction('providerProfiles', 'readwrite')
    const store = tx.objectStore('providerProfiles')
    const row = await new Promise<Record<string, unknown>>((resolve) => {
      const r = store.get('fake-profile')
      r.onsuccess = () => resolve(r.result as Record<string, unknown>)
    })
    store.put({ ...row, defaultModel: id, cachedModels: [{ id, reasoning: { efforts: true, canDisable: true, adaptive: false } }] })
    await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()))
    db.close()
  }, long)
  await page.reload()
  await waitForAppReady(page)

  const model = page.getByRole('button', { name: `Model: ${long}` })
  const effort = page.getByRole('button', { name: 'Reasoning effort: Default' })
  for (const button of [model, effort]) {
    const box = (await button.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(28)
  }
  const bar = (await page.locator('.pc-composer-bar').boundingBox())!
  const send = (await page.getByRole('button', { name: 'Send' }).boundingBox())!
  expect(send.x + send.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5)
  // The model options sit inside the input box, on their own row.
  const options = (await page.locator('.pc-opt-row').boundingBox())!
  const picked = (await model.boundingBox())!
  expect(picked.x + picked.width).toBeLessThanOrEqual(options.x + options.width + 0.5)
})
