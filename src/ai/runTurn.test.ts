// @vitest-environment node
import type { RenderResult } from '../render/types'
import { scriptedProvider } from '../test/providers'
import { errorResult, okResult } from '../test/results'
import { generateCode, runTurn, type TurnEvent } from './runTurn'

const FULL = 'Made a block.\n\n```openscad\ncube([30, 20, 10]);\n```\n'
const BROKEN = 'Here.\n\n```openscad\ncube([12, 12, 12]\n```\n'
const FIX = 'Closed the bracket.\n\n<<<<<<< SEARCH\ncube([12, 12, 12]\n=======\ncube([12, 12, 12]);\n>>>>>>> REPLACE\n'

describe('generateCode', () => {
  const base = { model: 'm', history: [], userText: 'A block', ctx: { code: '' }, signal: new AbortController().signal }

  it('returns the full file, the prose and the usage, streaming deltas as they come', async () => {
    const { provider, requests } = scriptedProvider({ text: FULL, usage: { inputTokens: 1000, outputTokens: 310, costUsd: 0.011 } })
    const deltas: string[] = []
    const r = await generateCode({ ...base, provider, onDelta: (t) => deltas.push(t) })
    expect(r).toEqual({
      code: 'cube([30, 20, 10]);\n',
      prose: 'Made a block.',
      usage: { inputTokens: 1000, outputTokens: 310, costUsd: 0.011 },
      model: 'm',
    })
    expect(deltas.join('')).toBe(FULL)
    expect(requests[0]).toMatchObject({ model: 'm' })
    expect(requests[0]).not.toHaveProperty('maxTokens')
    expect(requests[0].system).toContain('valid OpenSCAD')
    expect(requests[0]).not.toHaveProperty('temperature')
  })

  it('applies SEARCH/REPLACE edits to the current code', async () => {
    const { provider } = scriptedProvider('Wider.\n<<<<<<< SEARCH\nw = 1;\n=======\nw = 2;\n>>>>>>> REPLACE')
    const r = await generateCode({ ...base, provider, ctx: { code: 'w = 1;\ncube(w);\n' } })
    expect(r.code).toBe('w = 2;\ncube(w);\n')
    expect(r.prose).toBe('Wider.')
  })

  it('asks once for the full file when an edit does not apply, and sums the usage', async () => {
    const miss = 'Changed it.\n<<<<<<< SEARCH\nnot in the file\n=======\nx\n>>>>>>> REPLACE'
    const { provider, requests } = scriptedProvider(miss, FULL)
    const r = await generateCode({ ...base, provider, ctx: { code: 'cube(1);\n' } })
    expect(r.code).toBe('cube([30, 20, 10]);\n')
    expect(r.prose).toBe('Changed it.')
    expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 100 })
    expect(requests).toHaveLength(2)
    const retry = requests[1].messages
    expect(retry.at(-2)).toEqual({ role: 'assistant', content: miss })
    expect(retry.at(-1)?.content).toBe(
      'SEARCH/REPLACE block 1 did not match the current main.scad exactly, so nothing was changed. Reply with the complete updated file in one ```openscad block.',
    )
  })

  it('gives up with no code when the full-file retry has no usable code either', async () => {
    const miss = '<<<<<<< SEARCH\nnope\n=======\nx\n>>>>>>> REPLACE'
    const { provider, requests } = scriptedProvider(miss, 'Sorry, I cannot.')
    const r = await generateCode({ ...base, provider, ctx: { code: 'cube(1);\n' } })
    expect(r.code).toBeNull()
    expect(r.prose).toBe('Sorry, I cannot.')
    expect(requests).toHaveLength(2)
  })

  it('returns no code without retrying when the reply is only prose', async () => {
    const { provider, requests } = scriptedProvider('Which size?')
    expect(await generateCode({ ...base, provider })).toMatchObject({ code: null, prose: 'Which size?' })
    expect(requests).toHaveLength(1)
  })

  it('passes temperature through when set', async () => {
    const { provider, requests } = scriptedProvider(FULL)
    await generateCode({ ...base, provider, temperature: 0.8 })
    expect(requests[0].temperature).toBe(0.8)
  })
})

