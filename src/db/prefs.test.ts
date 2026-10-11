import 'fake-indexeddb/auto'
import { DEFAULT_SETTINGS, ChatScadDb, type Settings } from './db'
import { DEFAULT_LAYOUT } from '../layout/panelLayout'
import { prefsFrom, readPrefs, writePrefs } from './prefs'

let database: ChatScadDb
beforeEach(() => {
  database = new ChatScadDb(`prefs-${crypto.randomUUID()}`)
})
afterEach(() => database.delete())

const DEFAULTS = { variantCount: 1, lowQualityPreview: false, transcriptionModel: 'whisper-1', panelLayout: DEFAULT_LAYOUT }

it('defaults to one reply per prompt, full renders only, and whisper-1', async () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ ...DEFAULTS, panelLayout: null })
  expect(await readPrefs(database)).toEqual(DEFAULTS)
})

it('fills the M4 fields an older settings row lacks and keeps every other field', async () => {
  const older: Record<string, unknown> = { ...DEFAULT_SETTINGS, activeModel: 'gpt-x' }
  delete older.variantCount
  delete older.lowQualityPreview
  delete older.transcriptionModel
  await database.settings.put(older as unknown as Settings)

  expect(await readPrefs(database)).toEqual(DEFAULTS)
  expect(await writePrefs({ variantCount: 3 }, database)).toEqual({ ...DEFAULTS, variantCount: 3 })
  expect(await database.settings.get('app')).toMatchObject({ activeModel: 'gpt-x', variantCount: 3, lowQualityPreview: false })
})

it('creates the settings row when there is none', async () => {
  await writePrefs({ lowQualityPreview: true }, database)
  expect(await database.settings.get('app')).toEqual({ ...DEFAULT_SETTINGS, lowQualityPreview: true })
})

it('ignores values outside the allowed set', () => {
  expect(prefsFrom({ variantCount: 2 as unknown as 1, lowQualityPreview: 'yes' as unknown as boolean, transcriptionModel: '  ' })).toEqual(
    DEFAULTS,
  )
  expect(prefsFrom({ transcriptionModel: ' gpt-4o-transcribe ' }).transcriptionModel).toBe('gpt-4o-transcribe')
})

it('stores the desktop panel layout and reads back a broken one as the defaults', async () => {
  const layout = { chatWidth: 420, codeWidth: 500, dockHeight: 240, consoleHeight: 200 }
  await writePrefs({ panelLayout: layout }, database)
  expect((await readPrefs(database)).panelLayout).toEqual(layout)
  expect(prefsFrom({ panelLayout: { chatWidth: 'x' } } as unknown as Partial<Settings>).panelLayout).toEqual(DEFAULT_LAYOUT)
})
