import { fireEvent, render, screen } from '@testing-library/react'
import { NewProjectDialog } from './NewProjectDialog'

function setup() {
  const onCreate = vi.fn()
  const onClose = vi.fn()
  render(<NewProjectDialog onCreate={onCreate} onClose={onClose} />)
  return { onCreate, onClose }
}

it('asks for a name and the libraries, with BOSL2 recommended and on', () => {
  setup()
  expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument()
  expect(screen.getByLabelText('Name')).toHaveValue('Untitled project')
  expect(screen.getByRole('checkbox', { name: 'Use BOSL2 in this project' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Use MCAD in this project' })).not.toBeChecked()
  expect(screen.getByText('Recommended')).toBeInTheDocument()
  expect(screen.getByText(/The AI may use BOSL2\./)).toBeInTheDocument()
})

it('explains what each library contains on request', () => {
  setup()
  const [bosl] = screen.getAllByRole('button', { name: 'What is inside' })
  expect(bosl).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Threads')).toBeNull()
  fireEvent.click(bosl)
  expect(bosl).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('Threads')).toBeInTheDocument()
  expect(screen.getByText('include <BOSL2/std.scad>')).toBeInTheDocument()
})

it('updates the summary as libraries are switched', () => {
  setup()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use MCAD in this project' }))
  expect(screen.getByText(/The AI may use BOSL2 and MCAD\./)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use BOSL2 in this project' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use MCAD in this project' }))
  expect(screen.getByText(/No libraries/)).toBeInTheDocument()
})

it('creates the project with the trimmed name and the chosen libraries', () => {
  const { onCreate } = setup()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Hose filter ' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use MCAD in this project' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  expect(onCreate).toHaveBeenCalledWith({ name: 'Hose filter', enabledLibraries: ['BOSL2', 'MCAD'] })
})

it('needs a name, and cancels without creating', () => {
  const { onCreate, onClose } = setup()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' ' } })
  expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalled()
  expect(onCreate).not.toHaveBeenCalled()
})
