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
