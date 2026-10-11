import { create } from 'zustand'

/** The last final transcript, kept until the message it produced is sent (StoredMessage.audioTranscript). */
export const useVoiceStore = create<{ transcript: string | null; setTranscript(t: string | null): void; takeTranscript(): string | null }>()(
  (set, get) => ({
    transcript: null,
    setTranscript: (transcript) => set({ transcript }),
    takeTranscript: () => {
      const t = get().transcript
      set({ transcript: null })
      return t
    },
  }),
)
