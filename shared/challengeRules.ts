// Rules shared by the challenge server and client so both sides agree on timing.

// How long a wrong move stays on the board before the historical line is restored.
// The mover's clock is paused for this long, as in solo training.
export const correctionDelayMs = 1100
// Countdown between the creator pressing Start and the clocks starting.
export const startCountdownMs = 3000
export const maxInvitees = 9
export const minDepth = 12
export const maxDepth = 30
export const defaultDepth = 16
// A challenge whose creator never finishes the analysis is voided after this long.
export const analysisDeadlineMs = 24 * 60 * 60 * 1000
// Prefer games long enough to be a real test; shorter ones are used only if nothing else exists.
export const preferredMinPlies = 20
