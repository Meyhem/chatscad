import { useState } from 'react'
import { useAgentStore } from '../agent/agentStore'
import { ModeNote, ModeRow } from '../agent/ui/ModeSwitch'
import { useAgentMode } from '../agent/useReviewer'
import { AttachButton } from '../images/AttachButton'
import { AttachmentTray } from '../images/AttachmentTray'
import { useAttachments } from '../images/attachments'
import { PickChip } from '../refine/PickChip'
import { useRefineStore } from '../refine/refineStore'
import { useVisionSupport } from '../refine/useVisionSupport'
import { attachSketch } from '../sketch/exportSketch'
import { SketchDialog } from '../sketch/SketchDialog'
import { usePrefs } from '../settings/prefsStore'
import { startVariants } from '../variants/startVariants'
import { VariantCountButton } from '../variants/VariantCountButton'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { IconAgent, IconSend, IconStop } from '../ui/icons'
import { useChatStore } from './chatStore'
import { EffortPicker } from './EffortPicker'
import { ModelPicker } from './ModelPicker'
import { DictationCaption } from '../voice/DictationCaption'
import { MicButton } from '../voice/MicButton'
import { useComposerDictation } from '../voice/useDictation'
import { useVoiceStore } from '../voice/voiceStore'

export function Composer() {
  const draft = useChatStore((s) => s.draft)
  const setDraft = useChatStore((s) => s.setDraft)
  const chatBusy = useChatStore((s) => s.busy)
  const agentBusy = useAgentStore((s) => s.busy !== null)
  const busy = chatBusy || agentBusy
  const profile = useProvidersStore(selectActiveProfile)
  const model = useProvidersStore(selectActiveModel)
  const vision = useVisionSupport()
  const mode = useAgentMode()
  const agent = mode === 'agent'
  const [sketching, setSketching] = useState(false)
  const dictation = useComposerDictation({
    value: draft,
    onChange: setDraft,
    profile,
  })

  const blocked = profile === null ? 'Add a provider first' : model === null ? 'Choose a model first' : null
  const canSend = !busy && blocked === null && draft.trim() !== ''
  const send = () => {
    if (!canSend) return
    // Taken on every send, so a transcript never sticks to a later, typed message.
    const audioTranscript = useVoiceStore.getState().takeTranscript()
    // Variants (Edit only) take a plain-text prompt; images and a picked part go with one scoped turn.
    const withExtras = useAttachments.getState().items.length > 0 || useRefineStore.getState().pick !== null
    if (!agent && usePrefs.getState().variantCount === 3 && !withExtras) {
      useChatStore.getState().setActiveRun(null)
      if (startVariants(draft)) setDraft('')
      return
    }
    // The mode on screen is the mode sent: Edit is one builder turn, Agent plans, builds and reviews.
    void useAgentStore.getState().submit(draft, undefined, { mode, ...(audioTranscript ? { audioTranscript } : {}) })
  }

  return (
    <div className="flex flex-col gap-2">
      <ModeRow />
      <ModeNote />
      <div className={`pc-composer${agent ? ' is-agent' : ''}`}>
        <PickChip />
        <AttachmentTray />
        <textarea
          rows={2}
          aria-label="Prompt"
          placeholder={agent ? 'Describe the part. The agent plans, builds and reviews it.' : 'Describe a small change'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="pc-composer-bar">
          <AttachButton vision={vision} onSketch={() => setSketching(true)} />
          {dictation.mode && (
            <MicButton
              listening={dictation.state.phase === 'listening'}
              busy={dictation.state.phase === 'transcribing'}
              onToggle={dictation.toggle}
            />
          )}
          <span className="pc-spacer" />
          {busy ? (
            <button type="button" className="pc-btn is-sm" aria-label="Stop" title="Stop" onClick={() => useAgentStore.getState().stop()}>
              <IconStop className="pc-i" aria-hidden="true" />
              {agentBusy ? 'Stop agent' : 'Stop'}
            </button>
          ) : (
            <button type="button" className="pc-btn is-sm is-primary" title={blocked ?? undefined} disabled={!canSend} onClick={send}>
              {agent ? (
                <>
                  <IconAgent className="pc-i" aria-hidden="true" />
                  Run agent
                </>
              ) : (
                <>
                  Send
                  <IconSend className="pc-i" aria-hidden="true" />
                </>
              )}
            </button>
          )}
        </div>
        <div className="pc-opt-row">
          <ModelPicker />
          <EffortPicker />
          {!agent && <VariantCountButton />}
        </div>
        {sketching && (
          <SketchDialog
            onCancel={() => setSketching(false)}
            onAttach={(result) => {
              setSketching(false)
              void attachSketch(result)
            }}
          />
        )}
      </div>
      <DictationCaption state={dictation.state} mode={dictation.mode} />
    </div>
  )
}
