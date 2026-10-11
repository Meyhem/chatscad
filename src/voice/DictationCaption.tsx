import type { MicMode } from './support'
import type { DictationState } from './useDictation'

export function DictationCaption({ state, mode }: { state: DictationState; mode: MicMode }) {
  if (state.phase === 'error' && state.message) {
    return (
      <p role="alert" className="pc-caption mt-1.5 text-error">
        {state.message}
      </p>
    )
  }
  const text =
    state.phase === 'listening'
      ? mode === 'speech'
        ? 'Listening… tap the mic to stop. Chrome sends speech to Google for recognition.'
        : 'Recording… tap the mic to stop. The audio goes to your provider to be transcribed.'
      : state.phase === 'transcribing'
        ? 'Transcribing…'
        : null
  if (!text) return null
  return (
    <p role="status" className="pc-caption mt-1.5">
      {text}
    </p>
  )
}
