import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { UNTITLED } from '../history/projectStore'
import { NO_VISION_EXPLANATION } from '../images/attachments'
import type { PreparedImage } from '../images/prepareImage'
import { layoutFor, type DraftPhoto } from '../photos/photoDraft'
import { PhotoSlots } from '../photos/PhotoSlots'
import { MAX_BRIEF_CHARS, type PhotoScale } from '../photos/projectPhotos'
import { useDraftPhotos } from '../photos/useDraftPhotos'
import { useVisionSupport } from '../refine/useVisionSupport'
import { LIBRARY_NAMES, type LibraryName } from '../render/libraries'
import { useAppStore } from '../state/store'
import { IconCamera, IconCheck, IconFile, IconInfo, IconWarning, IconX } from '../ui/icons'
import { LibraryCard, RECOMMENDED_LIBRARY } from '../ui/LibraryCard'
import { Modal } from '../ui/Modal'

const DEFAULT_LIBRARIES: LibraryName[] = [RECOMMENDED_LIBRARY]

export interface NewProjectResult {
  name: string
  enabledLibraries: LibraryName[]
  photos?: { photos: DraftPhoto[]; brief: string; scale: PhotoScale }
}

interface Props {
  /** May return a promise: the dialog stays open, with the draft, until it resolves, and shows why if it rejects. */
  onCreate(result: NewProjectResult): void | Promise<void>
  onClose(): void
  /** Whether the active model takes images; read from the providers by default. */
  vision?: boolean
  prepare?(blob: Blob): Promise<PreparedImage>
  objectUrl?(blob: Blob): string
}

type Start = 'blank' | 'photos'
type Layout = 'one' | 'angles'

const ONE_PHOTO_TIPS = [
  'Shoot straight at the side that shows the shape best.',
  'Put a coin, card or ruler next to it for scale.',
  'What one photo cannot show is guessed. Add angles later from the project.',
]

interface Choice<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

