import { useEffect, useState } from 'react'
import { getVisualCheck, setVisualCheck } from '../db/visualCheck'

export function VisualCheckSetting() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    void getVisualCheck().then((value) => {
      if (alive) setOn(value)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="flex flex-col gap-1">
      <label className="pc-switch">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.currentTarget.checked
            setOn(next)
            void setVisualCheck(next)
          }}
        />
        <span className="pc-track" aria-hidden="true" />
        Visual check after each AI change
      </label>
      <span className="pc-caption">
        Sends a picture of the new model to a vision model and shows its yes or no answer in the chat. Needs a provider with Vision
        turned on. Uses extra tokens.
      </span>
    </div>
  )
}
