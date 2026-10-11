import type { PromptContext } from '../ai/prompt'
import type { ContentPart } from '../ai/types'
import { saveImage } from '../db/images'
import { NO_VISION_EXPLANATION, type Attachment } from '../images/attachments'
import { blobToBase64, dataUrlToBlob } from '../images/base64'
import { prepareImage } from '../images/prepareImage'
import { formatDims } from '../render/dims'
import type { Bounds, Vec3 } from '../render/types'
import type { PickResult } from './pick'
import { useRefineStore } from './refineStore'

export interface TurnInput {
  userText: string | ContentPart[]
  selection?: PromptContext['selection']
  imageBlobIds: string[]
}

interface OutgoingImage {
  blob: Blob
  mediaType: 'image/png' | 'image/jpeg'
  note: string
}

export interface TurnInputDeps {
  saveImage(blob: Blob): Promise<string>
  toBase64(blob: Blob): Promise<string>
  captureViewport(): Promise<OutgoingImage | null>
}

const browserDeps: TurnInputDeps = {
  saveImage: (blob) => saveImage(blob),
  toBase64: blobToBase64,
  async captureViewport() {
    const capture = useRefineStore.getState().capture
    if (!capture) return null
    const png = await prepareImage(dataUrlToBlob(capture()), 'image/png')
    return { blob: png.blob, mediaType: png.mediaType, note: '' }
  },
}

const point = (v: Vec3) => `[${v.map((n) => Number(n.toFixed(2))).join(', ')}]`

export function describeRegion(bounds: Bounds): string {
  return `the box from ${point(bounds.min)} to ${point(bounds.max)} mm (${formatDims(bounds)})`
}

export async function prepareTurnInput(
  opts: { text: string; attachments: readonly Attachment[]; pick: PickResult | null; vision: boolean },
  deps: TurnInputDeps = browserDeps,
): Promise<TurnInput> {
  const { text, attachments, pick, vision } = opts
  if (attachments.length > 0 && !vision) throw new Error(NO_VISION_EXPLANATION)

  const images: OutgoingImage[] = attachments.map((a) => ({ blob: a.blob, mediaType: a.mediaType, note: a.note }))
  let prompt = text
  if (pick?.kind === 'box') {
    const view = vision ? await deps.captureViewport() : null
    if (view) images.push(view)
    prompt = `${text}\n\nThe part I mean is inside ${describeRegion(pick.bounds)}${view ? ', outlined in the attached view of the model' : ''}.`
  }
  const selection =
    pick?.kind === 'part' ? { startLine: pick.scope.startLine, endLine: pick.scope.endLine, label: pick.statement.label } : undefined

  if (images.length === 0) return { userText: prompt, selection, imageBlobIds: [] }

  const parts: ContentPart[] = [{ type: 'text', text: prompt }]
  const imageBlobIds: string[] = []
  for (const image of images) {
    parts.push({ type: 'image', mediaType: image.mediaType, data: await deps.toBase64(image.blob) })
    if (image.note.trim() !== '') parts.push({ type: 'text', text: `Note for the image above: ${image.note.trim()}` })
    imageBlobIds.push(await deps.saveImage(image.blob))
  }
  return { userText: parts, selection, imageBlobIds }
}
