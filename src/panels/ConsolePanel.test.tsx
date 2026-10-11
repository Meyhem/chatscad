import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LogLine } from '../render/types'
import { ConsolePanel } from './ConsolePanel'

const out = (text: string): LogLine => ({ stream: 'stdout', text })
const err = (text: string): LogLine => ({ stream: 'stderr', text })
const lines = () => Array.from(screen.getByTestId('console').children) as HTMLElement[]

it('tones each line like the design system console', () => {
  render(
    <ConsolePanel
      status="error"
      renderMs={38}
      error="OpenSCAD exited with code 1"
      logs={[
        err('Parsing design (AST generation)...'),
        out('ECHO: "wall = 2"'),
        err("WARNING: Ignoring unknown variable 'lid_h' in file main.scad, line 12"),
        err('ERROR: Parser error in file "/main.scad", line 7: syntax error'),
        err('Execution aborted'),
      ]}
    />,
  )
  expect(lines().map((l) => [l.textContent, l.className.trim()])).toEqual([
    ['Parsing design (AST generation)...', 'pc-log is-muted'],
    ['ECHO: "wall = 2"', 'pc-log'],
    ["WARNING: Ignoring unknown variable 'lid_h' in file main.scad, line 12", expect.stringContaining('pc-log is-warn')],
    ['ERROR: Parser error in file "/main.scad", line 7: syntax error', expect.stringContaining('pc-log is-error')],
    ['Execution aborted', 'pc-log is-error'],
    ['OpenSCAD exited with code 1 · 38 ms', 'pc-log is-muted'],
  ])
})

it('marks OpenSCAD timing as ok and adds a render summary on success', () => {
  render(<ConsolePanel status="ok" renderMs={412} error={null} logs={[err('Total rendering time: 0:00:00.412')]} />)
  expect(lines().map((l) => [l.textContent, l.className.trim()])).toEqual([
    ['Total rendering time: 0:00:00.412', 'pc-log is-ok'],
    ['Rendered in 412 ms', 'pc-log is-ok'],
  ])
})

it('uses the error tone for the summary when OpenSCAD printed no ERROR line (timeout, crash, empty model)', () => {
  render(<ConsolePanel status="error" renderMs={60_000} error="Render timed out after 60 s" logs={[]} />)
  expect(lines().map((l) => [l.textContent, l.className.trim()])).toEqual([
    ['Render timed out after 60 s · 60000 ms', 'pc-log is-error'],
  ])
})

it('shows a loading line before the first render and a compiling line during one', () => {
  const { rerender } = render(<ConsolePanel status="idle" renderMs={null} error={null} logs={[]} />)
  expect(screen.getByTestId('console')).toHaveTextContent('Loading OpenSCAD…')
  rerender(<ConsolePanel status="rendering" renderMs={null} error={null} logs={[]} />)
  expect(screen.getByTestId('console')).toHaveTextContent('Compiling main.scad…')
})

it('makes located ERROR and WARNING lines jump to the editor line', async () => {
  const onGoToLine = vi.fn()
  render(
    <ConsolePanel
      status="error"
      renderMs={1}
      error="OpenSCAD exited with code 1"
      logs={[out('ECHO: 1'), err("WARNING: Ignoring unknown variable 'x' in file main.scad, line 2"), err('ERROR: Parser error in file "/main.scad", line 7: syntax error')]}
      onGoToLine={onGoToLine}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: /line 7/ }))
  expect(onGoToLine).toHaveBeenLastCalledWith(7)
  await userEvent.click(screen.getByRole('button', { name: /line 2/ }))
  expect(onGoToLine).toHaveBeenLastCalledWith(2)
  expect(screen.getByText('ECHO: 1').tagName).toBe('DIV')
})

it('renders model output as plain text, never as HTML', () => {
  const evil = 'ECHO: "<img src=x onerror=alert(1)>"'
  render(<ConsolePanel status="ok" renderMs={1} error={null} logs={[out(evil)]} />)
  expect(screen.getByText(evil)).toBeInTheDocument()
  expect(screen.getByTestId('console').querySelector('img')).toBeNull()
})
