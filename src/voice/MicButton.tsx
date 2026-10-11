import { IconMic } from '../ui/icons'

export function MicButton({ listening, busy, onToggle }: { listening: boolean; busy: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className={`pc-btn is-icon is-sm is-ghost ${listening ? 'bg-accent-soft text-accent' : ''}`.trim()}
      aria-label={listening ? 'Stop dictation' : 'Dictate'}
      aria-pressed={listening}
      disabled={busy}
      onClick={onToggle}
    >
      <IconMic className="pc-i" aria-hidden="true" />
    </button>
  )
}
