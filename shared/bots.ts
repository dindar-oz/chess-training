// Practice bots for challenges. A bot takes a seat like a player and plays on
// the server: mostly the master's move, as often as its level says. When it
// strays it plays the engine's best move if the server has already searched
// the position (which costs no extra search to score), and the weak bot
// sometimes plays any legal move instead. Bots are never rated.

export type BotLevel = 'weak' | 'medium' | 'strong'

export const botLevels: Record<BotLevel, {
  label: string
  // Chance of playing the master's move.
  masterRate: number
  // When straying: chance of a random legal move instead of the engine's best.
  randomRate: number
  // How long it thinks before each move, in milliseconds.
  thinkMs: [number, number]
}> = {
  weak: { label: 'Weak', masterRate: 0.4, randomRate: 0.5, thinkMs: [2_000, 7_000] },
  medium: { label: 'Medium', masterRate: 0.65, randomRate: 0.15, thinkMs: [2_000, 6_000] },
  strong: { label: 'Strong', masterRate: 0.85, randomRate: 0, thinkMs: [1_500, 5_000] },
}

export function isBotLevel(value: unknown): value is BotLevel {
  return typeof value === 'string' && Object.hasOwn(botLevels, value)
}

// The bot's move in a position, in UCI. `engineBestUci` is the server's best
// move there if it has been searched yet; with nothing better known, a bot
// that strays plays the master's move after all (the weak one may still play
// a random move).
export function chooseBotMove(level: BotLevel, position: { masterUci: string; legalUcis: string[]; engineBestUci: string | null }, random: () => number = Math.random) {
  const { masterRate, randomRate } = botLevels[level]
  if (random() < masterRate) return position.masterUci
  const others = position.legalUcis.filter((uci) => uci !== position.masterUci)
  if (others.length > 0 && random() < randomRate) return others[Math.floor(random() * others.length)]
  if (position.engineBestUci && position.engineBestUci !== position.masterUci) return position.engineBestUci
  return position.masterUci
}

// How long the bot thinks: a random time in its level's range, but never more
// than a twentieth of its remaining clock, so it can't run out of time.
export function botThinkMs(level: BotLevel, remainingMs: number, random: () => number = Math.random) {
  const [min, max] = botLevels[level].thinkMs
  return Math.max(200, Math.min(min + random() * (max - min), remainingMs / 20))
}
