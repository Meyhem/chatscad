import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getProfile } from '../db/profiles'
import { resetDb } from '../test/db'
import { PROVIDER_PRESETS } from './presets'
import { ProfileForm } from './ProfileForm'
import { useProvidersStore } from './providersStore'

const preset = (id: string) => PROVIDER_PRESETS.find((p) => p.id === id)!

beforeEach(async () => {
  await resetDb()
  useProvidersStore.setState(useProvidersStore.getInitialState(), true)
})
afterEach(() => vi.unstubAllGlobals())

/** Renders the form for the store's current copy of the profile, as SettingsPage does. */
function Connected({ id }: { id: string }) {
  const profile = useProvidersStore((s) => s.profiles.find((p) => p.id === id))
  return profile ? <ProfileForm profile={profile} /> : null
}

async function setup(presetId: string) {
  const p = await useProvidersStore.getState().addProfile(preset(presetId))
  render(<Connected id={p.id} />)
  return p
}

it('shows the profile fields with a masked key and the safety hints', async () => {
  await setup('openai')
  expect(screen.getByLabelText('Name')).toHaveValue('OpenAI')
  expect(screen.getByLabelText('Adapter')).toHaveValue('openai-compatible')
  expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1')
  expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password')
  expect(screen.getByText(/Keys stay in this browser and are never included in exports or share links/)).toBeInTheDocument()
  expect(screen.getByText(/Use a key with a spending limit/)).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Streaming' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Vision (images and sketches)' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Test connection' })).toHaveClass('is-primary')
})

it('saves every change at once', async () => {
  const p = await setup('custom')
  await userEvent.clear(screen.getByLabelText('Name'))
  await userEvent.type(screen.getByLabelText('Name'), 'Fake LLM')
  await userEvent.type(screen.getByLabelText('Base URL'), 'https://llm.test/v1')
  await userEvent.type(screen.getByLabelText('API key'), 'sk-secret')
  await userEvent.type(screen.getByLabelText('Default model'), 'fake-model')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Vision (images and sketches)' }))
  await vi.waitFor(async () =>
    expect(await getProfile(p.id)).toMatchObject({
      name: 'Fake LLM',
      baseUrl: 'https://llm.test/v1',
      apiKey: 'sk-secret',
      defaultModel: 'fake-model',
      capabilities: { streaming: true, vision: true, audio: false },
    }),
  )
})

it('explains an Ollama CORS block and marks the profile Blocked', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }),
  )
  const p = await setup('ollama')
  expect(screen.getByLabelText('API key')).toHaveAttribute('placeholder', 'Not needed for a server on this computer')
  await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveClass('pc-callout', 'is-error')
  expect(alert).toHaveTextContent('Ollama blocked the request from this page (CORS)')
  expect(alert).toHaveTextContent(`OLLAMA_ORIGINS=${location.origin} ollama serve`)
  expect(useProvidersStore.getState().status[p.id]).toBe('blocked')
})

it('loads the model list on success, offers it for the default model, and marks the profile OK', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/models')
        ? Response.json({ data: [{ id: 'llama3' }, { id: 'qwen3-coder' }] })
        : new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
    ),
  )
  const p = await setup('ollama')
  await userEvent.type(screen.getByLabelText('Default model'), 'qwen3-coder')
  await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  expect(await screen.findByText('Connection works')).toBeInTheDocument()
  expect(screen.getByText('qwen3-coder on localhost:11434 replied · 2 models listed.')).toBeInTheDocument()
  expect(useProvidersStore.getState().status[p.id]).toBe('ok')
  await vi.waitFor(async () => expect((await getProfile(p.id))?.cachedModels).toEqual([{ id: 'llama3' }, { id: 'qwen3-coder' }]))
  const list = document.getElementById(screen.getByLabelText('Default model').getAttribute('list')!)!
  expect([...list.querySelectorAll('option')].map((o) => o.value)).toEqual(['llama3', 'qwen3-coder'])
  expect(screen.getByText(/2 models from the provider/)).toBeInTheDocument()
})

it('asks for confirmation before deleting', async () => {
  const p = await setup('anthropic')
  await userEvent.click(screen.getByRole('button', { name: 'Delete profile' }))
  await userEvent.click(screen.getByRole('button', { name: 'Keep' }))
  expect(useProvidersStore.getState().profiles).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Delete profile' }))
  await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }))
  await vi.waitFor(async () => expect(await getProfile(p.id)).toBeUndefined())
})

it('edits the price table in USD per million tokens', async () => {
  const p = await setup('openai')
  await userEvent.type(screen.getByLabelText('Default model'), 'gpt-test')
  await userEvent.click(screen.getByRole('button', { name: 'Edit price table' }))
  await userEvent.type(screen.getByLabelText('gpt-test input price'), '1.25')
  await userEvent.type(screen.getByLabelText('gpt-test output price'), '10')
  await userEvent.tab()
  await vi.waitFor(async () => expect((await getProfile(p.id))?.priceTable).toEqual({ 'gpt-test': { inputPerMTok: 1.25, outputPerMTok: 10 } }))

  await userEvent.type(screen.getByLabelText('Model to price'), 'gpt-mini')
  await userEvent.click(screen.getByRole('button', { name: 'Add model' }))
  expect(screen.getByLabelText('gpt-mini input price')).toBeInTheDocument()
})

it('marks a price that is not a number', async () => {
  await setup('openai')
  await userEvent.type(screen.getByLabelText('Default model'), 'm')
  await userEvent.click(screen.getByRole('button', { name: 'Edit price table' }))
  await userEvent.type(screen.getByLabelText('m input price'), 'abc')
  expect(screen.getByLabelText('m input price').closest('.pc-input')).toHaveClass('is-invalid')
})
