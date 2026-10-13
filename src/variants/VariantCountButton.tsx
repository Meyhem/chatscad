import { usePrefs } from '../settings/prefsStore'

export function VariantCountButton() {
  const count = usePrefs((s) => s.variantCount)
  const update = usePrefs((s) => s.update)
  return (
    <button
      type="button"
      className="pc-model whitespace-nowrap"
      aria-label="Variants per prompt"
      aria-pressed={count === 3}
      title={count === 3 ? '3 variants per prompt' : '1 reply per prompt'}
      onClick={() => void update({ variantCount: count === 3 ? 1 : 3 })}
    >
      <span className="pc-opt-k">Variants</span>
      {count}
    </button>
  )
}
