import { currentLibraries } from '../../history/projectStore'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Version } from '../../db/db'
import { useProjectStore } from '../../history/projectStore'
import { ancestry, listVersions } from '../../history/versions'
import { errorMessage } from '../../render/result'
import { getRenderQueue } from '../../render/sharedQueue'
import { IconDownload } from '../../ui/icons'
import { isAbortError } from '../../util/abort'
import { drawCaption } from '../caption'
import { FramePreview } from '../FramePreview'
import { renderFrames } from '../frames'
import { createGifEncoder } from '../gifClient'
import { ProgressBar } from '../ProgressBar'
import { saveFile } from '../saveFile'
import { GIF_SIZES } from '../sizes'
import {
  describePlan,
  formatTimelapseProgress,
  parseSeconds,
  planTimelapse,
  renderTimelapse,
  type TimelapseProgress,
} from '../timelapse'
import { TabBody, TabFooter } from './layout'

function progressFraction(p: TimelapseProgress): number {
  return p.phase === 'compile' ? (p.done / p.total) * 0.5 : 0.5 + (p.done / p.total) * 0.5
}

function Seconds({ id, label, value, onChange }: { id: string; label: string; value: string; onChange(v: string): void }) {
  return (
    <div className="pc-field">
      <label htmlFor={id}>{label}</label>
      <div className="pc-input is-mono">
        <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="pc-unit">s</span>
      </div>
    </div>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="pc-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="pc-track" />
      {label}
    </label>
  )
}

export function TimelapseTab() {
  const project = useProjectStore((s) => s.project)
  const head = useProjectStore((s) => s.head)
  const [history, setHistory] = useState<{ ancestry: Version[]; all: Version[] } | null>(null)
  const [frameDelay, setFrameDelay] = useState('0.8')
  const [hold, setHold] = useState('2')
  const [sizeIndex, setSizeIndex] = useState(0)
  const [caption, setCaption] = useState(true)
  const [turntable, setTurntable] = useState(true)
  const [includeFailed, setIncludeFailed] = useState(false)
  const [includeVariants, setIncludeVariants] = useState(false)
  const [progress, setProgress] = useState<TimelapseProgress | null>(null)
  const [frame, setFrame] = useState<{ image: ImageData; index: number } | null>(null)
  const [message, setMessage] = useState<{ tone: 'warn' | 'error'; text: string } | null>(null)
  const run = useRef<AbortController | null>(null)

  useEffect(() => () => run.current?.abort(), [])

  useEffect(() => {
    if (!project || !head) {
      setHistory(null)
      return
    }
    let live = true
    Promise.all([ancestry(head.id), listVersions(project.id)]).then(
      ([branch, all]) => live && setHistory({ ancestry: branch, all }),
      (e: unknown) => live && setMessage({ tone: 'error', text: `Could not read the history: ${errorMessage(e)}` }),
    )
    return () => {
      live = false
    }
  }, [project, head])

  const plan = useMemo(
    () => (history ? planTimelapse(history.ancestry, history.all, { includeFailed, includeVariants }) : null),
    [history, includeFailed, includeVariants],
  )
  const enough = (plan?.versions.length ?? 0) >= 2

  const save = async () => {
    if (!plan || !enough) return
    const controller = new AbortController()
    run.current = controller
    setMessage(null)
    setFrame(null)
    setProgress({ phase: 'compile', done: 0, total: plan.versions.length, label: plan.versions[0].label })
    try {
      const out = await renderTimelapse(
        {
          versions: plan.versions,
          size: GIF_SIZES[sizeIndex].size,
          frameDelayMs: Math.round(parseSeconds(frameDelay, { min: 0.05, max: 10, fallback: 0.8 }) * 1000),
          holdMs: Math.round(parseSeconds(hold, { min: 0, max: 10, fallback: 2 }) * 1000),
          caption,
          turntable,
          libraries: currentLibraries(),
          signal: controller.signal,
          onProgress: setProgress,
          onFrame: (image, index) => setFrame({ image, index }),
        },
        { queue: getRenderQueue(), renderFrames, createEncoder: createGifEncoder, drawCaption },
      )
      await saveFile(out.blob, 'model-timelapse.gif')
      if (out.failed.length > 0) {
        const verb = out.failed.length === 1 ? 'it no longer compiles' : 'they no longer compile'
        setMessage({ tone: 'warn', text: `Left out ${out.failed.join(', ')}: ${verb}.` })
      }
    } catch (e) {
      if (!isAbortError(e)) setMessage({ tone: 'error', text: `Could not make the GIF: ${errorMessage(e)}` })
    } finally {
      run.current = null
      setProgress(null)
    }
  }

  return (
    <>
      <TabBody>
        <div className="flex min-w-0 flex-col gap-3">
          <FramePreview
            frame={frame?.image ?? null}
            label="Timelapse frame"
            placeholder={<span className="pc-caption">Save GIF renders every version again; frames appear here.</span>}
            overlay={
              frame &&
              progress?.phase === 'frames' && (
                <span className="pc-caption pc-mono absolute top-3 right-3">
                  frame {frame.index + 1} / {progress.total}
                </span>
              )
            }
          />
          <span className="pc-caption">{plan ? describePlan(plan) : 'Reading the history…'}</span>
        </div>
        <div className="flex flex-col gap-4">
          <Seconds id="timelapse-duration" label="Frame duration" value={frameDelay} onChange={setFrameDelay} />
          <Seconds id="timelapse-hold" label="Hold on last frame" value={hold} onChange={setHold} />
          <div className="pc-field">
            <label htmlFor="timelapse-size">Size</label>
            <select id="timelapse-size" className="pc-select" value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
              {GIF_SIZES.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="pc-stack">
            <Switch label="Caption with version and prompt" checked={caption} onChange={setCaption} />
            <Switch label="Slow turntable" checked={turntable} onChange={setTurntable} />
            <Switch label="Include failed versions" checked={includeFailed} onChange={setIncludeFailed} />
            <Switch label="Include unpicked variants" checked={includeVariants} onChange={setIncludeVariants} />
          </div>
        </div>
      </TabBody>
      <TabFooter>
        {progress ? (
          <>
            <ProgressBar label={formatTimelapseProgress(progress)} fraction={progressFraction(progress)} />
            <button type="button" className="pc-btn is-ghost" onClick={() => run.current?.abort()}>
              Cancel
            </button>
          </>
        ) : (
          <span className="min-w-0 flex-1">
            {message ? (
              <span role={message.tone === 'error' ? 'alert' : 'status'} className={`pc-caption ${message.tone === 'error' ? 'text-error' : ''}`}>
                {message.text}
              </span>
            ) : (
              plan && !enough && <span className="pc-caption">Needs at least two versions on this branch that compiled.</span>
            )}
          </span>
        )}
        <button type="button" className="pc-btn is-primary" disabled={!enough || progress !== null} onClick={() => void save()}>
          <IconDownload className="pc-i" aria-hidden="true" />
          Save GIF
        </button>
      </TabFooter>
    </>
  )
}
