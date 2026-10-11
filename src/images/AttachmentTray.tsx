import { IconWarning, IconX } from '../ui/icons'
import { useAttachments } from './attachments'

export function AttachmentTray() {
  const items = useAttachments((s) => s.items)
  const error = useAttachments((s) => s.error)
  const remove = useAttachments((s) => s.remove)
  if (items.length === 0 && error === null) return null

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <div className="pc-row">
          {items.map((item) => (
            <span key={item.id} className="relative">
              <img src={item.url} alt={item.name} className="pc-msg-img object-cover" />
              <button
                type="button"
                className="pc-btn is-icon is-sm is-ghost absolute top-0 right-0"
                aria-label={`Remove ${item.name}`}
                onClick={() => remove(item.id)}
              >
                <IconX className="pc-i" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {error !== null && (
        <div className="pc-callout is-error" role="alert">
          <IconWarning className="pc-i" aria-hidden="true" />
          <div className="pc-callout-body">{error}</div>
        </div>
      )}
    </div>
  )
}
