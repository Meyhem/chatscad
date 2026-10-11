import { resetDb } from '../test/db'
import { deleteProfile, getProfile, listProfiles, newProfile, saveProfile } from './profiles'
import { getSettings, updateSettings } from './settings'

beforeEach(resetDb)

it('builds a new profile with defaults, without saving it', async () => {
  const p = newProfile({ name: 'Ollama on this computer', adapter: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' })
  expect(p).toMatchObject({
    name: 'Ollama on this computer',
    apiKey: '',
    defaultModel: '',
    cachedModels: [],
    capabilities: { streaming: true, vision: false, audio: false },
    priceTable: {},
  })
  expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(await listProfiles()).toEqual([])
})

it('saves, reads back, and lists profiles oldest first', async () => {
  const a = await saveProfile(newProfile({ name: 'A', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', createdAt: 1 }))
  const b = await saveProfile(newProfile({ name: 'B', adapter: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', createdAt: 2 }))
  expect((await listProfiles()).map((p) => p.name)).toEqual(['A', 'B'])
  expect(await getProfile(b.id)).toEqual(b)
  expect(a.updatedAt).toBeGreaterThanOrEqual(a.createdAt)
})

it('deleting the active profile clears the active profile and model', async () => {
  const p = await saveProfile(newProfile({ name: 'A', adapter: 'anthropic', baseUrl: '' }))
  await updateSettings({ activeProfileId: p.id, activeModel: 'claude-x' })
  await deleteProfile(p.id)
  expect(await getProfile(p.id)).toBeUndefined()
  expect(await getSettings()).toMatchObject({ activeProfileId: null, activeModel: null, autoFixAttempts: 2 })
})

it('merges defaults into stored settings', async () => {
  expect(await getSettings()).toEqual({ id: 'app', activeProfileId: null, activeModel: null, autoFixAttempts: 2 })
  await updateSettings({ autoFixAttempts: 3 })
  expect((await getSettings()).autoFixAttempts).toBe(3)
})
