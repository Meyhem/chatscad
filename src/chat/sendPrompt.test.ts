import { ProviderError } from '../ai/types'
import { DEFAULT_SETTINGS, db } from '../db/db'
import { newProfile } from '../db/profiles'
import { useProvidersStore } from '../settings/providersStore'
import { DEFAULT_CODE, useAppStore } from '../state/store'
import { resetDb } from '../test/db'
import { scriptedProvider } from '../test/providers'
import { errorResult, okResult } from '../test/results'
import { useChatStore } from './chatStore'
import { goBack, sendPrompt, stopTurn } from './sendPrompt'

const FULL = 'Made a block.\n\n```openscad\ncube([30, 20, 10]);\n```\n'
const BROKEN = 'Here.\n\n```openscad\ncube([12, 12, 12]\n```\n'
const FIXED = 'Closed it.\n\n```openscad\ncube([12, 12, 12]);\n```\n'
const profile = newProfile({ name: 'Test', adapter: 'openai-compatible', baseUrl: 'https://llm.test/v1', defaultModel: 'test-model' })

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useChatStore.setState(useChatStore.getInitialState(), true)
  useProvidersStore.setState(
    {
      ...useProvidersStore.getInitialState(),
      loaded: true,
      profiles: [profile],
      settings: { ...DEFAULT_SETTINGS, activeProfileId: profile.id, activeModel: 'test-model' },
    },
    true,
  )
})

const chat = () => useChatStore.getState()

it('runs a turn: user message, labelled reply with cost, AI code in the editor, one usage row', async () => {
  const { provider } = scriptedProvider({ text: FULL, usage: { inputTokens: 1000, outputTokens: 310, costUsd: 0.011 } })
  await sendPrompt('  A block  ', { createProvider: () => provider, render: async () => okResult() })

  expect(chat().messages).toEqual([
    expect.objectContaining({ role: 'user', text: 'A block', status: 'done' }),
    expect.objectContaining({
      role: 'assistant',
      text: 'Made a block.',
      status: 'done',
      turnLabel: 'v1',
      model: 'test-model',
      usage: { inputTokens: 1000, outputTokens: 310, cost: 0.011 },
      compileStatus: 'ok',
    }),
  ])
  expect(useAppStore.getState()).toMatchObject({ code: 'cube([30, 20, 10]);\n', codeSource: 'ai' })
  expect(chat()).toMatchObject({ busy: false, fixing: null, draft: '' })
  expect(chat().history).toEqual([
    { role: 'user', content: 'A block' },
    { role: 'assistant', content: 'Made a block.' },
  ])
  await vi.waitFor(async () =>
    expect(await db.usage.toArray()).toEqual([
      expect.objectContaining({ profileId: profile.id, model: 'test-model', inputTokens: 1000, outputTokens: 310, cost: 0.011, costSource: 'provider' }),
    ]),
  )
})

it('starts from an empty file while the editor still holds the sample model', async () => {
  const { provider, requests } = scriptedProvider(FULL)
  expect(useAppStore.getState().code).toBe(DEFAULT_CODE)
  await sendPrompt('A block', { createProvider: () => provider, render: async () => okResult() })
  expect(requests[0].messages.at(-1)?.content).toContain('The editor is empty.')
})

it('shows the compile error, auto-fixes, and labels each attempt', async () => {
  const { provider } = scriptedProvider(BROKEN, FIXED)
  const results = [errorResult(), okResult()]
  await sendPrompt('A cube', { createProvider: () => provider, render: async () => results.shift()! })

  const replies = chat().messages.filter((m) => m.role === 'assistant')
  expect(replies).toHaveLength(2)
  expect(replies[0]).toMatchObject({
    turnLabel: 'v1',
    compileStatus: 'error',
    error: { title: 'Line 1: Parser error: syntax error', body: 'OpenSCAD exited with code 1' },
  })
  expect(replies[1]).toMatchObject({ turnLabel: 'v2', compileStatus: 'ok', text: 'Closed it.' })
  expect(useAppStore.getState()).toMatchObject({ code: 'cube([12, 12, 12]);\n', codeSource: 'autofix' })
  expect(chat().fixing).toBeNull()
})

it('notes when auto-fix gives up', async () => {
  useProvidersStore.setState((s) => ({ settings: { ...s.settings, autoFixAttempts: 1 } }))
  const { provider } = scriptedProvider(BROKEN, BROKEN)
  await sendPrompt('A cube', { createProvider: () => provider, render: async () => errorResult() })
  expect(chat().messages.at(-1)).toMatchObject({ role: 'note', text: "Auto-fix stopped after 1 attempt. The code still doesn't compile." })
})

it('turns a provider error into an error callout on the reply', async () => {
  const { provider } = scriptedProvider(new ProviderError('auth', 'Incorrect API key provided', 401))
  await sendPrompt('A cube', { createProvider: () => provider, render: async () => okResult() })
  expect(chat().messages.at(-1)).toMatchObject({
    role: 'assistant',
    status: 'error',
    error: { title: 'llm.test rejected the API key', body: 'Incorrect API key provided. Check the key in Settings › AI providers.' },
  })
  expect(chat().busy).toBe(false)
})

it('a manual edit stops the turn and keeps the edit', async () => {
  const { provider } = scriptedProvider(FULL)
  // No render loop runs in this test, so the default awaitRender waits until the turn is stopped.
  const turn = sendPrompt('A block', { createProvider: () => provider })
  await vi.waitFor(() => expect(useAppStore.getState().code).toBe('cube([30, 20, 10]);\n'))
  useAppStore.getState().setCode('cube(2);')
  await turn
  expect(chat().messages.at(-1)).toMatchObject({ role: 'note', text: 'Stopped: you edited the code.' })
  expect(useAppStore.getState().code).toBe('cube(2);')
  expect(chat().busy).toBe(false)
})

