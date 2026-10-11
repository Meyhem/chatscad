import { IconWarning } from '../ui/icons'

export const TRIANGLE_WARNING = 1_000_000

export function TriangleWarning({ count }: { count: number }) {
  if (count <= TRIANGLE_WARNING) return null
  return (
    <div role="status" className="pc-callout is-warn max-w-xs">
      <IconWarning className="pc-i" aria-hidden="true" />
      <div className="pc-callout-body">
        <strong>Heavy model: {count.toLocaleString('en-US')} triangles</strong>
        Phones may slow down or run out of memory. Lower $fn or simplify the model.
      </div>
    </div>
  )
}
