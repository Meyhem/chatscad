// @vitest-environment node
import type { Plugin } from 'vite'
import { CSP, cspPlugin } from './csp'

it('allows only self-hosted scripts plus WASM compilation, and self-hosted fonts', () => {
  expect(CSP).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(CSP).toContain("font-src 'self'")
  expect(CSP).toContain("object-src 'none'")
  expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/)
})

it('injects the CSP meta tag into production HTML only', () => {
  const plugin: Plugin = cspPlugin()
  expect(plugin.apply).toBe('build')
  const transform = plugin.transformIndexHtml as unknown as (html: string) => string
  expect(transform('<html><head><title>x</title></head></html>')).toContain(
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
  )
})
