import { useState } from 'react'
import { UNTITLED } from '../history/projectStore'
import { LIBRARY_NAMES, type LibraryName } from '../render/libraries'
import { IconInfo, IconX } from '../ui/icons'
import { LibraryCard, RECOMMENDED_LIBRARY } from '../ui/LibraryCard'
import { Modal } from '../ui/Modal'

const DEFAULT_LIBRARIES: LibraryName[] = [RECOMMENDED_LIBRARY]

interface Props {
  onCreate(opts: { name: string; enabledLibraries: LibraryName[] }): void
  onClose(): void
}

export function NewProjectDialog({ onCreate, onClose }: Props) {
  const [name, setName] = useState(UNTITLED)
  const [enabled, setEnabled] = useState<LibraryName[]>(DEFAULT_LIBRARIES)
  const toggle = (list: LibraryName[], lib: LibraryName) =>
    LIBRARY_NAMES.filter((n) => (n === lib ? !list.includes(n) : list.includes(n)))

  const summary =
    enabled.length === 0
      ? 'No libraries: the AI writes plain OpenSCAD that opens in any OpenSCAD and renders fastest.'
      : `The AI may use ${enabled.join(' and ')}. They are bundled with the app and work offline.`

  return (
    <Modal labelledBy="new-project-title" onClose={onClose} className="pc-dialog max-w-[600px] gap-0 p-0">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() !== '') onCreate({ name: name.trim(), enabledLibraries: enabled })
        }}
      >
        <div className="flex items-start gap-4 px-6 pt-6">
          <div className="flex flex-1 flex-col gap-1">
            <h2 id="new-project-title">New project</h2>
            <p className="pc-muted">Name it and pick the OpenSCAD libraries the AI may use for this part.</p>
          </div>
          <button type="button" className="pc-btn is-icon is-ghost" aria-label="Close" onClick={onClose}>
            <IconX className="pc-i" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-6 p-6">
          <div className="pc-stack">
            <label htmlFor="new-project-name" className="pc-label">
              Name
            </label>
            <div className="pc-input">
              <input id="new-project-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div className="pc-stack">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="pc-label">Libraries</span>
              <span className="pc-caption">Optional · change later in Settings › Libraries</span>
            </div>
            {LIBRARY_NAMES.map((lib) => (
              <LibraryCard key={lib} lib={lib} on={enabled.includes(lib)} onToggle={() => setEnabled((list) => toggle(list, lib))} />
            ))}
          </div>

          <div className="pc-callout">
            <IconInfo className="pc-i" aria-hidden="true" />
            <span className="pc-callout-body pc-muted">{summary}</span>
          </div>
        </div>

        <div className="pc-dialog-actions border-t border-line px-6 py-4">
          <button type="button" className="pc-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="pc-btn is-primary" disabled={name.trim() === ''}>
            Create project
          </button>
        </div>
      </form>
    </Modal>
  )
}
