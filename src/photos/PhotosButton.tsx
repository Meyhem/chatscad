import { useProjectStore } from '../history/projectStore'
import { IconCamera } from '../ui/icons'
import { usePhotosDialog } from './photosDialogStore'

/** "Photos · N" in the Agent header; opens the project Photos dialog (spec P10). */
export function PhotosButton() {
  const project = useProjectStore((s) => s.project)
  const setOpen = usePhotosDialog((s) => s.setOpen)
  if (!project || (project.origin !== 'photos' && (project.photos?.length ?? 0) === 0)) return null
  const n = project.photos?.length ?? 0
  return (
    <button type="button" className="pc-btn is-sm is-ghost" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <IconCamera className="pc-i text-ink-muted" aria-hidden="true" />
      Photos · {n}
    </button>
  )
}
