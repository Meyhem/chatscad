import { useEffect, useRef, useState } from 'react'
import { useAgentStore } from '../agent/agentStore'
import { useChatStore } from '../chat/chatStore'
import { deleteUnreferencedImages, loadImage, saveImage as defaultSaveImage } from '../db/images'
import { useProjectStore } from '../history/projectStore'
import { nextLabel } from '../history/versions'
import type { PreparedImage } from '../images/prepareImage'
import { IconInfo, IconX } from '../ui/icons'
import { Modal } from '../ui/Modal'
import type { DraftPhoto } from './photoDraft'
import { PhotoSlots } from './PhotoSlots'
import { MAX_BRIEF_CHARS, MAX_PROJECT_PHOTOS, type ProjectPhoto } from './projectPhotos'
import { useDraftPhotos } from './useDraftPhotos'

interface Props {
  onClose(): void
  load?(id: string): Promise<Blob | null>
  objectUrl?(blob: Blob): string
  prepare?(blob: Blob): Promise<PreparedImage>
  saveImage?(blob: Blob): Promise<string>
  /** Deletes photo blobs the project no longer uses; by default keeps those a message of the project still shows. */
  deleteImages?(ids: string[]): Promise<void>
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The project's reference photos and description: add angles, save, or refine the model against them (spec P10). */
export function PhotosDialog({ onClose, load = loadImage, objectUrl = (b) => URL.createObjectURL(b), prepare, saveImage = defaultSaveImage, deleteImages }: Props) {
  const project = useProjectStore((s) => s.project)
  const projectId = useRef(project?.id ?? null)
  const removeBlobs = useRef(deleteImages ?? ((ids: string[]) => deleteUnreferencedImages(projectId.current, ids)))
  const head = useProjectStore((s) => s.head)
  const versions = useProjectStore((s) => s.versions)
  const chatBusy = useChatStore((s) => s.busy)
  const agentBusy = useAgentStore((s) => s.busy !== null)
  const working = chatBusy || agentBusy
  const { draft, latest, commit, onAdd, onRemove, mounted } = useDraftPhotos({ layout: () => 'angles', prepare, objectUrl })
  const [brief, setBrief] = useState(project?.brief ?? '')
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The photos on the project, by id; updated by each save. */
  const stored = useRef(new Map<string, ProjectPhoto>())
  /** The ids of the photos the project had when the dialog opened; the others are new to a refine. */
  const original = useRef(new Set<string>())
  /** Blobs saved by an attempt that failed later on, not yet on the project: a retry reuses them, closing deletes them. */
  const savedBlobs = useRef(new Map<string, string>())
  const saving = useRef<Promise<unknown> | null>(null)

  // Blobs of a failed save that never reached the project would be orphans: delete them on close,
  // after any save still running has settled.
  useEffect(
    () => () => {
      void Promise.resolve(saving.current)
        .then(() => {
          const ids = [...savedBlobs.current.values()]
          savedBlobs.current.clear()
          if (ids.length > 0) return removeBlobs.current(ids)
        })
        .catch(() => {})
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    const photos = useProjectStore.getState().project?.photos ?? []
    void (async () => {
      const shown: DraftPhoto[] = []
      try {
        for (const photo of photos) {
          const blob = await load(photo.blobId)
          if (!blob) continue
          const mediaType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
          shown.push({ id: photo.id, angle: photo.angle, blob, mediaType, url: objectUrl(blob), name: photo.angle })
        }
      } catch (err) {
        if (!cancelled) setLoadError(`Could not load the photos: ${message(err)}`)
      }
      if (cancelled) {
        for (const p of shown) URL.revokeObjectURL?.(p.url)
        return
      }
      stored.current = new Map(photos.map((p) => [p.id, p]))
      original.current = new Set(photos.map((p) => p.id))
      commit({ photos: shown, error: null })
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
    // Loads once per open; the injected loaders are fixed for the dialog's life.
  }, [])

  const count = draft.photos.length
  const ready = loaded && loadError === null && !busy

  /** Saves the draft and the description; null when saving failed (the dialog then says why and keeps the draft). */
  const persist = (): Promise<ProjectPhoto[] | null> => {
    const run = save()
    saving.current = run
    return run
  }
  const save = async (): Promise<ProjectPhoto[] | null> => {
    setBusy(true)
    setSaveError(null)
    try {
      const photos: ProjectPhoto[] = []
      for (const p of latest.current.photos) {
        const known = stored.current.get(p.id)
        if (known) {
          photos.push({ ...known, angle: p.angle })
          continue
        }
        const blobId = savedBlobs.current.get(p.id) ?? (await saveImage(p.blob))
        savedBlobs.current.set(p.id, blobId)
        photos.push({ id: p.id, blobId, angle: p.angle, addedAt: Date.now() })
      }
      const store = useProjectStore.getState()
      await store.setPhotos(photos)
      // The project now holds `photos`: blobs of removed photos, and of picks saved earlier and removed since, go.
      const kept = new Set(photos.map((p) => p.blobId))
      const unused = [...[...stored.current.values()].map((p) => p.blobId), ...savedBlobs.current.values()].filter((id) => !kept.has(id))
      stored.current = new Map(photos.map((p) => [p.id, p]))
      savedBlobs.current.clear()
      await removeBlobs.current(unused).catch(() => {})
      await store.setBrief(brief.trim())
      return photos
    } catch (err) {
      if (mounted.current) setSaveError(`Could not save the photos: ${message(err)}`)
      return null
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const saveOnly = async () => {
    if (!ready) return
    if (await persist()) onClose()
  }

  const refine = async () => {
    if (!ready || working || count === 0) return
    const photos = await persist()
    if (!photos || !mounted.current) return
    const newAngles = photos.filter((p) => !original.current.has(p.id)).map((p) => p.angle)
    onClose()
    void useAgentStore.getState().refineWithPhotos(newAngles)
  }

  /** Closing mid-save would lose the outcome of the save; Cancel, Close and Escape wait for it. */
  const close = () => {
    if (!busy) onClose()
  }

  const next = head ? nextLabel(head, versions.filter((v) => v.parentId === head.id)) : null
  const alert = loadError ?? saveError

  return (
    <Modal labelledBy="photos-title" onClose={close} className="pc-dialog max-w-[760px] gap-0 p-0">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void refine()
        }}
      >
        <div className="flex items-start gap-4 px-6 pt-6">
          <div className="flex flex-1 flex-col gap-1">
            <h2 id="photos-title">Photos</h2>
            <p className="pc-muted">Every build and review in this project sees these photos and the description.</p>
          </div>
          <button type="button" className="pc-btn is-icon is-ghost" aria-label="Close" disabled={busy} onClick={close}>
            <IconX className="pc-i" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-6 p-6">
          <div className="pc-stack gap-2">
            <div className="pc-row justify-between">
              <span className="text-[13px] font-semibold">
                {count} of {MAX_PROJECT_PHOTOS} photos
              </span>
              <span className="pc-caption">Sent with every request in this project</span>
            </div>
            {loaded ? (
              <PhotoSlots layout="angles" photos={draft.photos} onAdd={onAdd} onRemove={onRemove} error={draft.error} />
            ) : (
              <span className="pc-caption">Loading the photos…</span>
            )}
          </div>

          <div className="pc-field">
            <label htmlFor="ph-desc">Description</label>
            <div className="pc-area h-[84px]">
              <textarea
                id="ph-desc"
                value={brief}
                maxLength={MAX_BRIEF_CHARS}
                placeholder="What it is, sizes you know, what it attaches to"
                onChange={(e) => setBrief(e.target.value)}
              />
            </div>
          </div>

          {count > 0 && (
            <div className="pc-callout is-info">
              <IconInfo className="pc-i" aria-hidden="true" />
              <div className="pc-callout-body">
                <strong>{head && next ? `Refining builds ${next} from ${head.label}` : 'Refining builds a new version'}</strong>
                <span className="pc-muted">
                  The agent compares the model with {count === 1 ? 'the photo' : `all ${count} photos`} and fixes what differs. Sizes you set keep their
                  values. Guessed sizes may change.
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="pc-dialog-actions items-center border-t border-line px-6 py-4">
          {alert ? (
            <span role="alert" className="pc-caption min-w-[12rem] flex-1 text-error">
              {alert}
            </span>
          ) : (
            <span className="pc-caption min-w-[12rem] flex-1">{head ? `${head.label} stays in History.` : ''}</span>
          )}
          <button type="button" className="pc-btn" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button type="button" className="pc-btn" disabled={!ready} onClick={() => void saveOnly()}>
            Save photos only
          </button>
          <button type="submit" className="pc-btn is-primary" disabled={!ready || working || count === 0}>
            Refine with {count} {count === 1 ? 'photo' : 'photos'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
