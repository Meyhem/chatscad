import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportButtons, exportDisabledReason } from './ExportButtons'

it('disables STL export with the reason as a tooltip, and keeps Share available', () => {
  render(
    <ExportButtons
      canExportStl={false}
      disabledReason="Fix the error first, so the file matches the code"
      onExportStl={() => {}}
      onShare={() => {}}
    />,
  )
  const stl = screen.getByRole('button', { name: 'Export STL' })
  expect(stl).toBeDisabled()
  expect(stl).toHaveAttribute('title', 'Fix the error first, so the file matches the code')
  expect(stl).toHaveClass('pc-btn', 'is-primary')
  expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Share' })).not.toHaveClass('is-primary')
})

it('calls the handlers', async () => {
  const onExportStl = vi.fn()
  const onShare = vi.fn()
  render(<ExportButtons canExportStl disabledReason={null} onExportStl={onExportStl} onShare={onShare} />)
  const stl = screen.getByRole('button', { name: 'Export STL' })
  expect(stl).not.toHaveAttribute('title')
  await userEvent.click(stl)
  await userEvent.click(screen.getByRole('button', { name: 'Share' }))
  expect(onExportStl).toHaveBeenCalledOnce()
  expect(onShare).toHaveBeenCalledOnce()
})

describe('exportDisabledReason', () => {
  it('explains each blocked state in plain words', () => {
    expect(exportDisabledReason('idle')).toBe('Wait for the first render to finish')
    expect(exportDisabledReason('rendering')).toBe('Wait for the render to finish')
    expect(exportDisabledReason('error')).toBe('Fix the error first, so the file matches the code')
    expect(exportDisabledReason('ok')).toBeNull()
  })
})

it('explains that an empty model cannot be exported', () => {
  expect(exportDisabledReason('empty')).toBe('Write or generate a model first')
})

it('disables Share too when there is nothing to share', () => {
  render(<ExportButtons canExportStl={false} canShare={false} disabledReason="Write or generate a model first" onExportStl={() => {}} onShare={() => {}} />)
  const share = screen.getByRole('button', { name: 'Share' })
  expect(share).toBeDisabled()
  expect(share).toHaveAttribute('title', 'Write or generate a model first')
})
