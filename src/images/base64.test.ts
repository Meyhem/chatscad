// @vitest-environment node
import { blobToBase64, dataUrlToBlob } from './base64'

it('encodes a blob as base64 without a data: prefix', async () => {
  expect(await blobToBase64(new Blob(['hello']))).toBe('aGVsbG8=')
})

it('encodes large blobs in chunks', async () => {
  const bytes = new Uint8Array(200_000).fill(65)
  const encoded = await blobToBase64(new Blob([bytes]))
  expect(atob(encoded)).toHaveLength(200_000)
})

it('turns a base64 data URL back into a typed blob', async () => {
  const blob = dataUrlToBlob('data:image/png;base64,aGVsbG8=')
  expect(blob.type).toBe('image/png')
  expect(await blob.text()).toBe('hello')
})

it('rejects anything that is not a base64 data URL', () => {
  expect(() => dataUrlToBlob('https://example.test/a.png')).toThrow('Not a base64 data URL')
})
