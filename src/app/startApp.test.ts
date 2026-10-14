// @vitest-environment node
import 'fake-indexeddb/auto'
import { useChatStore } from '../chat/chatStore'
import { db } from '../db/db'
import { useProjectStore } from '../history/projectStore'
import { useSettingsStore } from '../settings/settingsStore'
import { useAppStore } from '../state/store'
import { useNewProjectDialog } from '../workbench/newProjectDialogStore'
import { resetDb } from '../test/resetDb'
import { startApp, type StartedApp } from './startApp'

let app: StartedApp | null = null

const resetStores = () => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useProjectStore.setState(useProjectStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useChatStore.setState({ messages: [] })
  useNewProjectDialog.setState({ open: false })
}

beforeEach(async () => {
  await resetDb()
  resetStores()
})
afterEach(() => {
  app?.stop()
  app = null
})

/** Startup with no projects opens the dialog; the user's choice there is what creates one. */
const startWithProject = async () => {
  app = await startApp({ capture: async () => null })
  await useProjectStore.getState().newProject({ code: '', origin: 'blank' })
  useNewProjectDialog.getState().setOpen(false)
}

it('opens the new project dialog instead of creating a project on the first run', async () => {
  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project).toBeNull()
  expect(await db.projects.count()).toBe(0)
  expect(useNewProjectDialog.getState().open).toBe(true)
  expect(useSettingsStore.getState().loaded).toBe(true)
})

it('opens the last project without the dialog once one exists', async () => {
  await startWithProject()
  app!.stop()
  resetStores()
  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project).not.toBeNull()
  expect(useNewProjectDialog.getState().open).toBe(false)
})

it('reopens the last project after a reload, with its head and chat', async () => {
  await startWithProject()
  const first = useProjectStore.getState().project!
  await useProjectStore.getState().commit({ code: 'cube(2);', params: {}, source: 'manual', message: 'edit', model: null, compileStatus: 'ok', renderMs: 1 })
  await db.messages.put({
    id: 'm1', projectId: first.id, versionId: null, role: 'user', content: 'Make a cube', imageBlobIds: [], audioTranscript: null,
    model: null, usageId: null, createdAt: 1,
  })
  app!.stop()
  resetStores()

  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project?.id).toBe(first.id)
  expect(useProjectStore.getState().head?.label).toBe('v2')
  expect(useAppStore.getState().code).toBe('cube(2);')
  await vi.waitFor(() => expect(useChatStore.getState().messages.map((m) => m.text)).toEqual(['Make a cube']))
})

it('falls back to the most recent project when the last one is gone', async () => {
  await startWithProject()
  const first = useProjectStore.getState().project!
  await useSettingsStore.getState().update({ lastProjectId: 'deleted' })
  app!.stop()
  resetStores()
  app = await startApp({ capture: async () => null })
  expect(useProjectStore.getState().project?.id).toBe(first.id)
})

it('records versions once started: an edit plus a successful render becomes v2', async () => {
  await startWithProject()
  useAppStore.getState().setCode('cube(3);')
  await Promise.resolve()
  const s = useAppStore.getState()
  const { okResult } = await import('../test/results')
  s.renderFinished(okResult(), s.code, s.params)
  await vi.waitFor(() => expect(useProjectStore.getState().head?.label).toBe('v2'))
})
