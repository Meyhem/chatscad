import { useEffect, useState } from 'react'
import { loadImage } from '../db/images'
import { useProjectStore } from '../history/projectStore'
import type { Bounds } from '../render/types'
import { IconCamera, IconX } from '../ui/icons'
import { usePoseRequest } from '../viewer/poseRequest'
import { PHOTO_LABEL } from './projectPhotos'
import { referencePose, referenceView } from './referenceCamera'

interface Props {
  bounds: Bounds | null
  load?(id: string): Promise<Blob | null>
  objectUrl?(blob: Blob): string
}

/** A small reference photo in the viewer's corner, with a tab per angle (spec P12). Hidden state is per session. */
export function ReferencePhoto({ bounds, load = loadImage, objectUrl = (b) => URL.createObjectURL(b) }: Props) {
  const photos = useProjectStore((s) => s.project?.photos)
  const request = usePoseRequest((s) => s.request)
  const [hidden, setHidden] = useState(false)
  const [current, setCurrent] = useState(0)
  const [urls, setUrls] = useState<Record<string, string>>({})
  // Reload only when the set of blobs changes, not on every project update.
  const blobKey = JSON.stringify((photos ?? []).map((p) => [p.id, p.blobId]))

  useEffect(() => {
    let live = true
    const made: string[] = []
    const wanted = JSON.parse(blobKey) as [string, string][]
    void Promise.all(wanted.map(async ([id, blobId]) => [id, await load(blobId)] as const)).then((pairs) => {
      if (!live) return
      const next: Record<string, string> = {}
      for (const [id, blob] of pairs) {
        if (!blob) continue
        const url = objectUrl(blob)
        made.push(url)
        next[id] = url
      }
      setUrls(next)
    })
    return () => {
      live = false
      for (const url of made) URL.revokeObjectURL?.(url)
    }
    // load and objectUrl are injection points that never change for a mounted overlay; the blob set is the trigger.
  }, [blobKey])

  if (!photos || photos.length === 0) return null
  const index = Math.min(current, photos.length - 1)
  const photo = photos[index]!
  const view = referenceView(photo.angle)

  const pick = (i: number) => {
    setCurrent(i)
    const next = referenceView(photos[i]!.angle)
    if (next && bounds) request(referencePose(bounds, next))
  }

  if (hidden) {
    return (
      <button type="button" className="pc-btn is-sm" aria-label="Show reference photo" title="Show reference photo" onClick={() => setHidden(false)}>
        <IconCamera className="pc-i" aria-hidden="true" />
      </button>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1.5" data-testid="reference-photo">
      <div className="relative aspect-[4/3] w-[168px] overflow-hidden rounded-md border border-line bg-inset">
        {urls[photo.id] && <img src={urls[photo.id]} alt={`Reference photo, ${PHOTO_LABEL[photo.angle].toLowerCase()}`} className="absolute inset-0 size-full object-cover" />}
        <span className="absolute top-1.5 left-1.5 rounded-sm bg-panel px-1.5 text-[11px] leading-5 font-semibold">{PHOTO_LABEL[photo.angle]}</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="pc-tabs pc-seg" role="radiogroup" aria-label="Reference photo">
          {photos.map((p, i) => (
            <button key={p.id} type="button" role="radio" className="pc-tab" aria-checked={i === index} onClick={() => pick(i)}>
              {PHOTO_LABEL[p.angle]}
            </button>
          ))}
        </div>
        <button type="button" className="pc-btn is-sm is-icon" aria-label="Hide reference photo" title="Hide reference photo" onClick={() => setHidden(true)}>
          <IconX className="pc-i" aria-hidden="true" />
        </button>
      </div>
      {view && <span className="pc-caption">The camera matches the photo&apos;s angle.</span>}
    </div>
  )
}
