// @vitest-environment node
import 'fake-indexeddb/auto'
import { db, DEFAULT_SETTINGS } from '../db/db'
import { resetDb } from '../test/resetDb'
import { useSettingsStore } from './settingsStore'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

it('starts with the defaults, loads the stored row, and persists updates', async () => {
  expect(useSettingsStore.getState()).toMatchObject({ settings: DEFAULT_SETTINGS, loaded: false })
  await db.settings.put({ ...DEFAULT_SETTINGS, debounceMs: 900 })
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState()).toMatchObject({ loaded: true, settings: { debounceMs: 900 } })

  await useSettingsStore.getState().update({ theme: 'light', timeoutMs: 30_000 })
  expect(useSettingsStore.getState().settings).toMatchObject({ theme: 'light', timeoutMs: 30_000, debounceMs: 900 })
  expect(await db.settings.get('app')).toMatchObject({ theme: 'light', timeoutMs: 30_000 })
})