it('Stop ends the turn with a note', async () => {
  const { provider } = scriptedProvider(FULL)
  const turn = sendPrompt('A block', { createProvider: () => provider })
  await vi.waitFor(() => expect(useAppStore.getState().codeSource).toBe('ai'))
  stopTurn()
  await turn
  expect(chat().messages.at(-1)).toMatchObject({ role: 'note', text: 'Stopped.' })
})

it('Back to restores the code from before the turn', async () => {
  useAppStore.getState().setCode('cube(5);\n')
  const { provider } = scriptedProvider(BROKEN)
  useProvidersStore.setState((s) => ({ settings: { ...s.settings, autoFixAttempts: 0 } }))
  await sendPrompt('Bigger', { createProvider: () => provider, render: async () => errorResult() })
  expect(chat().backTo).toEqual({ label: null, code: 'cube(5);\n' })
  goBack()
  expect(useAppStore.getState()).toMatchObject({ code: 'cube(5);\n', codeSource: 'restore' })
  expect(chat().messages.at(-1)).toMatchObject({ role: 'note', text: 'Went back to the code from before this prompt.' })
  expect(chat().backTo).toBeNull()
})

it('does nothing without text or without a model', async () => {
  const { provider, requests } = scriptedProvider(FULL)
  await sendPrompt('   ', { createProvider: () => provider })
  useProvidersStore.setState({ profiles: [] })
  await sendPrompt('A block', { createProvider: () => provider })
  expect(requests).toHaveLength(0)
  expect(chat().messages).toEqual([])
})

it('a slider move stops the turn, so the turn is never judged on the person\'s parameter values', async () => {
  const { provider } = scriptedProvider(FULL)
  const turn = sendPrompt('A block', { createProvider: () => provider })
  await vi.waitFor(() => expect(useAppStore.getState().code).toBe('cube([30, 20, 10]);\n'))
  useAppStore.getState().setParams({ width: 30 })
  await turn
  expect(chat().messages.at(-1)).toMatchObject({ role: 'note', text: 'Stopped: you changed a parameter.' })
  expect(chat().busy).toBe(false)
})

it('keeps the dictated transcript on the user message', async () => {
  const { provider } = scriptedProvider({ text: FULL })
  await sendPrompt('A block', { createProvider: () => provider, render: async () => okResult(), audioTranscript: 'a block' })
  expect(chat().messages[0]).toMatchObject({ role: 'user', text: 'A block', audioTranscript: 'a block' })
})

describe('M5: images and the picked part', () => {
  const turnInput = {
    saveImage: vi.fn(async () => 'blob-1'),
    toBase64: vi.fn(async () => 'QUJD'),
    captureViewport: vi.fn(async () => null),
  }
  const visionProfile = { ...profile, capabilities: { ...profile.capabilities, vision: true } }

  beforeEach(async () => {
    const { useAttachments } = await import('../images/attachments')
    const { useRefineStore } = await import('../refine/refineStore')
    useAttachments.setState({ items: [], error: null })
    useRefineStore.setState({ pick: null })
    useProvidersStore.setState({ profiles: [visionProfile] })
  })

  it('sends attached images as image parts, stores them on the user message and clears the tray', async () => {
    const { useAttachments } = await import('../images/attachments')
    const image = new Blob(['png'], { type: 'image/png' })
    useAttachments.setState({ items: [{ id: 'a1', blob: image, mediaType: 'image/png', name: 'hook.png', note: '', url: 'blob:x' }] })
    const { provider, requests } = scriptedProvider({ text: FULL })
    await sendPrompt('Like this', { createProvider: () => provider, render: async () => okResult(), turnInput })

    expect(chat().messages[0]).toMatchObject({ role: 'user', text: 'Like this', imageBlobIds: ['blob-1'] })
    const last = requests[0].messages.at(-1)!
    expect(JSON.stringify(last.content)).toContain('"type":"image"')
    expect(useAttachments.getState().items).toEqual([])
  })

  it('scopes the turn to the picked part', async () => {
    const { useRefineStore } = await import('../refine/refineStore')
    const { partPickFixture } = await import('../test/picks')
    useAppStore.setState({ code: 'a();\nb();\nc();\n' })
    useRefineStore.setState({ pick: { ...partPickFixture(), scope: { startLine: 2, endLine: 2 } } })
    const { provider, requests } = scriptedProvider({ text: 'Done.\n\n```openscad\na();\nB();\nc();\n```\n' })
    await sendPrompt('Make it bigger', { createProvider: () => provider, render: async () => okResult(), turnInput })
    expect(requests[0].system).toContain('line 2')
    expect(useAppStore.getState().code).toBe('a();\nB();\nc();\n')
  })

  it('keeps the attachments and says why when the profile cannot take images', async () => {
    const { useAttachments } = await import('../images/attachments')
    useProvidersStore.setState({ profiles: [profile] })
    useAttachments.setState({ items: [{ id: 'a1', blob: new Blob(['x']), mediaType: 'image/png', name: 'hook.png', note: '', url: 'blob:x' }] })
    const { provider, requests } = scriptedProvider({ text: FULL })
    await sendPrompt('Like this', { createProvider: () => provider, render: async () => okResult(), turnInput })
    expect(requests).toHaveLength(0)
    expect(chat().messages).toEqual([])
    expect(chat().busy).toBe(false)
    expect(useAttachments.getState().items).toHaveLength(1)
    expect(useAttachments.getState().error).toMatch(/image/i)
  })
})
