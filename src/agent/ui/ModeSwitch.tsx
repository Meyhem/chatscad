import type { KeyboardEvent } from 'react'
import type { AgentMode } from '../../db/db'
import { useProjectStore } from '../../history/projectStore'
import { useProvidersStore } from '../../settings/providersStore'
import { useSettingsStore } from '../../settings/settingsStore'
import { useAppStore } from '../../state/store'
import { Popover } from '../../ui/Popover'
import { IconAgent, IconEye, IconManual, IconSettings } from '../../ui/icons'
import { NO_REVIEWER, reviewerChoices } from '../reviewer'
import { useAgentMode, useReviewer } from '../useReviewer'

const SAME = ''
const key = (profileId: string, model: string) => `${profileId}\n${model}`

function AgentSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const profiles = useProvidersStore((s) => s.profiles)
  const choices = reviewerChoices(profiles)
  const chosen = settings.reviewProfileId && settings.reviewModel ? key(settings.reviewProfileId, settings.reviewModel) : SAME

  return (
    <>
      <div className="pc-row">
        <span className="font-semibold">Agent</span>
        <span className="flex-1" />
        <span className="pc-caption">Plan, build, review, fix</span>
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
        <span className="pc-hint">Needs a model that takes images. A different model from the builder catches more.</span>
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
          <legend className="mb-1 p-0 text-[13px] font-semibold">After each review</legend>
          <label className="pc-row flex-nowrap" style={{ gap: 6 }}>
            <input type="radio" name="review-mode" className="accent-accent" checked={settings.reviewMode === 'ask'} onChange={() => void update({ reviewMode: 'ask' })} />
            Ask me which fixes to send
          </label>
          <label className="pc-row flex-nowrap" style={{ gap: 6 }}>
            <input type="radio" name="review-mode" className="accent-accent" checked={settings.reviewMode === 'auto'} onChange={() => void update({ reviewMode: 'auto' })} />
            Fix until every check passes
          </label>
        </fieldset>
      </div>
      <div className="pc-stack" style={{ gap: 2 }}>
        <label className="pc-switch">
          <input type="checkbox" checked={settings.reviewApprovePlan} onChange={(e) => void update({ reviewApprovePlan: e.currentTarget.checked })} />
          <span className="pc-track" aria-hidden="true" />
          Approve the checks before the first build
        </label>
        <span className="pc-caption">Off: the agent plans the checks and builds straight away.</span>
      </div>
    </>
  )
}

/** Edit | Agent, what the chosen mode does, and the agent's settings. Always above the composer box. */
export function ModeRow() {
  const reviewer = useReviewer()
  const mode = useAgentMode()
  const rounds = useSettingsStore((s) => s.settings.reviewRounds)
  const choose = (next: AgentMode) => {
    if (next !== mode) void useProjectStore.getState().setAgentMode(next)
  }
  // A radio group: the arrow keys move between the two modes.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!reviewer || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const next = mode === 'edit' ? 'agent' : 'edit'
    choose(next)
    e.currentTarget.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus()
  }

  return (
    <div className="pc-mode-row">
      <div role="radiogroup" aria-label="Mode" className="pc-tabs pc-mode-seg" onKeyDown={onKeyDown}>
        <button type="button" role="radio" data-mode="edit" aria-checked={mode === 'edit'} tabIndex={mode === 'edit' ? 0 : -1} className="pc-tab" onClick={() => choose('edit')}>
          <IconManual className="pc-i" aria-hidden="true" />
          Edit
        </button>
        <button
          type="button"
          role="radio"
          data-mode="agent"
          aria-checked={mode === 'agent'}
          tabIndex={mode === 'agent' ? 0 : -1}
          className="pc-tab is-agent"
          disabled={!reviewer}
          title={reviewer ? 'Plan, build and review' : NO_REVIEWER}
          onClick={() => choose('agent')}
        >
          <IconAgent className="pc-i" aria-hidden="true" />
          Agent
        </button>
      </div>
      <span className="pc-mode-sum">
        {mode === 'agent' && reviewer ? `Reviewer ${reviewer.model} · ${rounds} ${rounds === 1 ? 'round' : 'rounds'} max` : 'One builder turn · no review'}
      </span>
      <span className="flex-1" />
      {mode === 'agent' && (
        <Popover
          label="Agent settings"
          className="right-0 bottom-9 w-[360px] max-w-[calc(100vw-24px)]"
          trigger={(props) => (
            <button type="button" className="pc-btn is-icon is-sm is-ghost" aria-label="Agent settings" title="Agent settings" {...props}>
              <IconSettings className="pc-i" aria-hidden="true" />
            </button>
          )}
        >
          <AgentSettings />
        </Popover>
      )}
    </div>
  )
}

/** Says why Agent is unavailable, and where to fix it. Nothing while a model can review or before any provider exists. */
export function ModeNote() {
  const reviewer = useReviewer()
  const hasProfile = useProvidersStore((s) => s.profiles.length > 0)
  const setView = useAppStore((s) => s.setView)
  if (reviewer || !hasProfile) return null
  return (
    <div className="pc-mode-note">
      <IconEye className="pc-i" aria-hidden="true" />
      <span className="min-w-0 flex-1">Agent mode needs a model that takes images. Turn on Vision for a provider.</span>
      <button type="button" className="pc-btn is-sm" onClick={() => setView('settings')}>
        Set up
      </button>
    </div>
  )
}
