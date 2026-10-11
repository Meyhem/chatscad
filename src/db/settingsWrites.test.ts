// @vitest-environment node
import 'fake-indexeddb/auto'
import { resetDb } from '../test/resetDb'
import { db } from './db'
import { writePrefs } from './prefs'
import { updateSettings } from './settings'

beforeEach(resetDb)

it('keeps both changes when settings and preferences are written at the same time', async () => {
  const panelLayout = { chatWidth: 460, codeWidth: 440, dockHeight: null, consoleHeight: 176 }
  await Promise.all([updateSettings({ lastProjectId: 'p1' }), writePrefs({ panelLayout }), updateSettings({ debounceMs: 900 })])
  expect(await db.settings.get('app')).toMatchObject({ lastProjectId: 'p1', debounceMs: 900, panelLayout })
})
