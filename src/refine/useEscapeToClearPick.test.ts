import { fireEvent, renderHook } from '@testing-library/react'
import { partPickFixture } from '../test/picks'
import { useRefineStore } from './refineStore'
import { useEscapeToClearPick } from './useEscapeToClearPick'

beforeEach(() => useRefineStore.setState(useRefineStore.getInitialState(), true))

it('Esc clears the pick', () => {
  renderHook(() => useEscapeToClearPick())
  useRefineStore.setState({ pick: partPickFixture() })
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(useRefineStore.getState().pick).toBeNull()
})

it('Esc inside the code editor is left to the editor', () => {
  renderHook(() => useEscapeToClearPick())
  const editor = document.createElement('div')
  editor.className = 'cm-editor'
  const input = document.createElement('div')
  editor.append(input)
  document.body.append(editor)
  useRefineStore.setState({ pick: partPickFixture() })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(useRefineStore.getState().pick).not.toBeNull()
  editor.remove()
})

it('other keys do nothing', () => {
  renderHook(() => useEscapeToClearPick())
  useRefineStore.setState({ pick: partPickFixture() })
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(useRefineStore.getState().pick).not.toBeNull()
})
