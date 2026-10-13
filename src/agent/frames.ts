import { presetPose, renderFrames as defaultRenderFrames, type PresetView } from '../export/frames'
import { imageDataToPng } from '../images/imageData'
import type { MeshData } from '../render/types'
import { readToken } from '../theme/tokens'
import { faceColourArray, readPartPalette, type PartPalette } from './partColours'

export const REVIEW_VIEWS: PresetView[] = ['iso', 'front', 'top', 'right']
export const REVIEW_FRAME_SIZE = 768

export interface ReviewFrame {
  view: PresetView
  png: Blob
}

export interface FrameDeps {
  renderFrames(opts: {
    mesh: MeshData
    size: [number, number]
    background: string | null
    cameras: ReturnType<typeof presetPose>[]
    colours?: Float32Array
  }): AsyncIterable<ImageData>
  toPng(image: ImageData): Promise<Blob>
  palette(): PartPalette
  ground(): string
}

const browserDeps: FrameDeps = {
  renderFrames: defaultRenderFrames,
  toPng: imageDataToPng,
  palette: readPartPalette,
  ground: () => readToken('frame-ground'),
}

/** The four views the reviewer sees, with each part in its colour when `faceTags` is given (filament otherwise). */
export async function renderReviewFrames(mesh: MeshData, faceTags: Uint32Array | null, deps: FrameDeps = browserDeps): Promise<ReviewFrame[]> {
  const palette = faceTags ? deps.palette() : null
  const colours = faceTags && palette ? faceColourArray(faceTags, palette.colours, palette.none) : undefined
  const images: ImageData[] = []
  for await (const image of deps.renderFrames({
    mesh,
    size: [REVIEW_FRAME_SIZE, REVIEW_FRAME_SIZE],
    background: deps.ground(),
    cameras: REVIEW_VIEWS.map((view) => presetPose(mesh.bounds, view)),
    ...(colours ? { colours } : {}),
  })) {
    images.push(image)
  }
  return Promise.all(images.map(async (image, i) => ({ view: REVIEW_VIEWS[i], png: await deps.toPng(image) })))
}
