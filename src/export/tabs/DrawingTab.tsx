import { useEffect, useState } from 'react'
import { formatDims } from '../../render/dims'
import { errorMessage } from '../../render/result'
import { selectCanExport, useAppStore } from '../../state/store'
import { readToken } from '../../theme/tokens'
import { Callout } from '../../ui/Callout'
import { IconDownload } from '../../ui/icons'
import { exportDisabledReason } from '../ExportButtons'
import { FramePreview } from '../FramePreview'
import { imageDataToPng } from '../png'
import { saveFile } from '../saveFile'
import { SHEET_SIZE } from '../sheet'
import { renderSheet, type SheetColours } from '../sheetRender'
import { previewSize } from '../sizes'
import { NothingToExport, TabBody, TabFooter } from './layout'

const PREVIEW_SIZE = previewSize(SHEET_SIZE, 960)

/** Read at draw time. The sheet tokens are fixed in both themes, so the sheet stays light in dark mode. */
export function sheetColours(): SheetColours {
  return {
    paper: readToken('sheet-paper'),
    ink: readToken('sheet-ink'),
    muted: readToken('sheet-muted'),
    fontSans: readToken('font-sans'),
    fontMono: readToken('font-mono'),
  }
}

export function DrawingTab() {
  const mesh = useAppStore((s) => s.mesh)
  const status = useAppStore((s) => s.status)
  const canExport = useAppStore(selectCanExport)
  const [preview, setPreview] = useState<ImageData | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mesh || !canExport) return
    let live = true
    renderSheet({ mesh, size: PREVIEW_SIZE, colours: sheetColours() }).then(
      (frame) => live && setPreview(frame),
      (e: unknown) => live && setError(`Could not draw the preview: ${errorMessage(e)}`),
    )
    return () => {
      live = false
    }
  }, [mesh, canExport])

  if (!mesh) return <NothingToExport />
  if (!canExport) {
    return (
      <div className="px-6 py-5">
        <Callout tone="info" title="The drawing needs a current render">
          {exportDisabledReason(status) ?? 'Wait for the render to finish'}.
        </Callout>
      </div>
    )
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const sheet = await renderSheet({ mesh, size: SHEET_SIZE, colours: sheetColours() })
      await saveFile(await imageDataToPng(sheet), 'model-drawing.png')
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
          <FramePreview frame={preview} label="Preview of the drawing" />
          <span className="pc-caption">Front, top and right views to one scale, with an iso view for context.</span>
        </div>
        <div className="flex flex-col gap-4">
          <div className="pc-field">
            <span className="pc-label">Sheet</span>
            <span>{`A4 landscape, ${SHEET_SIZE[0]} × ${SHEET_SIZE[1]} px`}</span>
          </div>
          <div className="pc-field">
            <span className="pc-label">Overall size</span>
            <span className="pc-mono">{formatDims(mesh.bounds)}</span>
          </div>
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
