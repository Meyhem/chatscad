import { act, renderHook } from '@testing-library/react'
import { useAppStore } from '../state/store'
import { partPickFixture } from '../test/picks'
import { okResult } from '../test/results'
import { useRefineStore } from './refineStore'
import { useRefineSync } from './useRefineSync'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useRefineStore.setState(useRefineStore.getInitialState(), true)
})

it('clears the pick when the code changes', () => {
  renderHook(() => useRefineSync())
  useRefineStore.setState({ pick: partPickFixture() })
  act(() => useAppStore.getState().setCode('cube(2);'))
  expect(useRefineStore.getState().pick).toBeNull()
})

it('clears the pick when a new mesh arrives (for example after a slider change)', () => {
  renderHook(() => useRefineSync())
  useRefineStore.setState({ pick: partPickFixture() })
  act(() => useAppStore.getState().renderFinished(okResult(), useAppStore.getState().code))
  expect(useRefineStore.getState().pick).toBeNull()
})

it('keeps the pick for unrelated changes', () => {
  renderHook(() => useRefineSync())
  useRefineStore.setState({ pick: partPickFixture() })
  act(() => useAppStore.getState().goToLine(3))
  expect(useRefineStore.getState().pick).not.toBeNull()
})
