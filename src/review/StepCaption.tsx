import { stepMove } from './steps'
import type { ReviewMove, ReviewStep } from './steps'

// What the board shows at a review step, in a line.
export function StepCaption({ step, move }: { step: ReviewStep; move: ReviewMove }) {
  const label = stepMove(step)
  if (step.kind === 'yours') return <>Your move {label}{move.mark}{!move.correct && <> · the master played <b>{move.expected}</b></>}</>
  if (step.kind === 'master') return <>The master's move <b>{label}</b></>
  return label ? <>The game continued {label}</> : <>Before your first move</>
}
