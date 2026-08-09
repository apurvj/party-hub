import { seededIndex, type Seat } from "@party-hub/shared";

/**
 * CONNECT FOUR ENGINE - the only deterministic-but-varying choice in this game.
 *
 * Connect Four is perfect information with no randomness in play, so the sole
 * thing to seed is which seat drops FIRST each round. Seeded from the room code
 * (so a refresh/reconnect reproduces it) and alternating every round (so neither
 * seat keeps the opening advantage), exactly like Guess-the-Person's firstAsker.
 * A rematch bumps `matchEpoch`, reshuffling the base opener. No Date.now / no
 * Math.random - replay is exact. All board/win math lives in the shared module
 * (emptyBoard, dropRow, findWinningLine, isBoardFull) since it's pure and
 * identical on both sides.
 */

/**
 * Which seat drops first this round. Round 1's opener is drawn from the room
 * seed; each subsequent round flips it, so the first move rotates between seats.
 */
export function firstMover(roomCode: string, roundNumber: number, matchEpoch: number): Seat {
  const seed = `${roomCode}#connect-four#match${matchEpoch}#firstMover`;
  const base = seededIndex(seed, 2); // 0 or 1, fixed for the match
  // roundNumber is 1-based; flip on each subsequent round.
  return (base + (roundNumber - 1)) % 2 === 0 ? "A" : "B";
}
