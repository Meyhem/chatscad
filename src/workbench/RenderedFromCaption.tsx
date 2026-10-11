import { useRenderedVersionLabel } from '../history/renderedVersion'

/** Next to the dims while the model on screen is the last one that compiled (screen CompileError: "from v3"). */
export function RenderedFromCaption() {
  const label = useRenderedVersionLabel()
  return <span className="pc-caption">{label ? `from ${label}` : 'last model that compiled'}</span>
}
