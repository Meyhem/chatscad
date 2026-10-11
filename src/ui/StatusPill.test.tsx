import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Diagnostic } from '../render/types'
import { StatusPill } from './StatusPill'

const errAt7: Diagnostic = { line: 7, severity: 'error', message: 'Parser error: syntax error' }
const warn: Diagnostic = { line: 2, severity: 'warning', message: "Ignoring unknown variable 'x'" }

it('shows a busy pill with an icon while OpenSCAD loads', () => {
  render(<StatusPill status="idle" renderMs={null} error={null} diagnostics={[]} />)
  const pill = screen.getByTestId('render-status')
  expect(pill).toHaveTextContent('Loading OpenSCAD…')
  expect(pill).toHaveClass('pc-status', 'is-busy')
  expect(pill.querySelector('svg.pc-i')).not.toBeNull()
})

it('shows "Rendering…" while a render runs', () => {
  render(<StatusPill status="rendering" renderMs={null} error={null} diagnostics={[]} />)
  expect(screen.getByTestId('render-status')).toHaveTextContent('Rendering…')
  expect(screen.getByTestId('render-status')).toHaveClass('is-busy')
})

it('shows the render time in mono after success', () => {
  render(<StatusPill status="ok" renderMs={412.4} error={null} diagnostics={[]} />)
  const pill = screen.getByTestId('render-status')
  expect(pill).toHaveTextContent('Rendered 412 ms')
  expect(pill).toHaveClass('is-ok')
  expect(pill.querySelector('.pc-mono')).toHaveTextContent('412 ms')
})

it('turns to the warn tone and counts warnings', () => {
  render(<StatusPill status="ok" renderMs={50} error={null} diagnostics={[warn, { ...warn, line: 5 }]} />)
  const pill = screen.getByTestId('render-status')
  expect(pill).toHaveTextContent('Rendered 50 ms · 2 warnings')
  expect(pill).toHaveClass('is-warn')
})

it('names the first error line, explains in the tooltip, and jumps there on click', async () => {
  const onGoToLine = vi.fn()
  render(<StatusPill status="error" renderMs={38} error="OpenSCAD exited with code 1" diagnostics={[warn, errAt7]} onGoToLine={onGoToLine} />)
  const pill = screen.getByRole('button', { name: 'Failed · line 7' })
  expect(pill).toHaveClass('is-error')
  expect(pill).toHaveAttribute('title', 'OpenSCAD exited with code 1')
  await userEvent.click(pill)
  expect(onGoToLine).toHaveBeenCalledWith(7)
})

it('says "Timed out after 60 s" for a timeout', () => {
  render(<StatusPill status="error" renderMs={60_000} error="Render timed out after 60 s" diagnostics={[]} />)
  expect(screen.getByTestId('render-status')).toHaveTextContent('Timed out after 60 s')
  expect(screen.queryByRole('button')).toBeNull()
})

it('falls back to "Failed" with the reason as a tooltip', () => {
  render(<StatusPill status="error" renderMs={5} error="Render worker crashed: worker died" diagnostics={[]} />)
  const pill = screen.getByTestId('render-status')
  expect(pill).toHaveTextContent(/^Failed$/)
  expect(pill).toHaveAttribute('title', 'Render worker crashed: worker died')
})
