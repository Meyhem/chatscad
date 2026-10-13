import { useEffect, useRef, useState } from 'react'
import type { PreparedImage } from '../images/prepareImage'
import { addDraftPhotos, layoutFor, removeDraftPhoto, type DraftState } from './photoDraft'
import { MAX_PROJECT_PHOTOS, onePhotoOnly, tooManyPhotos, type PhotoAngle } from './projectPhotos'

const revoke = (url: string) => URL.revokeObjectURL?.(url)

interface Options {
  /** The layout when a batch is ready, so a layout change made in the meantime applies. */
  layout(): 'one' | 'angles'
  prepare?(blob: Blob): Promise<PreparedImage>
  objectUrl?(blob: Blob): string
}

/**
 * The photos a dialog is choosing. Photos are prepared one batch at a time; each batch joins the
 * draft as it is when the batch is ready, so removals made in the meantime stay.
 */
export function useDraftPhotos({ layout, prepare, objectUrl }: Options) {
  const [draft, setDraft] = useState<DraftState>({ photos: [], error: null })
  const latest = useRef(draft)
  const queue = useRef<Promise<void>>(Promise.resolve())
  /** False once the dialog has closed: late batches and late saves leave it alone. */
  const mounted = useRef(true)
  const commit = (next: DraftState) => {
    latest.current = next
    setDraft(next)
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const p of latest.current.photos) revoke(p.url)
    }
  }, [])

  const onAdd = (files: File[], angle: PhotoAngle) => {
    queue.current = queue.current
      .then(async () => {
        const before = latest.current
        const next = await addDraftPhotos(before, files, angle, prepare, objectUrl)
        const added = next.photos.slice(before.photos.length)
        if (!mounted.current) {
          for (const p of added) revoke(p.url)
          return
        }
        const now = layout()
        const photos = layoutFor(now, [...latest.current.photos, ...added]).slice(0, MAX_PROJECT_PHOTOS)
        const dropped = added.filter((p) => !photos.some((kept) => kept.id === p.id))
        for (const p of dropped) revoke(p.url)
        // A photo the layout had no room for is named, so it is not lost without a word.
        const first = dropped[0]
        const error = first ? (now === 'angles' ? tooManyPhotos(first.name) : onePhotoOnly(first.name)) : next.error
        commit({ photos, error })
      })
      .catch(() => {}) // one failed batch must not stop later picks
  }
  const onRemove = (id: string) => commit(removeDraftPhoto(latest.current, id, revoke))

  return { draft, latest, commit, onAdd, onRemove, mounted }
}