describe('runTurn', () => {
  function setup(results: RenderResult[], maxFixAttempts = 2) {
    const events: TurnEvent[] = []
    const apply = vi.fn()
    const render = vi.fn(async (_code: string, _signal: AbortSignal) => results.shift() ?? okResult())
    const base = {
      model: 'm',
      history: [],
      userText: 'A block',
      ctx: { code: '' },
      maxFixAttempts,
      render,
      apply,
      onEvent: (e: TurnEvent) => events.push(e),
      signal: new AbortController().signal,
    }
    return { events, apply, render, base, types: () => events.filter((e) => e.type !== 'delta').map((e) => e.type) }
  }

  it('applies the reply as AI code and stops after a successful render', async () => {
    const { provider } = scriptedProvider(FULL)
    const t = setup([okResult()])
    await runTurn({ ...t.base, provider })
    expect(t.apply).toHaveBeenCalledExactlyOnceWith('cube([30, 20, 10]);\n', 'ai')
    expect(t.render).toHaveBeenCalledWith('cube([30, 20, 10]);\n', t.base.signal)
    expect(t.types()).toEqual(['reply', 'rendered'])
    expect(t.events.find((e) => e.type === 'reply')).toMatchObject({ attempt: 0 })
  })

  it('does not apply a finished reply when the turn was aborted before it could be applied', async () => {
    // A manual edit can land between the end of the stream and apply(); the user's code must win.
    const { provider } = scriptedProvider(FULL)
    const t = setup([okResult()])
    const controller = new AbortController()
    const onEvent = (e: TurnEvent) => {
      t.events.push(e)
      if (e.type === 'reply') controller.abort()
    }
    await expect(runTurn({ ...t.base, provider, onEvent, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(t.apply).not.toHaveBeenCalled()
    expect(t.render).not.toHaveBeenCalled()
  })

  it('forwards streamed text as delta events', async () => {
    const { provider } = scriptedProvider(FULL)
    const t = setup([okResult()])
    await runTurn({ ...t.base, provider })
    expect(
      t.events
        .filter((e) => e.type === 'delta')
        .map((e) => (e.type === 'delta' ? e.text : ''))
        .join(''),
    ).toBe(FULL)
  })

  it('sends compiler errors back and applies the fix as auto-fix code', async () => {
    const { provider, requests } = scriptedProvider(BROKEN, FIX)
    const t = setup([errorResult(), okResult()])
    await runTurn({ ...t.base, provider })
    expect(t.types()).toEqual(['reply', 'rendered', 'fixing', 'reply', 'rendered'])
    expect(t.events.find((e) => e.type === 'fixing')).toEqual({
      type: 'fixing',
      attempt: 1,
      of: 2,
      errors: 'ERROR: Parser error in file "/main.scad", line 1: syntax error',
    })
    expect(t.apply.mock.calls).toEqual([
      ['cube([12, 12, 12]\n', 'ai'],
      ['cube([12, 12, 12]);\n', 'autofix'],
    ])
    const fixMessage = requests[1].messages.at(-1)?.content as string
    expect(fixMessage).toContain('```openscad\ncube([12, 12, 12]\n```')
    expect(fixMessage).toContain('ERROR: Parser error')
    expect(requests[1].messages.slice(0, 2)).toEqual([
      { role: 'user', content: 'A block' },
      { role: 'assistant', content: 'Here.' },
    ])
  })

  it('gives up after maxFixAttempts failed fixes', async () => {
    const { provider, requests } = scriptedProvider(BROKEN, BROKEN, BROKEN)
    const t = setup([errorResult(), errorResult(), errorResult()])
    await runTurn({ ...t.base, provider })
    expect(requests).toHaveLength(3)
    expect(t.events.at(-1)).toEqual({ type: 'gave-up', attempts: 2 })
  })

  it('does not auto-fix when maxFixAttempts is 0', async () => {
    const { provider, requests } = scriptedProvider(BROKEN)
    const t = setup([errorResult()], 0)
    await runTurn({ ...t.base, provider })
    expect(requests).toHaveLength(1)
    expect(t.events.at(-1)).toEqual({ type: 'gave-up', attempts: 0 })
  })

  it('neither applies nor renders a reply without code', async () => {
    const { provider } = scriptedProvider('Which size?')
    const t = setup([])
    await runTurn({ ...t.base, provider })
    expect(t.apply).not.toHaveBeenCalled()
    expect(t.render).not.toHaveBeenCalled()
    expect(t.types()).toEqual(['reply'])
  })

  it('rejects with the abort and sends nothing more when stopped during the render', async () => {
    const { provider, requests } = scriptedProvider(FULL)
    const controller = new AbortController()
    const t = setup([])
    const render = (_code: string, signal: AbortSignal) =>
      new Promise<RenderResult>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError'))),
      )
    const done = runTurn({ ...t.base, provider, render, signal: controller.signal })
    await vi.waitFor(() => expect(t.apply).toHaveBeenCalled())
    controller.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).toHaveLength(1)
  })
})
