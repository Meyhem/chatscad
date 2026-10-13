import { useAgentStore } from '../agentStore'
import { PlanCardView } from './PlanCardView'
import { ReviewCardView } from './ReviewCardView'
import { SizesCardView } from './SizesCardView'

/** The live card behind a chat note; null when the card is gone (a reloaded project shows the note text). */
export function AgentCardView({ cardId }: { cardId: string }) {
  const card = useAgentStore((s) => s.cards[cardId])
  if (!card) return null
  if (card.kind === 'plan') return <PlanCardView card={card} />
  if (card.kind === 'review') return <ReviewCardView card={card} />
  return <SizesCardView card={card} />
}
