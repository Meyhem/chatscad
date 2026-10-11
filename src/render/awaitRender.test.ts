import { useAppStore } from '../state/store'
import { errorResult, okResult } from '../test/results'
import { awaitRender } from './awaitRender'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('resolves at once when the code has already rendered', async () => {
  const result = okResult()
  useAppStore.getState().renderFinished(result, 'cube(1);')
  await expect(awaitRender('cube(1);')).resolves.toBe(result)
})

it('waits for the render of exactly this code, ignoring others', async () => {
  const pending = awaitRender('cube(2);')
  useAppStore.getState().renderFinished(okResult(), 'cube(1);')
  const failed = errorResult()
  useAppStore.getState().renderFinished(failed, 'cube(2);')
  await expect(pending).resolves.toBe(failed)
})

it('rejects with an AbortError when aborted while waiting, and stops listening', async () => {
  const controller = new AbortController()
  const pending = awaitRender('cube(3);', controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(() => useAppStore.getState().renderFinished(okResult(), 'cube(3);')).not.toThrow()
})

it('rejects immediately when the signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  useAppStore.getState().renderFinished(okResult(), 'cube(4);')
  await expect(awaitRender('cube(4);', controller.signal)).rejects.toBeInstanceOf(DOMException)
})
