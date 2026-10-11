import { act, fireEvent, render, screen } from '@testing-library/react'
import { useAppStore } from '../state/store'
import { ViewTabs } from './ViewTabs'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('shows Project, History and Settings with the current view selected', () => {
  render(<ViewTabs />)
  expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Project', 'History', 'Settings'])
  expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'true')
  act(() => useAppStore.getState().setView('settings'))
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'false')
})

it('switches the view on click', () => {
  render(<ViewTabs />)
  fireEvent.click(screen.getByRole('tab', { name: 'History' }))
  expect(useAppStore.getState().view).toBe('history')
  fireEvent.click(screen.getByRole('tab', { name: 'Project' }))
  expect(useAppStore.getState().view).toBe('workbench')
})

it('moves with the arrow keys and keeps only the selected tab in the tab order', () => {
  render(<ViewTabs />)
  const project = screen.getByRole('tab', { name: 'Project' })
  expect(project).toHaveAttribute('tabindex', '0')
  expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('tabindex', '-1')
  fireEvent.keyDown(project, { key: 'ArrowLeft' })
  expect(useAppStore.getState().view).toBe('settings')
  expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Settings' }), { key: 'ArrowRight' })
  expect(useAppStore.getState().view).toBe('workbench')
})

it('points each tab at its panel', () => {
  render(<ViewTabs />)
  expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-controls', 'view-panel-history')
})
