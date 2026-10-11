import { IconSpinner } from '../ui/icons'
import { variantProgressLabel } from './describeSlot'
import { useVariantStore } from './variantStore'

export function VariantProgressPill() {
  const open = useVariantStore((s) => s.open)
  const slots = useVariantStore((s) => s.slots)
  const label = open ? variantProgressLabel(slots) : null
  if (!label) return null
  return (
    <span role="status" className="pc-status is-busy">
      <IconSpinner className="pc-i" aria-hidden="true" />
      {label}
    </span>
  )
}
