import type { ChatRequest, LlmProvider, ModelInfo, Usage } from '../ai/types'

export interface ScriptedReply {
  text: string
  usage?: Usage
}

/** A fake LlmProvider that replays canned replies in order and records every request. */
export function scriptedProvider(...replies: Array<string | ScriptedReply | Error>) {
  const requests: ChatRequest[] = []
  const models: ModelInfo[] = []
  const provider: LlmProvider = {
    listModels: async () => models,
    async *streamChat(req) {
      requests.push(req)
      const next = replies.shift()
      if (next === undefined) throw new Error('scriptedProvider: no reply left')
      if (next instanceof Error) throw next
      const reply = typeof next === 'string' ? { text: next } : next
      for (const piece of reply.text.match(/[\s\S]{1,8}/g) ?? []) yield { type: 'text', delta: piece }
      yield { type: 'usage', usage: reply.usage ?? { inputTokens: 100, outputTokens: 50 } }
    },
  }
  return { provider, requests, models }
}
