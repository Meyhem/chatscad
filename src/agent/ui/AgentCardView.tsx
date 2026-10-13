import { useAgentStore } from '../agentStore'
import { PlanCardView } from './PlanCardView'
import { ReviewCardView } from './ReviewCardView'

/** The live card behind a chat note; null when the card is gone (a reloaded project shows the note text). */
export function AgentCardView({ cardId }: { cardId: string }) {
  const card = useAgentStore((s) => s.cards[cardId])
  if (!card) return null
  return card.kind === 'plan' ? <PlanCardView card={card} /> : <ReviewCardView card={card} />
}
