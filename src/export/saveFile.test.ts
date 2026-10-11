import type { MockInstance } from 'vitest'
import { saveFile } from './saveFile'

const blob = new Blob(['solid x'], { type: 'model/stl' })
let click: MockInstance<() => void>

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
})

function mockShare(share: () => Promise<void>, canShare = true) {
  Object.defineProperty(navigator, 'share', { value: vi.fn(share), configurable: true })
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => canShare), configurable: true })
}

it('downloads via an anchor when sharing is not preferred', async () => {
  expect(await saveFile(blob, 'model.stl', { preferShare: false })).toBe('downloaded')
  expect(click).toHaveBeenCalledTimes(1)
  const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement
  expect(anchor.download).toBe('model.stl')
  expect(anchor.href).toBe('blob:fake')
})

it('shares the file on devices that prefer sharing', async () => {
  mockShare(() => Promise.resolve())
  expect(await saveFile(blob, 'model.stl', { preferShare: true })).toBe('shared')
  const shared = (navigator.share as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as ShareData
  expect(shared.files?.[0].name).toBe('model.stl')
  expect(click).not.toHaveBeenCalled()
})

it('does not download when the user cancels the share sheet', async () => {
  mockShare(() => Promise.reject(new DOMException('cancelled', 'AbortError')))
  expect(await saveFile(blob, 'model.stl', { preferShare: true })).toBe('cancelled')
  expect(click).not.toHaveBeenCalled()
})

it('falls back to download when sharing fails or files cannot be shared', async () => {
  mockShare(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
  expect(await saveFile(blob, 'a.stl', { preferShare: true })).toBe('downloaded')
  mockShare(() => Promise.resolve(), false)
  expect(await saveFile(blob, 'b.stl', { preferShare: true })).toBe('downloaded')
  expect(click).toHaveBeenCalledTimes(2)
})
