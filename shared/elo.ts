// Multiplayer ELO for challenges. Every pair of participants counts as one game:
// a finisher beats anyone who timed out or left, and both beat a player whose
// analysis never arrived (forfeited); otherwise higher accuracy wins, and
// accuracies closer than drawAccuracyMargin are a draw. K is divided by
// (players - 1) so a big challenge moves ratings about as much as a duel.
// Pure and dependency-free so both the server and tests can import it.

export const initialRating = 1200
export const kFactor = 32
export const drawAccuracyMargin = 1
export const ratingFloor = 100

export type RatedParticipant = {
  id: string
  rating: number
  // False for players who ran out of time or left the challenge.
  finished: boolean
  // Average accuracy (0-100) over the moves the player made; null if none.
  accuracy: number | null
  // The player's analysis never arrived; ranks below everyone else.
  forfeited?: boolean
}

export type RatingChange = {
  id: string
  before: number
  after: number
  delta: number
  // 1-based; players who draw with each other share a rank.
  rank: number
}

// 1 = a beats b, 0.5 = draw, 0 = b beats a.
function tier(participant: RatedParticipant) {
  return participant.forfeited ? 0 : participant.finished ? 2 : 1
}

export function pairScore(a: RatedParticipant, b: RatedParticipant) {
  if (tier(a) !== tier(b)) return tier(a) > tier(b) ? 1 : 0
  const difference = (a.accuracy ?? 0) - (b.accuracy ?? 0)
  if (Math.abs(difference) < drawAccuracyMargin) return 0.5
  return difference > 0 ? 1 : 0
}

export function expectedScore(rating: number, opponentRating: number) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400))
}

export function computeRatingChanges(participants: RatedParticipant[]): RatingChange[] {
  const k = participants.length > 1 ? kFactor / (participants.length - 1) : 0
  return participants.map((player) => {
    let delta = 0
    let beatenBy = 0
    for (const opponent of participants) {
      if (opponent === player) continue
      const score = pairScore(player, opponent)
      if (score === 0) beatenBy += 1
      delta += k * (score - expectedScore(player.rating, opponent.rating))
    }
    const after = Math.max(ratingFloor, Math.round(player.rating + delta))
    return { id: player.id, before: player.rating, after, delta: after - player.rating, rank: beatenBy + 1 }
  })
}
