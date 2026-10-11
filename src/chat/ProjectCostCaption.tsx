import { projectCost } from '../history/projectCost'
import { formatCost } from '../ui/format'
import { useChatStore } from './chatStore'

/** "$0.026 this project" in the chat pane head (screen Main); replaces M2's "this chat" caption. */
export function ProjectCostCaption() {
  const cost = useChatStore((s) => projectCost(s.messages))
  return (
    <span className="pc-caption pc-mono" data-testid="project-cost">
      {formatCost(cost)} this project
    </span>
  )
}
