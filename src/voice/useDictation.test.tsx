import { act, renderHook } from '@testing-library/react'
import type { ProviderProfile } from '../db/db'
import { usePrefs } from '../settings/prefsStore'
import type { SpeechRecognitionLike, SpeechResultEventLike } from './support'
import { transcribe } from './transcribe'
import { useComposerDictation, useDictation } from './useDictation'
import { useVoiceStore } from './voiceStore'

vi.mock('./transcribe', () => ({ transcribe: vi.fn(async () => 'five slots') }))

class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
  constructor() {
    FakeRecognition.last = this
  }
}

const event = (...parts: Array<[string, boolean]>): SpeechResultEventLike => ({
  results: parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
})

afterEach(() => {
  Reflect.deleteProperty(window, 'webkitSpeechRecognition')
  Reflect.deleteProperty(window, 'MediaRecorder')
  Reflect.deleteProperty(navigator, 'mediaDevices')
  useVoiceStore.setState({ transcript: null })
})

it('dictates with interim results until the mic is tapped again', () => {
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
  const onText = vi.fn()
  const { result } = renderHook(() => useDictation({ mode: 'speech', onText, transcribeWith: () => null, lang: 'en-GB' }))
  act(() => result.current.toggle())
  const rec = FakeRecognition.last!
  expect(rec).toMatchObject({ continuous: true, interimResults: true, lang: 'en-GB' })
  expect(rec.start).toHaveBeenCalled()
  expect(result.current.state.phase).toBe('listening')

  act(() => rec.onresult?.(event(['make it', false])))
  act(() => rec.onresult?.(event(['make it ', true], ['five slots', false])))
  expect(onText.mock.calls).toEqual([
    ['make it', false],
    ['make it five slots', false],
  ])

  act(() => result.current.toggle())
  expect(rec.stop).toHaveBeenCalled()
  expect(result.current.state).toEqual({ phase: 'idle', message: null })
})

it('reports a blocked microphone', () => {
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
  const { result } = renderHook(() => useDictation({ mode: 'speech', onText: () => {}, transcribeWith: () => null }))
  act(() => result.current.toggle())
  act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }))
  expect(result.current.state.phase).toBe('error')
  expect(result.current.state.message).toMatch(/^Microphone access was blocked/)
})

it('records, then transcribes through the provider', async () => {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] }
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

  const onText = vi.fn()
  const config = { baseUrl: 'https://fake-llm.test/v1', apiKey: 'k', model: 'whisper-1' }
  const { result } = renderHook(() => useDictation({ mode: 'record', onText, transcribeWith: () => config }))
  await act(async () => result.current.toggle())
  expect(result.current.state.phase).toBe('listening')
  await act(async () => result.current.toggle())

  expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), config)
  expect(track.stop).toHaveBeenCalled()
  expect(onText).toHaveBeenCalledWith('five slots', true)
  expect(result.current.state.phase).toBe('idle')
})

it('does nothing without a mic mode', () => {
  const onText = vi.fn()
  const { result } = renderHook(() => useDictation({ mode: null, onText, transcribeWith: () => null }))
  act(() => result.current.toggle())
  expect(result.current.state.phase).toBe('idle')
})

it('writes into the composer after the existing draft and keeps the final transcript', () => {
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
  usePrefs.setState({ transcriptionModel: 'whisper-1' })
  const onChange = vi.fn()
  const { result } = renderHook(() => useComposerDictation({ value: 'Walls 2.4 mm.', onChange, profile: null as ProviderProfile | null }))
  expect(result.current.mode).toBe('speech')
  act(() => result.current.toggle())
  act(() => FakeRecognition.last!.onresult?.(event(['and a lid', true])))
  expect(onChange).toHaveBeenLastCalledWith('Walls 2.4 mm. and a lid')
  expect(useVoiceStore.getState().takeTranscript()).toBe('and a lid')
  expect(useVoiceStore.getState().transcript).toBeNull()
})
