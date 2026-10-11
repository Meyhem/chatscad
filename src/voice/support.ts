import type { ProviderProfile } from '../db/db'

export interface SpeechAlternativeLike {
  transcript: string
}
export interface SpeechResultLike {
  readonly length: number
  readonly isFinal: boolean
  [index: number]: SpeechAlternativeLike
}
export interface SpeechResultEventLike {
  readonly results: { readonly length: number; [index: number]: SpeechResultLike }
}

/** The part of the Web Speech API we use; TypeScript's DOM lib does not declare it. */
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechResultEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function getSpeechRecognition(win: object = window): SpeechRecognitionCtor | null {
  const w = win as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type MicMode = 'speech' | 'record' | null

export function micMode({ speech, recorder, profile }: { speech: boolean; recorder: boolean; profile: ProviderProfile | null }): MicMode {
  if (speech) return 'speech'
  if (recorder && profile?.adapter === 'openai-compatible' && profile.capabilities.audio && !profile.keyEncrypted) return 'record'
  return null
}

export function joinDraft(base: string, spoken: string): string {
  const tail = spoken.trim()
  if (!tail) return base
  const head = base.trimEnd()
  return head ? `${head} ${tail}` : tail
}

export function speechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return "Microphone access was blocked. Allow it in the browser's site settings, then tap the mic again."
    case 'no-speech':
      return 'No speech was heard. Tap the mic and try again.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Speech recognition needs a network connection.'
    default:
      return `Speech recognition stopped: ${code}.`
  }
}
