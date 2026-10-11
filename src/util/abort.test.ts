import { abortError, isAbortError } from './abort'

it('makes DOMException AbortErrors and recognises them', () => {
  const e = abortError('Render cancelled')
  expect(e).toBeInstanceOf(DOMException)
  expect(e.name).toBe('AbortError')
  expect(e.message).toBe('Render cancelled')
  expect(isAbortError(e)).toBe(true)
  expect(isAbortError(new Error('AbortError'))).toBe(false)
  const controller = new AbortController()
  controller.abort()
  expect(isAbortError(controller.signal.reason)).toBe(true)
})
