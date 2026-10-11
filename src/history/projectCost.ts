import type { ChatMessage } from '../chat/chatStore'

/** Sum of the known costs in the project's chat (unknown prices count as nothing). */
export function projectCost(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.usage?.cost ?? 0), 0)
}
