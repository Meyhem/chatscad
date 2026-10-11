import { useEffect, useState } from 'react'
import { errorMessage } from '../../render/result'
import type { Bounds } from '../../render/types'
import { useAppStore } from '../../state/store'
import { readToken } from '../../theme/tokens'
import { IconDownload } from '../../ui/icons'
import { getViewerPose } from '../../viewer/viewerCamera'
import { FramePreview } from '../FramePreview'
import { fitPoseToAspect, presetPose, renderFrames, type CameraPose } from '../frames'
import { imageDataToPng } from '../png'
import { saveFile } from '../saveFile'
import { IMAGE_SIZES, previewSize } from '../sizes'
import { NothingToExport, TabBody, TabFooter } from './layout'

export type CameraChoice = 'current' | 'iso' | 'front' | 'top'
const CAMERA_LABELS: Record<CameraChoice, string> = { current: 'Current view', iso: 'Iso', front: 'Front', top: 'Top' }
const CAMERA_CHOICES = Object.keys(CAMERA_LABELS) as CameraChoice[]

/** The camera for an image of `aspect` (width / height); "Current view" grows the frame rather than crop what the viewer shows. */
export function poseFor(choice: CameraChoice, bounds: Bounds, aspect: number): CameraPose {
  const viewer = choice === 'current' ? getViewerPose() : null
  return viewer ? fitPoseToAspect(viewer, aspect) : presetPose(bounds, choice === 'current' ? 'iso' : choice, aspect)
}

async function lastFrame(frames: AsyncGenerator<ImageData>): Promise<ImageData | null> {
  let last: ImageData | null = null
  for await (const frame of frames) last = frame
  return last
}

export function ImageTab() {
  const mesh = useAppStore((s) => s.mesh)
  const [sizeIndex, setSizeIndex] = useState(0)
  const [camera, setCamera] = useState<CameraChoice>(() => (getViewerPose() ? 'current' : 'iso'))
  const [transparent, setTransparent] = useState(false)
  const [preview, setPreview] = useState<ImageData | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { size, label } = IMAGE_SIZES[sizeIndex]
  const aspect = size[0] / size[1]

  useEffect(() => {
    if (!mesh) return
    let live = true
    const background = transparent ? null : readToken('viewport')
    lastFrame(renderFrames({ mesh, size: previewSize(IMAGE_SIZES[sizeIndex].size), background, cameras: [poseFor(camera, mesh.bounds, aspect)] })).then(
      (frame) => live && setPreview(frame),
      (e: unknown) => live && setError(`Could not draw the preview: ${errorMessage(e)}`),
    )
    return () => {
      live = false
    }
  }, [mesh, sizeIndex, transparent, camera, aspect])

  if (!mesh) return <NothingToExport />

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const background = transparent ? null : readToken('viewport')
      const frame = await lastFrame(renderFrames({ mesh, size, background, cameras: [poseFor(camera, mesh.bounds, aspect)] }))
      if (frame) await saveFile(await imageDataToPng(frame), 'model.png')
    } catch (e) {
      setError(`Could not save the PNG: ${errorMessage(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <TabBody>
        <div className="flex min-w-0 flex-col gap-3">
          <FramePreview frame={preview} label={`Preview of the ${label} image`} />
          <span className="pc-caption">The last model that compiled, at {label}.</span>
        </div>
        <div className="flex flex-col gap-4">
          <div className="pc-field">
            <label htmlFor="image-size">Size</label>
            <select id="image-size" className="pc-select" value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
              {IMAGE_SIZES.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="pc-field">
            <label htmlFor="image-camera">Camera</label>
            <select id="image-camera" className="pc-select" value={camera} onChange={(e) => setCamera(e.target.value as CameraChoice)}>
              {CAMERA_CHOICES.map((c) => (
                <option key={c} value={c} disabled={c === 'current' && !getViewerPose()}>
                  {CAMERA_LABELS[c]}
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
        <span className="min-w-0 flex-1">
          {error && (
            <span role="alert" className="pc-caption text-error">
              {error}
            </span>
          )}
        </span>
        <button type="button" className="pc-btn is-primary" disabled={saving} onClick={() => void save()}>
          <IconDownload className="pc-i" aria-hidden="true" />
          Save PNG
        </button>
      </TabFooter>
    </>
  )
}
