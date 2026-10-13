// @vitest-environment node
import 'fake-indexeddb/auto'
import { useChatStore, type ChatMessage } from '../chat/chatStore'
import { db, type UsageRecord } from '../db/db'
import { installUsageHook } from '../db/usageLinks'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { startChatPersistence, type ChatPersistence } from './chatPersistence'
import { projectCost } from './projectCost'
import { useProjectStore } from './projectStore'

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: crypto.randomUUID(),
  role: 'user',
  text: 'hi',
  turnLabel: null,
  model: null,
  usage: null,
  status: 'done',
  ...over,
})

const usage = (id: string): UsageRecord => ({
  id, profileId: 'p', model: 'gpt-x', inputTokens: 1000, outputTokens: 180, cost: 0.006, costSource: 'provider', createdAt: 5, projectId: null, versionId: null,
})

let chat: ChatPersistence
let uninstall: () => void
const store = () => useProjectStore.getState()

beforeEach(async () => {
  await resetDb()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useChatStore.setState({ messages: [] })
  uninstall = installUsageHook(() => store().project?.id ?? null)
  await store().newProject({ code: 'cube(1);', origin: 'blank' })
  chat = startChatPersistence()
})
afterEach(() => {
  chat.stop()
  uninstall()
})

it('stores finished messages of the open project and skips streaming ones', async () => {
  const user = msg({ text: 'A holder for four cells' })
  const reply = msg({ role: 'assistant', text: 'Made…', status: 'streaming' })
  useChatStore.setState({ messages: [user, reply] })
  await chat.settled()
  expect((await db.messages.toArray()).map((m) => [m.role, m.content, m.projectId])).toEqual([['user', 'A holder for four cells', store().project!.id]])
})

it('links a turn to its version: label on the last reply, version on every message, usage on the reply', async () => {
  const user = msg({ text: 'Taller please' })
  const reply = msg({ role: 'assistant', text: 'Raised it.', model: 'gpt-x', status: 'streaming' })
  useChatStore.setState({ messages: [user, reply] })
  await db.usage.add(usage('u1'))
  const v2 = await store().commit({ code: 'cube(2);', params: {}, source: 'ai', message: 'Taller please', model: 'gpt-x', compileStatus: 'pending', renderMs: null })
  await chat.linkTurn(v2)

  // M2 finishes the message and (in M2's own logic) resets the label; M3's label wins.
  useChatStore.setState((s) => ({ messages: s.messages.map((m) => (m.id === reply.id ? { ...m, status: 'done', turnLabel: null } : m)) }))
  await chat.settled()

  expect(useChatStore.getState().messages.find((m) => m.id === reply.id)?.turnLabel).toBe('v2')
  const rows = await db.messages.orderBy('createdAt').toArray()
  expect(rows.map((r) => [r.role, r.versionId, r.usageId])).toEqual([
    ['user', v2.id, null],
    ['assistant', v2.id, 'u1'],
  ])
  expect(await db.usage.get('u1')).toMatchObject({ projectId: store().project!.id, versionId: v2.id })
})

it('loads a project chat with labels, usage and compile status, and swaps chats between projects', async () => {
  const first = store().project!
  const reply = msg({ role: 'assistant', text: 'Made a box.', model: 'gpt-x' })
  useChatStore.setState({ messages: [msg({ text: 'A box' }), reply] })
  await db.usage.add(usage('u1'))
  const v2 = await store().commit({ code: 'cube(2);', params: {}, source: 'ai', message: 'A box', model: 'gpt-x', compileStatus: 'error', renderMs: 3 })
  await chat.linkTurn(v2)
  await chat.settled()

  await store().newProject({ code: 'sphere(1);', origin: 'blank' })
  await chat.load(store().project!.id)
  expect(useChatStore.getState().messages).toEqual([])

  await store().openProject(first.id)
  await chat.load(first.id)
  const loaded = useChatStore.getState().messages
  expect(loaded.map((m) => [m.role, m.text, m.turnLabel, m.status])).toEqual([
    ['user', 'A box', null, 'done'],
    ['assistant', 'Made a box.', 'v2', 'done'],
  ])
  expect(loaded[1]).toMatchObject({ model: 'gpt-x', usage: { inputTokens: 1000, outputTokens: 180, cost: 0.006 }, compileStatus: 'error' })
  expect(projectCost(loaded)).toBeCloseTo(0.006)
  await chat.settled()
  expect(await db.messages.count()).toBe(2)
})

it('writes nothing while no project is open', async () => {
  useProjectStore.setState({ project: null, head: null, versions: [] })
  useChatStore.setState({ messages: [msg({})] })
  await chat.settled()
  expect(await db.messages.count()).toBe(0)
})

it('stores and restores the transcript of a dictated message', async () => {
  const { toStored, fromStored } = await import('./chatPersistence')
  const row = toStored(msg({ text: 'A lid', audioTranscript: 'a lid' }), { projectId: 'p', versionId: null, usageId: null, createdAt: 1 })
  expect(row.audioTranscript).toBe('a lid')
  expect(fromStored(row, undefined, undefined).audioTranscript).toBe('a lid')
  expect(toStored(msg({}), { projectId: 'p', versionId: null, usageId: null, createdAt: 1 }).audioTranscript).toBeNull()
  expect(fromStored({ ...row, audioTranscript: null }, undefined, undefined)).not.toHaveProperty('audioTranscript')
})

it('stores and restores the reasoning, and loads rows saved before reasoning existed', async () => {
  const { toStored, fromStored } = await import('./chatPersistence')
  const meta = { projectId: 'p', versionId: null, usageId: null, createdAt: 1 }
  const row = toStored(
    msg({ role: 'assistant', text: 'Done.', reasoning: 'Wall is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12, reasoningStartedAt: 99 }),
    meta,
  )
  expect(row).toMatchObject({ reasoning: 'Wall is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12 })
  expect(row).not.toHaveProperty('reasoningStartedAt')
  expect(fromStored(row, undefined, undefined)).toMatchObject({ reasoning: 'Wall is 1.6 mm.', reasoningMs: 7_500, reasoningTokens: 12 })
  expect(toStored(msg({}), meta)).toMatchObject({ reasoning: null, reasoningMs: null, reasoningTokens: null })
  const old = { ...row }
  delete old.reasoning
  delete old.reasoningMs
  delete old.reasoningTokens
  const restored = fromStored(old, undefined, undefined)
  expect(restored).not.toHaveProperty('reasoning')
  expect(restored).not.toHaveProperty('reasoningMs')
})

it('stores and restores the agent run a message belongs to', async () => {
  const { toStored, fromStored } = await import('./chatPersistence')
  const meta = { projectId: 'p', versionId: null, usageId: null, createdAt: 1 }
  const row = toStored(msg({ runId: 'run-1' }), meta)
  expect(row.runId).toBe('run-1')
  expect(fromStored(row, undefined, undefined).runId).toBe('run-1')
  expect(toStored(msg({}), meta).runId).toBeNull()
  expect(fromStored(toStored(msg({}), meta), undefined, undefined)).not.toHaveProperty('runId')
})

it('saves the partial reasoning of a stopped reply', async () => {
  const id = crypto.randomUUID()
  useChatStore.setState({ messages: [msg({ id, role: 'assistant', text: '', status: 'streaming', reasoning: 'Half' })] })
  useChatStore.getState().patchMessage(id, { status: 'done', text: 'Stopped before the reply finished.' })
  await chat.settled()
  expect(await db.messages.get(id)).toMatchObject({ reasoning: 'Half' })
})
