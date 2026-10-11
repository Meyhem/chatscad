import { fireEvent, render, screen } from '@testing-library/react'
import type { ModelReasoning } from '../ai/types'
import { DEFAULT_SETTINGS } from '../db/db'
import { newProfile } from '../db/profiles'
import { useProvidersStore } from '../settings/providersStore'
import { EffortPicker } from './EffortPicker'

function setup(reasoning: ModelReasoning | undefined, chosen?: 'low') {
  const profile = {
    ...newProfile({ name: 'OR', adapter: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'r1' }),
    cachedModels: [{ id: 'r1', ...(reasoning ? { reasoning } : {}) }],
    ...(chosen ? { reasoningEffort: { r1: chosen } } : {}),
  }
  const setReasoningEffort = vi.fn(async () => {})
  useProvidersStore.setState({
    loaded: true,
    profiles: [profile],
    settings: { ...DEFAULT_SETTINGS, activeProfileId: profile.id, activeModel: 'r1' },
    setReasoningEffort,
  })
  return { profile, setReasoningEffort }
}

it('is hidden when the model does not support effort', () => {
  setup(undefined)
  const { container } = render(<EffortPicker />)
  expect(container).toBeEmptyDOMElement()
})

it('shows Default, opens a menu with captions, and stores the choice', () => {
  const { profile, setReasoningEffort } = setup({ efforts: true, canDisable: true, adaptive: false })
  render(<EffortPicker />)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Default' }))
  expect(screen.getByRole('menuitemradio', { name: /Default/ })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('menuitemradio', { name: /Off/ })).toHaveTextContent('No reasoning, fastest')
  expect(screen.getByRole('menuitemradio', { name: /High/ })).toHaveTextContent('Slower, more tokens')
  fireEvent.click(screen.getByRole('menuitemradio', { name: /High/ }))
  expect(setReasoningEffort).toHaveBeenCalledWith(profile.id, 'r1', 'high')
  expect(screen.queryByRole('menu')).toBeNull()
})

it('hides Off when the model cannot turn reasoning off, and shows the current choice', () => {
  setup({ efforts: true, canDisable: false, adaptive: true }, 'low')
  render(<EffortPicker />)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Low' }))
  expect(screen.queryByRole('menuitemradio', { name: /Off/ })).toBeNull()
  expect(screen.getByRole('menuitemradio', { name: /Low/ })).toHaveAttribute('aria-checked', 'true')
})

it('choosing Default clears the stored choice; Escape closes', () => {
  const { profile, setReasoningEffort } = setup({ efforts: true, canDisable: true, adaptive: false }, 'low')
  render(<EffortPicker />)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Low' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Default/ }))
  expect(setReasoningEffort).toHaveBeenCalledWith(profile.id, 'r1', null)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Low' }))
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})

it('moves focus with the arrow keys', () => {
  setup({ efforts: true, canDisable: true, adaptive: false })
  render(<EffortPicker />)
  fireEvent.click(screen.getByRole('button', { name: 'Reasoning effort: Default' }))
  const items = screen.getAllByRole('menuitemradio')
  expect(items[0]).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
  expect(items[1]).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
  expect(items.at(-1)).toHaveFocus()
})
