import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../render/result'
import { useAppStore } from '../../state/store'
import { readToken } from '../../theme/tokens'
import { IconDownload } from '../../ui/icons'
import { isAbortError } from '../../util/abort'
import { FramePreview } from '../FramePreview'
import { presetPose, renderFrames } from '../frames'
import { ProgressBar } from '../ProgressBar'
import { saveFile } from '../saveFile'
import { GIF_SIZES, previewSize } from '../sizes'
import { clampFrames, exportTurntable, formatGifProgress, type GifProgress } from '../turntable'
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
  const frames = clampFrames(Number(framesText))

  useEffect(() => () => run.current?.abort(), [])

  useEffect(() => {
    if (!mesh || run.current) return
    let live = true
    const background = transparent ? null : readToken('viewport')
    void (async () => {
      for await (const frame of renderFrames({
        mesh,
        size: previewSize(GIF_SIZES[sizeIndex].size),
        background,
        cameras: [presetPose(mesh.bounds, 'iso')],
      })) {
        if (live) setPreview(frame)
      }
    })()
    return () => {
      live = false
    }
  }, [mesh, sizeIndex, transparent])

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
        <FramePreview
          frame={preview}
          label="Turntable preview"
          overlay={
            progress && (
              <span className="pc-caption pc-mono absolute top-3 right-3">
                frame {progress.done} / {progress.total}
              </span>
            )
          }
        />
        <div className="flex flex-col gap-4">
          <div className="pc-field">
            <label htmlFor="turntable-frames">Frames</label>
            <div className="pc-input is-mono">
              <input
                id="turntable-frames"
                inputMode="numeric"
                value={framesText}
                onChange={(e) => setFramesText(e.target.value)}
                onBlur={() => setFramesText(String(frames))}
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
