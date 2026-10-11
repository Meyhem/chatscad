import { useProjectStore } from '../../history/projectStore'
import { LIBRARY_INFO, LIBRARY_NAMES } from '../../render/libraries'

export function LibrariesSection() {
  const project = useProjectStore((s) => s.project)
  return (
    <section aria-labelledby="libraries-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="libraries-title" className="text-[20px] leading-[26px] font-semibold">
        Libraries
      </h2>
      <p className="pc-muted">
        Enabled libraries are written into every render of this project and offered to the AI. They are bundled with the app and work offline.
      </p>
      {!project ? (
        <p className="pc-caption">Open a project to choose its libraries.</p>
      ) : (
        <div className="pc-stack">
          <span className="pc-label">For {project.name}</span>
          {LIBRARY_NAMES.map((name) => {
            const on = project.enabledLibraries.includes(name)
            const info = LIBRARY_INFO[name]
            return (
              <div key={name} className="flex flex-col gap-1">
                <label className="pc-switch">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = LIBRARY_NAMES.filter((n) => (n === name ? !on : project.enabledLibraries.includes(n)))
                      void useProjectStore.getState().setEnabledLibraries(next)
                    }}
                  />
                  <span className="pc-track" />
                  {name}
                </label>
                <span className="pc-caption pc-mono">
                  {name} {info.version} · {info.license} · {info.usage}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
