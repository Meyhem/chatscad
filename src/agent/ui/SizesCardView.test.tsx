import { act, fireEvent, render, screen } from '@testing-library/react'
import { effectiveValues } from '../../scad/customizer'
import { useAppStore } from '../../state/store'
import { useAgentStore, type SizesCard } from '../agentStore'
import { usePhotosDialog } from '../../photos/photosDialogStore'
import { SizesCardView } from './SizesCardView'

const card: SizesCard = {
  kind: 'sizes', id: 's1', noteId: 'n1', versionLabel: 'v1', status: 'ready',
  rows: [
    { name: 'wall', value: 3, unit: 'mm', source: 'guess' },
    { name: 'rod_d', value: 25, unit: 'mm', source: 'description' },
    { name: 'plate_w', value: 22, unit: 'mm', source: 'photo' },
  ],
}

beforeEach(() => {
  useAgentStore.setState({ cards: { s1: card } })
  useAppStore.setState({ code: 'wall = 3; // [1:6] guessed\nrod_d = 25;\nplate_w = 22;', params: {} })
  usePhotosDialog.setState({ open: false })
})

it('lists the sizes with their sources and the guessed count', () => {
  render(<SizesCardView card={card} />)
  expect(screen.getByText('Sizes in v1 · 3')).toBeInTheDocument()
  expect(screen.getByText('1 guessed')).toBeInTheDocument()
  expect(screen.getByText('Guessed')).toBeInTheDocument()
  expect(screen.getByText('From description')).toBeInTheDocument()
  expect(screen.getByText('From photo')).toBeInTheDocument()
})

it('writes an edited size as a parameter override, accepts, and opens the Photos dialog', () => {
  render(<SizesCardView card={card} />)
  const input = screen.getByRole('spinbutton', { name: 'wall in mm' })
  fireEvent.change(input, { target: { value: '3.4' } })
  fireEvent.blur(input)
  expect(useAppStore.getState().params).toEqual({ wall: 3.4 })
  fireEvent.click(screen.getByRole('button', { name: 'Add a photo' }))
  expect(usePhotosDialog.getState().open).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Sizes look right' }))
  expect(useAgentStore.getState().cards.s1!.status).toBe('accepted')
})

it('editing a size back to its original value writes it again', () => {
  render(<SizesCardView card={card} />)
  const input = screen.getByRole('spinbutton', { name: 'wall in mm' })
  fireEvent.change(input, { target: { value: '3.4' } })
  fireEvent.blur(input)
  expect(useAppStore.getState().params).toEqual({ wall: 3.4 })
  fireEvent.change(input, { target: { value: '3' } })
  fireEvent.blur(input)
  expect(effectiveValues(useAppStore.getState().code, useAppStore.getState().params).wall).toBe(3)
})

it('shows a size changed outside the card', () => {
  render(<SizesCardView card={card} />)
  act(() => useAppStore.getState().setParams({ wall: 4.2 }))
  expect(screen.getByRole('spinbutton', { name: 'wall in mm' })).toHaveValue(4.2)
  act(() => useAppStore.getState().setParams({}))
  expect(screen.getByRole('spinbutton', { name: 'wall in mm' })).toHaveValue(3)
})

it('shows the edited value once the sizes are accepted', () => {
  useAppStore.getState().setParams({ wall: 3.4 })
  render(<SizesCardView card={card} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sizes look right' }))
  const accepted = useAgentStore.getState().cards.s1 as SizesCard
  expect(accepted.rows[0]).toMatchObject({ name: 'wall', value: 3.4 })
  render(<SizesCardView card={accepted} />)
  expect(screen.getByText('3.4 mm')).toBeInTheDocument()
})

it('asks for the guessed sizes to be checked first, with no claim about their accuracy', () => {
  render(<SizesCardView card={card} />)
  expect(screen.getByText('Check the guessed sizes first. The model estimated them from the photos.')).toBeInTheDocument()
  expect(screen.queryByText(/within about/)).toBeNull()
})

it('says every size was given when none is guessed', () => {
  const given: SizesCard = { ...card, rows: card.rows.filter((r) => r.source !== 'guess') }
  render(<SizesCardView card={given} />)
  expect(screen.getByText('Every size came from the description or the photos.')).toBeInTheDocument()
})
