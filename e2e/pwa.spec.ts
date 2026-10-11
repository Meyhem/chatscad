import { expect, test } from '@playwright/test'
import { RENDER_TIMEOUT, replaceCode, STARTER_CODE, waitForAppReady, watchCspViolations } from './support'

test.use({ serviceWorkers: 'allow' })

test('registers a service worker that keeps the app and OpenSCAD working offline', async ({ page, context }) => {
  const csp = watchCspViolations(page)
  await page.goto('./')
  const scriptURL = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? '')
  expect(new URL(scriptURL).pathname).toBe(`${new URL(page.url()).pathname}sw.js`)
  await waitForAppReady(page)
  await replaceCode(page, STARTER_CODE)
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  // The rendered code is saved as a version before going offline.
  await page.locator('.cm-content').blur()

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('dims')).toHaveText('20 × 20 × 10 mm', { timeout: RENDER_TIMEOUT })
  await context.setOffline(false)
  expect(csp).toEqual([])
})

test('serves an installable manifest with the generated icons', async ({ page, request }) => {
  await page.goto('./')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const manifestUrl = new URL(href!, page.url())
  const manifest = (await (await request.get(manifestUrl.toString())).json()) as {
    display: string
    icons: Array<{ src: string; sizes: string; purpose?: string }>
  }
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512'])
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, manifestUrl).toString())
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('image/png')
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /icons\/icon-192\.png$/)
})
