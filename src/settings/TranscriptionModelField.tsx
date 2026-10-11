import { useEffect, useState } from 'react'
import { usePrefs } from './prefsStore'

export function TranscriptionModelField() {
  const model = usePrefs((s) => s.transcriptionModel)
  const update = usePrefs((s) => s.update)
  const [text, setText] = useState(model)
  useEffect(() => setText(model), [model])
  return (
    <div className="pc-field">
      <label htmlFor="transcription-model">Transcription model</label>
      <div className="pc-input is-mono">
        <input id="transcription-model" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void update({ transcriptionModel: text })} />
      </div>
      <span className="pc-hint">Used for dictation where the browser has no speech recognition, on profiles with Audio switched on.</span>
    </div>
  )
}
