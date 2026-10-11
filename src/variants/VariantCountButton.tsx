import { usePrefs } from '../settings/prefsStore'
import { IconLayers } from '../ui/icons'

export function VariantCountButton() {
  const count = usePrefs((s) => s.variantCount)
  const update = usePrefs((s) => s.update)
  return (
    <button
      type="button"
      className="pc-btn is-sm is-ghost"
      aria-label="Variants per prompt"
      aria-pressed={count === 3}
      title={count === 3 ? '3 variants per prompt' : '1 reply per prompt'}
      onClick={() => void update({ variantCount: count === 3 ? 1 : 3 })}
    >
      <IconLayers className="pc-i" aria-hidden="true" />
      <span className="pc-mono">{count}</span>
    </button>
  )
}
