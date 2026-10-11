import { usePrefs } from '../settings/prefsStore'
import { startVariants } from '../variants/startVariants'
import { VariantCountButton } from '../variants/VariantCountButton'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { IconSend, IconStop } from '../ui/icons'
import { useChatStore } from './chatStore'
import { ModelPicker } from './ModelPicker'
import { sendPrompt, stopTurn } from './sendPrompt'
import { DictationCaption } from '../voice/DictationCaption'
import { MicButton } from '../voice/MicButton'
import { useComposerDictation } from '../voice/useDictation'
import { useVoiceStore } from '../voice/voiceStore'

export function Composer() {
  const draft = useChatStore((s) => s.draft)
  const setDraft = useChatStore((s) => s.setDraft)
  const busy = useChatStore((s) => s.busy)
  const profile = useProvidersStore(selectActiveProfile)
  const model = useProvidersStore(selectActiveModel)
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
    if (usePrefs.getState().variantCount === 3) {
      if (startVariants(draft)) setDraft('')
      return
    }
    void (audioTranscript ? sendPrompt(draft, { audioTranscript }) : sendPrompt(draft))
  }

  return (
    <>
      <div className="pc-composer">
        <textarea
          rows={2}
          aria-label="Prompt"
          placeholder="Describe a part, or ask for a change"
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
          <ModelPicker />
          <span className="pc-spacer" />
          {dictation.mode && (
            <MicButton
              listening={dictation.state.phase === 'listening'}
              busy={dictation.state.phase === 'transcribing'}
              onToggle={dictation.toggle}
            />
          )}
          <VariantCountButton />
          {busy ? (
            <button type="button" className="pc-btn is-icon is-sm" aria-label="Stop" title="Stop" onClick={stopTurn}>
              <IconStop className="pc-i" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="pc-btn is-icon is-sm is-primary"
              aria-label="Send"
              title={blocked ?? undefined}
              disabled={!canSend}
              onClick={send}
            >
              <IconSend className="pc-i" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <DictationCaption state={dictation.state} mode={dictation.mode} />
    </>
  )
}
