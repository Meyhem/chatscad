// @vitest-environment node
import { errorResult, okResult } from '../test/results'
import { SYSTEM_PROMPT, buildMessages, buildSystemPrompt, formatCompileErrors } from './prompt'

it('fixes the contract in the system prompt', () => {
  expect(SYSTEM_PROMPT).toContain('valid OpenSCAD')
  expect(SYSTEM_PROMPT).toContain('millimetres')
  expect(SYSTEM_PROMPT).toContain('Customizer')
  expect(SYSTEM_PROMPT).toContain('/* [Group] */')
  expect(SYSTEM_PROMPT).toContain('module')
  expect(SYSTEM_PROMPT).toContain('```openscad')
  expect(SYSTEM_PROMPT).toContain('<<<<<<< SEARCH')
  expect(SYSTEM_PROMPT).toContain('>>>>>>> REPLACE')
})

it('forbids libraries unless some are enabled', () => {
  expect(buildSystemPrompt({ code: '' })).toBe(`${SYSTEM_PROMPT}\n\nNo external libraries are available: do not use include <…> or use <…>.`)
})

it('asks for the whole file on the first turn, with the current code', () => {
  const msgs = buildMessages([], 'Make it taller', { code: 'cube(10);' })
  expect(msgs).toHaveLength(1)
  expect(msgs[0].role).toBe('user')
  const text = msgs[0].content as string
  expect(text).toContain('Current main.scad:\n```openscad\ncube(10);\n```')
  expect(text).toContain('Reply with the complete file in one ```openscad block.')
  expect(text.endsWith('Request: Make it taller')).toBe(true)
})

it('says the editor is empty when there is no code', () => {
  const text = buildMessages([], 'A knob', { code: '  ' })[0].content as string
  expect(text).toContain('The editor is empty.')
  expect(text).not.toContain('Current main.scad')
})

it('asks for SEARCH/REPLACE blocks on follow-ups and keeps the history first', () => {
  const history = [
    { role: 'user' as const, content: 'A box' },
    { role: 'assistant' as const, content: 'Made a box.' },
  ]
  const msgs = buildMessages(history, 'Walls 2.4 mm', { code: 'wall = 2;\n' })
  expect(msgs.slice(0, 2)).toEqual(history)
  const text = msgs[2].content as string
  expect(text).toContain('Reply with SEARCH/REPLACE blocks')
  expect(text).not.toContain('Reply with the complete file')
})

it('puts compiler errors into the final message', () => {
  const text = buildMessages([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }], 'Fix it', {
    code: 'cube(',
    errors: 'ERROR: Parser error in file "/main.scad", line 1: syntax error',
  })[2].content as string
  expect(text).toContain('OpenSCAD reported these errors:\n```text\nERROR: Parser error in file "/main.scad", line 1: syntax error\n```')
})

it('keeps image parts and puts the context in a leading text part', () => {
  const msgs = buildMessages([], [{ type: 'text', text: 'Like this' }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }], { code: '' })
  const parts = msgs[0].content as Array<{ type: string }>
  expect(parts[0]).toEqual({ type: 'text', text: expect.stringContaining('The editor is empty.') })
  expect(parts.slice(1)).toEqual([
    { type: 'text', text: 'Like this' },
    { type: 'image', mediaType: 'image/png', data: 'AAAA' },
  ])
})

describe('formatCompileErrors', () => {
  it('lists the ERROR lines from the log', () => {
    expect(formatCompileErrors(errorResult())).toBe('ERROR: Parser error in file "/main.scad", line 1: syntax error')
  })
  it('falls back to the failure message when the log names nothing', () => {
    expect(
      formatCompileErrors({ ok: false, error: 'Render timed out after 60 s', logs: [], diagnostics: [], renderMs: 60_000 }),
    ).toBe('Render timed out after 60 s')
  })
  it('is empty for a successful render', () => {
    expect(formatCompileErrors(okResult())).toBe('')
  })
})

it('mentions only the enabled libraries', () => {
  expect(buildSystemPrompt({ code: '', libraries: ['BOSL2'] })).toContain('include <BOSL2/std.scad>')
  expect(buildSystemPrompt({ code: '' })).not.toContain('BOSL2')
})
