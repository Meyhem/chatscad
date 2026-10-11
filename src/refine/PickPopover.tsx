import { IconAskAi, IconCode, IconInfo } from '../ui/icons'
import { pickSummary, pickTitle, type PickResult } from './pick'

export const NO_VISION_REGION =
  'This region is not matched to code, and this provider is not set up for images, so its position is sent as text. Turn on Vision for the provider in Settings › AI providers if its model can read images.'

interface Props {
  pick: PickResult
  vision: boolean
  onAskAi(): void
  onShowCode(line: number): void
}

export function PickPopover({ pick, vision, onAskAi, onShowCode }: Props) {
  return (
    <section
      aria-label="Selected part"
      className="flex w-[260px] flex-col gap-2 rounded-lg border border-line bg-panel-raised p-3 text-ink shadow-pop"
    >
      <div className="pc-row">
        <span className="font-semibold">{pickTitle(pick)}</span>
        <span className="pc-caption pc-mono">{pick.kind === 'part' ? pick.caption : 'Not matched to code'}</span>
      </div>
      <div className="pc-caption" data-testid="pick-summary">
        {pickSummary(pick)}
      </div>
      {pick.kind === 'box' && !vision && (
        <div className="pc-callout is-info" role="note">
          <IconInfo className="pc-i" aria-hidden="true" />
          <div className="pc-callout-body pc-caption">{NO_VISION_REGION}</div>
        </div>
      )}
      <div className="pc-row">
        <button type="button" className="pc-btn is-sm is-primary" onClick={onAskAi}>
          <IconAskAi className="pc-i" aria-hidden="true" />
          Ask AI
        </button>
        {pick.kind === 'part' && (
          <button type="button" className="pc-btn is-sm" onClick={() => onShowCode(pick.scope.startLine)}>
            <IconCode className="pc-i" aria-hidden="true" />
            Show code
          </button>
        )}
      </div>
    </section>
  )
}
