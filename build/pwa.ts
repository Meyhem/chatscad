import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import type { IconResource, VitePWAOptions } from 'vite-plugin-pwa'

/** The pinned OpenSCAD WASM is ~11 MB; Workbox's 2 MiB default would silently leave it out of the offline cache. */
export const MAX_PRECACHE_BYTES = 32 * 1024 * 1024
export const PRECACHE_GLOB = '**/*.{js,css,html,wasm,woff2,zip,json,png,svg}'

export const ICONS: IconResource[] = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

/** Written by scripts/gen-icons.ts next to the PNGs. */
export const FAVICON = 'icons/icon.svg'
export const FAVICON_PNG = 'icons/icon-32.png'

export interface TokenFile {
  color: { themes: { id: string }[]; tokens: { name: string; value: string | Record<string, string> }[] }
}

export function readTokens(path: URL = new URL('../design/tokens.json', import.meta.url)): TokenFile {
  return JSON.parse(readFileSync(path, 'utf8')) as TokenFile
}

/** A colour token's value in the primary (first, dark) theme. */
export function primaryColor(tokens: TokenFile, name: string): string {
  const theme = tokens.color.themes[0]?.id
  const token = tokens.color.tokens.find((t) => t.name === name)
  const value = typeof token?.value === 'string' ? token.value : theme ? token?.value[theme] : undefined
  if (!value) throw new Error(`Colour token "${name}" not found in design/tokens.json`)
  return value
}

export function pwaOptions(base: string, tokens: TokenFile = readTokens()): Partial<VitePWAOptions> {
  return {
    base,
    registerType: 'prompt',
    // The app imports virtual:pwa-register/react itself; nothing inline goes into index.html (CSP).
    injectRegister: false,
    // The PNG glob already covers the icons.
    includeManifestIcons: false,
    manifest: {
      name: 'ChatSCAD',
      short_name: 'ChatSCAD',
      description: 'Describe a part, get OpenSCAD code, render it in the browser and export STL.',
      display: 'standalone',
      start_url: '.',
      scope: '.',
      background_color: primaryColor(tokens, 'bg'),
      theme_color: primaryColor(tokens, 'panel'),
      icons: ICONS,
    },
    workbox: {
      globPatterns: [PRECACHE_GLOB],
      maximumFileSizeToCacheInBytes: MAX_PRECACHE_BYTES,
      cleanupOutdatedCaches: true,
    },
  }
}

/** The favicons for browser tabs (PNG first for Safari; SVG-capable browsers prefer the SVG); iOS reads apple-touch-icon rather than manifest icons; theme-color tints the browser chrome. */
export function pwaHeadPlugin(base: string, tokens: TokenFile = readTokens()): Plugin {
  const panel = primaryColor(tokens, 'panel')
  return {
    name: 'chatscad-pwa-head',
    transformIndexHtml: (html) =>
      html.replace(
        '</head>',
        `  <meta name="theme-color" content="${panel}">\n    <link rel="icon" href="${base}${FAVICON_PNG}" sizes="32x32" type="image/png">\n    <link rel="icon" href="${base}${FAVICON}" type="image/svg+xml">\n    <link rel="apple-touch-icon" href="${base}icons/icon-192.png">\n  </head>`,
      ),
  }
}
