import { errorResult, okResult } from '../test/results'
import { describeSlot, variantProgressLabel } from './describeSlot'
import { initialSlots, type VariantSlot } from './types'

const [a, b, c] = initialSlots('fake-model', [undefined, 0.7, 1.0])
const code = 'w = 20; // [5:1:100]\nh = 10; // [2:1:50]\ncube([w, w, h]);'
const withWarning = () => {
  const r = okResult()
  return { ...r, diagnostics: [{ line: 2, severity: 'warning' as const, message: "Ignoring unknown variable 'x'" }] }
}

it('names every state with a word, as status pills must', () => {
  expect(describeSlot(a, [a, b, c], 2)).toEqual({ tone: 'busy', label: 'Generating…', detail: 'waiting for the model' })

  const first: VariantSlot = { ...a, status: 'queued', renderSeq: 1 }
  const second: VariantSlot = { ...b, status: 'queued', renderSeq: 2 }
  expect(describeSlot(first, [first, second, c], 2)).toEqual({ tone: 'busy', label: 'Rendering…', detail: 'compiling in the background' })
  expect(describeSlot(second, [first, second, c], 2)).toEqual({ tone: 'neutral', label: 'Queued', detail: 'waiting for the renderer' })

  expect(describeSlot({ ...a, status: 'fixing', fixAttempt: 1 }, [a], 2)).toMatchObject({ tone: 'busy', label: 'Auto-fix 1 of 2' })
  expect(describeSlot({ ...a, status: 'ok', code, result: okResult(), resultCode: code }, [a], 2)).toEqual({
    tone: 'ok',
    label: 'Rendered',
    detail: '20 × 20 × 10 mm · 2 params',
  })
  expect(describeSlot({ ...a, status: 'ok', code, result: withWarning(), resultCode: code }, [a], 2)).toMatchObject({
    tone: 'warn',
    label: '1 warning',
  })
  expect(describeSlot({ ...a, status: 'error', code: 'x', result: errorResult(), resultCode: 'x' }, [a], 2)).toEqual({
    tone: 'error',
    label: 'Failed · line 1',
    detail: 'did not compile',
  })
  expect(describeSlot({ ...a, status: 'no-code' }, [a], 2)).toEqual({ tone: 'warn', label: 'No code', detail: 'the reply had no OpenSCAD code' })
  expect(
    describeSlot({ ...a, status: 'failed-request', error: { title: 'The provider rejected the API key', body: '…' } }, [a], 2),
  ).toEqual({ tone: 'error', label: 'Request failed', detail: 'The provider rejected the API key' })
  expect(describeSlot({ ...a, status: 'cancelled' }, [a], 2)).toEqual({ tone: 'neutral', label: 'Stopped', detail: 'cancelled' })
})

it('counts progress for the header pill', () => {
  const done: VariantSlot = { ...a, status: 'ok' }
  const queued: VariantSlot = { ...b, status: 'queued', renderSeq: 1 }
  expect(variantProgressLabel([a, b, c])).toBe('Generating 3 variants')
  expect(variantProgressLabel([done, done, queued])).toBe('Rendering 3 of 3')
  expect(variantProgressLabel([done, queued, { ...c, status: 'fixing' }])).toBe('Rendering 2 of 3')
  expect(variantProgressLabel([done, done, { ...c, status: 'error' }])).toBeNull()
})
