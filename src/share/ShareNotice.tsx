import { IconInfo, IconWarning, IconX } from '../ui/icons'
import { useShareNotice } from './shareNotice'

export function ShareNotice() {
  const notice = useShareNotice((s) => s.notice)
  const dismiss = useShareNotice((s) => s.dismiss)
  if (!notice) return null
  const error = notice.tone === 'error'
  const Icon = error ? IconWarning : IconInfo
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`pc-callout ${error ? 'is-error' : 'is-info'} fixed top-[calc(var(--header-height)+12px)] left-1/2 z-40 w-[min(560px,calc(100%-24px))] -translate-x-1/2 shadow-pop`}
    >
      <Icon className="pc-i" aria-hidden="true" />
      <div className="pc-callout-body">
        <strong>{notice.title}</strong>
        {notice.body}
      </div>
      <button type="button" className="pc-btn is-icon is-sm is-ghost" aria-label="Dismiss" onClick={dismiss}>
        <IconX className="pc-i" aria-hidden="true" />
      </button>
    </div>
  )
}
