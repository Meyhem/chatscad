import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useAppStore } from '../state/store'
import { BrandTitle } from './BrandTitle'

afterEach(() => useAppStore.setState({ view: 'workbench' }))

it('is plain text on the workbench', () => {
  render(<BrandTitle />)
  expect(screen.getByRole('heading', { name: 'ChatSCAD' })).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})

it.each(['settings', 'history', 'gallery'] as const)('goes back to the project from %s', (view) => {
  useAppStore.setState({ view })
  render(<BrandTitle />)
  fireEvent.click(screen.getByRole('button', { name: 'ChatSCAD, back to project' }))
  expect(useAppStore.getState().view).toBe('workbench')
})
