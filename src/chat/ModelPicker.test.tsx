import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_SETTINGS, type ProviderProfile } from '../db/db'
import { newProfile } from '../db/profiles'
import { getSettings } from '../db/settings'
import { selectActiveModel, selectActiveProfile, useProvidersStore } from '../settings/providersStore'
import { resetDb } from '../test/db'
import { ModelPicker, modelIds } from './ModelPicker'

const openrouter = newProfile({
  name: 'OpenRouter',
  adapter: 'openai-compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openai/gpt-5-mini',
  cachedModels: [{ id: 'openai/gpt-5-mini' }, { id: 'qwen/qwen3-coder' }],
})
const anthropic = newProfile({ name: 'Anthropic', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-5-5' })

function seed(profiles: ProviderProfile[]) {
  useProvidersStore.setState({ ...useProvidersStore.getInitialState(), loaded: true, profiles, settings: DEFAULT_SETTINGS }, true)
}

beforeEach(resetDb)

it('is a disabled "No model" button without providers', () => {
  seed([])
  render(<ModelPicker />)
  expect(screen.getByRole('button', { name: 'No model' })).toBeDisabled()
})

it('lists the models of every profile, filters by search, and remembers the choice', async () => {
  seed([openrouter, anthropic])
  render(<ModelPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Model: openai/gpt-5-mini' }))
  expect(screen.getByRole('group', { name: 'OpenRouter' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'claude-sonnet-5-5' })).toBeInTheDocument()

  await userEvent.type(screen.getByLabelText('Search models'), 'qwen')
  expect(screen.queryByRole('button', { name: 'openai/gpt-5-mini' })).toBeNull()
  expect(screen.queryByRole('group', { name: 'Anthropic' })).toBeNull()

  await userEvent.click(screen.getByRole('button', { name: 'qwen/qwen3-coder' }))
  expect(screen.queryByLabelText('Search models')).toBeNull()
  expect(selectActiveModel(useProvidersStore.getState())).toBe('qwen/qwen3-coder')
  expect(screen.getByRole('button', { name: 'Model: qwen/qwen3-coder' })).toBeInTheDocument()
  await vi.waitFor(async () => expect((await getSettings()).activeModel).toBe('qwen/qwen3-coder'))
})

it('matches models fuzzily and puts the best match first', async () => {
  seed([openrouter, anthropic])
  render(<ModelPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Model: openai/gpt-5-mini' }))
  await userEvent.type(screen.getByLabelText('Search models'), 'qw3c')
  expect(screen.getByRole('button', { name: 'qwen/qwen3-coder' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'openai/gpt-5-mini' })).toBeNull()

  await userEvent.clear(screen.getByLabelText('Search models'))
  await userEvent.type(screen.getByLabelText('Search models'), 'son 55')
  expect(screen.getByRole('button', { name: 'claude-sonnet-5-5' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'OpenRouter' })).toBeNull()
})

it('switches profile when a model of another profile is picked', async () => {
  seed([openrouter, anthropic])
  render(<ModelPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Model: openai/gpt-5-mini' }))
  await userEvent.click(screen.getByRole('button', { name: 'claude-sonnet-5-5' }))
  expect(selectActiveProfile(useProvidersStore.getState())?.name).toBe('Anthropic')
})

it('accepts a model name typed by hand for the active profile', async () => {
  seed([openrouter])
  render(<ModelPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Model: openai/gpt-5-mini' }))
  await userEvent.type(screen.getByLabelText('Search models'), 'mistral/devstral')
  expect(screen.getByRole('button', { name: 'Use “mistral/devstral” with OpenRouter' })).toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  expect(selectActiveModel(useProvidersStore.getState())).toBe('mistral/devstral')
})

it('closes on Escape', async () => {
  seed([openrouter])
  render(<ModelPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Model: openai/gpt-5-mini' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByLabelText('Search models')).toBeNull()
})

it('puts the default model first when the provider did not list it', () => {
  expect(modelIds({ ...anthropic, cachedModels: [{ id: 'claude-a' }] })).toEqual(['claude-sonnet-5-5', 'claude-a'])
})

const deepseek = newProfile({
  name: 'DeepSeek router',
  adapter: 'openai-compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openai/gpt-5-mini',
  cachedModels: [
    { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini' },
    { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek: DeepSeek V4 Flash' },
    { id: 'acme/m1', name: 'Acme Falcon' },
  ],
})

it('finds a model by its display name', async () => {
  seed([deepseek])
  render(<ModelPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Model: openai/gpt-5-mini' }))
  await userEvent.type(screen.getByLabelText('Search models'), 'falcon')
  expect(screen.getByRole('button', { name: 'acme/m1' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'openai/gpt-5-mini' })).toBeNull()
})

it('picks the top match with Enter for a loose multi-word query', async () => {
  seed([deepseek])
  render(<ModelPicker />)
  await userEvent.click(screen.getByRole('button', { name: 'Model: openai/gpt-5-mini' }))
  await userEvent.type(screen.getByLabelText('Search models'), 'dee fla 4')
  await userEvent.keyboard('{Enter}')
  expect(selectActiveModel(useProvidersStore.getState())).toBe('deepseek/deepseek-v4-flash')
  expect(screen.queryByLabelText('Search models')).toBeNull()
})
