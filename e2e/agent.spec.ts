import { expect, test, type Page, type Route } from '@playwright/test'
import { FAKE_BASE, RENDER_TIMEOUT, waitForAppReady, watchCspViolations } from './support'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}
const FENCE = '`'.repeat(3)

const ONE_RAIL = [
  'module body() cube([40, 20, 10]);',
  'module lid_rail() translate([0, 20, 8]) cube([40, 2, 2]);',
  'body();',
  'lid_rail();',
  '',
].join('\n')
const TWO_RAILS = [
  'module body() cube([40, 20, 10]);',
  'module lid_rail() for (y = [-2, 20]) translate([0, y, 8]) cube([40, 2, 2]);',
  'body();',
  'lid_rail();',
  '',
].join('\n')

const PLAN = { checks: [{ kind: 'part', text: 'A body 40 mm long' }, { kind: 'part', text: 'Rails on both long sides' }], parts: ['body', 'lid_rail'] }
const FAILS = {
  summary: 'The rail is on one side only.',
  checks: [
    { n: 1, status: 'pass', evidence: 'Orange body, 40 mm in the code.' },
    { n: 2, status: 'fail', evidence: 'Right view: one rail.' },
  ],
  issues: [{ severity: 'high', part: 'lid_rail', check: 2, change: 'Mirror the rail onto the other long side.' }],
  newChecks: [],
}
const PASSES = {
  summary: 'Both rails are there.',
  checks: [
    { n: 1, status: 'pass', evidence: 'Body 40 mm.' },
    { n: 2, status: 'pass', evidence: 'Right view: two rails.' },
  ],
  issues: [],
  newChecks: [],
}

type Body = { messages: Array<{ role: string; content: unknown }> }

function sse(text: string): string {
  const chunks = [{ choices: [{ index: 0, delta: { content: text } }] }, { choices: [], usage: { prompt_tokens: 200, completion_tokens: 50 } }]
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

/** A fake vision provider that answers the planner, the builder and the reviewer by their system prompts. */
async function fakeAgent(page: Page) {
  const seen = { plan: [] as Body[], build: [] as Body[], review: [] as Body[] }
  const builds = [ONE_RAIL, TWO_RAILS]
  const reviews = [FAILS, PASSES]
  await page.route(`${FAKE_BASE}/**`, async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (req.url().endsWith('/models')) {
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'fake-vision' }] }) })
    }
    const body = req.postDataJSON() as Body
    const system = String(body.messages[0]?.content ?? '')
    let text: string
    if (system.startsWith('You plan')) {
      seen.plan.push(body)
      text = JSON.stringify(PLAN)
    } else if (system.startsWith('You review')) {
      seen.review.push(body)
      text = JSON.stringify(reviews.shift() ?? PASSES)
    } else {
      seen.build.push(body)
      text = `Made it.\n\n${FENCE}openscad\n${builds.shift() ?? TWO_RAILS}${FENCE}\n`
    }
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(text) })
  })
  return seen
}

