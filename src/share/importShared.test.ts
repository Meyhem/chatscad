import { useProjectStore } from '../history/projectStore'
import { consumeShareHash, importSharedPayload, listenForShareLinks, noticeFor, openSharedOrLast } from './importShared'
import { encodeShare, type SharePayload } from './link'
import { useShareNotice } from './shareNotice'

const payload: SharePayload = { v: 1, name: 'Broom hook', code: 'cube([62, 38, 44]);', params: { wall: 2.4 } }
const loc = (hash: string) => ({ hash, pathname: '/chatscad/', search: '?x=1' })

beforeEach(() => useShareNotice.setState({ notice: null }))

it('does nothing without a share hash', async () => {
  const hist = { replaceState: vi.fn() }
  const importer = vi.fn(async () => {})
  expect(await consumeShareHash(loc(''), hist, importer)).toEqual({ status: 'none' })
  expect(hist.replaceState).not.toHaveBeenCalled()
  expect(importer).not.toHaveBeenCalled()
})

it('imports a valid link once and clears the hash, keeping the base path', async () => {
  const hist = { replaceState: vi.fn() }
  const importer = vi.fn(async () => {})
  expect(await consumeShareHash(loc(`#s=${encodeShare(payload)}`), hist, importer)).toEqual({ status: 'imported', name: 'Broom hook' })
  expect(importer).toHaveBeenCalledExactlyOnceWith(payload)
  expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/chatscad/?x=1')
})

it('creates no project for a bad link, and still clears the hash', async () => {
  const hist = { replaceState: vi.fn() }
  const importer = vi.fn(async () => {})
  const outcome = await consumeShareHash(loc('#s=garbage!!'), hist, importer)
  expect(outcome).toMatchObject({ status: 'error' })
  expect(importer).not.toHaveBeenCalled()
  expect(hist.replaceState).toHaveBeenCalled()
})

it('reports a project that could not be saved', async () => {
  const importer = vi.fn(async () => {
    throw new Error('QuotaExceededError')
  })
  expect(await consumeShareHash(loc(`#s=${encodeShare(payload)}`), { replaceState: vi.fn() }, importer)).toEqual({
    status: 'error',
    error: 'The model could not be saved on this device: QuotaExceededError',
  })
})

it('imports as a new shared-link project with the code and parameter values only', async () => {
  const newProject = vi.fn(async () => {})
  useProjectStore.setState({ newProject } as never)
  await importSharedPayload(payload)
  expect(newProject).toHaveBeenCalledExactlyOnceWith({
    name: 'Broom hook',
    origin: 'shared-link',
    code: 'cube([62, 38, 44]);',
    params: { wall: 2.4 },
    source: 'import',
    message: 'Opened from a link',
  })
})

it('words the notices', () => {
  expect(noticeFor({ status: 'none' })).toBeNull()
  expect(noticeFor({ status: 'imported', name: 'Broom hook' })).toEqual({
    tone: 'info',
    title: 'Opened “Broom hook” from a link',
    body: 'It is a new project with the code and parameter values from the link. Your other projects are unchanged.',
  })
  expect(noticeFor({ status: 'error', error: 'The link has no OpenSCAD code.' })).toEqual({
    tone: 'error',
    title: 'This link could not be opened',
    body: 'The link has no OpenSCAD code. Your projects are unchanged.',
  })
})

it('opens the shared model instead of the last project, and the last project otherwise', async () => {
  const restore = vi.fn(async () => {})
  await openSharedOrLast(restore, async () => ({ status: 'imported', name: 'Broom hook' }))
  expect(restore).not.toHaveBeenCalled()
  expect(useShareNotice.getState().notice?.title).toBe('Opened “Broom hook” from a link')

  await openSharedOrLast(restore, async () => ({ status: 'error', error: 'The link has no OpenSCAD code.' }))
  expect(restore).toHaveBeenCalledTimes(1)
  expect(useShareNotice.getState().notice?.tone).toBe('error')

  await openSharedOrLast(restore, async () => ({ status: 'none' }))
  expect(restore).toHaveBeenCalledTimes(2)
})

it('imports a link pasted into the address bar of the open tab', async () => {
  const consume = vi.fn(async () => ({ status: 'imported' as const, name: 'Broom hook' }))
  const stop = listenForShareLinks(consume)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await vi.waitFor(() => expect(useShareNotice.getState().notice?.title).toBe('Opened “Broom hook” from a link'))
  stop()
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect(consume).toHaveBeenCalledTimes(1)
})
