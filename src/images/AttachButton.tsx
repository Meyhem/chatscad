import { useRef, useState } from 'react'
import { IconAttach } from '../ui/icons'
import { NO_VISION_EXPLANATION, useAttachments } from './attachments'

export function AttachButton({ vision, onSketch }: { vision: boolean; onSketch(): void }) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const addFiles = useAttachments((s) => s.addFiles)

  return (
    <span className="relative">
      <button
        type="button"
        className="pc-btn is-icon is-sm is-ghost"
        aria-label="Attach image or sketch"
        aria-haspopup="menu"
        aria-expanded={open}
        title={vision ? 'Attach image or sketch' : NO_VISION_EXPLANATION}
        disabled={!vision}
        onClick={() => setOpen((o) => !o)}
      >
        <IconAttach className="pc-i" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Attach"
          className="absolute bottom-full left-0 z-10 mb-1 flex min-w-44 flex-col rounded-md border border-line bg-panel-raised p-1 shadow-pop"
        >
          <button
            type="button"
            role="menuitem"
            className="pc-btn is-sm is-ghost justify-start"
            onClick={() => {
              setOpen(false)
              input.current?.click()
            }}
          >
            Image from device
          </button>
          <button
            type="button"
            role="menuitem"
            className="pc-btn is-sm is-ghost justify-start"
            onClick={() => {
              setOpen(false)
              onSketch()
            }}
          >
            Sketch
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Image file"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? [])
          e.currentTarget.value = ''
          if (files.length > 0) void addFiles(files)
        }}
      />
    </span>
  )
}