async function seedVisionProvider(page: Page) {
  await page.goto('./')
  await waitForAppReady(page)
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

test('plans a new model, builds it, reviews coloured views, fixes the failed check and passes', async ({ page }) => {
  const seen = await fakeAgent(page)
  const csp = watchCspViolations(page)
  await seedVisionProvider(page)

  const agent = page.getByRole('region', { name: 'Agent', exact: true })
  // A new project starts in Agent mode, and the composer says what a run does.
  await expect(page.getByRole('radio', { name: 'Agent' })).toBeChecked()
  await expect(agent.getByText('Reviewer fake-vision · 3 rounds max')).toBeVisible()
  await page.getByRole('textbox', { name: 'Prompt' }).fill('A 40 mm holder with a rail on each long side')
  await page.getByRole('button', { name: 'Run agent' }).click()

  // The plan comes first; nothing is built until it is approved.
  const plan = agent.getByTestId('plan-card')
  await expect(plan).toContainText('Plan · 2 checks')
  await expect(plan).toContainText('Rails on both long sides')
  expect(seen.build).toHaveLength(0)
  await plan.getByRole('button', { name: 'Approve and build' }).click()

  // Build, then the first review: one check fails, its fix is ticked.
  const reviews = agent.getByTestId('review-card')
  await expect(reviews.first()).toContainText('1 of 2 fail', { timeout: RENDER_TIMEOUT })
  await expect(reviews.first().getByRole('img', { name: /view$/ })).toHaveCount(4)
  await expect(reviews.first().getByRole('list', { name: 'Part colours' })).toContainText('lid_rail')
  await expect(reviews.first().getByRole('checkbox')).toBeChecked()
  expect(JSON.stringify(seen.build[0].messages)).toContain('The model must meet these checks')
  const images = (seen.review[0].messages.at(-1)?.content as Array<{ type: string }>).filter((p) => p.type === 'image_url')
  expect(images).toHaveLength(4)
  await expect(agent.getByRole('button', { name: 'Checks · 1 of 2 pass' })).toBeVisible()

  // Fix: the builder gets the issue, the next round passes.
  await reviews.first().getByRole('button', { name: 'Fix 1 issue' }).click()
  await expect(reviews.nth(1)).toContainText('All 2 pass', { timeout: RENDER_TIMEOUT })
  expect(JSON.stringify(seen.build[1].messages)).toContain('lid_rail: Mirror the rail onto the other long side.')
  await expect(agent.getByText('Fix 1 issue from the review')).toBeVisible()
  await expect(agent.getByRole('button', { name: 'Checks · 2 of 2 pass' })).toBeVisible()
  // The whole run is one group, with its steps in order.
  await expect(agent.getByRole('region', { name: 'Agent run' })).toHaveCount(1)
  await expect(agent.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveText([
    'Plan · 2 checks',
    /^Build v\d+$/,
    'Review 1 · 1 fail',
    /^Fix v\d+$/,
    'Review 2 · pass',
  ])

  // The viewer shows the same part colours.
  await page.getByRole('button', { name: 'Part colours' }).click()
  await expect(page.getByTestId('viewer').getByRole('list', { name: 'Part colours' })).toContainText('body')

  // The review frames are blob: images, which the strict CSP allows.
  const loaded = await reviews.first().getByRole('img', { name: 'iso view' }).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)
  expect(loaded).toBe(768)
  expect(csp).toEqual([])
})

test('Edit mode sends one builder turn without review, and Review vN reviews it', async ({ page }) => {
  const seen = await fakeAgent(page)
  await seedVisionProvider(page)
  await page.getByRole('radio', { name: 'Edit' }).click()
  await expect(page.getByText('One builder turn · no review')).toBeVisible()
  await page.getByRole('textbox', { name: 'Prompt' }).fill('A 40 mm holder with a rail on each long side')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByTestId('dims')).toHaveText('40 × 22 × 10 mm', { timeout: RENDER_TIMEOUT })
  expect(seen.plan).toHaveLength(0)
  expect(seen.review).toHaveLength(0)
  await expect(page.getByTestId('chat-reply').getByText('Edit', { exact: true })).toBeVisible()

  // Without checks, Review vN plans them first, then reviews the model on screen.
  await expect(page.getByText('Edits are not reviewed.')).toBeVisible()
  await page.getByRole('button', { name: /^Review v\d+$/ }).click()
  await page.getByTestId('plan-card').last().getByRole('button', { name: 'Approve and review' }).click()
  await expect(page.getByTestId('review-card')).toContainText('1 of 2 fail', { timeout: RENDER_TIMEOUT })
  expect(seen.build).toHaveLength(1)

  // The mode is kept with the project.
  await page.reload()
  await waitForAppReady(page)
  await expect(page.getByRole('radio', { name: 'Edit' })).toBeChecked()
})
