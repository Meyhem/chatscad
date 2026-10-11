import { useAppStore } from '../state/store'

const TEXT = 'text-[15px] font-bold tracking-tight'

/** The header title. Off the workbench it goes back to the project; on it, it is plain text. */
export function BrandTitle() {
  const view = useAppStore((s) => s.view)
  if (view === 'workbench') return <h1 className={TEXT}>ChatSCAD</h1>
  return (
    <h1 className={TEXT}>
      <button
        type="button"
        aria-label="ChatSCAD, back to project"
        title="Back to project"
        className="-ml-2 h-(--control-sm) cursor-pointer rounded-sm px-2 hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        onClick={() => useAppStore.getState().setView('workbench')}
      >
        ChatSCAD
      </button>
    </h1>
  )
}
