import { expect, type Page } from '@playwright/test'

export const RENDER_TIMEOUT = 90_000
export const FAKE_BASE = 'https://fake-llm.test/v1'
const FENCE = '`'.repeat(3)

export function watchCspViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) violations.push(msg.text())
  })
  return violations
}

export async function waitForFirstRender(page: Page): Promise<void> {
  await expect(page.getByTestId('render-status')).toHaveText(/^Rendered/, { timeout: RENDER_TIMEOUT })
}

/** New projects start empty: wait until the app has settled on either an empty or a rendered model. */
export async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.getByTestId('render-status')).toHaveText(/^(Nothing to render|Rendered)/, { timeout: RENDER_TIMEOUT })
}

/** The cube-with-a-hole model new projects used to start with (20 × 20 × 10 mm, three parameters). */
export const STARTER_CODE = `/* [Dimensions] */
width = 20;  // [5:1:100]
depth = 20;  // [5:1:100]
height = 10; // [2:1:50]

difference() {
  cube([width, depth, height]);
  translate([width / 2, depth / 2, 2])
    cylinder(h = height, r = min(width, depth) / 4, $fn = 48);
}
`

/** A first visit has no projects, so the New project dialog opens; this starts a blank project from it. */
export async function openBlankProject(page: Page): Promise<void> {
  await page.goto('./')
  await createBlankProject(page)
}

/** Clicks Create project in the New project dialog that opens while no project exists. */
export async function createBlankProject(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'New project' }).getByRole('button', { name: 'Create project' }).click()
  await waitForAppReady(page)
}

export async function replaceCode(page: Page, code: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  // insertText avoids CodeMirror auto-closing brackets that would double up with typed input.
  await page.keyboard.insertText(code)
}

/** Opens the app and types the starter model, for specs that need something rendered. */
export async function openWithStarter(page: Page): Promise<void> {
  await openBlankProject(page)
  await replaceCode(page, STARTER_CODE)
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
}

/** Adds an OpenAI-compatible profile for FAKE_BASE and makes it active, then reloads. */
export async function seedFakeProvider(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await openBlankProject(page)
  await page.evaluate(
    async ({ base, patch }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('chatscad')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const now = Date.now()
      const tx = db.transaction(['providerProfiles', 'settings'], 'readwrite')
      tx.objectStore('providerProfiles').put({
        id: 'fake-profile',
        name: 'Fake LLM',
        adapter: 'openai-compatible',
        baseUrl: base,
        apiKey: 'test-key',
        defaultModel: 'fake-model',
        cachedModels: [{ id: 'fake-model' }],
        capabilities: { streaming: true, vision: false, audio: false },
        priceTable: { 'fake-model': { inputPerMTok: 1, outputPerMTok: 2 } },
        createdAt: now,
        updatedAt: now,
      })
      const store = tx.objectStore('settings')
      const current = await new Promise<Record<string, unknown> | undefined>((resolve) => {
        const req = store.get('app')
        req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined)
      })
      store.put({ id: 'app', autoFixAttempts: 2, ...current, activeProfileId: 'fake-profile', activeModel: 'fake-model', ...patch })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { base: FAKE_BASE, patch: settings },
  )
  await page.reload()
  await waitForAppReady(page)
}

/** Adds an OpenAI-compatible profile with vision for FAKE_BASE (model fake-vision), makes it active, then reloads. */
export async function seedVisionProvider(page: Page): Promise<void> {
  await openBlankProject(page)
  await page.evaluate(async (baseUrl) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('chatscad')
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
      priceTable: { 'fake-vision': { inputPerMTok: 1, outputPerMTok: 2 } },
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
  }, FAKE_BASE)
  await page.reload()
  await waitForAppReady(page)
}

/** Serves an OpenAI-compatible endpoint whose replies are the given codes, in turn, as full files. */
export async function routeFakeLlm(page: Page, codes: string[]): Promise<{ requests: number }> {
  const state = { requests: 0 }
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  }
  await page.route(`${FAKE_BASE}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.url().endsWith('/models')) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'fake-model' }] }) })
    }
    const body = req.postDataJSON() as { stream?: boolean }
    const code = codes[state.requests++ % codes.length]
    const text = `Here is the part.\n\n${FENCE}openscad\n${code}\n${FENCE}\n`
    const usage = { prompt_tokens: 1_000, completion_tokens: 500, total_tokens: 1_500 }
    if (body.stream) {
      const deltas = [text.slice(0, 20), text.slice(20)].map(
        (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`,
      )
      const sse = [...deltas, `data: ${JSON.stringify({ choices: [], usage })}\n\n`, 'data: [DONE]\n\n'].join('')
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse })
    }
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage }),
    })
  })
  return state
}
