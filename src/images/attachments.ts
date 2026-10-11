import { create } from 'zustand'
import { outputTypeFor, prepareImage, type OutputType, type PreparedImage } from './prepareImage'

export const MAX_ATTACHMENTS = 4

export const NO_VISION_EXPLANATION =
  'Images need a model with vision. Turn on Vision for this provider in Settings › AI providers if its model can read images.'

export interface Attachment {
  id: string
  blob: Blob
  mediaType: OutputType
  name: string
  /** Sketch note, sent as text right after the image. */
  note: string
  /** Object URL for the thumbnail; revoked on remove and clear. */
  url: string
}

type Prepare = (blob: Blob, type: OutputType) => Promise<PreparedImage>

interface AttachmentsState {
  items: Attachment[]
  error: string | null
  addFiles(files: readonly File[], prepare?: Prepare): Promise<void>
  addPrepared(image: PreparedImage, name: string, note?: string): void
  remove(id: string): void
  clear(): void
  setError(error: string | null): void
}

const tooMany = (name: string) => `Up to ${MAX_ATTACHMENTS} images per message. ${name} was not added.`

export const useAttachments = create<AttachmentsState>()((set, get) => ({
  items: [],
  error: null,
  async addFiles(files, prepare = prepareImage) {
    set({ error: null })
    for (const file of files) {
      if (get().items.length >= MAX_ATTACHMENTS) {
        set({ error: tooMany(file.name) })
        return
      }
      if (!file.type.startsWith('image/')) {
        set({ error: `${file.name} is not an image. Attach a PNG, JPEG or WebP image.` })
        continue
      }
      try {
        get().addPrepared(await prepare(file, outputTypeFor(file.type)), file.name)
      } catch {
        set({ error: `Could not read ${file.name}. Attach a PNG, JPEG or WebP image.` })
      }
    }
  },
  addPrepared(image, name, note = '') {
    if (get().items.length >= MAX_ATTACHMENTS) {
      set({ error: tooMany(name) })
      return
    }
    const item: Attachment = {
      id: crypto.randomUUID(),
      blob: image.blob,
      mediaType: image.mediaType,
      name,
      note,
      url: URL.createObjectURL(image.blob),
    }
    set((s) => ({ items: [...s.items, item] }))
  },
  remove(id) {
    const item = get().items.find((i) => i.id === id)
    if (item) URL.revokeObjectURL(item.url)
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
  },
  clear() {
    for (const item of get().items) URL.revokeObjectURL(item.url)
    set({ items: [], error: null })
  },
  setError: (error) => set({ error }),
}))
