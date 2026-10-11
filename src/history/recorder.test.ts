// @vitest-environment node
import 'fake-indexeddb/auto'
import { useChatStore, type ChatMessage } from '../chat/chatStore'
import { bakeParams } from '../scad/customizer'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { errorResult, okResult } from '../test/results'
import { onBeforeLeaveHead, useProjectStore } from './projectStore'
import { describeChatTurn, startRecorder, type Recorder, type TurnInfo } from './recorder'

const CODE = 'w = 10; // [1:1:50]\ncube(w);'
const EDITED = 'w = 10; // [1:1:50]\ncube(w + 1);'
const turn: TurnInfo = { prompt: 'Make it taller', reply: 'Raised the height.\nNothing else changed.', model: 'gpt-x' }
const capture = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
const onCommit = vi.fn()
let recorder: Recorder

const app = () => useAppStore.getState()
const project = () => useProjectStore.getState()
const labels = () => project().versions.map((v) => `${v.label} ${v.source} ${v.compileStatus} ${v.message}`)
const rendered = (ok = true) => {
  const s = app()
  s.renderFinished(ok ? okResult() : errorResult(), s.code, s.params)
}

async function start(idleMs = 30_000) {
  recorder = startRecorder({ idleMs, capture, describeTurn: () => turn, onCommit })
}

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useChatStore.setState({ messages: [] })
  onBeforeLeaveHead(null)
  await project().newProject({ code: CODE, origin: 'blank' })
  capture.mockClear()
  onCommit.mockClear()
})
afterEach(() => {
  recorder.stop()
  vi.useRealTimers()
})

it('fills in the status, time and thumbnail of a pending head when its render finishes', async () => {
  await start()
  rendered()
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual ok New project'])
  expect(project().head).toMatchObject({ renderMs: 12, thumbnailBlobId: expect.any(String) })
  expect(capture).toHaveBeenCalledTimes(1)
})

it('coalesces manual edits into one version on the next successful render', async () => {
  await start()
  app().setCode(`${EDITED} `)
  app().setCode(EDITED)
  await recorder.settled()
  expect(project().versions).toHaveLength(1)

  rendered()
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 manual ok Edited code · +1 −1 lines'])
  expect(project().head).toMatchObject({ code: EDITED, renderMs: 12, thumbnailBlobId: expect.any(String) })
  expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ label: 'v2' }))
})

it('does not commit on a failed render, but does on blur, with the error status', async () => {
  await start()
  app().setCode('cube(')
  await recorder.settled()
  rendered(false)
  await recorder.settled()
  expect(project().versions).toHaveLength(1)

  await recorder.flush()
  expect(labels().at(-1)).toBe('v2 manual error Edited code · +1 −2 lines')
  expect(capture).not.toHaveBeenCalled()
})

it('commits a pending edit after 30 s without changes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await start()
  app().setCode(EDITED)
  await recorder.settled()
  await vi.advanceTimersByTimeAsync(29_999)
  await recorder.settled()
  expect(project().versions).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  await recorder.settled()
  expect(labels().at(-1)).toBe('v2 manual pending Edited code · +1 −1 lines')
})

it('records a slider change with old and new values, and nothing when it is moved back', async () => {
  await start()
  app().setParams({ w: 20 })
  app().setParams({ w: 10 })
  await recorder.settled()
  rendered()
  await recorder.settled()
  expect(project().versions).toHaveLength(1)

  app().setParams({ w: 20 })
  await recorder.settled()
  rendered()
  await recorder.settled()
  expect(labels().at(-1)).toBe('v2 slider ok w 10 → 20')
  expect(project().head?.params).toEqual({ w: 20 })
})

it('records an AI change at once with the prompt and model, then its render result', async () => {
  await start()
  app().setCode('cube(5);', 'ai')
  await recorder.settled()
  expect(project().head).toMatchObject({ label: 'v2', source: 'ai', compileStatus: 'pending', message: 'Make it taller', model: 'gpt-x' })
  rendered(false)
  await recorder.settled()
  expect(project().head?.compileStatus).toBe('error')

  app().setCode('cube(6);', 'autofix')
  await recorder.settled()
  expect(project().head).toMatchObject({ label: 'v3', source: 'autofix', message: 'Auto-fix: Raised the height.' })
})

it('keeps the source of a code change when the editor echoes the same code back as manual', async () => {
  await start()
  app().setCode('cube(5);', 'ai')
  app().setCode('cube(5);')
  await recorder.settled()
  expect(project().head).toMatchObject({ label: 'v2', source: 'ai' })
})

it('saves a pending manual edit as its own version before an AI change', async () => {
  await start()
  app().setCode(EDITED)
  await recorder.settled()
  app().setCode('cube(5);', 'ai')
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 manual pending Edited code · +1 −1 lines', 'v3 ai pending Make it taller'])
  expect(project().versions[2]!.parentId).toBe(project().versions[1]!.id)
})

it('records Bake into code as one slider version that supersedes the pending slider change', async () => {
  await start()
  app().setParams({ w: 20 })
  await recorder.settled()
  app().setCode(bakeParams(CODE, { w: 20 }), 'slider')
  app().setParams({})
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 slider pending Baked w into code'])
  expect(project().head).toMatchObject({ code: 'w = 20; // [1:1:50]\ncube(w);', params: {} })
})

it('records nothing extra for project-store restores and undo, and labels an editor restore', async () => {
  await start()
  const v1 = project().head!
  app().setCode(EDITED)
  await recorder.flush()
  await project().restore(v1.id)
  await recorder.settled()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 manual pending Edited code · +1 −1 lines', 'v3 restore pending Restored v1'])
  rendered()
  await recorder.settled()
  expect(project().head?.compileStatus).toBe('ok')

  await project().undo()
  await recorder.settled()
  expect(project().versions).toHaveLength(3)

  // M2's "Back to vN" sets older code with the 'restore' source. The head is v2 again after the undo.
  app().setCode(EDITED, 'restore')
  await recorder.settled()
  expect(labels()).toHaveLength(3)
  app().setCode(CODE, 'restore')
  await recorder.settled()
  expect(labels().at(-1)).toBe('v2.1 restore ok Restored v1')
  app().setCode('cube(42);', 'restore')
  await recorder.settled()
  expect(labels().at(-1)).toBe('v2.2 restore pending Restored earlier code')
})

it('flushes a pending edit before the head moves', async () => {
  await start()
  onBeforeLeaveHead(() => recorder.flush())
  app().setCode(EDITED)
  await recorder.settled()
  await project().undo()
  expect(labels()).toEqual(['v1 manual pending New project', 'v2 manual pending Edited code · +1 −1 lines'])
  expect(project().head?.label).toBe('v1')
  expect(app().code).toBe(CODE)
})

it('stops listening when stopped', async () => {
  await start()
  recorder.stop()
  app().setCode('cube(5);', 'ai')
  await recorder.settled()
  expect(project().versions).toHaveLength(1)
})

it('describes the latest chat turn', () => {
  const msg = (role: ChatMessage['role'], text: string, model: string | null = null): ChatMessage => ({
    id: crypto.randomUUID(), role, text, turnLabel: null, model, usage: null, status: 'done',
  })
  useChatStore.setState({ messages: [msg('user', 'first'), msg('assistant', 'one', 'm1'), msg('user', 'second'), msg('assistant', 'two', 'm2')] })
  expect(describeChatTurn()).toEqual({ prompt: 'second', reply: 'two', model: 'm2' })
  useChatStore.setState({ messages: [] })
  expect(describeChatTurn()).toEqual({ prompt: null, reply: null, model: null })
})
