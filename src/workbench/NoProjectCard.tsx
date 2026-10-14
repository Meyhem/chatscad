import { useAppStore } from '../state/store'
import { IconGallery, IconPlus } from '../ui/icons'
import { useNewProjectDialog } from './newProjectDialogStore'

/** Takes the workbench's place while no project is open, so nothing is edited outside a project. */
export function NoProjectCard() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-4">
      <div className="flex max-w-90 flex-col items-center gap-3 rounded-lg border border-line bg-panel p-6 text-center">
        <h2 className="text-[16px] leading-[22px] font-semibold">No project open</h2>
        <p className="pc-muted">Start a project blank or from photos of a real object, or open one of the examples.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="pc-btn is-sm is-primary" onClick={() => useNewProjectDialog.getState().setOpen(true)}>
            <IconPlus className="pc-i" aria-hidden="true" />
            New project…
          </button>
          <button type="button" className="pc-btn is-sm" onClick={() => useAppStore.getState().setView('gallery')}>
            <IconGallery className="pc-i" aria-hidden="true" />
            Browse examples
          </button>
        </div>
      </div>
    </div>
  )
}
