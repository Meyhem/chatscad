import { DEFAULT_SETTINGS, PromptCadDb, db } from './db'

it('names the shared database "promptcad"', () => {
  expect(db.name).toBe('promptcad')
})

it('declares version 1 with the M2 tables and indexes', async () => {
  const test = new PromptCadDb(`test-${crypto.randomUUID()}`)
  await test.open()
  expect(test.verno).toBe(1)
  expect(test.tables.map((t) => t.name).sort()).toEqual(['providerProfiles', 'settings', 'usage'])
  expect(test.providerProfiles.schema.primKey.name).toBe('id')
  expect(test.providerProfiles.schema.indexes.map((i) => i.name)).toEqual(['name'])
  expect(test.usage.schema.indexes.map((i) => i.name)).toEqual(['profileId', 'createdAt', 'projectId'])
  expect(test.settings.schema.primKey.name).toBe('id')
  await test.delete()
})

it('defaults to two auto-fix attempts and no active profile', () => {
  expect(DEFAULT_SETTINGS).toEqual({ id: 'app', activeProfileId: null, activeModel: null, autoFixAttempts: 2 })
})
