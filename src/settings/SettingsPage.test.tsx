import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addUsage } from '../db/usage'
import { useAppStore } from '../state/store'
import { resetDb } from '../test/db'
import { PROVIDER_PRESETS } from './presets'
import { useProvidersStore } from './providersStore'
import { SettingsPage } from './SettingsPage'

const preset = (id: string) => PROVIDER_PRESETS.find((p) => p.id === id)!

beforeEach(async () => {
  await resetDb()
  useAppStore.setState({ ...useAppStore.getInitialState(), view: 'settings' }, true)
  useProvidersStore.setState({ ...useProvidersStore.getInitialState(), loaded: true }, true)
})

it('is the Settings tab panel, with no header or back button of its own', () => {
  render(<SettingsPage />)
  expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'view-panel-settings')
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Back to project' })).toBeNull()
})

it('shows AI providers as the current section and switches to the other sections', async () => {
  render(<SettingsPage />)
  const nav = screen.getByRole('navigation', { name: 'Settings sections' })
  expect(within(nav).getByRole('button', { name: 'AI providers' })).toHaveAttribute('aria-current', 'page')
  await userEvent.click(within(nav).getByRole('button', { name: 'Rendering' }))
  expect(within(nav).getByRole('button', { name: 'Rendering' })).toHaveAttribute('aria-current', 'page')
  expect(within(nav).getByRole('button', { name: 'AI providers' })).not.toHaveAttribute('aria-current')
  expect(screen.getByRole('heading', { name: 'Rendering' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Profiles' })).toBeNull()
  await userEvent.click(within(nav).getByRole('button', { name: 'AI providers' }))
  expect(screen.getByRole('region', { name: 'Profiles' })).toBeInTheDocument()
})

it('adds a profile from a preset and opens it', async () => {
  render(<SettingsPage />)
  expect(screen.getByText('No providers yet. Add one to start prompting.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  const menu = screen.getByRole('menu', { name: 'Provider presets' })
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
    'OpenAI',
    'OpenRouter',
    'DeepInfra',
    'Ollama',
    'LM Studio',
    'Anthropic',
    'Custom',
  ])
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Ollama' }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(await screen.findByLabelText('Base URL')).toHaveValue('http://localhost:11434/v1')
  const list = screen.getByRole('region', { name: 'Profiles' })
  expect(within(list).getByRole('button', { name: /Ollama on this computer/ })).toHaveAttribute('aria-current', 'true')
})

it('switches the form to the profile picked in the list', async () => {
  await useProvidersStore.getState().addProfile(preset('openai'))
  await useProvidersStore.getState().addProfile(preset('anthropic'))
  render(<SettingsPage />)
  expect(screen.getByLabelText('Name')).toHaveValue('OpenAI')
  await userEvent.click(within(screen.getByRole('region', { name: 'Profiles' })).getByRole('button', { name: /^Anthropic/ }))
  expect(screen.getByLabelText('Name')).toHaveValue('Anthropic')
})

it('shows each profile connection status as an icon and a word', async () => {
  const a = await useProvidersStore.getState().addProfile(preset('ollama'))
  const b = await useProvidersStore.getState().addProfile(preset('openai'))
  useProvidersStore.getState().setStatus(a.id, 'blocked')
  useProvidersStore.getState().setStatus(b.id, 'ok')
  render(<SettingsPage />)
  const list = screen.getByRole('region', { name: 'Profiles' })
  const blocked = within(list).getByRole('button', { name: /Ollama on this computer/ }).querySelector('.pc-status')!
  expect(blocked).toHaveClass('is-error')
  expect(blocked).toHaveTextContent('Blocked')
  expect(blocked.querySelector('svg')).not.toBeNull()
  expect(within(list).getByRole('button', { name: /^OpenAI/ }).querySelector('.pc-status')).toHaveTextContent('OK')
})

it('totals this month per profile in mono', async () => {
  const a = await useProvidersStore.getState().addProfile(preset('openrouter'))
  const b = await useProvidersStore.getState().addProfile(preset('ollama'))
  await addUsage({ profileId: a.id, model: 'm', inputTokens: 400_000, outputTokens: 12_118, cost: 1.844, costSource: 'provider' })
  await addUsage({ profileId: b.id, model: 'q', inputTokens: 50_000, outputTokens: 8_000, cost: 0, costSource: 'price-table' })
  render(<SettingsPage />)
  const usage = screen.getByTestId('month-usage')
  expect(within(usage).getByText('This month')).toBeInTheDocument()
  expect(await within(usage).findByText('$1.84 · 412,118 tok')).toHaveClass('pc-mono')
  expect(within(usage).getByText('$0.000 · 58,000 tok')).toBeInTheDocument()
})
