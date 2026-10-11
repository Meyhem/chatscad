import { render, screen } from '@testing-library/react'
import { DimsReadout } from './DimsReadout'

const box = { min: [0, 0, 0] as [number, number, number], max: [88.8, 25.4, 22] as [number, number, number] }

it('renders the inline form', () => {
  render(<DimsReadout bounds={box} />)
  const dims = screen.getByTestId('dims')
  expect(dims).toHaveTextContent('88.8 × 25.4 × 22 mm')
  expect(dims).toHaveClass('pc-dims')
})

it('renders the axis form with coloured axis letters and a readable label', () => {
  render(<DimsReadout bounds={box} axes />)
  const dims = screen.getByTestId('dims-axes')
  expect(dims).toHaveAttribute('aria-label', '88.8 × 25.4 × 22 mm')
  expect(dims.querySelector('.x')).toHaveTextContent('X')
  expect(dims.querySelector('.y')).toHaveTextContent('Y')
  expect(dims.querySelector('.z')).toHaveTextContent('Z')
  expect(dims).toHaveTextContent('X 88.8')
  expect(dims).toHaveTextContent('Z 22')
  expect(dims).toHaveTextContent('mm')
})
