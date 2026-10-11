import { act, renderHook } from '@testing-library/react'
import { newProfile } from '../db/profiles'
import { transcribe } from './transcribe'
import { useComposerDictation } from './useDictation'

vi.mock('./transcribe', () => ({ transcribe: vi.fn(async () => 'a lid') }))
vi.mock('../security/lock', () => ({ unlockedKeyFor: vi.fn(() => 'sk-unlocked') }))

afterEach(() => {
  Reflect.deleteProperty(window, 'MediaRecorder')
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

it('records with an encrypted key once it is unlocked, and sends the unlocked key', async () => {
  const stream = { getTracks: () => [{ stop: vi.fn() }] }
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => stream) }, configurable: true })
  class FakeRecorder {
    mimeType = 'audio/webm'
    ondataavailable: ((e: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    start = vi.fn()
    stop = vi.fn(() => {
      this.ondataavailable?.({ data: new Blob(['audio']) })
      this.onstop?.()
    })
  }
  Object.defineProperty(window, 'MediaRecorder', { value: FakeRecorder, configurable: true })
  const profile = {
    ...newProfile({ name: 'P', adapter: 'openai-compatible', baseUrl: 'https://llm.test/v1', defaultModel: 'm' }),
    apiKey: 'sealed-ciphertext',
    keyEncrypted: true,
    capabilities: { streaming: true, vision: false, audio: true },
  }
  const onChange = vi.fn()
  const { result } = renderHook(() => useComposerDictation({ value: '', onChange, profile }))
  expect(result.current.mode).toBe('record')
  await act(async () => result.current.toggle())
  await act(async () => result.current.toggle())
  expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ apiKey: 'sk-unlocked' }))
  expect(onChange).toHaveBeenLastCalledWith('a lid')
})
