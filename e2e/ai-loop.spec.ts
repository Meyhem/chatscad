import { expect, test, type Page, type Route } from '@playwright/test'

const RENDER_TIMEOUT = 90_000
const BASE = 'https://fake-llm.test/v1'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

type ChatBody = { model: string; stream?: boolean; max_tokens?: number; messages: Array<{ role: string; content: string }> }

function sse(text: string, usage: Record<string, number>): string {
  const pieces = text.match(/[\s\S]{1,24}/g) ?? []
  const chunks = [...pieces.map((content) => ({ choices: [{ index: 0, delta: { content } }] })), { choices: [], usage }]
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

/** Serves a fake OpenAI-compatible API. Chat requests get `replies` in order; returns the recorded chat bodies. */
async function fakeLlm(page: Page, replies: string[]): Promise<ChatBody[]> {
  const bodies: ChatBody[] = []
  await page.route(`${BASE}/**`, async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (request.url().endsWith('/models')) {
      return route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ data: [{ id: 'fake-model' }] }),
      })
    }
    const body = request.postDataJSON() as ChatBody
    const stream = { ...CORS, 'content-type': 'text/event-stream' }
    if (body.max_tokens === 16) {
      return route.fulfill({ status: 200, headers: stream, body: sse('OK', { prompt_tokens: 5, completion_tokens: 1 }) })
    }
    bodies.push(body)
    const reply = replies.shift() ?? 'No more replies.'
    return route.fulfill({ status: 200, headers: stream, body: sse(reply, { prompt_tokens: 1000, completion_tokens: 310, cost: 0.011 }) })
  })
  return bodies
}

async function addFakeProfile(page: Page) {
  await expect(page.getByText('Connect an AI model to start')).toBeVisible()
  await page.getByRole('button', { name: 'Add a provider' }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Custom' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Fake LLM')
  await page.getByLabel('Base URL').fill(BASE)
  await page.getByLabel('Default model').fill('fake-model')
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.getByText('Connection works')).toBeVisible()
  await expect(page.getByRole('button', { name: /Fake LLM/ })).toContainText('OK')
  await page.getByRole('button', { name: 'Back to project' }).click()
  await expect(page.getByText('Connect an AI model to start')).toHaveCount(0)
}

async function prompt(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Prompt' }).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('a prompt becomes code that renders, with the cost shown', async ({ page }) => {
  const bodies = await fakeLlm(page, ['Made a 30 × 20 × 10 mm block.\n\n```openscad\ncube([30, 20, 10]);\n```\n'])
  await page.goto('./')
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await addFakeProfile(page)

  await prompt(page, 'A 30 by 20 by 10 mm block')

  await expect(page.getByTestId('dims')).toHaveText('30 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('render-status')).toHaveText(/^Rendered \d+ ms$/)
  await expect(page.locator('.cm-content')).toContainText('cube([30, 20, 10]);')
  await expect(page.getByTestId('chat-reply')).toContainText('Made a 30 × 20 × 10 mm block.')
  // A new project starts at v1 (M3), so the first AI version is v2.
  await expect(page.getByTestId('chat-reply')).toContainText('v2')
  await expect(page.getByTestId('msg-cost')).toHaveText('1,310 tok · $0.011')
  await expect(page.getByTestId('project-cost')).toHaveText('$0.011 this project')
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeEnabled()

  expect(bodies).toHaveLength(1)
  expect(bodies[0]).toMatchObject({ model: 'fake-model', stream: true })
  expect(bodies[0].messages[0].role).toBe('system')
  expect(bodies[0].messages.at(-1)?.content).toContain('The editor is empty.')
})

test('a reply that fails to compile is sent back with the error, and the fixed reply renders', async ({ page }) => {
  const bodies = await fakeLlm(page, [
    'Here is a 12 mm cube.\n\n```openscad\ncube([12, 12, 12]\n```\n',
    'Closed the bracket.\n\n<<<<<<< SEARCH\ncube([12, 12, 12]\n=======\ncube([12, 12, 12]);\n>>>>>>> REPLACE\n',
  ])
  await page.goto('./')
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await addFakeProfile(page)

  await prompt(page, 'A 12 mm cube')

  await expect(page.getByTestId('dims')).toHaveText('12 × 12 × 12 mm', { timeout: RENDER_TIMEOUT })
  await expect(page.getByTestId('render-status')).toHaveText(/^Rendered \d+ ms$/)
  await expect(page.locator('.cm-content')).toContainText('cube([12, 12, 12]);')
  const replies = page.getByTestId('chat-reply')
  await expect(replies).toHaveCount(2)
  await expect(replies.nth(0)).toContainText('Failed')
  await expect(replies.nth(0).getByRole('alert')).toContainText(/^Line \d+: /)
  await expect(replies.nth(1)).toContainText('Closed the bracket.')
  await expect(replies.nth(1)).toContainText('v3')
  await expect(page.getByTestId('project-cost')).toHaveText('$0.022 this project')
  await expect(page.getByTestId('autofix')).toHaveCount(0)

  expect(bodies).toHaveLength(2)
  const fixRequest = bodies[1].messages.at(-1)?.content ?? ''
  expect(fixRequest).toContain('cube([12, 12, 12]')
  expect(fixRequest).toMatch(/ERROR: Parser error/)
  expect(fixRequest).toContain('Request: The code did not compile. Fix the errors above.')
})
