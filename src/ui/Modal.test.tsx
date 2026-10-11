import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Modal } from './Modal'

function Harness({ closeOnScrim = true, onClose = vi.fn() }: { closeOnScrim?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal
          labelledBy="t"
          closeOnScrim={closeOnScrim}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
          className="pc-dialog"
        >
          <h2 id="t">Export and share</h2>
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>
      )}
    </>
  )
}

it('is a labelled modal dialog that takes focus and gives it back', async () => {
  render(<Harness />)
  const opener = screen.getByRole('button', { name: 'Open' })
  await userEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Export and share' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(dialog.parentElement).toHaveClass('pc-scrim')
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(opener).toHaveFocus()
})

it('keeps Tab inside the dialog', async () => {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
  await userEvent.tab({ shift: true })
  expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
})

it('closes on a click on the scrim unless told not to', async () => {
  const onClose = vi.fn()
  const { unmount } = render(<Harness onClose={onClose} />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  await userEvent.click(screen.getByRole('dialog'))
  expect(onClose).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('dialog').parentElement!)
  expect(onClose).toHaveBeenCalledOnce()
  unmount()

  const keep = vi.fn()
  render(<Harness closeOnScrim={false} onClose={keep} />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  await userEvent.click(screen.getByRole('dialog').parentElement!)
  expect(keep).not.toHaveBeenCalled()
})
