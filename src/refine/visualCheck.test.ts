import { ProviderError, type ChatEvent, type ChatRequest, type LlmProvider } from '../ai/types'
import { meshOf } from '../test/meshes'
import { maybeVisualCheck, runVisualCheck, VISUAL_CHECK_QUESTION } from './visualCheck'

const MESH = meshOf([[0, 0, 0, 1, 0, 0, 0, 1, 0]])
const IMAGE = { type: 'image', mediaType: 'image/png', data: 'iso' } as const
const renderImage = async () => IMAGE

function scriptedProvider(reply: string | Error): LlmProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    requests,
    listModels: async () => [],
    async *streamChat(req: ChatRequest): AsyncIterable<ChatEvent> {
      requests.push(req)
      if (reply instanceof Error) throw reply
      yield { type: 'text', delta: reply }
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 20 } }
    },
  }
}

it('asks the vision model the fixed question with the request and an iso image', async () => {
  const provider = scriptedProvider('Yes.\n  It has four   bores.')
  const result = await runVisualCheck({ provider, model: 'm', request: 'A holder for four 18650 cells', mesh: MESH, renderImage })
  const req = provider.requests[0]
  expect(req.maxTokens).toBe(200)
  expect(req.messages).toEqual([
    { role: 'user', content: [{ type: 'text', text: `Request: A holder for four 18650 cells\n\n${VISUAL_CHECK_QUESTION}` }, IMAGE] },
  ])
  expect(result).toEqual({ answer: 'Yes. It has four bores.', usage: { inputTokens: 900, outputTokens: 20 } })
})

describe('maybeVisualCheck', () => {
  const base = { model: 'm', request: 'A block', mesh: MESH, renderImage }

  it('does nothing when the setting is off or the profile has no vision', async () => {
    const provider = scriptedProvider('Yes.')
    const addNote = vi.fn()
    await maybeVisualCheck({ ...base, provider, enabled: false, vision: true, addNote })
    await maybeVisualCheck({ ...base, provider, enabled: true, vision: false, addNote })
    expect(provider.requests).toHaveLength(0)
    expect(addNote).not.toHaveBeenCalled()
  })

  it('shows the answer as a note with its cost, and reports usage once', async () => {
    const addNote = vi.fn()
    const onUsage = vi.fn()
    await maybeVisualCheck({
      ...base,
      provider: scriptedProvider('No. The lid is missing.'),
      enabled: true,
      vision: true,
      price: { inputPerMTok: 1, outputPerMTok: 5 },
      addNote,
      onUsage,
    })
    expect(addNote).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ role: 'note', text: 'Visual check: No. The lid is missing.', status: 'done', model: 'm' }),
    )
    expect(addNote.mock.calls[0][0].usage.cost).toBeCloseTo(0.001)
    expect(onUsage).toHaveBeenCalledExactlyOnceWith({ inputTokens: 900, outputTokens: 20 })
  })

  it('says when the check failed, and stays quiet when it was stopped', async () => {
    const addNote = vi.fn()
    await maybeVisualCheck({ ...base, provider: scriptedProvider(new ProviderError('network', 'Network error')), enabled: true, vision: true, addNote })
    expect(addNote).toHaveBeenCalledWith(expect.objectContaining({ text: 'Visual check failed: Network error' }))
    addNote.mockClear()
    await maybeVisualCheck({ ...base, provider: scriptedProvider(new ProviderError('aborted', 'Stopped')), enabled: true, vision: true, addNote })
    expect(addNote).not.toHaveBeenCalled()
  })
})
