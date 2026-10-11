import { IconRefresh } from '../ui/icons'

export function UpdatePrompt({ needRefresh, onReload, onDismiss }: { needRefresh: boolean; onReload(): void; onDismiss(): void }) {
  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="pc-callout is-info fixed right-4 bottom-[calc(var(--header-height)+16px)] z-40 max-w-sm shadow-pop md:bottom-4"
    >
      <IconRefresh className="pc-i" aria-hidden="true" />
      <div className="pc-callout-body">
        <strong>New version available</strong>
        Reload to use it. Your projects stay on this device.
        <div className="pc-row mt-2">
          <button type="button" className="pc-btn is-sm is-primary" onClick={onReload}>
            Reload
          </button>
          <button type="button" className="pc-btn is-sm is-ghost" onClick={onDismiss}>
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
