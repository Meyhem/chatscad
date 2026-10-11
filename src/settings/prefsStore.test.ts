import { readPrefs, writePrefs } from '../db/prefs'
import { usePrefs } from './prefsStore'

vi.mock('../db/prefs', () => ({
  readPrefs: vi.fn(async () => ({ variantCount: 3, lowQualityPreview: true, transcriptionModel: 'whisper-large' })),
  writePrefs: vi.fn(async (patch: object) => ({ variantCount: 1, lowQualityPreview: false, transcriptionModel: 'whisper-1', ...patch })),
}))

beforeEach(() => usePrefs.setState(usePrefs.getInitialState(), true))

it('starts from the defaults until loaded', () => {
  expect(usePrefs.getState()).toMatchObject({ variantCount: 1, lowQualityPreview: false, transcriptionModel: 'whisper-1', loaded: false })
})

it('loads the stored prefs', async () => {
  await usePrefs.getState().load()
  expect(readPrefs).toHaveBeenCalled()
  expect(usePrefs.getState()).toMatchObject({ variantCount: 3, lowQualityPreview: true, transcriptionModel: 'whisper-large', loaded: true })
})

it('applies an update at once and persists it', async () => {
  const pending = usePrefs.getState().update({ variantCount: 3 })
  expect(usePrefs.getState().variantCount).toBe(3)
  await pending
  expect(writePrefs).toHaveBeenCalledWith({ variantCount: 3 })
  expect(usePrefs.getState().variantCount).toBe(3)
})

it('keeps the newest change when an older write finishes later', async () => {
  const pending: Array<() => void> = []
  vi.mocked(writePrefs).mockImplementation(
    (patch) =>
      new Promise((resolve) =>
        pending.push(() => resolve({ variantCount: 1, lowQualityPreview: false, transcriptionModel: 'whisper-1', ...patch } as never)),
      ),
  )
  const a = usePrefs.getState().update({ variantCount: 3 })
  const b = usePrefs.getState().update({ variantCount: 1 })
  pending[1]()
  await b
  pending[0]()
  await a
  expect(usePrefs.getState().variantCount).toBe(1)
})
