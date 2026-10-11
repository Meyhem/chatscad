// @vitest-environment node
import { NO_VISION_EXPLANATION, type Attachment } from '../images/attachments'
import { boxPickFixture, partPickFixture } from '../test/picks'
import { describeRegion, prepareTurnInput, type TurnInputDeps } from './turnInput'

function fakeDeps(view: Blob | null = null) {
  const saved: Blob[] = []
  const captureViewport = vi.fn(async () => (view ? { blob: view, mediaType: 'image/png' as const, note: '' } : null))
  const deps: TurnInputDeps = {
    saveImage: async (blob) => {
      saved.push(blob)
      return `id-${saved.length}`
    },
    toBase64: async (blob) => `b64:${await blob.text()}`,
    captureViewport,
  }
  return { deps, saved, captureViewport }
}

const attachment = (name: string, note = ''): Attachment => ({
  id: name,
  blob: new Blob([name], { type: 'image/jpeg' }),
  mediaType: 'image/jpeg',
  name: `${name}.jpg`,
  note,
  url: 'blob:x',
})

it('sends plain text as a string', async () => {
  const { deps } = fakeDeps()
  expect(await prepareTurnInput({ text: 'Make it taller', attachments: [], pick: null, vision: false }, deps)).toEqual({
    userText: 'Make it taller',
    selection: undefined,
    imageBlobIds: [],
  })
})

it('turns a picked part into the selection', async () => {
  const { deps } = fakeDeps()
  const input = await prepareTurnInput({ text: 'Wider', attachments: [], pick: partPickFixture(), vision: false }, deps)
  expect(input.selection).toEqual({ startLine: 15, endLine: 17, label: 'bores' })
  expect(input.userText).toBe('Wider')
})

it('sends images as parts, notes right after their image, and stores each image', async () => {
  const { deps, saved } = fakeDeps()
  const input = await prepareTurnInput(
    { text: 'Like this', attachments: [attachment('photo'), attachment('sketch', 'two M4 holes')], pick: null, vision: true },
    deps,
  )
  expect(input.userText).toEqual([
    { type: 'text', text: 'Like this' },
    { type: 'image', mediaType: 'image/jpeg', data: 'b64:photo' },
    { type: 'image', mediaType: 'image/jpeg', data: 'b64:sketch' },
    { type: 'text', text: 'Note for the image above: two M4 holes' },
  ])
  expect(input.imageBlobIds).toEqual(['id-1', 'id-2'])
  expect(saved).toHaveLength(2)
})

it('a region on a vision profile sends the outlined view and the coordinates', async () => {
  const { deps, captureViewport } = fakeDeps(new Blob(['view'], { type: 'image/png' }))
  const input = await prepareTurnInput({ text: 'Round this off', attachments: [], pick: boxPickFixture(), vision: true }, deps)
  expect(captureViewport).toHaveBeenCalledOnce()
  expect(input.selection).toBeUndefined()
  expect(input.userText).toEqual([
    {
      type: 'text',
      text: `Round this off\n\nThe part I mean is inside ${describeRegion(boxPickFixture().bounds)}, outlined in the attached view of the model.`,
    },
    { type: 'image', mediaType: 'image/png', data: 'b64:view' },
  ])
  expect(input.imageBlobIds).toEqual(['id-1'])
})

it('a region without vision sends the coordinates as text only', async () => {
  const { deps, captureViewport } = fakeDeps(new Blob(['view']))
  const input = await prepareTurnInput({ text: 'Round this off', attachments: [], pick: boxPickFixture(), vision: false }, deps)
  expect(captureViewport).not.toHaveBeenCalled()
  expect(input.userText).toBe('Round this off\n\nThe part I mean is inside the box from [0, 0, 0] to [10, 10, 0] mm (10 × 10 × 0 mm).')
})

it('a region without a capture still sends the coordinates', async () => {
  const { deps } = fakeDeps(null)
  const input = await prepareTurnInput({ text: 'Round this off', attachments: [], pick: boxPickFixture(), vision: true }, deps)
  expect(typeof input.userText).toBe('string')
})

it('refuses images on a profile without vision', async () => {
  const { deps } = fakeDeps()
  await expect(prepareTurnInput({ text: 'x', attachments: [attachment('photo')], pick: null, vision: false }, deps)).rejects.toThrow(
    NO_VISION_EXPLANATION,
  )
})
