import { formatMegabytes } from '../ui/bytes'

export interface LoadProgress {
  loaded: number
  /** null when the server's length is missing or cannot be trusted (compressed transfer). */
  total: number | null
}

export const LOAD_PROGRESS_TYPE = 'promptcad:openscad-load-progress'

export interface LoadProgressMessage extends LoadProgress {
  type: typeof LOAD_PROGRESS_TYPE
}

export function loadProgressMessage(p: LoadProgress): LoadProgressMessage {
  return { type: LOAD_PROGRESS_TYPE, loaded: p.loaded, total: p.total }
}

export function isLoadProgressMessage(data: unknown): data is LoadProgressMessage {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return d.type === LOAD_PROGRESS_TYPE && typeof d.loaded === 'number' && (d.total === null || typeof d.total === 'number')
}

/** Passes on the first report, then one per `stepBytes`, and the one that completes the download. */
export function throttleProgress(report: (p: LoadProgress) => void, stepBytes = 250_000): (p: LoadProgress) => void {
  let last: number | null = null
  return (p) => {
    const complete = p.total !== null && p.loaded >= p.total
    if (last === null || p.loaded - last >= stepBytes || complete) {
      last = p.loaded
      report(p)
    }
  }
}

/** "5.2 / 8.4 MB", or "5.2 MB" when the total is unknown. */
export function formatLoadProgress({ loaded, total }: LoadProgress): string {
  return total ? `${formatMegabytes(loaded)} / ${formatMegabytes(total)} MB` : `${formatMegabytes(loaded)} MB`
}

type Listener = (p: LoadProgress) => void
const listeners = new Set<Listener>()

export function onLoadProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitLoadProgress(p: LoadProgress): void {
  for (const listener of listeners) listener(p)
}
