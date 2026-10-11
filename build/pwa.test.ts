// @vitest-environment node
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CSP } from './csp'
import { ICONS, MAX_PRECACHE_BYTES, PRECACHE_GLOB, primaryColor, pwaHeadPlugin, pwaOptions, readTokens } from './pwa'

const WASM = fileURLToPath(new URL('../public/openscad/openscad.wasm', import.meta.url))
const tokens = readTokens()

it('asks before updating and registers from the bundle, never from an inline script', () => {
  const options = pwaOptions('/chatscad/')
  expect(options.registerType).toBe('prompt')
  expect(options.injectRegister).toBe(false)
  expect(options.base).toBe('/chatscad/')
  expect(CSP).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(CSP).toContain("worker-src 'self' blob:")
})

it('precaches the shell, fonts, icons, library zips and the OpenSCAD WASM', () => {
  const { workbox } = pwaOptions('/')
  expect(workbox?.globPatterns).toEqual([PRECACHE_GLOB])
  for (const ext of ['js', 'css', 'html', 'wasm', 'woff2', 'zip', 'png', 'svg']) expect(PRECACHE_GLOB).toContain(ext)
  // The BOSL2 and MCAD bundles (M3) are .json files under libraries/; they must work offline too.
  expect(PRECACHE_GLOB).toContain('json')
  expect(workbox?.maximumFileSizeToCacheInBytes).toBe(MAX_PRECACHE_BYTES)
})

it.skipIf(!existsSync(WASM))('leaves at least twice the pinned WASM size in the precache limit', () => {
  expect(statSync(WASM).size * 2).toBeLessThanOrEqual(MAX_PRECACHE_BYTES)
})

it('is an installable standalone app coloured from the design tokens', () => {
  const { manifest } = pwaOptions('/')
  if (!manifest) throw new Error('manifest missing')
  expect(manifest).toMatchObject({ name: 'ChatSCAD', short_name: 'ChatSCAD', display: 'standalone', start_url: '.', scope: '.' })
  expect(manifest.background_color).toBe(primaryColor(tokens, 'bg'))
  expect(manifest.theme_color).toBe(primaryColor(tokens, 'panel'))
  expect(manifest.icons).toBe(ICONS)
  expect(ICONS.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
    ['icons/icon-192.png', '192x192', 'any'],
    ['icons/icon-512.png', '512x512', 'any'],
    ['icons/icon-maskable-512.png', '512x512', 'maskable'],
  ])
})

it('adds the PNG and SVG favicons, the iOS touch icon and the theme colour under the base path', () => {
  const transform = pwaHeadPlugin('/chatscad/', tokens).transformIndexHtml as (html: string) => string
  const html = transform('<html><head><title>ChatSCAD</title></head><body></body></html>')
  // PNG first for Safari, which ignores SVG favicons; browsers that support SVG prefer it.
  expect(html).toContain(
    '<link rel="icon" href="/chatscad/icons/icon-32.png" sizes="32x32" type="image/png">\n    <link rel="icon" href="/chatscad/icons/icon.svg" type="image/svg+xml">',
  )
  expect(html).toContain('<link rel="apple-touch-icon" href="/chatscad/icons/icon-192.png">')
  expect(html).toContain(`<meta name="theme-color" content="${primaryColor(tokens, 'panel')}">`)
})
