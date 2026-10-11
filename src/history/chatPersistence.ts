import { useChatStore, type ChatMessage } from '../chat/chatStore'
import type { StoredMessage, UsageRecord, Version } from '../db/db'
import { listMessages, putMessage } from '../db/messages'
import { clearPendingUsage, linkUsage, takePendingUsageIds, usageByIds } from '../db/usageLinks'
import { useProjectStore } from './projectStore'

export interface ChatPersistence {
  linkTurn(version: Version): Promise<void>
  load(projectId: string): Promise<void>
  settled(): Promise<void>
  stop(): void
}

export function toStored(
  m: ChatMessage,
  meta: { projectId: string; versionId: string | null; usageId: string | null; createdAt: number },
): StoredMessage {
  return {
    id: m.id,
    projectId: meta.projectId,
    versionId: meta.versionId,
    role: m.role,
    content: m.text,
    imageBlobIds: m.imageBlobIds ?? [],
    audioTranscript: m.audioTranscript ?? null,
    model: m.model,
    usageId: meta.usageId,
    createdAt: meta.createdAt,
  }
}

/** `version` is passed only for the message that carries the turn's label. */
export function fromStored(m: StoredMessage, version: Version | undefined, usage: UsageRecord | undefined): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    text: m.content,
    turnLabel: version?.label ?? null,
    model: m.model,
    usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.cost } : null,
    status: 'done',
    ...(version && version.compileStatus !== 'pending' ? { compileStatus: version.compileStatus } : {}),
    ...(m.imageBlobIds.length > 0 ? { imageBlobIds: m.imageBlobIds } : {}),
    ...(m.audioTranscript !== null ? { audioTranscript: m.audioTranscript } : {}),
  }
}

export function startChatPersistence(): ChatPersistence {
  const versionOf = new Map<string, string>() // message id → version id
  const labelOf = new Map<string, string>() // message id → version label (the turn's last reply)
  const usageOf = new Map<string, string>() // message id → usage id
  const createdAtOf = new Map<string, number>()
  const persisted = new Map<string, ChatMessage>() // last object written per id
  let lastTime = 0
  let loading = false
  let queue: Promise<void> = Promise.resolve()

  const serial = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((e: unknown) => console.error('Saving the chat failed', e))
    return queue
  }
  const nextTime = () => (lastTime = Math.max(Date.now(), lastTime + 1))

  function enforceLabels(messages: ChatMessage[]): void {
    if (!messages.some((m) => labelOf.has(m.id) && m.turnLabel !== labelOf.get(m.id))) return
    useChatStore.setState({
      messages: messages.map((m) => (labelOf.has(m.id) && m.turnLabel !== labelOf.get(m.id) ? { ...m, turnLabel: labelOf.get(m.id)! } : m)),
    })
  }

  function persistChanged(messages: ChatMessage[]): void {
    const projectId = useProjectStore.getState().project?.id
    if (!projectId || loading) return
    for (const m of messages) {
      if (!createdAtOf.has(m.id)) createdAtOf.set(m.id, nextTime())
      if (m.status === 'streaming' || persisted.get(m.id) === m) continue
      persisted.set(m.id, m)
      const row = toStored(m, {
        projectId,
        versionId: versionOf.get(m.id) ?? null,
        usageId: usageOf.get(m.id) ?? null,
        createdAt: createdAtOf.get(m.id)!,
      })
      void serial(() => putMessage(row))
    }
  }

  const unsubscribe = useChatStore.subscribe((s) => {
    enforceLabels(s.messages)
    persistChanged(useChatStore.getState().messages)
  })

  const persistence: ChatPersistence = {
    async linkTurn(version) {
      const unlinked = useChatStore.getState().messages.filter((m) => !versionOf.has(m.id))
      const usageIds = takePendingUsageIds()
      for (const m of unlinked) {
        versionOf.set(m.id, version.id)
        persisted.delete(m.id)
      }
      const reply = [...unlinked].reverse().find((m) => m.role === 'assistant')
      if (reply) {
        labelOf.set(reply.id, version.label)
        if (usageIds.length > 0) usageOf.set(reply.id, usageIds.at(-1)!)
      }
      await serial(() => linkUsage(usageIds, version.id))
      enforceLabels(useChatStore.getState().messages)
      persistChanged(useChatStore.getState().messages)
      await persistence.settled()
    },

    async load(projectId) {
      await persistence.settled()
      loading = true
      try {
        const rows = await listMessages(projectId)
        const versions = new Map(useProjectStore.getState().versions.map((v) => [v.id, v]))
        const usage = new Map((await usageByIds(rows.flatMap((r) => (r.usageId ? [r.usageId] : [])))).map((u) => [u.id, u]))
        const lastReplyOf = new Map<string, string>()
        for (const r of rows) if (r.role === 'assistant' && r.versionId) lastReplyOf.set(r.versionId, r.id)
        for (const map of [versionOf, labelOf, usageOf, createdAtOf, persisted]) map.clear()
        clearPendingUsage()
        const messages = rows.map((r) => {
          const version = r.versionId ? versions.get(r.versionId) : undefined
          const labelled = version !== undefined && lastReplyOf.get(version.id) === r.id
          if (r.versionId) versionOf.set(r.id, r.versionId)
          if (r.usageId) usageOf.set(r.id, r.usageId)
          if (labelled) labelOf.set(r.id, version.label)
          createdAtOf.set(r.id, r.createdAt)
          const m = fromStored(r, labelled ? version : undefined, r.usageId ? usage.get(r.usageId) : undefined)
          persisted.set(m.id, m)
          return m
        })
        useChatStore.setState({ messages })
      } finally {
        loading = false
      }
    },

    async settled() {
      let seen: Promise<void>
      do {
        seen = queue
        await seen
      } while (seen !== queue)
    },

    stop() {
      unsubscribe()
    },
  }
  return persistence
}
