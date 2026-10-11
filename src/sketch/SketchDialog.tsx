import { useEffect, useReducer, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTokens } from '../theme/tokens'
import { IconClear, IconErase, IconLine, IconPen, IconSize, IconUndo } from '../ui/icons'
import {
  drawSketch,
  emptySketch,
  SKETCH_SIZE,
  sketchReducer,
  type Point,
  type SketchItem,
  type SketchResult,
  type SketchTool,
} from './sketchModel'

const TOOLS = [
  { tool: 'pen', label: 'Pen', Icon: IconPen },
  { tool: 'line', label: 'Line', Icon: IconLine },
  { tool: 'size', label: 'Size', Icon: IconSize },
  { tool: 'erase', label: 'Erase', Icon: IconErase },
] as const

const SKETCH_TOKENS = ['inset', 'grid-minor', 'ink', 'accent'] as const
const MIN_DIMENSION_PX = 4

export function SketchDialog({ onCancel, onAttach }: { onCancel(): void; onAttach(result: SketchResult): void }) {
  const t = useTokens(SKETCH_TOKENS)
  const [state, dispatch] = useReducer(sketchReducer, emptySketch)
  const [tool, setTool] = useState<SketchTool>('pen')
  const [draft, setDraft] = useState<SketchItem | null>(null)
  const [pendingDim, setPendingDim] = useState<{ a: Point; b: Point } | null>(null)
  const [mm, setMm] = useState('')
  const [note, setNote] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const items = draft ? [...state.items, draft] : state.items
    drawSketch(ctx, items, { ground: t.inset, grid: t['grid-minor'], ink: t.ink, accent: t.accent })
  }, [state.items, draft, t])

  const toPoint = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / (rect.width || 1)) * SKETCH_SIZE.width,
      y: ((e.clientY - rect.top) / (rect.height || 1)) * SKETCH_SIZE.height,
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pendingDim) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = toPoint(e)
    if (tool === 'erase') {
      dispatch({ type: 'erase', at: p })
      return
    }
    setDraft(tool === 'pen' ? { kind: 'stroke', points: [p] } : { kind: 'line', a: p, b: p })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draft) return
    const p = toPoint(e)
    if (draft.kind === 'stroke') setDraft({ ...draft, points: [...draft.points, p] })
    else if (draft.kind === 'line') setDraft({ ...draft, b: p })
  }

  const onPointerUp = () => {
    if (!draft) return
    setDraft(null)
    if (tool === 'size' && draft.kind === 'line') {
      if (Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) >= MIN_DIMENSION_PX) setPendingDim({ a: draft.a, b: draft.b })
      return
    }
    dispatch({ type: 'add', item: draft })
  }

  const addSize = (e: FormEvent) => {
    e.preventDefault()
    const value = Number(mm.replace(',', '.'))
    if (!pendingDim || !(value > 0)) return
    dispatch({ type: 'add', item: { kind: 'dim', a: pendingDim.a, b: pendingDim.b, mm: value } })
    setPendingDim(null)
    setMm('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sketch"
        className="flex h-full w-full flex-col bg-panel text-ink md:h-auto md:max-h-[92vh] md:w-[480px] md:rounded-lg md:border md:border-line md:shadow-pop"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
      >
        <header className="flex items-center gap-2 border-b border-line p-2">
          <button type="button" className="pc-btn is-ghost" onClick={onCancel}>
            Cancel
          </button>
          <span className="flex-1 text-center font-semibold">Sketch</span>
          <button
            type="button"
            className="pc-btn is-icon is-ghost"
            aria-label="Clear"
            title="Clear"
            disabled={state.items.length === 0}
            onClick={() => dispatch({ type: 'clear' })}
          >
            <IconClear className="pc-i" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pc-btn is-icon is-ghost"
            aria-label="Undo"
            title="Undo"
            disabled={state.undo.length === 0}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <IconUndo className="pc-i" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 bg-inset">
          <canvas
            ref={canvas}
            width={SKETCH_SIZE.width}
            height={SKETCH_SIZE.height}
            aria-label="Sketch canvas"
            className="mx-auto block aspect-[3/4] max-h-full w-full max-w-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDraft(null)}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-line bg-panel px-4 py-3">
          {pendingDim && (
            <form className="pc-row" onSubmit={addSize}>
              <label className="pc-input is-mono">
                <input inputMode="decimal" aria-label="Length in mm" autoFocus value={mm} onChange={(e) => setMm(e.target.value)} />
                <span className="pc-unit">mm</span>
              </label>
              <button type="submit" className="pc-btn is-sm is-primary">
                Add size
              </button>
              <button type="button" className="pc-btn is-sm is-ghost" onClick={() => setPendingDim(null)}>
                Cancel size
              </button>
            </form>
          )}
          <div className="pc-tabs grid grid-cols-4" role="toolbar" aria-label="Sketch tools">
            {TOOLS.map(({ tool: id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`pc-tab justify-center ${tool === id ? 'bg-accent-soft text-ink' : ''}`}
                aria-pressed={tool === id}
                onClick={() => setTool(id)}
              >
                <Icon className="pc-i" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <label className="pc-input">
            <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button
            type="button"
            className="pc-btn is-primary"
            disabled={state.items.length === 0}
            onClick={() => onAttach({ items: state.items, note: note.trim() })}
          >
            Attach to prompt
          </button>
          <span className="pc-caption">
            Choose Size and drag between two points to add a dimension in mm. Sent as an image to vision models only.
          </span>
        </div>
      </div>
    </div>
  )
}
