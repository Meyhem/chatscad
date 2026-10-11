import { create } from 'zustand'
import type { LlmMessage } from '../ai/types'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'note'
  text: string
  turnLabel: string | null // "v2" in M2 (session turn number); M3 sets the version label
  model: string | null
  usage: { inputTokens: number; outputTokens: number; cost: number | null } | null
  status: 'streaming' | 'done' | 'error'
  error?: { title: string; body: string }
  compileStatus?: 'ok' | 'error'
  imageBlobIds?: string[] // M5
  audioTranscript?: string // what was dictated, when the prompt was spoken
  reasoning?: string // the model's reasoning, shown collapsed; never sent back
  reasoningMs?: number
  reasoningTokens?: number
  reasoningStartedAt?: number // memory only: the live "Thinking · 38 s" timer
}

export interface AutoFixState {
  attempt: number
  of: number
  model: string
}

/** The code before the current turn, for "Back to vN" (D6: held in memory in M2). */
export interface BackTo {
  label: string | null
  code: string
}

export interface ChatState {
  messages: ChatMessage[]
  /** What the model has seen: user prompts and reply prose, without code (the code goes in each new request). */
  history: LlmMessage[]
  busy: boolean
  fixing: AutoFixState | null
  backTo: BackTo | null
  turnCount: number
  codeByLabel: Record<string, string>
  /** Composer text; the suggestions fill it. */
  draft: string
  setDraft(text: string): void
  addMessage(m: Omit<ChatMessage, 'id'>): string
  patchMessage(id: string, patch: Partial<Omit<ChatMessage, 'id'>>): void
  appendText(id: string, delta: string): void
  appendReasoning(id: string, delta: string): void
  nextLabel(code: string): string
  labelForCode(code: string): string | null
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  history: [],
  busy: false,
  fixing: null,
  backTo: null,
  turnCount: 0,
  codeByLabel: {},
  draft: '',
  setDraft: (draft) => set({ draft }),
  addMessage: (m) => {
    const id = crypto.randomUUID()
    set((s) => ({ messages: [...s.messages, { ...m, id }] }))
    return id
  },
  patchMessage: (id, patch) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  appendText: (id, delta) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)) })),
  appendReasoning: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, reasoning: (m.reasoning ?? '') + delta, reasoningStartedAt: m.reasoningStartedAt ?? Date.now() } : m,
      ),
    })),
  nextLabel: (code) => {
    const n = get().turnCount + 1
    const label = `v${n}`
    set((s) => ({ turnCount: n, codeByLabel: { ...s.codeByLabel, [label]: code } }))
    return label
  },
  labelForCode: (code) => {
    const entries = Object.entries(get().codeByLabel)
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i][1] === code) return entries[i][0]
    return null
  },
}))

/** Total cost of this chat; undefined before any reply, null when no reply had a price. */
export function selectChatCost(s: Pick<ChatState, 'messages'>): number | null | undefined {
  const costs = s.messages.flatMap((m) => (m.role === 'assistant' && m.usage ? [m.usage.cost] : []))
  if (costs.length === 0) return undefined
  const priced = costs.filter((c): c is number => c !== null)
  return priced.length === 0 ? null : priced.reduce((sum, c) => sum + c, 0)
}