/** A segmented radio group: one tab stop, the arrow keys move between the enabled options. */
function Segmented<T extends string>({ labelledBy, value, options, onChange }: { labelledBy: string; value: T; options: Choice<T>[]; onChange(value: T): void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
    const next = enabled[(enabled.findIndex((o) => o.value === value) + step + enabled.length) % enabled.length]
    if (!next) return
    onChange(next.value)
    e.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus()
  }
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="pc-tabs pc-seg self-start" onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={o.value === value}
          aria-disabled={o.disabled || undefined}
          tabIndex={o.value === value ? 0 : -1}
          className="pc-tab"
          onClick={() => !o.disabled && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function NewProjectDialog({ onCreate, onClose, vision: visionProp, prepare, objectUrl }: Props) {
  const visionFromStore = useVisionSupport()
  const vision = visionProp ?? visionFromStore
  const [name, setName] = useState(UNTITLED)
  const [enabled, setEnabled] = useState<LibraryName[]>(DEFAULT_LIBRARIES)
  const [chosenStart, setStart] = useState<Start>('blank')
  const [layout, setLayout] = useState<Layout>('angles')
  const [brief, setBrief] = useState('')
  const [scale, setScale] = useState<PhotoScale>('reference')
  const [showLibraries, setShowLibraries] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const start: Start = chosenStart === 'photos' && vision ? 'photos' : 'blank'

  const layoutNow = useRef(layout)
  const { draft, latest, commit, onAdd, onRemove, mounted } = useDraftPhotos({ layout: () => layoutNow.current, prepare, objectUrl })
  const changeLayout = (next: Layout) => {
    layoutNow.current = next
    setLayout(next)
    const photos = layoutFor(next, latest.current.photos)
    for (const p of latest.current.photos) if (!photos.some((kept) => kept.id === p.id)) URL.revokeObjectURL(p.url)
    commit({ photos, error: null })
  }

  const toggle = (list: LibraryName[], lib: LibraryName) =>
    LIBRARY_NAMES.filter((n) => (n === lib ? !list.includes(n) : list.includes(n)))
  const libraryCards = LIBRARY_NAMES.map((lib) => (
    <LibraryCard key={lib} lib={lib} on={enabled.includes(lib)} onToggle={() => setEnabled((list) => toggle(list, lib))} />
  ))

  const summary =
    enabled.length === 0
      ? 'No libraries: the AI writes plain OpenSCAD that opens in any OpenSCAD and renders fastest.'
      : `The AI may use ${enabled.join(' and ')}. They are bundled with the app and work offline.`

  /** Closing mid-create would lose the outcome; Cancel, Close, Escape and the scrim wait for it, as in the Photos dialog. */
  const close = () => {
    if (!saving) onClose()
  }

  const ready = name.trim() !== '' && (start === 'blank' || (draft.photos.length > 0 && brief.trim() !== ''))

  return (
    <Modal labelledBy="new-project-title" onClose={close} className={`pc-dialog ${start === 'photos' ? 'max-w-[920px]' : 'max-w-[600px]'} gap-0 p-0`}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!ready || saving) return
          setSaving(true)
          setCreateError(null)
          try {
            await onCreate({
              name: name.trim(),
              enabledLibraries: enabled,
              ...(start === 'photos' ? { photos: { photos: layoutFor(layout, draft.photos), brief: brief.trim(), scale } } : {}),
            })
          } catch (err) {
            if (mounted.current) setCreateError(`Could not create the project: ${err instanceof Error ? err.message : String(err)}`)
          } finally {
            if (mounted.current) setSaving(false)
          }
        }}
      >
        <div className="flex items-start gap-4 px-6 pt-6">
          <div className="flex flex-1 flex-col gap-1">
            <h2 id="new-project-title">New project</h2>
            <p className="pc-muted">Start blank, or from photos of a real object. Photos are a starting point; describe the rest in words.</p>
          </div>
          <button type="button" className="pc-btn is-icon is-ghost" aria-label="Close" disabled={saving} onClick={close}>
            <IconX className="pc-i" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-6 p-6">
          <div className="grid items-end gap-6 md:grid-cols-2">
            <div className="pc-field">
              <label htmlFor="new-project-name">Name</label>
              <div className="pc-input">
                <input id="new-project-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <div className="pc-field">
              <span id="new-project-start" className="text-[13px] font-semibold">
                Start from
              </span>
              <Segmented<Start>
                labelledBy="new-project-start"
                value={start}
                onChange={setStart}
                options={[
                  {
                    value: 'blank',
                    label: (
                      <>
                        <IconFile className="pc-i" aria-hidden="true" />
                        Blank
                      </>
                    ),
                  },
                  {
                    value: 'photos',
                    disabled: !vision,
                    label: (
                      <>
                        <IconCamera className="pc-i" aria-hidden="true" />
                        Photos
                      </>
                    ),
                  },
                ]}
              />
            </div>
          </div>

          {!vision && (
            <div className="pc-callout is-warn">
              <IconWarning className="pc-i" aria-hidden="true" />
              <div className="pc-callout-body">
                <strong>Photos need a model with vision</strong>
                <span className="pc-muted">{NO_VISION_EXPLANATION}</span>
              </div>
              <button
                type="button"
                className="pc-btn is-sm"
                onClick={() => {
                  if (saving) return
                  useAppStore.getState().setView('settings')
                  onClose()
                }}
              >
                Open AI providers
              </button>
            </div>
          )}

          {start === 'photos' ? (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="pc-stack gap-3">
                  <div className="pc-row justify-between">
                    <span id="new-project-photos" className="text-[13px] font-semibold">
                      Photos
                    </span>
                    <Segmented<Layout>
                      labelledBy="new-project-photos"
                      value={layout}
                      onChange={changeLayout}
                      options={[
                        { value: 'one', label: 'One photo' },
                        { value: 'angles', label: 'Several angles' },
                      ]}
                    />
                  </div>
                  <PhotoSlots layout={layout} photos={draft.photos} onAdd={onAdd} onRemove={onRemove} error={draft.error} />
                  {layout === 'one' ? (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {ONE_PHOTO_TIPS.map((tip) => (
                        <li key={tip} className="pc-caption flex items-start gap-2">
                          <IconCheck className="pc-i text-ok" aria-hidden="true" />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="pc-caption">Fill the angles you have. One is enough to start. Drop photos here, or click a slot to choose or take one.</span>
                  )}
                </div>

                <div className="pc-stack gap-4">
                  <div className="pc-field">
                    <label htmlFor="np-desc">Describe it</label>
                    <div className="pc-area h-24 md:h-[188px]">
                      <textarea
                        id="np-desc"
                        value={brief}
                        maxLength={MAX_BRIEF_CHARS}
                        placeholder="What it is, sizes you know, what it attaches to"
                        onChange={(e) => setBrief(e.target.value)}
                      />
                    </div>
                    <span className="pc-hint">Sizes you know, what it fits or holds, and anything the photos cannot show, such as the back or the depth of a hole.</span>
                  </div>
                  <div className="pc-field">
                    <label htmlFor="np-scale">Scale</label>
                    <select id="np-scale" className="pc-select" value={scale} onChange={(e) => setScale(e.target.value as PhotoScale)}>
                      <option value="reference">Find a coin, card or ruler in the photos</option>
                      <option value="description">Only the sizes in the description</option>
                    </select>
                    <span className="pc-hint">With neither, every size is a guess and the first reply says so.</span>
                  </div>
                </div>
              </div>

              <div className="pc-stack">
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
                  <span className="pc-label">Libraries</span>
                  {LIBRARY_NAMES.map((lib) =>
                    enabled.includes(lib) ? (
                      <span key={lib} className="pc-chip is-accent">
                        {lib}
                      </span>
                    ) : (
                      <span key={lib} className="pc-caption">
                        {lib} off
                      </span>
                    ),
                  )}
                  <span className="flex-1" />
                  <button type="button" className="pc-btn is-sm is-ghost" aria-expanded={showLibraries} onClick={() => setShowLibraries((v) => !v)}>
                    Change
                  </button>
                </div>
                {showLibraries && libraryCards}
              </div>
            </>
          ) : (
            <>
              <div className="pc-stack">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="pc-label">Libraries</span>
                  <span className="pc-caption">Optional · change later in Settings › Libraries</span>
                </div>
                {libraryCards}
              </div>

              <div className="pc-callout">
                <IconInfo className="pc-i" aria-hidden="true" />
                <span className="pc-callout-body pc-muted">{summary}</span>
              </div>
            </>
          )}
        </div>

        <div className="pc-dialog-actions items-center border-t border-line px-6 py-4">
          {createError ? (
            <span role="alert" className="pc-caption min-w-[12rem] flex-1 text-error">
              {createError}
            </span>
          ) : (
            <span className="pc-caption min-w-[12rem] flex-1">
              {start === 'photos'
                ? 'The agent plans checks from your description and photos, then builds v1.'
                : 'Opens an empty project. Describe a part, write code, or start from an example.'}
            </span>
          )}
          <button type="button" className="pc-btn" disabled={saving} onClick={close}>
            Cancel
          </button>
          <button type="submit" className="pc-btn is-primary" disabled={!ready || saving}>
            {start === 'photos' ? 'Create and build' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
