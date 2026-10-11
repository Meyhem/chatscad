import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyRow } from './KeyRow'

it('offers the symbols from the spec plus Indent', () => {
  render(<KeyRow onInsert={() => {}} />)
  const toolbar = screen.getByRole('toolbar', { name: 'Code symbols' })
  expect([...toolbar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
    ';',
    '{',
    '}',
    '(',
    ')',
    '[',
    ']',
    'Indent',
  ])
})

it('inserts on tap without taking focus from the editor', async () => {
  const onInsert = vi.fn()
  render(<KeyRow onInsert={onInsert} />)
  const semicolon = screen.getByRole('button', { name: ';' })
  expect(fireEvent.pointerDown(semicolon)).toBe(false)
  expect(fireEvent.mouseDown(semicolon)).toBe(false)
  await userEvent.click(semicolon)
  await userEvent.click(screen.getByRole('button', { name: 'Indent' }))
  expect(onInsert.mock.calls).toEqual([[';'], ['  ']])
})
