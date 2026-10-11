import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../render/result'
import { useAppStore } from '../../state/store'
import { readToken } from '../../theme/tokens'
import { IconDownload, IconPause, IconPlay } from '../../ui/icons'
import { useReducedMotion } from '../../ui/useReducedMotion'
import { isAbortError } from '../../util/abort'
import { FramePreview } from '../FramePreview'
import { renderFrames, turntablePoses } from '../frames'
import { ProgressBar } from '../ProgressBar'
import { saveFile } from '../saveFile'
import { GIF_SIZES, previewSize } from '../sizes'
import { clampFrames, exportTurntable, formatGifProgress, turntableDelayMs, type GifProgress } from '../turntable'
import { useFrameLoop } from '../useFrameLoop'
import { NothingToExport, TabBody, TabFooter } from './layout'

export function TurntableTab() {
  const mesh = useAppStore((s) => s.mesh)
  const [framesText, setFramesText] = useState('48')
  const [sizeIndex, setSizeIndex] = useState(0)
  const [transparent, setTransparent] = useState(false)
  const [preview, setPreview] = useState<ImageData | null>(null)
  const [progress, setProgress] = useState<GifProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useRef<AbortController | null>(null)
  const [committedFrames, setCommittedFrames] = useState(48)
  const frames = clampFrames(Number(framesText))
  const [previewFrames, setPreviewFrames] = useState<ImageData[]>([])
  const reducedMotion = useReducedMotion()
  const [paused, setPaused] = useState(reducedMotion)
  const delay = turntableDelayMs(committedFrames)
  const index = useFrameLoop(previewFrames.length, delay, !paused && progress === null)

  useEffect(() => () => run.current?.abort(), [])

  // The preview plays the GIF's own frames, rendered small once and looped; a settings change starts it again.
  useEffect(() => {
    if (!mesh) return
    let live = true
    const [width, height] = GIF_SIZES[sizeIndex].size
    const frames = renderFrames({
      mesh,
      size: previewSize([width, height]),
      background: transparent ? null : readToken('viewport'),
      cameras: turntablePoses(mesh.bounds, committedFrames, width / height),
    })
    setPreviewFrames([])
    void (async () => {
      for await (const frame of frames) {
        if (!live) break
        setPreviewFrames((f) => [...f, frame])
      }
    })().catch(() => {})
    return () => {
      live = false
      void frames.return(undefined)
    }
  }, [mesh, sizeIndex, transparent, committedFrames])

  if (!mesh) return <NothingToExport />

  const save = async () => {
    const controller = new AbortController()
    run.current = controller
    setError(null)
    setProgress({ done: 0, total: frames, bytes: 0 })
    try {
      const blob = await exportTurntable({
        mesh,
        size: GIF_SIZES[sizeIndex].size,
        frames,
        transparent,
        signal: controller.signal,
        onProgress: setProgress,
        onFrame: setPreview,
      })
      await saveFile(blob, 'model-turntable.gif')
    } catch (e) {
      if (!isAbortError(e)) setError(`Could not make the GIF: ${errorMessage(e)}`)
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
            frame={progress ? preview : (previewFrames[index] ?? null)}
            label="Turntable preview"
            overlay={
              progress ? (
                <span className="pc-caption pc-mono absolute top-3 right-3">
                  frame {progress.done} / {progress.total}
                </span>
              ) : (
                <>
                  {previewFrames.length > 0 && (
                    <span className="pc-caption pc-mono absolute top-3 right-3">
                      frame {index + 1} / {committedFrames}
                    </span>
                  )}
                  <div className="absolute bottom-3 left-3 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={paused ? 'Play preview' : 'Pause preview'}
                      title={paused ? 'Play preview' : 'Pause preview'}
                      className="grid size-(--control-sm) place-items-center rounded-sm border border-line bg-panel text-ink-muted hover:text-ink"
                      onClick={() => setPaused((p) => !p)}
                    >
                      {paused ? <IconPlay className="pc-i" aria-hidden="true" /> : <IconPause className="pc-i" aria-hidden="true" />}
                    </button>
                    {previewFrames.length < committedFrames && (
                      <span className="pc-caption">
                        Rendering preview frames · {previewFrames.length} of {committedFrames}
                      </span>
                    )}
                  </div>
                </>
              )
            }
          />
          <span className="pc-caption">
            Plays like the GIF: {committedFrames} frames, one turn every {((delay * committedFrames) / 1000).toFixed(1)} s.
          </span>
        </div>
        <div className="flex flex-col gap-4">
          <div className="pc-field">
            <label htmlFor="turntable-frames">Frames</label>
            <div className="pc-input is-mono">
              <input
                id="turntable-frames"
                inputMode="numeric"
                value={framesText}
                onChange={(e) => setFramesText(e.target.value)}
                onBlur={() => {
                  setFramesText(String(frames))
                  setCommittedFrames(frames)
                }}
              />
              <span className="pc-unit">frames</span>
            </div>
            <span className="pc-hint">36–72. More frames turn more smoothly and make a bigger file.</span>
          </div>
          <div className="pc-field">
            <label htmlFor="turntable-size">Size</label>
            <select id="turntable-size" className="pc-select" value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
              {GIF_SIZES.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <label className="pc-switch">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            <span className="pc-track" />
            Transparent background
          </label>
        </div>
      </TabBody>
      <TabFooter>
        {progress ? (
          <>
            <ProgressBar label={formatGifProgress(progress)} fraction={progress.done / progress.total} />
            <button type="button" className="pc-btn is-ghost" onClick={() => run.current?.abort()}>
              Cancel
            </button>
          </>
        ) : (
          <span className="min-w-0 flex-1">
            {error && (
              <span role="alert" className="pc-caption text-error">
                {error}
              </span>
            )}
          </span>
        )}
        <button type="button" className="pc-btn is-primary" disabled={progress !== null} onClick={() => void save()}>
          <IconDownload className="pc-i" aria-hidden="true" />
          Save GIF
        </button>
      </TabFooter>
    </>
  )
}
