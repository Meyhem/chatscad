import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SketchDialog } from './SketchDialog'

// jsdom may lack PointerEvent; a MouseEvent subclass carries clientX/clientY and pointerId.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
    }
  }
  Object.assign(window, { PointerEvent: PointerEventShim })
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800, toJSON: () => ({}),
  } as DOMRect)
})
afterEach(() => vi.restoreAllMocks())

function drag(canvas: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(canvas, { clientX: from[0], clientY: from[1], pointerId: 1 })
  fireEvent.pointerMove(canvas, { clientX: to[0], clientY: to[1], pointerId: 1 })
  fireEvent.pointerUp(canvas, { clientX: to[0], clientY: to[1], pointerId: 1 })
}

it('is a dialog with the screen\'s tools, with Pen selected and nothing to attach yet', () => {
  render(<SketchDialog onCancel={() => {}} onAttach={() => {}} />)
  expect(screen.getByRole('dialog', { name: 'Sketch' })).toBeInTheDocument()
  const tools = screen.getByRole('toolbar', { name: 'Sketch tools' })
  expect(within(tools).getAllByRole('button').map((b) => b.textContent)).toEqual(['Pen', 'Line', 'Size', 'Erase'])
  expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Attach to prompt' })).toBeDisabled()
})

it('Size asks for the length in mm and attaches the dimension with the note', async () => {
  const onAttach = vi.fn()
  render(<SketchDialog onCancel={() => {}} onAttach={onAttach} />)
  await userEvent.click(screen.getByRole('button', { name: 'Size' }))
  drag(screen.getByLabelText('Sketch canvas'), [100, 400], [300, 400])
  await userEvent.type(screen.getByLabelText('Length in mm'), '40')
  await userEvent.click(screen.getByRole('button', { name: 'Add size' }))
  await userEvent.type(screen.getByLabelText('Note'), 'Two M4 holes')
  await userEvent.click(screen.getByRole('button', { name: 'Attach to prompt' }))
  expect(onAttach).toHaveBeenCalledWith({
    items: [{ kind: 'dim', a: { x: 100, y: 400 }, b: { x: 300, y: 400 }, mm: 40 }],
    note: 'Two M4 holes',
  })
})

it('undo and clear remove what was drawn', async () => {
  render(<SketchDialog onCancel={() => {}} onAttach={() => {}} />)
  const canvas = screen.getByLabelText('Sketch canvas')
  const attach = screen.getByRole('button', { name: 'Attach to prompt' })
  await userEvent.click(screen.getByRole('button', { name: 'Line' }))
  drag(canvas, [0, 0], [100, 100])
  expect(attach).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(attach).toBeDisabled()
  drag(canvas, [0, 0], [100, 100])
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(attach).toBeDisabled()
})

it('Cancel and Esc close without attaching', async () => {
  const onCancel = vi.fn()
  const onAttach = vi.fn()
  render(<SketchDialog onCancel={onCancel} onAttach={onAttach} />)
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await userEvent.click(screen.getByLabelText('Note'))
  await userEvent.keyboard('{Escape}')
  expect(onCancel).toHaveBeenCalledTimes(2)
  expect(onAttach).not.toHaveBeenCalled()
})
