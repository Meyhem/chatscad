import { useChatStore } from '../chat/chatStore'
import { putBlob } from '../db/blobs'
import type { Version } from '../db/db'
import { paramsEqual, type Params } from '../render/params'
import { effectiveValues, paramOverrides } from '../scad/customizer'
import { useAppStore, type AppState, type CodeSource } from '../state/store'
import { matchesHead } from './matchesHead'
import { bakeMessage, describeParamChanges, manualMessage, truncate } from './messages'
import { useProjectStore, type CommitInput } from './projectStore'

export const IDLE_COMMIT_MS = 30_000

export interface TurnInfo {
  prompt: string | null
  reply: string | null
  model: string | null
}

export interface RecorderDeps {
  idleMs?: number
  capture?(): Promise<Blob | null>
  describeTurn?(): TurnInfo
  onCommit?(version: Version): void | Promise<void>
}

export interface Recorder {
  /** Commits a pending manual or slider change now (editor blur, before the head moves). */
  flush(): Promise<void>
  /** Resolves once every queued commit and patch has been written. */
  settled(): Promise<void>
  stop(): void
}

/** Code changes from these sources become a version at once; manual edits and parameter changes are coalesced. */
const IMMEDIATE: ReadonlySet<CodeSource> = new Set(['ai', 'autofix', 'restore', 'gallery', 'import', 'slider'])

interface Snapshot {
  code: string
  params: Params
}

/** Changes not processed yet: the state before the first one, and the source of the last code change. */
interface Pending {
  prev: Snapshot
  source: CodeSource
}

export function describeChatTurn(): TurnInfo {
  const messages = useChatStore.getState().messages
  let prompt: string | null = null
  let reply: string | null = null
  let model: string | null = null
  for (let i = messages.length - 1; i >= 0 && (prompt === null || reply === null); i--) {
    const m = messages[i]!
    if (m.role === 'user' && prompt === null) prompt = m.text
    if (m.role === 'assistant' && reply === null && prompt === null) {
      reply = m.text
      model = m.model
    }
  }
  return { prompt, reply, model }
}

let active: Recorder | null = null

/** Commits the running recorder's pending edit; the code editor calls it on blur. */
export function flushRecorder(): void {
  void active?.flush()
}

