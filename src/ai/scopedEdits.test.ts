import { buildSystemPrompt } from './prompt'
import { generateCode } from './runTurn'
import { changedOutsideRange, scopeInstruction } from './scope'
import type { ChatEvent, ChatRequest, LlmProvider } from './types'

const CODE = ['a = 1;', 'module peg() { cube(10); }', 'plate();', 'peg();', ''].join('\n')
const SELECTION = { startLine: 2, endLine: 2, label: 'peg' }

const block = (search: string, replace: string) => `Done.\n\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n`
const INSIDE = block('module peg() { cube(10); }', 'module peg() { cube(12); }')
const OUTSIDE = block('a = 1;', 'a = 2;')

function scriptedProvider(replies: string[]): LlmProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    requests,
    listModels: async () => [],
    async *streamChat(req: ChatRequest): AsyncIterable<ChatEvent> {
      requests.push(req)
      yield { type: 'text', delta: replies.shift() ?? '' }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    },
  }
}

const run = (provider: LlmProvider, ctx: Parameters<typeof generateCode>[0]['ctx'] = { code: CODE, selection: SELECTION }) =>
  generateCode({ provider, model: 'm', history: [], userText: 'Make the peg taller', ctx, signal: new AbortController().signal })

describe('generateCode with a selection', () => {
  it('applies an edit inside the selection in one request', async () => {
    const provider = scriptedProvider([INSIDE])
    const result = await run(provider)
    expect(result.code).toBe(CODE.replace('cube(10)', 'cube(12)'))
    expect(provider.requests).toHaveLength(1)
  })

  it('rejects an edit outside the selection and retries once with the line range spelled out', async () => {
    const provider = scriptedProvider([OUTSIDE, INSIDE])
    const result = await run(provider)
    expect(result.code).toBe(CODE.replace('cube(10)', 'cube(12)'))
    expect(provider.requests).toHaveLength(2)
    expect(JSON.stringify(provider.requests[1].messages)).toContain('Your previous reply changed lines outside line 2')
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 })
  })

  it('gives up after the retry also strays, and leaves the code alone', async () => {
    const provider = scriptedProvider([OUTSIDE, OUTSIDE])
    const result = await run(provider)
    expect(result.code).toBeNull()
    expect(result.prose).toBe(
      'The reply changed lines outside line 2, so it was not applied. Ask again, or clear the selected part to allow changes anywhere.',
    )
  })

  it('accepts SEARCH text that quotes unchanged lines around the selection', async () => {
    const provider = scriptedProvider([block('a = 1;\nmodule peg() { cube(10); }', 'a = 1;\nmodule peg() { cube(12); }')])
    expect((await run(provider)).code).toBe(CODE.replace('cube(10)', 'cube(12)'))
    expect(provider.requests).toHaveLength(1)
  })

  it('checks full-file replies the same way', async () => {
    const full = `Here.\n\n\`\`\`openscad\n${CODE.replace('a = 1;', 'a = 9;')}\`\`\`\n`
    const provider = scriptedProvider([full, INSIDE])
    expect((await run(provider)).code).toBe(CODE.replace('cube(10)', 'cube(12)'))
    expect(provider.requests).toHaveLength(2)
  })

  it('does not restrict auto-fix replies', async () => {
    const provider = scriptedProvider([OUTSIDE])
    const result = await run(provider, { code: CODE, selection: SELECTION, errors: 'ERROR: something' })
    expect(result.code).toBe(CODE.replace('a = 1;', 'a = 2;'))
    expect(provider.requests).toHaveLength(1)
  })
})

describe('the scope rule in the system prompt', () => {
  it('names the lines and quotes them', () => {
    const system = buildSystemPrompt({ code: CODE, selection: SELECTION })
    expect(system).toContain('Edit only line 2.')
    expect(system).toContain('module peg() { cube(10); }')
    expect(scopeInstruction({ startLine: 15, endLine: 17, label: 'bores' }, CODE)).toContain('Edit only lines 15–17.')
  })

  it('is left out without a selection and for auto-fix requests', () => {
    expect(buildSystemPrompt({ code: CODE })).not.toContain('Edit only')
    expect(buildSystemPrompt({ code: CODE, selection: SELECTION, errors: 'ERROR: x' })).not.toContain('Edit only')
  })
})

describe('changedOutsideRange', () => {
  const before = 'a\nb\nc\nd\n'
  it('allows the range to change, grow and shrink', () => {
    expect(changedOutsideRange(before, 'a\nB\nc\nd\n', { startLine: 2, endLine: 3 })).toBe(false)
    expect(changedOutsideRange(before, 'a\nb\nx\ny\nc\nd\n', { startLine: 2, endLine: 3 })).toBe(false)
    expect(changedOutsideRange(before, 'a\nd\n', { startLine: 2, endLine: 3 })).toBe(false)
  })

  it('flags changes before or after the range', () => {
    expect(changedOutsideRange(before, 'A\nb\nc\nd\n', { startLine: 2, endLine: 3 })).toBe(true)
    expect(changedOutsideRange(before, 'a\nb\nc\nD\n', { startLine: 2, endLine: 3 })).toBe(true)
    expect(changedOutsideRange(before, 'a\n', { startLine: 2, endLine: 3 })).toBe(true)
  })

  it('ignores CRLF and a missing final newline', () => {
    expect(changedOutsideRange('a\r\nb\r\n', 'a\nB\n', { startLine: 2, endLine: 2 })).toBe(false)
    expect(changedOutsideRange('a\nb\nc\n', 'A\nb\nc', { startLine: 1, endLine: 1 })).toBe(false)
  })
})
