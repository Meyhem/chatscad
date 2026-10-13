import type { DragEvent } from 'react'
import { IconCamera, IconX } from '../ui/icons'
import type { DraftPhoto } from './photoDraft'
import { PHOTO_ANGLES, PHOTO_LABEL, type PhotoAngle } from './projectPhotos'

interface Props {
  layout: 'one' | 'angles'
  photos: readonly DraftPhoto[]
  onAdd(files: File[], angle: PhotoAngle): void
  onRemove(id: string): void
  error?: string | null
}

const slotClass =
  'relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong bg-inset text-[13px] font-medium text-ink-muted hover:border-accent hover:text-ink focus-within:border-accent focus-within:text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring'

/** The one-photo slot is wide, the angle slots are 4:3. */
const aspectFor = (angle: PhotoAngle) => (angle === 'photo' ? 'aspect-[16/10]' : 'aspect-[4/3]')

/** "front photo" for a tagged angle, "photo" for the untagged one-photo case. */
const photoName = (angle: PhotoAngle) => (angle === 'photo' ? 'photo' : `${PHOTO_LABEL[angle].toLowerCase()} photo`)

/** An empty slot is a label around its file input: clicking or tapping it opens the picker or the camera. */
function EmptySlot({ angle, onAdd }: { angle: PhotoAngle; onAdd(files: File[], angle: PhotoAngle): void }) {
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    // The slot takes the drop: the dialog around it must not add the files again.
    e.stopPropagation()
    const files = [...(e.dataTransfer?.files ?? [])]
    if (files.length > 0) onAdd(files, angle)
  }
  return (
    <label className={`${slotClass} ${aspectFor(angle)}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <input
        type="file"
        accept="image/*"
        multiple={angle === 'photo' || angle === 'other'}
        className="sr-only"
        aria-label={`Add ${photoName(angle)}`}
        onChange={(e) => {
          onAdd([...(e.target.files ?? [])], angle)
          e.target.value = ''
        }}
      />
      <IconCamera className="pc-i" aria-hidden="true" />
      {angle === 'photo' ? 'Add a photo' : PHOTO_LABEL[angle]}
    </label>
  )
}

function FilledSlot({ photo, angle, onRemove }: { photo: DraftPhoto; angle: PhotoAngle; onRemove(id: string): void }) {
  const label = PHOTO_LABEL[angle]
  return (
    <div className={`relative ${aspectFor(angle)} overflow-hidden rounded-md border border-line bg-inset`}>
      <img src={photo.url} draggable={false} alt={angle === 'photo' ? 'Photo' : `${label} photo`} className="absolute inset-0 size-full object-cover" />
      <span className="absolute top-1.5 left-1.5 rounded-sm bg-panel px-1.5 text-[11px] leading-5 font-semibold">{label}</span>
      <button type="button" className="pc-btn is-icon is-sm is-ghost absolute top-1 right-1 bg-panel" aria-label={`Remove ${photoName(angle)}`} onClick={() => onRemove(photo.id)}>
        <IconX className="pc-i" aria-hidden="true" />
      </button>
    </div>
  )
}

/** The photo picker shared by the new project and Photos dialogs (spec P2). */
export function PhotoSlots({ layout, photos, onAdd, onRemove, error = null }: Props) {
  const alert = error && (
    <span role="alert" className="pc-caption text-error">
      {error}
    </span>
  )
  if (layout === 'one') {
    const photo = photos[0]
    return (
      <div className="pc-stack">
        {photo ? <FilledSlot photo={photo} angle="photo" onRemove={onRemove} /> : <EmptySlot angle="photo" onAdd={onAdd} />}
        {alert}
      </div>
    )
  }
  // An untagged photo (from the one-photo layout or a stored project) sits with the other angles.
  const byAngle = new Map<PhotoAngle, DraftPhoto[]>()
  for (const p of photos) {
    const angle = p.angle === 'photo' ? 'other' : p.angle
    byAngle.set(angle, [...(byAngle.get(angle) ?? []), p])
  }
  return (
    <div className="pc-stack">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PHOTO_ANGLES.flatMap((angle) => {
          const filled = byAngle.get(angle) ?? []
          const slots = filled.map((p) => <FilledSlot key={p.id} photo={p} angle={angle} onRemove={onRemove} />)
          if (angle === 'other' || filled.length === 0) slots.push(<EmptySlot key={`add-${angle}`} angle={angle} onAdd={onAdd} />)
          return slots
        })}
      </div>
      {alert}
    </div>
  )
}
