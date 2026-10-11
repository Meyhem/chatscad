export function abortError(message = 'The operation was aborted'): DOMException {
  return new DOMException(message, 'AbortError')
}

/** By name, not instanceof: a signal's reason can be a DOMException from another realm (jsdom, workers). */
export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}
