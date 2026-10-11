import { render, screen } from '@testing-library/react'
import { App } from './App'

it('shows the app name', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'PromptCAD' })).toBeInTheDocument()
})
