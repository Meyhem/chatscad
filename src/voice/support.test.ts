import type { ProviderProfile } from '../db/db'
import { getSpeechRecognition, joinDraft, micMode, speechErrorMessage, type SpeechRecognitionCtor } from './support'

const profile = (over: Partial<ProviderProfile> = {}) =>
  ({
    adapter: 'openai-compatible',
    capabilities: { streaming: true, vision: false, audio: true },
    keyEncrypted: false,
    ...over,
  }) as ProviderProfile

it('prefers the standard SpeechRecognition and falls back to the webkit one', () => {
  const Standard = class {} as unknown as SpeechRecognitionCtor
  const Webkit = class {} as unknown as SpeechRecognitionCtor
  expect(getSpeechRecognition({ SpeechRecognition: Standard, webkitSpeechRecognition: Webkit })).toBe(Standard)
  expect(getSpeechRecognition({ webkitSpeechRecognition: Webkit })).toBe(Webkit)
  expect(getSpeechRecognition({})).toBeNull()
})

it('uses dictation where it exists, recording only for an audio-capable OpenAI-compatible profile, and hides the mic otherwise', () => {
  expect(micMode({ speech: true, recorder: true, profile: null })).toBe('speech')
  expect(micMode({ speech: false, recorder: true, profile: profile() })).toBe('record')
  expect(micMode({ speech: false, recorder: true, profile: profile({ capabilities: { streaming: true, vision: false, audio: false } }) })).toBeNull()
  expect(micMode({ speech: false, recorder: true, profile: profile({ adapter: 'anthropic' }) })).toBeNull()
  expect(micMode({ speech: false, recorder: true, profile: profile({ keyEncrypted: true }) })).toBeNull()
  expect(micMode({ speech: false, recorder: false, profile: profile() })).toBeNull()
  expect(micMode({ speech: false, recorder: true, profile: null })).toBeNull()
})

it('appends spoken text to the draft with one space', () => {
  expect(joinDraft('', ' make it five slots ')).toBe('make it five slots')
  expect(joinDraft('Walls 2.4 mm.  ', 'And a lid')).toBe('Walls 2.4 mm. And a lid')
  expect(joinDraft('Keep this', '')).toBe('Keep this')
})

it('explains recognition errors in plain words', () => {
  expect(speechErrorMessage('not-allowed')).toBe("Microphone access was blocked. Allow it in the browser's site settings, then tap the mic again.")
  expect(speechErrorMessage('no-speech')).toBe('No speech was heard. Tap the mic and try again.')
  expect(speechErrorMessage('network')).toBe('Speech recognition needs a network connection.')
  expect(speechErrorMessage('bad-grammar')).toBe('Speech recognition stopped: bad-grammar.')
})
