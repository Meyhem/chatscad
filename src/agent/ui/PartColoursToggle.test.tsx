import { fireEvent, render, screen } from '@testing-library/react'
import { useAgentStore } from '../agentStore'
import { PartColoursToggle } from './PartColoursToggle'

beforeEach(() => useAgentStore.setState({ partColours: false }))

it('toggles part colours once the parts are found', () => {
  render(<PartColoursToggle available />)
  const button = screen.getByRole('button', { name: 'Part colours' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(button)
  expect(useAgentStore.getState().partColours).toBe(true)
  expect(button).toHaveAttribute('aria-pressed', 'true')
})

it('is disabled with the reason until the parts are found', () => {
  render(<PartColoursToggle available={false} />)
  const button = screen.getByRole('button', { name: 'Part colours' })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('title', 'Part colours show once the parts of a rendered model are found')
})
