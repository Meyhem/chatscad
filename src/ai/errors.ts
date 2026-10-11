import { errorMessage } from '../render/result'
import { ProviderError } from './types'
import { hostOf, isLocalBaseUrl, portOf } from './url'

function sentence(text: string): string {
  const t = text.trim()
  if (t === '') return ''
  return /[.?!…]$/.test(t) ? t : `${t}.`
}

function join(...parts: string[]): string {
  return parts.filter((p) => p !== '').join(' ')
}

function siteOrigin(): string {
  return typeof location !== 'undefined' ? location.origin : 'https://your-promptcad-site'
}

export function describeProviderError(err: unknown, baseUrl: string): { title: string; body: string } {
  const host = hostOf(baseUrl)
  if (!(err instanceof ProviderError)) {
    return { title: `Something went wrong talking to ${host}`, body: sentence(errorMessage(err)) }
  }
  const detail = sentence(err.message)
  switch (err.kind) {
    case 'network': {
      const origin = siteOrigin()
      if (isLocalBaseUrl(baseUrl)) {
        if (portOf(baseUrl) === '11434') {
          return {
            title: 'Ollama blocked the request from this page (CORS)',
            body: `Allow this site, then restart Ollama: OLLAMA_ORIGINS=${origin} ollama serve. If Ollama isn't running, start it first.`,
          }
        }
        if (portOf(baseUrl) === '1234') {
          return {
            title: 'LM Studio blocked the request from this page (CORS)',
            body: "Turn on CORS in LM Studio's server settings, start the server, then try again.",
          }
        }
        return { title: `Couldn't reach ${host}`, body: `Check that the server on ${host} is running and allows requests from ${origin} (CORS).` }
      }
      return {
        title: `Couldn't reach ${host}`,
        body: `Check the base URL and your connection. If both are right, ${host} doesn't accept requests from a web page (CORS), and PromptCAD has no server to relay them.`,
      }
    }
    case 'auth':
      return { title: `${host} rejected the API key`, body: join(detail, 'Check the key in Settings › AI providers.') }
    case 'not-found':
      return {
        title: `${host} doesn't know this model or address`,
        body: join(detail, 'Pick another model, or check that the base URL ends where the API starts (for example …/v1).'),
      }
    case 'bad-request':
      if (/\bmodel\b/i.test(err.message)) {
        return { title: `${host} doesn't know this model`, body: join(detail, 'Pick another model in the composer or in Settings › AI providers.') }
      }
      return { title: `${host} rejected the request`, body: detail }
    case 'rate-limit':
      return { title: `${host} is limiting requests`, body: join(detail, "Wait a minute and try again, or check your plan's limits.") }
    case 'server':
      return { title: `${host} had a server error`, body: join(detail, 'Try again in a moment.') }
    case 'aborted':
      return { title: 'Stopped', body: 'The request was cancelled before the reply finished.' }
  }
}
