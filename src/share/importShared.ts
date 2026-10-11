import { useProjectStore } from '../history/projectStore'
import { errorMessage } from '../render/result'
import { decodeShareHash, type SharePayload } from './link'
import { useShareNotice, type Notice } from './shareNotice'

export type ShareOutcome = { status: 'none' } | { status: 'imported'; name: string } | { status: 'error'; error: string }

export async function importSharedPayload(payload: SharePayload): Promise<void> {
  await useProjectStore.getState().newProject({
    name: payload.name,
    origin: 'shared-link',
    code: payload.code,
    params: payload.params,
    source: 'import',
    message: 'Opened from a link',
  })
}

export async function consumeShareHash(
  loc: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  hist: Pick<History, 'replaceState'> = window.history,
  importer: (payload: SharePayload) => Promise<void> = importSharedPayload,
): Promise<ShareOutcome> {
  const parsed = decodeShareHash(loc.hash)
  if (!parsed) return { status: 'none' }
  // Clear the hash first, so a reload never imports the same link twice or retries a bad one.
  hist.replaceState(null, '', `${loc.pathname}${loc.search}`)
  if (!parsed.ok) return { status: 'error', error: parsed.error }
  try {
    await importer(parsed.payload)
  } catch (e) {
    return { status: 'error', error: `The model could not be saved on this device: ${errorMessage(e)}` }
  }
  return { status: 'imported', name: parsed.payload.name }
}

export function noticeFor(outcome: ShareOutcome): Notice | null {
  switch (outcome.status) {
    case 'none':
      return null
    case 'imported':
      return {
        tone: 'info',
        title: `Opened “${outcome.name}” from a link`,
        body: 'It is a new project with the code and parameter values from the link. Your other projects are unchanged.',
      }
    case 'error':
      return { tone: 'error', title: 'This link could not be opened', body: `${outcome.error} Your projects are unchanged.` }
  }
}

/** Startup: a `#s=` link wins over restoring the last project. */
export async function openSharedOrLast(
  restoreLastProject: () => Promise<void>,
  // Outside a browser (Node tests, workers) there is no address bar to read a link from.
  consume: () => Promise<ShareOutcome> = () =>
    typeof window === 'undefined' ? Promise.resolve({ status: 'none' }) : consumeShareHash(),
): Promise<void> {
  const outcome = await consume()
  useShareNotice.getState().show(noticeFor(outcome))
  if (outcome.status !== 'imported') await restoreLastProject()
}

/** A link pasted into the address bar of an open tab only changes the hash; no reload happens. */
export function listenForShareLinks(consume: () => Promise<ShareOutcome> = () => consumeShareHash()): () => void {
  const onHashChange = () => {
    void consume().then((outcome) => {
      if (outcome.status !== 'none') useShareNotice.getState().show(noticeFor(outcome))
    })
  }
  window.addEventListener('hashchange', onHashChange)
  return () => window.removeEventListener('hashchange', onHashChange)
}
