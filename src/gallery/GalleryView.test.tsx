import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useProjectStore } from '../history/projectStore'
import { useAppStore } from '../state/store'
import { makeProject } from '../test/fixtures'
import { GalleryView } from './GalleryView'
import { EXAMPLES } from './index'

const newProject = vi.fn(async () => makeProject())

beforeEach(() => {
  newProject.mockClear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.getState().setView('gallery')
  useProjectStore.setState({ newProject })
})

const cards = () => screen.getAllByRole('article')

it('shows every example with its glyph, parameter count and tags', () => {
  render(<GalleryView />)
  expect(screen.getByRole('heading', { name: 'Start from a working model' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'All 8' })).toHaveAttribute('aria-selected', 'true')
  expect(cards()).toHaveLength(8)
  const box = within(screen.getByRole('article', { name: 'Box with lid' }))
  expect(box.getByText('6 params')).toBeInTheDocument()
  expect(box.getByText('snap-fit')).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'Box with lid' }).querySelector('.pc-variant-view svg polygon')).not.toBeNull()
})

it('filters by category and by search over names and tags', () => {
  render(<GalleryView />)
  fireEvent.click(screen.getByRole('tab', { name: 'Desk' }))
  expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['Cable clip', 'Phone stand'])
  fireEvent.click(screen.getByRole('tab', { name: 'All 8' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Search examples' }), { target: { value: 'no supports' } })
  expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['Print-in-place hinge'])
  fireEvent.change(screen.getByRole('textbox', { name: 'Search examples' }), { target: { value: 'zzz' } })
  expect(screen.getByText('No example matches “zzz”.')).toBeInTheDocument()
})

it('starts a new project from an example and opens the workbench', async () => {
  render(<GalleryView />)
  fireEvent.click(within(screen.getByRole('article', { name: 'Spur gear' })).getByRole('button', { name: 'Start from this' }))
  const gear = EXAMPLES.find((e) => e.id === 'spur-gear')!
  await waitFor(() =>
    expect(newProject).toHaveBeenCalledWith({ name: 'Spur gear', code: gear.code, origin: 'gallery', source: 'gallery', message: 'Started from Spur gear' }),
  )
  await waitFor(() => expect(useAppStore.getState().view).toBe('workbench'))
})

it('goes back to the project', () => {
  render(<GalleryView />)
  fireEvent.click(screen.getByRole('button', { name: 'Back to project' }))
  expect(useAppStore.getState().view).toBe('workbench')
})
