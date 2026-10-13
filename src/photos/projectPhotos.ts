import type { ContentPart } from '../ai/types'
import { loadImage } from '../db/images'
import { blobToBase64 } from '../images/base64'
import { outputTypeFor, prepareImage, type ImageCodec, type OutputType, type PreparedImage } from '../images/prepareImage'

/** Where a photo was taken from. 'photo' is the one-photo case (no angle chosen). */
export type PhotoAngle = 'photo' | 'front' | 'top' | 'side' | 'back' | 'bottom' | 'other'
/** How the builder gets sizes: from a coin, card or ruler in the photos, or only from the description. */
export type PhotoScale = 'reference' | 'description'

export interface ProjectPhoto {
  id: string
  blobId: string
  angle: PhotoAngle
  addedAt: number
}

export const PHOTO_ANGLES: readonly PhotoAngle[] = ['front', 'top', 'side', 'back', 'bottom', 'other']
export const MAX_PROJECT_PHOTOS = 5
/** Smaller than chat attachments: the photos go with every request in the project. */
export const PHOTO_MAX_EDGE = 1024
export const MAX_BRIEF_CHARS = 2000

export const PHOTO_LABEL: Record<PhotoAngle, string> = {
  photo: 'Photo',
  front: 'Front',
  top: 'Top',
  side: 'Side',
  back: 'Back',
  bottom: 'Bottom',
  other: 'Other angle',
}

export const tooManyPhotos = (name: string): string => `Up to ${MAX_PROJECT_PHOTOS} photos per project. ${name} was not added.`
export const unreadablePhoto = (name: string): string => `Could not read ${name}. Add a PNG, JPEG or WebP image.`

export function preparePhoto(blob: Blob, type: OutputType = outputTypeFor(blob.type), codec?: ImageCodec): Promise<PreparedImage> {
  return codec ? prepareImage(blob, type, codec, PHOTO_MAX_EDGE) : prepareImage(blob, type, undefined, PHOTO_MAX_EDGE)
}

export interface LoadedPhoto {
  photo: ProjectPhoto
  blob: Blob
  mediaType: 'image/png' | 'image/jpeg'
}

/** The photos whose blobs are still in the database; `missing` counts the rest. */
export async function loadPhotos(
  photos: readonly ProjectPhoto[],
  load: (id: string) => Promise<Blob | null> = loadImage,
): Promise<{ loaded: LoadedPhoto[]; missing: number }> {
  const loaded: LoadedPhoto[] = []
  let missing = 0
  for (const photo of photos) {
    const blob = await load(photo.blobId)
    if (!blob) missing++
    else loaded.push({ photo, blob, mediaType: blob.type === 'image/png' ? 'image/png' : 'image/jpeg' })
  }
  return { loaded, missing }
}

/** Content parts for a request: each photo preceded by its angle, in project order. */
export async function photoParts(loaded: readonly LoadedPhoto[], toBase64: (b: Blob) => Promise<string> = blobToBase64): Promise<ContentPart[]> {
  const parts: ContentPart[] = []
  for (const { photo, blob, mediaType } of loaded) {
    parts.push({ type: 'text', text: `Reference photo (${PHOTO_LABEL[photo.angle].toLowerCase()})` })
    parts.push({ type: 'image', mediaType, data: await toBase64(blob) })
  }
  return parts
}
