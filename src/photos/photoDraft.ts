import type { PreparedImage } from '../images/prepareImage'
import { MAX_PROJECT_PHOTOS, preparePhoto, tooManyPhotos, unreadablePhoto, type PhotoAngle } from './projectPhotos'

/** A photo chosen in a dialog, before it is saved to the project. */
export interface DraftPhoto {
  id: string
  angle: PhotoAngle
  blob: Blob
  mediaType: 'image/png' | 'image/jpeg'
  /** Object URL for the thumbnail; revoked on remove. */
  url: string
  name: string
}

export interface DraftState {
  photos: DraftPhoto[]
  error: string | null
}

export async function addDraftPhotos(
  state: DraftState,
  files: readonly File[],
  angle: PhotoAngle,
  prepare: (b: Blob) => Promise<PreparedImage> = (b) => preparePhoto(b),
  objectUrl: (b: Blob) => string = (b) => URL.createObjectURL(b),
): Promise<DraftState> {
  let photos = state.photos
  let error: string | null = null
  for (const file of files) {
    if (photos.length >= MAX_PROJECT_PHOTOS) {
      error = tooManyPhotos(file.name)
      break
    }
    if (!file.type.startsWith('image/')) {
      error = unreadablePhoto(file.name)
      continue
    }
    try {
      const image = await prepare(file)
      photos = [...photos, { id: crypto.randomUUID(), angle, blob: image.blob, mediaType: image.mediaType, url: objectUrl(image.blob), name: file.name }]
    } catch {
      error = unreadablePhoto(file.name)
    }
  }
  return { photos, error }
}

export function removeDraftPhoto(state: DraftState, id: string, revoke: (url: string) => void = (u) => URL.revokeObjectURL(u)): DraftState {
  const photo = state.photos.find((p) => p.id === id)
  if (photo) revoke(photo.url)
  return { photos: state.photos.filter((p) => p.id !== id), error: null }
}

/** One photo keeps the first photo, untagged; several angles turns an untagged photo into "other". */
export function layoutFor(layout: 'one' | 'angles', photos: readonly DraftPhoto[]): DraftPhoto[] {
  if (layout === 'one') return photos.slice(0, 1).map((p) => ({ ...p, angle: 'photo' }))
  return photos.map((p) => (p.angle === 'photo' ? { ...p, angle: 'other' } : p))
}
