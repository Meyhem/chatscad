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

/** Adds an OpenAI-compatible profile for FAKE_BASE and makes it active, then reloads. */
export async function seedFakeProvider(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await page.goto('./')
  await waitForFirstRender(page)
  await page.evaluate(
    async ({ base, patch }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('promptcad')
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
  await waitForFirstRender(page)
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
