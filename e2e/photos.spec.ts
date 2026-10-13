import { expect, test, type Page, type Route } from '@playwright/test'
import { FAKE_BASE, RENDER_TIMEOUT, seedFakeProvider, seedVisionProvider, waitForAppReady, watchCspViolations } from './support'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
const FENCE = '`'.repeat(3)
const BRACKET = [
  '// Curtain rod bracket, from 2 photos',
  'rod_d = 25; // [15:0.5:40] from description',
  'height = 50; // [30:1:90] from description',
  'wall = 3; // [1.2:0.2:6] guessed',
  'module wall_plate() cube([wall * 2, 22, height]);',
  'module cup() translate([wall * 2, 0, 0]) difference() { cube([rod_d + 2 * wall, 22, rod_d]); translate([wall, -1, wall]) cube([rod_d, 24, rod_d]); }',
  'wall_plate();',
  'cup();',
  '',
].join('\n')
const PLAN = { checks: [{ kind: 'size', text: 'About 50 mm tall' }, { kind: 'part', text: 'An open cup for a 25 mm rod' }], parts: ['wall_plate', 'cup'] }
const PASSES = {
  summary: 'Matches the photos.',
  checks: [
    { n: 1, status: 'pass', evidence: 'height = 50 in the code.' },
    { n: 2, status: 'pass', evidence: 'Front view shows the cup.' },
  ],
  issues: [],
  newChecks: [],
}

type Part = { type: string; text?: string; image_url?: { url: string } }
type Body = { messages: Array<{ role: string; content: string | Part[] }> }

const sse = (text: string) =>
  [{ choices: [{ index: 0, delta: { content: text } }] }, { choices: [], usage: { prompt_tokens: 200, completion_tokens: 50 } }]
    .map((c) => `data: ${JSON.stringify(c)}\n\n`)
    .join('') + 'data: [DONE]\n\n'
const lastParts = (body: Body) => body.messages.at(-1)!.content as Part[]
const images = (body: Body) => lastParts(body).filter((p) => p.type === 'image_url')
const texts = (body: Body) =>
  lastParts(body)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')

/** A fake vision provider that answers the planner, the builder and the reviewer by their system prompts. */
async function fakeVision(page: Page) {
  const seen = { plan: [] as Body[], build: [] as Body[], review: [] as Body[] }
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
      text = JSON.stringify(PASSES)
    } else {
      seen.build.push(body)
      text = `Built it.\n\n${FENCE}openscad\n${BRACKET}${FENCE}\n`
    }
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(text) })
  })
  return seen
}

async function openNewProject(page: Page) {
  await page.getByRole('button', { name: 'Untitled project' }).click()
  await page.getByRole('menuitem', { name: 'New project…' }).click()
  return page.getByRole('dialog', { name: 'New project' })
}

test('starts a project from two photos, builds with sizes and their sources, adds an angle and refines', async ({ page }) => {
  const seen = await fakeVision(page)
  const csp = watchCspViolations(page)
  await seedVisionProvider(page)

  // New project › Photos: two angles and a description; the scale stays on the default.
  const dialog = await openNewProject(page)
  await dialog.getByRole('radio', { name: 'Photos' }).click()
  await dialog.getByLabel('Add front photo').setInputFiles('e2e/fixtures/photo-front.png')
  await dialog.getByLabel('Add top photo').setInputFiles('e2e/fixtures/photo-top.png')
  await expect(dialog.getByRole('img', { name: 'Top photo' })).toBeVisible()
  await dialog.getByLabel('Describe it').fill('A wall bracket for a 25 mm curtain rod, about 50 mm tall.')
  await dialog.getByRole('button', { name: 'Create and build' }).click()
  await expect(dialog).toBeHidden()

  // The planner and the builder each got both photos with their tags.
  const agent = page.getByRole('region', { name: 'Agent', exact: true })
  await agent.getByTestId('plan-card').getByRole('button', { name: 'Approve and build' }).click()
  await expect(page.getByTestId('dims')).toHaveText('37 × 22 × 50 mm', { timeout: RENDER_TIMEOUT })
  expect(images(seen.plan[0]!)).toHaveLength(2)
  expect(texts(seen.plan[0]!).join('\n')).toContain('Reference photo (front)')
  expect(images(seen.build[0]!)).toHaveLength(2)
  expect(String(seen.build[0]!.messages[0]!.content)).toContain('End every Customizer annotation with its source')
  await expect(agent.getByRole('img', { name: /Attached image/ })).toHaveCount(2)

  // The review got the photos too; the Sizes card shows the guess and lets the user change it.
  await expect(agent.getByTestId('review-card')).toContainText('All 2 pass', { timeout: RENDER_TIMEOUT })
  expect(images(seen.review[0]!)).toHaveLength(6) // four frames plus two photos
  const sizes = agent.getByTestId('sizes-card')
  await expect(sizes).toContainText(/Sizes in v\d+ · 3/)
  await expect(sizes).toContainText('1 guessed')
  await expect(page.getByTestId('param-wall')).toContainText('Guessed')
  const wall = sizes.getByRole('spinbutton', { name: 'wall in mm' })
  await wall.fill('4')
  await wall.blur()
  await expect(page.getByTestId('dims')).toHaveText('41 × 22 × 50 mm', { timeout: RENDER_TIMEOUT })

  // The viewer shows the reference photo; the top angle moves the camera.
  const reference = page.getByTestId('reference-photo')
  await expect(reference.getByRole('img')).toBeVisible()
  await reference.getByRole('radio', { name: 'Top' }).click()
  await expect(reference.getByRole('radio', { name: 'Top' })).toHaveAttribute('aria-checked', 'true')

  // Add a side photo and refine: three photos go with the request, the user's size is kept.
  await agent.getByRole('button', { name: 'Photos · 2' }).click()
  const photos = page.getByRole('dialog', { name: 'Photos' })
  await photos.getByLabel('Add side photo').setInputFiles('e2e/fixtures/photo-side.png')
  await photos.getByRole('button', { name: 'Refine with 3 photos' }).click()
  await expect(photos).toBeHidden()
  await expect(agent.getByTestId('review-card')).toHaveCount(2, { timeout: RENDER_TIMEOUT })
  expect(images(seen.build[1]!)).toHaveLength(3)
  expect(texts(seen.build[1]!).join('\n')).toContain('New photos: side.')
  expect(texts(seen.build[1]!).join('\n')).toContain('The user set these sizes; keep them: wall = 4.')
  await expect(agent.getByRole('button', { name: 'Photos · 3' })).toBeVisible()

  // Reload: the photos and the button survive.
  await page.reload()
  await waitForAppReady(page)
  await expect(agent.getByRole('button', { name: 'Photos · 3' })).toBeVisible()
  expect(csp).toEqual([])
})

test('Photos is disabled without a vision model', async ({ page }) => {
  await seedFakeProvider(page)
  const dialog = await openNewProject(page)
  await expect(dialog.getByRole('radio', { name: 'Photos' })).toHaveAttribute('aria-disabled', 'true')
  await expect(dialog.getByText('Photos need a model with vision')).toBeVisible()
})