export function startRecorder(deps: RecorderDeps = {}): Recorder {
  const idleMs = deps.idleMs ?? IDLE_COMMIT_MS
  const capture = deps.capture ?? (async () => null)
  const describeTurn = deps.describeTurn ?? describeChatTurn

  let dirty: 'manual' | 'slider' | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let pending: Pending | null = null
  let queue: Promise<void> = Promise.resolve()

  const serial = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((e: unknown) => console.error('Recording a version failed', e))
    return queue
  }

  const clearDirty = () => {
    dirty = null
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = null
  }

  const restartIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      void recorder.flush()
    }, idleMs)
  }

  function statusFor(s: AppState, snap: Snapshot): Pick<Version, 'compileStatus' | 'renderMs'> {
    const lr = s.lastRender
    if (!lr || lr.code !== snap.code) return { compileStatus: 'pending', renderMs: null }
    if (!lr.result.ok) return { compileStatus: 'error', renderMs: lr.result.renderMs }
    return paramsEqual(s.renderedParams, snap.params) ? { compileStatus: 'ok', renderMs: lr.result.renderMs } : { compileStatus: 'pending', renderMs: null }
  }

  async function attachThumbnail(version: Version): Promise<void> {
    const blob = await capture()
    if (!blob) return
    const id = await putBlob('thumbnail', blob)
    await useProjectStore.getState().patchVersion(version.id, { thumbnailBlobId: id })
  }

  async function record(input: CommitInput): Promise<void> {
    const version = await useProjectStore.getState().commit(input)
    if (version.compileStatus === 'ok') await attachThumbnail(version)
    await deps.onCommit?.(version)
  }

  async function commitDirty(snap: Snapshot, s: AppState): Promise<void> {
    const kind = dirty
    const head = useProjectStore.getState().head
    clearDirty()
    if (!kind || !head || matchesHead(snap.code, snap.params, head)) return
    const message =
      kind === 'manual' && snap.code !== head.code
        ? manualMessage(head.code, snap.code)
        : describeParamChanges(effectiveValues(head.code, head.params), effectiveValues(snap.code, snap.params))
    await record({
      code: snap.code,
      params: paramOverrides(snap.code, snap.params),
      source: kind,
      message,
      model: null,
      ...statusFor(s, snap),
    })
  }

  async function commitImmediate(s: AppState, prev: Snapshot, source: CodeSource): Promise<void> {
    const head = useProjectStore.getState().head
    if (!head) return
    const params = paramOverrides(s.code, s.params)
    let message: string
    let model: string | null = null
    switch (source) {
      case 'ai': {
        const t = describeTurn()
        message = truncate(t.prompt ?? '') || 'AI edit'
        model = t.model
        break
      }
      case 'autofix': {
        const t = describeTurn()
        const reply = truncate(t.reply ?? '')
        message = reply ? `Auto-fix: ${reply}` : 'Auto-fix'
        model = t.model
        break
      }
      case 'slider':
        message = bakeMessage(Object.keys(paramOverrides(prev.code, prev.params)))
        break
      case 'restore': {
        const match = useProjectStore.getState().versions.find((v) => v.code === s.code && paramsEqual(v.params, params))
        message = match ? `Restored ${match.label}` : 'Restored earlier code'
        break
      }
      case 'gallery':
        message = 'Started from an example'
        break
      case 'import':
        message = 'Imported code'
        break
      case 'manual':
        message = manualMessage(head.code, s.code)
        break
    }
    await record({ code: s.code, params, source, message, model, ...statusFor(s, { code: s.code, params: s.params }) })
  }

  async function processEdit({ prev, source }: Pending): Promise<void> {
    const s = useAppStore.getState()
    const head = useProjectStore.getState().head
    if (!head) return
    if (matchesHead(s.code, s.params, head)) {
      clearDirty()
      return
    }
    const codeChanged = s.code !== prev.code
    if (codeChanged && IMMEDIATE.has(source)) {
      if (dirty === 'slider' && source === 'slider') clearDirty()
      if (dirty) await commitDirty(prev, s)
      await commitImmediate(useAppStore.getState(), prev, source)
      return
    }
    dirty = codeChanged ? 'manual' : (dirty ?? 'slider')
    restartIdle()
  }

  async function onRendered(): Promise<void> {
    const s = useAppStore.getState()
    const lr = s.lastRender
    if (!lr || lr.code !== s.code) return
    if (lr.result.ok && !paramsEqual(s.renderedParams, s.params)) return
    if (dirty) {
      if (lr.result.ok) await commitDirty({ code: s.code, params: s.params }, s)
      return
    }
    const head = useProjectStore.getState().head
    if (head && head.compileStatus === 'pending' && matchesHead(s.code, s.params, head)) {
      await useProjectStore.getState().patchVersion(head.id, {
        compileStatus: lr.result.ok ? 'ok' : 'error',
        renderMs: lr.result.renderMs,
      })
      if (lr.result.ok) await attachThumbnail(head)
    }
  }

  const takePending = (): Pending | null => {
    const p = pending
    pending = null
    return p
  }

  const unsubscribe = useAppStore.subscribe((s, prev) => {
    const codeChanged = s.code !== prev.code
    if (codeChanged || s.params !== prev.params) {
      // Several synchronous updates (setCode then setParams) are handled as one change.
      if (pending === null) {
        pending = { prev: { code: prev.code, params: prev.params }, source: s.codeSource }
        queueMicrotask(() => {
          const p = takePending()
          if (p) void serial(() => processEdit(p))
        })
      }
      // The source is taken when the code changes, so a later echo of the same code cannot relabel it.
      if (codeChanged) pending.source = s.codeSource
    }
    if (s.lastRender !== prev.lastRender) void serial(onRendered)
  })

  const recorder: Recorder = {
    flush: () => {
      // An edit made in this same task has not been processed yet; take it now so it is not lost.
      const p = takePending()
      return serial(async () => {
        if (p) await processEdit(p)
        if (!dirty) return
        const s = useAppStore.getState()
        await commitDirty({ code: s.code, params: s.params }, s)
      })
    },
    async settled() {
      let seen: Promise<void>
      do {
        await Promise.resolve()
        seen = queue
        await seen
      } while (seen !== queue)
    },
    stop() {
      unsubscribe()
      clearDirty()
      if (active === recorder) active = null
    },
  }
  active = recorder
  return recorder
}
