import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { focusComposer } from '../refine/focusComposer'
import { useAppStore } from '../state/store'
import { ParamSheet } from './ParamSheet'
import { PhoneLayout } from './PhoneLayout'
import { PHONE_QUERY, useIsPhone } from './useIsPhone'

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const list = {
    matches,
    media: PHONE_QUERY,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  window.matchMedia = vi.fn(() => list) as unknown as typeof window.matchMedia
  return {
    set(next: boolean) {
      list.matches = next
      listeners.forEach((l) => l())
    },
  }
}

afterEach(() => Reflect.deleteProperty(window, 'matchMedia'))
beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('follows the md breakpoint', () => {
  const media = mockMatchMedia(false)
  const { result } = renderHook(() => useIsPhone())
  expect(result.current).toBe(false)
  act(() => media.set(true))
  expect(result.current).toBe(true)
  expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767.98px)')
})

it('is not a phone where matchMedia is missing', () => {
  const { result } = renderHook(() => useIsPhone())
  expect(result.current).toBe(false)
})

function layout() {
  const viewer = vi.fn((paused: boolean) => <div data-testid="viewer-slot" data-paused={String(paused)} />)
  render(
    <PhoneLayout
      header={<header>PromptCAD</header>}
      chat={
        <div className="pc-composer">
          <textarea aria-label="Prompt" />
        </div>
      }
      code={<div data-testid="code-slot" />}
      keyRow={<div role="toolbar" aria-label="Code symbols" />}
      viewer={viewer}
      params={<div data-testid="params-slot" />}
    />,
  )
  return { viewer }
}

it('shows Chat first with the 3D view paused', () => {
  layout()
  const tabs = screen.getByRole('tablist', { name: 'Panels' })
  expect(tabs).toHaveClass('pc-tabbar')
  expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeVisible()
  expect(screen.getByTestId('viewer-slot')).not.toBeVisible()
  expect(screen.getByTestId('viewer-slot')).toHaveAttribute('data-paused', 'true')
})

it('switches tabs by tap and by arrow keys, resuming the viewer only on 3D', async () => {
  layout()
  await userEvent.click(screen.getByRole('tab', { name: '3D' }))
  expect(screen.getByTestId('viewer-slot')).toBeVisible()
  expect(screen.getByTestId('viewer-slot')).toHaveAttribute('data-paused', 'false')
  expect(screen.getByRole('textbox', { name: 'Prompt', hidden: true })).not.toBeVisible()

  await userEvent.keyboard('{ArrowLeft}')
  expect(screen.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'Code' })).toHaveFocus()
  expect(screen.getByTestId('code-slot')).toBeVisible()
  expect(screen.getByRole('toolbar', { name: 'Code symbols' })).toBeVisible()
  expect(screen.getByTestId('viewer-slot')).toHaveAttribute('data-paused', 'true')
})

it('jumps to Code when something asks to reveal a line', () => {
  layout()
  act(() => useAppStore.getState().goToLine(9))
  expect(screen.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
})

it('opens and closes the parameter sheet from its grabber', async () => {
  render(
    <ParamSheet>
      <div data-testid="params" />
    </ParamSheet>,
  )
  const grabber = screen.getByRole('button', { name: 'Parameters' })
  expect(grabber).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByTestId('params')).not.toBeVisible()
  await userEvent.click(grabber)
  expect(grabber).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByTestId('params')).toBeVisible()
})

it('Ask AI from the 3D tab switches to Chat and puts the cursor in the prompt', async () => {
  layout()
  await userEvent.click(screen.getByRole('tab', { name: '3D' }))
  act(() => {
    expect(focusComposer()).toBe(true)
  })
  expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveFocus()
})
