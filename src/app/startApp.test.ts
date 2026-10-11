// @vitest-environment node
import 'fake-indexeddb/auto'
import { useChatStore } from '../chat/chatStore'
import { db } from '../db/db'
import { useProjectStore } from '../history/projectStore'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/resetDb'
import { startApp, type StartedApp } from './startApp'

let app: StartedApp | null = null

const resetStores = () => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useChatStore.setState({ messages: [] })
}

beforeEach(async () => {
  await resetDb()
  resetStores()
})
afterEach(() => {
  app?.stop()
  app = null
})

it('starts a blank project from the code already in the editor on the first run', async () => {
  useAppStore.getState().setCode('cube(7);')
  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project).toMatchObject({ name: 'Untitled project', origin: 'blank' })
  expect(useAppStore.getState().code).toBe('cube(7);')
  expect(useSettingsStore.getState()).toMatchObject({ loaded: true, settings: { lastProjectId: useProjectStore.getState().project!.id } })
})

it('reopens the last project after a reload, with its head and chat', async () => {
  app = await startApp({ capture: async () => null })
  const first = useProjectStore.getState().project!
  await useProjectStore.getState().commit({ code: 'cube(2);', params: {}, source: 'manual', message: 'edit', model: null, compileStatus: 'ok', renderMs: 1 })
  await db.messages.put({
    id: 'm1', projectId: first.id, versionId: null, role: 'user', content: 'Make a cube', imageBlobIds: [], audioTranscript: null,
    model: null, usageId: null, createdAt: 1,
  })
  app.stop()
  resetStores()

  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project?.id).toBe(first.id)
  expect(useProjectStore.getState().head?.label).toBe('v2')
  expect(useAppStore.getState().code).toBe('cube(2);')
  await vi.waitFor(() => expect(useChatStore.getState().messages.map((m) => m.text)).toEqual(['Make a cube']))
})

it('falls back to the most recent project when the last one is gone', async () => {
  app = await startApp({ capture: async () => null })
  const first = useProjectStore.getState().project!
  await useSettingsStore.getState().update({ lastProjectId: 'deleted' })
  app.stop()
  resetStores()
  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project?.id).toBe(first.id)
})

it('records versions once started: an edit plus a successful render becomes v2', async () => {
  app = await startApp({ capture: async () => null })
  useAppStore.getState().setCode('cube(3);')
  await Promise.resolve()
  const s = useAppStore.getState()
  const { okResult } = await import('../test/results')
  s.renderFinished(okResult(), s.code, s.params)
  await vi.waitFor(() => expect(useProjectStore.getState().head?.label).toBe('v2'))
})
