import { render, screen } from '@testing-library/react'
import { TriangleWarning } from './TriangleWarning'

it('stays hidden up to one million triangles', () => {
  const { container } = render(<TriangleWarning count={1_000_000} />)
  expect(container).toBeEmptyDOMElement()
})

it('warns with the count and what to do above one million', () => {
  render(<TriangleWarning count={1_234_567} />)
  const callout = screen.getByRole('status')
  expect(callout).toHaveClass('pc-callout', 'is-warn')
  expect(callout).toHaveTextContent('Heavy model: 1,234,567 triangles')
  expect(callout).toHaveTextContent('Phones may slow down or run out of memory. Lower $fn or simplify the model.')
  expect(callout.querySelector('svg.pc-i')).not.toBeNull()
})
