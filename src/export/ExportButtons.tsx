import type { RenderStatus } from '../state/store'
import { IconDownload, IconShare } from '../ui/icons'

/** Why Export STL is disabled, or null when the file would match the code. */
export function exportDisabledReason(status: RenderStatus): string | null {
  switch (status) {
    case 'idle':
      return 'Wait for the first render to finish'
    case 'rendering':
      return 'Wait for the render to finish'
    case 'empty':
      return 'Write or generate a model first'
    case 'error':
      return 'Fix the error first, so the file matches the code'
    case 'ok':
      return null
  }
}

interface Props {
  canExportStl: boolean
  disabledReason: string | null
  onExportStl(): void
  onShare(): void
}

export function ExportButtons({ canExportStl, disabledReason, onExportStl, onShare }: Props) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="pc-btn is-sm" onClick={onShare}>
        <IconShare className="pc-i" aria-hidden="true" />
        Share
      </button>
      <button
        type="button"
        className="pc-btn is-sm is-primary"
        disabled={!canExportStl}
        title={canExportStl ? undefined : (disabledReason ?? undefined)}
        onClick={onExportStl}
      >
        <IconDownload className="pc-i" aria-hidden="true" />
        Export STL
      </button>
    </div>
  )
}
