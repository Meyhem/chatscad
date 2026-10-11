import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Preset } from '../db/db'
import { useProjectStore } from '../history/projectStore'
import { useAppStore } from '../state/store'
import { makeProject } from '../test/fixtures'
import { usePromptRequest, ANNOTATE_PROMPT } from '../chat/promptRequest'
import { CustomizerDock } from './CustomizerDock'

const presets: Preset[] = [{ id: 's1', projectId: 'p1', name: 'tall', params: { height: 40 } }]
vi.mock('../db/presets', () => ({
  listPresets: vi.fn(async () => presets),
  putPreset: vi.fn(async (p: Preset) => void presets.push(p)),
  deletePreset: vi.fn(async (id: string) => void presets.splice(presets.findIndex((p) => p.id === id), 1)),
}))
const presetsApi = await import('../db/presets')

const CODE = [
  '/* [Dimensions] */',
  'width = 20; // [5:1:100]',
  'height = 10; // [2:1:50]',
  '/* [Lid] */',
  'lid = true;',
  'gap = 0.2;',
  '/* [Hidden] */',
  'secret = 1;',
].join('\n')

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.getState().setCode(CODE)
  useProjectStore.setState({ project: makeProject({ id: 'p1' }) })
  usePromptRequest.setState({ request: null })
  presets.splice(1)
})

it('shows one tab per group and the active group parameters, never hidden ones', async () => {
  render(<CustomizerDock />)
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Dimensions', 'Lid'])
  expect(screen.getByRole('tab', { name: 'Dimensions' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('param-width')).toBeInTheDocument()
  expect(screen.queryByTestId('param-lid')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Lid' }))
  expect(screen.getByTestId('param-lid')).toBeInTheDocument()
  expect(screen.queryByTestId('param-secret')).toBeNull()
  await waitFor(() => expect(presetsApi.listPresets).toHaveBeenCalledWith('p1'))
})

it('updates the store parameters from a slider, then resets them', () => {
  render(<CustomizerDock />)
  expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  fireEvent.change(screen.getByRole('slider', { name: 'width' }), { target: { value: '30' } })
  expect(useAppStore.getState().params).toEqual({ width: 30 })
  expect(screen.getByTestId('param-width')).toHaveClass('is-changed')
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(useAppStore.getState().params).toEqual({})
})

it('bakes the changed values into the code as a slider change and clears the parameters', () => {
  useAppStore.getState().setParams({ width: 30, height: 10 })
  render(<CustomizerDock />)
  fireEvent.click(screen.getByRole('button', { name: 'Bake into code' }))
  const s = useAppStore.getState()
  expect(s.code).toContain('width = 30; // [5:1:100]')
  expect(s.code).toContain('height = 10; // [2:1:50]')
  expect(s.codeSource).toBe('slider')
  expect(s.params).toEqual({})
})

it('applies, saves and deletes presets', async () => {
  render(<CustomizerDock />)
  const select = screen.getByRole('combobox', { name: 'Preset' })
  await waitFor(() => expect(screen.getByRole('option', { name: 'Preset: tall' })).toBeInTheDocument())
  expect(select).toHaveDisplayValue('Preset: default')

  fireEvent.change(select, { target: { value: 's1' } })
  expect(useAppStore.getState().params).toEqual({ height: 40 })
  expect(select).toHaveDisplayValue('Preset: tall')

  fireEvent.change(screen.getByRole('slider', { name: 'width' }), { target: { value: '30' } })
  expect(select).toHaveDisplayValue('Preset: custom')
  fireEvent.change(select, { target: { value: 'save' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Preset name' }), { target: { value: '  wide  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
  await waitFor(() => expect(presetsApi.putPreset).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', name: 'wide', params: { width: 30, height: 40 } })))
  await waitFor(() => expect(select).toHaveDisplayValue('Preset: wide'))

  fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }))
  await waitFor(() => expect(presetsApi.deletePreset).toHaveBeenCalled())
})

it('offers to annotate un-annotated numbers through the composer', () => {
  render(<CustomizerDock />)
  fireEvent.click(screen.getByRole('tab', { name: 'Lid' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI to annotate' }))
  expect(usePromptRequest.getState().request?.text).toBe(ANNOTATE_PROMPT)
})

it('offers to add parameters when the model has none', () => {
  useAppStore.getState().setCode('cube(10);')
  render(<CustomizerDock />)
  expect(screen.getByText('This model has no parameters yet.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI to add parameters' }))
  expect(usePromptRequest.getState().request?.text).toMatch(/^Make this model parametric/)
})
