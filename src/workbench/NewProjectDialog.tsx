import { useState } from 'react'
import { UNTITLED } from '../history/projectStore'
import { LIBRARY_INFO, LIBRARY_NAMES, type LibraryName } from '../render/libraries'
import { IconCheck, IconChevronRight, IconInfo, IconX } from '../ui/icons'
import { Modal } from '../ui/Modal'

/** BOSL2 covers threads, gears and fillets, which most printable parts need; MCAD stays opt-in. */
const DEFAULT_LIBRARIES: LibraryName[] = ['BOSL2']
const RECOMMENDED: LibraryName = 'BOSL2'

interface Props {
  onCreate(opts: { name: string; enabledLibraries: LibraryName[] }): void
  onClose(): void
}

export function NewProjectDialog({ onCreate, onClose }: Props) {
  const [name, setName] = useState(UNTITLED)
  const [enabled, setEnabled] = useState<LibraryName[]>(DEFAULT_LIBRARIES)
  const [expanded, setExpanded] = useState<LibraryName[]>([])
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
            {LIBRARY_NAMES.map((lib) => {
              const info = LIBRARY_INFO[lib]
              const on = enabled.includes(lib)
              const open = expanded.includes(lib)
              return (
                <div key={lib} className={`flex flex-col rounded-lg border ${on ? 'border-accent' : 'border-line'} bg-panel pb-3`}>
                  <label className="flex cursor-pointer items-start gap-3 p-4 pb-1">
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{lib}</span>
                        <span className="pc-muted">{info.title}</span>
                        {lib === RECOMMENDED && <span className="pc-chip is-accent">Recommended</span>}
                      </span>
                      <span>{info.summary}</span>
                      <span className="pc-caption pc-mono">
                        {info.version} · {info.license}
                      </span>
                    </span>
                    <span className="pc-switch mt-0.5">
                      <input
                        type="checkbox"
                        aria-label={`Use ${lib} in this project`}
                        checked={on}
                        onChange={() => setEnabled((list) => toggle(list, lib))}
                      />
                      <span className="pc-track" />
                    </span>
                  </label>
                  <button
                    type="button"
                    className="pc-btn is-ghost is-sm mx-3 self-start text-accent"
                    aria-expanded={open}
                    aria-controls={`library-${lib}-contents`}
                    onClick={() => setExpanded((list) => toggle(list, lib))}
                  >
                    <IconChevronRight className={`pc-i transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
                    What is inside
                  </button>
                  {open && (
                    <div id={`library-${lib}-contents`} className="mx-4 mt-1 flex flex-col gap-3 border-t border-line pt-3">
                      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                        {info.contents.map((c) => (
                          <li key={c.name} className="flex items-start gap-2">
                            <IconCheck className="pc-i mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
                            <span>
                              <span className="font-semibold">{c.name}</span> <span className="pc-muted">{c.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p>
                        <span className="pc-muted">Good for:</span> {info.goodFor}
                      </p>
                      <p>
                        <span className="pc-muted">Trade-off:</span> {info.tradeoff}
                      </p>
                      <code className="pc-mono self-start rounded-sm bg-inset px-2 py-1 text-[12px] text-syn-keyword">{info.usage}</code>
                    </div>
                  )}
                </div>
              )
            })}
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
