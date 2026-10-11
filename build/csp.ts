import type { Plugin } from 'vite'

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  // CodeMirror injects <style> elements at runtime.
  "style-src 'self' 'unsafe-inline'",
  // Archivo and JetBrains Mono are bundled from fontsource; no font CDN.
  "font-src 'self'",
  "img-src 'self' data: blob:",
  // AI providers (M2) are arbitrary https endpoints; local model servers run on localhost.
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

export function cspPlugin(): Plugin {
  return {
    name: 'chatscad-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`),
  }
}
