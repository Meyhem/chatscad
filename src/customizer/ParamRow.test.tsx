import { fireEvent, render, screen } from '@testing-library/react'
import type { CustomizerParam } from '../scad/customizer'
import { ParamRow } from './ParamRow'
import { unitFor } from './units'

const param = (over: Partial<CustomizerParam>): CustomizerParam => ({
  name: 'width',
  defaultValue: 40,
  control: { kind: 'slider', min: 10, step: 1, max: 200 },
  group: '',
  description: '',
  line: 1,
  annotated: true,
  ...over,
})

it('renders a slider row with the range hint, the value field and the mm unit', () => {
  const onChange = vi.fn()
  render(<ParamRow param={param({ description: 'Outer width' })} value={40} onChange={onChange} />)
  const row = screen.getByTestId('param-width')
  expect(row).toHaveClass('pc-param')
  expect(row).not.toHaveClass('is-changed')
  expect(row).toHaveAttribute('title', 'Outer width')
  expect(row).toHaveTextContent('width[10 : 1 : 200]')
  const range = screen.getByRole('slider', { name: 'width' })
  expect(range).toHaveAttribute('min', '10')
  expect(range).toHaveAttribute('max', '200')
  expect(range).toHaveAttribute('step', '1')
  expect(screen.getByLabelText('width value')).toHaveValue('40')
  expect(row.querySelector('.pc-unit')).toHaveTextContent('mm')

  fireEvent.change(range, { target: { value: '55' } })
  expect(onChange).toHaveBeenCalledWith(55)
})

it('marks a changed value with is-changed', () => {
  render(<ParamRow param={param({})} value={41} onChange={() => {}} />)
  expect(screen.getByTestId('param-width')).toHaveClass('is-changed')
})

it('applies valid typed numbers, flags invalid ones, and restores the value on blur', () => {
  const onChange = vi.fn()
  render(<ParamRow param={param({ control: { kind: 'number', step: 0.5 }, annotated: true })} value={40} onChange={onChange} />)
  expect(screen.getByTestId('param-width')).toHaveTextContent('step 0.5')
  const field = screen.getByLabelText('width')
  fireEvent.change(field, { target: { value: '12.5' } })
  expect(onChange).toHaveBeenLastCalledWith(12.5)
  fireEvent.change(field, { target: { value: '12,5x' } })
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(field.closest('.pc-input')).toHaveClass('is-invalid')
  expect(field).toHaveAttribute('aria-invalid', 'true')
  fireEvent.blur(field)
  expect(field).toHaveValue('40')
})

it('picks typed values from dropdowns', () => {
  const onChange = vi.fn()
  const options = [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }]
  render(<ParamRow param={param({ name: 'teeth', defaultValue: 1, control: { kind: 'dropdown', options } })} value={1} onChange={onChange} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'teeth' }), { target: { value: '1' } })
  expect(onChange).toHaveBeenCalledWith(2)
})

it('shows a value that is not among the options instead of picking the first one', () => {
  const options = [{ value: 'round', label: 'round' }]
  render(<ParamRow param={param({ name: 'shape', defaultValue: 'round', control: { kind: 'dropdown', options } })} value="hex" onChange={() => {}} />)
  expect(screen.getByRole('combobox', { name: 'shape' })).toHaveDisplayValue('hex')
})

it('renders toggle, text and vector controls', () => {
  const onChange = vi.fn()
  const { rerender } = render(<ParamRow param={param({ name: 'holes', defaultValue: true, control: { kind: 'toggle' } })} value={true} onChange={onChange} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'holes' }))
  expect(onChange).toHaveBeenLastCalledWith(false)

  rerender(<ParamRow param={param({ name: 'label', defaultValue: 'ABC', control: { kind: 'text' } })} value="ABC" onChange={onChange} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'label' }), { target: { value: '<b>XYZ</b>' } })
  expect(onChange).toHaveBeenLastCalledWith('<b>XYZ</b>')

  rerender(<ParamRow param={param({ name: 'size', defaultValue: [20, 30, 5], control: { kind: 'vector', length: 3 } })} value={[20, 30, 5]} onChange={onChange} />)
  expect(screen.getByLabelText('size x')).toHaveValue('20')
  fireEvent.change(screen.getByLabelText('size y'), { target: { value: '35' } })
  expect(onChange).toHaveBeenLastCalledWith([20, 35, 5])
})

it('picks units from the description, angles and counts', () => {
  expect(unitFor(param({ name: 'pressure_angle', description: 'Pressure angle (degrees)' }))).toBe('°')
  expect(unitFor(param({ name: 'angle' }))).toBe('°')
  expect(unitFor(param({ name: 'gear_module', description: 'Gear module: pitch diameter divided by teeth (mm)' }))).toBe('mm')
  for (const name of ['teeth', 'slots', 'holes_per_leg', 'cable_count', 'knuckles', 'grip_ridges', 'n']) expect(unitFor(param({ name }))).toBe('')
  expect(unitFor(param({ name: 'rows', description: 'Number of rows' }))).toBe('')
  expect(unitFor(param({ name: 'fill', description: 'Infill (%)' }))).toBe('%')
  expect(unitFor(param({ name: 'wall' }))).toBe('mm')
})
