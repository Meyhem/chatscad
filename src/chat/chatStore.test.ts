import { selectChatCost, useChatStore, type ChatMessage } from './chatStore'
import { streamingText } from './streamingText'

beforeEach(() => useChatStore.setState(useChatStore.getInitialState(), true))

const assistant = (usage: ChatMessage['usage']): Omit<ChatMessage, 'id'> => ({
  role: 'assistant',
  text: 'x',
  turnLabel: null,
  model: 'm',
  usage,
  status: 'done',
})

it('adds, patches and streams into messages', () => {
  const id = useChatStore.getState().addMessage({ ...assistant(null), text: '', status: 'streaming' })
  useChatStore.getState().appendText(id, 'Made ')
  useChatStore.getState().appendText(id, 'a cube.')
  useChatStore.getState().patchMessage(id, { status: 'done', turnLabel: 'v1' })
  expect(useChatStore.getState().messages).toEqual([
    { id, role: 'assistant', text: 'Made a cube.', turnLabel: 'v1', model: 'm', usage: null, status: 'done' },
  ])
})

it('numbers turns v1, v2… and finds the label of earlier code', () => {
  expect(useChatStore.getState().nextLabel('cube(1);')).toBe('v1')
  expect(useChatStore.getState().nextLabel('cube(2);')).toBe('v2')
  expect(useChatStore.getState().labelForCode('cube(1);')).toBe('v1')
  expect(useChatStore.getState().labelForCode('sphere(1);')).toBeNull()
})

it('sums the cost of the chat, and says when nothing is priced', () => {
  expect(selectChatCost(useChatStore.getState())).toBeUndefined()
  useChatStore.getState().addMessage(assistant({ inputTokens: 1, outputTokens: 1, cost: null }))
  expect(selectChatCost(useChatStore.getState())).toBeNull()
  useChatStore.getState().addMessage(assistant({ inputTokens: 1, outputTokens: 1, cost: 0.011 }))
  useChatStore.getState().addMessage(assistant({ inputTokens: 1, outputTokens: 1, cost: 0.015 }))
  expect(selectChatCost(useChatStore.getState())).toBeCloseTo(0.026, 10)
})

it('shows only the prose before the first code fence or SEARCH block while streaming', () => {
  expect(streamingText('Making a hook')).toEqual({ prose: 'Making a hook', writing: false })
  expect(streamingText('Made a hook.\n\n```openscad\nmodule ho')).toEqual({ prose: 'Made a hook.', writing: true })
  expect(streamingText('Wider.\n<<<<<<< SEARCH\nw =')).toEqual({ prose: 'Wider.', writing: true })
})

it('appends reasoning and stamps when it started', () => {
  vi.useFakeTimers({ now: 1_000 })
  const id = useChatStore.getState().addMessage({ role: 'assistant', text: '', turnLabel: null, model: 'm', usage: null, status: 'streaming' })
  useChatStore.getState().appendReasoning(id, 'Wall ')
  vi.setSystemTime(5_000)
  useChatStore.getState().appendReasoning(id, 'is 1.6 mm.')
  vi.useRealTimers()
  expect(useChatStore.getState().messages[0]).toMatchObject({ reasoning: 'Wall is 1.6 mm.', reasoningStartedAt: 1_000 })
})

it('stamps when reasoning ended at the first reply text', () => {
  vi.useFakeTimers({ now: 1_000 })
  const id = useChatStore.getState().addMessage({ role: 'assistant', text: '', turnLabel: null, model: 'm', usage: null, status: 'streaming' })
  useChatStore.getState().appendText(id, 'no reasoning yet ')
  expect(useChatStore.getState().messages[0]).not.toHaveProperty('reasoningEndedAt')
  useChatStore.getState().appendReasoning(id, 'Hmm')
  vi.setSystemTime(9_000)
  useChatStore.getState().appendText(id, 'Made')
  vi.setSystemTime(12_000)
  useChatStore.getState().appendText(id, ' it')
  vi.useRealTimers()
  expect(useChatStore.getState().messages[0]).toMatchObject({ reasoningStartedAt: 1_000, reasoningEndedAt: 9_000 })
})

it('stamps messages added during an agent run with its id', () => {
  const chat = useChatStore.getState()
  chat.setActiveRun('run-1')
  const inRun = chat.addMessage(assistant(null))
  chat.setActiveRun(null)
  const after = chat.addMessage(assistant(null))
  const byId = new Map(useChatStore.getState().messages.map((m) => [m.id, m]))
  expect(byId.get(inRun)?.runId).toBe('run-1')
  expect(byId.get(after)).not.toHaveProperty('runId')
})
