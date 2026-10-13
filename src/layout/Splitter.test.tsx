import { fireEvent, render, screen } from '@testing-library/react'
import { Splitter } from './Splitter'

function setup(over: Partial<React.ComponentProps<typeof Splitter>> = {}) {
  const onChange = vi.fn()
  const onCommit = vi.fn()
  render(
    <Splitter
      orientation="vertical"
      label="Resize agent"
      value={360}
      min={280}
      max={560}
      defaultValue={360}
      onChange={onChange}
      onCommit={onCommit}
      {...over}
    />,
  )
  return { onChange, onCommit, el: screen.getByRole('separator', { name: over.label ?? 'Resize agent' }) }
}

beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
})

it('exposes its size to assistive technology', () => {
  const { el } = setup()
  expect(el).toHaveAttribute('aria-orientation', 'vertical')
  expect(el).toHaveAttribute('aria-valuenow', '360')
  expect(el).toHaveAttribute('aria-valuemin', '280')
  expect(el).toHaveAttribute('aria-valuemax', '560')
  expect(el).toHaveAttribute('tabindex', '0')
  expect(el).toHaveAttribute('title', 'Drag to resize. Double-click to reset.')
})

it('moves 16 px per arrow key, in the direction the divider moves', () => {
  const { el, onCommit } = setup()
  fireEvent.keyDown(el, { key: 'ArrowRight' })
  expect(onCommit).toHaveBeenLastCalledWith(376)
  fireEvent.keyDown(el, { key: 'ArrowLeft' })
  expect(onCommit).toHaveBeenLastCalledWith(344)
})

it('grows a pane on the far side when the divider moves towards it', () => {
  const { el, onCommit } = setup({ label: 'Resize code', invert: true, value: 440, min: 320, max: 720, defaultValue: 440 })
  fireEvent.keyDown(el, { key: 'ArrowLeft' })
  expect(onCommit).toHaveBeenLastCalledWith(456)
})

it('uses up and down on a horizontal divider', () => {
  const { el, onCommit } = setup({ orientation: 'horizontal', label: 'Resize console', invert: true, value: 176, min: 72, max: 400, defaultValue: 176 })
  fireEvent.keyDown(el, { key: 'ArrowUp' })
  expect(onCommit).toHaveBeenLastCalledWith(192)
})

it('jumps to the limits with Home and End, and never passes them', () => {
  const { el, onCommit } = setup({ value: 550 })
  fireEvent.keyDown(el, { key: 'ArrowRight' })
  expect(onCommit).toHaveBeenLastCalledWith(560)
  fireEvent.keyDown(el, { key: 'Home' })
  expect(onCommit).toHaveBeenLastCalledWith(280)
  fireEvent.keyDown(el, { key: 'End' })
  expect(onCommit).toHaveBeenLastCalledWith(560)
})

it('resets on double-click', () => {
  const { el, onCommit } = setup({ value: 500 })
  fireEvent.doubleClick(el)
  expect(onCommit).toHaveBeenLastCalledWith(360)
})

it('follows the pointer while dragging and commits on release', () => {
  const { el, onChange, onCommit } = setup()
  fireEvent.pointerDown(el, { clientX: 100, pointerId: 1 })
  fireEvent.pointerMove(el, { clientX: 140, pointerId: 1 })
  expect(onChange).toHaveBeenLastCalledWith(400)
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.pointerMove(el, { clientX: 900, pointerId: 1 })
  expect(onChange).toHaveBeenLastCalledWith(560)
  fireEvent.pointerUp(el, { clientX: 140, pointerId: 1 })
  expect(onCommit).toHaveBeenLastCalledWith(400)
})

it('hands the reset to onReset when given, for panes whose default is not a fixed size', () => {
  const onReset = vi.fn()
  const { el, onCommit } = setup({ onReset })
  fireEvent.doubleClick(el)
  expect(onReset).toHaveBeenCalledOnce()
  expect(onCommit).not.toHaveBeenCalled()
})
