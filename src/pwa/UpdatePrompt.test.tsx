import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdatePrompt } from './UpdatePrompt'

it('stays hidden until a new version is waiting', () => {
  const { container } = render(<UpdatePrompt needRefresh={false} onReload={() => {}} onDismiss={() => {}} />)
  expect(container).toBeEmptyDOMElement()
})

it('asks before reloading into the new version', async () => {
  const onReload = vi.fn()
  const onDismiss = vi.fn()
  render(<UpdatePrompt needRefresh onReload={onReload} onDismiss={onDismiss} />)
  const prompt = screen.getByRole('status')
  expect(prompt).toHaveClass('pc-callout', 'is-info')
  expect(prompt).toHaveTextContent('New version available')
  expect(prompt).toHaveTextContent('Reload to use it. Your projects stay on this device.')
  expect(prompt.querySelectorAll('.pc-btn.is-primary')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
  await userEvent.click(screen.getByRole('button', { name: 'Later' }))
  expect(onReload).toHaveBeenCalledOnce()
  expect(onDismiss).toHaveBeenCalledOnce()
})
