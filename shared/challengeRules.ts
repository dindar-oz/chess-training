// Rules shared by the challenge server and client so both sides agree on timing.

// How long a wrong move stays on the board before the historical line is restored.
// The mover's clock is paused for this long, as in solo training.
export const correctionDelayMs = 1100
// Countdown between the creator pressing Start and the clocks starting.
export const startCountdownMs = 3000
export const maxInvitees = 9
// Seats in an open challenge, counting the host.
export const minOpenPlayers = 2
export const maxOpenPlayers = maxInvitees + 1
export const defaultOpenPlayers = 4
export const minDepth = 12
export const maxDepth = 30
export const defaultDepth = 16
// Each player's browser analyzes their own moves. Once everyone has finished
// playing, results wait this long for missing analyses; a player whose analysis
// never arrives is ranked last.
export const analysisGraceMs = 10 * 60 * 1000
// Other players' browsers analyze for a player who finished on time but whose
// analysis is missing: at once if they're offline, or after this long if they
// still look online (e.g. an out-of-date page that never sends it).
export const helperDelayMs = 60 * 1000
// Prefer games long enough to be a real test; shorter ones are used only if nothing else exists.
export const preferredMinPlies = 20
export const maxChatLength = 500
