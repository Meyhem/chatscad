import { useProvidersStore } from '../../settings/providersStore'
import { useSettingsStore } from '../../settings/settingsStore'
import { isEmptyCode, useAppStore } from '../../state/store'
import { Popover } from '../../ui/Popover'
import { IconChevron, IconEye } from '../../ui/icons'
import { useAgentStore } from '../agentStore'
import { NO_REVIEWER, reviewerChoices } from '../reviewer'
import { useReviewer } from '../useReviewer'

const SAME = ''
const key = (profileId: string, model: string) => `${profileId}\n${model}`

function Settings() {
  const reviewNext = useAgentStore((s) => s.reviewNext)
  const setReviewNext = useAgentStore((s) => s.setReviewNext)
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const profiles = useProvidersStore((s) => s.profiles)
  const choices = reviewerChoices(profiles)
  const chosen = settings.reviewProfileId && settings.reviewModel ? key(settings.reviewProfileId, settings.reviewModel) : SAME

  return (
    <>
      <div className="pc-row">
        <span className="font-semibold">Review</span>
        <span className="flex-1" />
        <span className="pc-caption">Needs a model that takes images</span>
      </div>
      <label className="pc-switch">
        <input type="checkbox" checked={reviewNext} onChange={(e) => setReviewNext(e.currentTarget.checked)} />
        <span className="pc-track" aria-hidden="true" />
        Review this request
      </label>
      <div className="pc-stack" style={{ gap: 2 }}>
        <label className="pc-switch">
          <input type="checkbox" checked={settings.reviewNewModels} onChange={(e) => void update({ reviewNewModels: e.currentTarget.checked })} />
          <span className="pc-track" aria-hidden="true" />
          Review new models on their own
        </label>
        <span className="pc-caption">A first build is planned and reviewed. Edits are reviewed when you ask.</span>
      </div>
      <div className="pc-field">
        <label htmlFor="reviewer-model">Reviewer model</label>
        <select
          id="reviewer-model"
          className="pc-select"
          value={chosen}
          onChange={(e) => {
            const [profileId, model] = e.target.value === SAME ? [null, null] : e.target.value.split('\n')
            void update({ reviewProfileId: profileId, reviewModel: model })
          }}
        >
          <option value={SAME}>Same as the builder</option>
          {choices.map((c) => (
            <option key={key(c.profile.id, c.model)} value={key(c.profile.id, c.model)}>
              {c.model} · {c.profile.name}
            </option>
          ))}
        </select>
        <span className="pc-hint">A different model from the builder catches more.</span>
      </div>
      <div className="grid items-start gap-3" style={{ gridTemplateColumns: '96px minmax(0, 1fr)' }}>
        <div className="pc-field">
          <label htmlFor="review-rounds">Rounds</label>
          <select id="review-rounds" className="pc-select" value={settings.reviewRounds} onChange={(e) => void update({ reviewRounds: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 p-0 text-[13px] font-semibold">Fixes</legend>
          <label className="pc-row flex-nowrap" style={{ gap: 6 }}>
            <input type="radio" name="review-mode" className="accent-accent" checked={settings.reviewMode === 'ask'} onChange={() => void update({ reviewMode: 'ask' })} />
            Ask me each round
          </label>
          <label className="pc-row flex-nowrap" style={{ gap: 6 }}>
            <input type="radio" name="review-mode" className="accent-accent" checked={settings.reviewMode === 'auto'} onChange={() => void update({ reviewMode: 'auto' })} />
            Fix until every check passes
          </label>
        </fieldset>
      </div>
    </>
  )
}

/** Composer control: shows whether the next request will be reviewed, and opens the review settings. */
export function ReviewButton() {
  const reviewer = useReviewer()
  const reviewNext = useAgentStore((s) => s.reviewNext)
  const newModels = useSettingsStore((s) => s.settings.reviewNewModels)
  const empty = useAppStore((s) => isEmptyCode(s.code))
  const willReview = reviewer !== null && (reviewNext || (newModels && empty))

  if (!reviewer) {
    return (
      <button type="button" className="pc-btn is-icon is-sm is-ghost" disabled title={NO_REVIEWER} aria-label={`Review. ${NO_REVIEWER}`}>
        <IconEye className="pc-i" aria-hidden="true" />
      </button>
    )
  }
  return (
    <Popover
      label="Review settings"
      className="right-0 bottom-9 w-[360px] max-w-[calc(100vw-24px)]"
      trigger={(props) => (
        <button
          type="button"
          className={`pc-btn is-sm is-ghost gap-0.5 px-1.5${willReview ? ' is-on' : ''}`}
          aria-label={willReview ? `Review: on for the next request, by ${reviewer.model}` : 'Review: off'}
          title={willReview ? `The next request is reviewed by ${reviewer.model}` : 'The next request is not reviewed'}
          {...props}
        >
          <IconEye className="pc-i" aria-hidden="true" />
          <IconChevron className="pc-i" aria-hidden="true" />
        </button>
      )}
    >
      <Settings />
    </Popover>
  )
}
