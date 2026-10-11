/** Matches both window.fetch and the Anthropic SDK's `fetch` client option. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function joinUrl(base: string, path: string): string {
  return `${base.trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.trim() || 'the provider'
  }
}

export function portOf(url: string): string {
  try {
    return new URL(url).port
  } catch {
    return ''
  }
}

/** True for servers on this computer (Ollama, LM Studio, llama.cpp …). */
export function isLocalBaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  } catch {
    return false
  }
}

/** True only for an absolute http(s) address. Anything else would resolve against this site, taking the key with it. */
export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url.trim())
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
