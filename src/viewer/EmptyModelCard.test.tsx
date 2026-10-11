import { fireEvent, render, screen } from '@testing-library/react'
import { useAppStore } from '../state/store'
import { EmptyModelCard } from './EmptyModelCard'

afterEach(() => useAppStore.setState({ view: 'workbench' }))

it('points at the next step and opens the examples', () => {
  render(<EmptyModelCard />)
  expect(screen.getByRole('heading', { name: 'Nothing to render yet' })).toBeInTheDocument()
  expect(screen.getByText('Describe a part in the chat, write OpenSCAD in the editor, or start from an example.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Browse examples' }))
  expect(useAppStore.getState().view).toBe('gallery')
})
