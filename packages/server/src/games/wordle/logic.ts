import {
  cyrb53,
  seededShuffle,
  WORD_LENGTH,
  type GuessFeedback,
  type LetterState,
  type WordleDifficulty,
} from "@party-hub/shared";
import { getAnswerPool, WORDLIST_VERSION } from "./wordlist.js";

/**
 * Compute Wordle feedback for a guess against the answer, handling the classic
 * duplicate-letter rule correctly:
 *   1. First pass: mark every exact-position match "correct" and consume that
 *      letter from a per-letter budget.
 *   2. Second pass: for each non-correct letter, mark "present" only if there's
 *      still budget for that letter left; otherwise "absent".
 *
 * Example — guess "LLAMA" vs answer "LEVEL":
 *   L at 0 → correct (LEVEL[0]=L). Budget for L now 1 (LEVEL has 2 L's, one used).
 *   L at 1 → not correct; budget L=1 → "present" (consumes it → 0).
 *   A at 2 → answer has 0 A → "absent".
 *   M at 3 → "absent".  A at 4 → "absent".
 *
 * Both `guess` and `answer` must be uppercase, length WORD_LENGTH.
 */
export function computeFeedback(guess: string, answer: string): GuessFeedback {
  if (guess.length !== WORD_LENGTH || answer.length !== WORD_LENGTH) {
    throw new Error("computeFeedback: inputs must be WORD_LENGTH");
  }
  const states: LetterState[] = new Array(WORD_LENGTH).fill("absent");
  const budget: Record<string, number> = {};

  // Pass 1: greens + build remaining-letter budget from non-green answer slots.
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) {
      states[i] = "correct";
    } else {
      const a = answer[i]!;
      budget[a] = (budget[a] ?? 0) + 1;
    }
  }

  // Pass 2: yellows where budget allows, else stays absent.
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (states[i] === "correct") continue;
    const g = guess[i]!;
    if ((budget[g] ?? 0) > 0) {
      states[i] = "present";
      budget[g]!--;
    }
  }

  return states.map((state, i) => ({ letter: guess[i]!, state }));
}

/** True if every letter is "correct". */
export function isWinningFeedback(fb: GuessFeedback): boolean {
  return fb.every((f) => f.state === "correct");
}

/**
 * Deterministically select the answer for a given room + round.
 *
 * The whole answer pool is shuffled once per room (seeded by roomCode +
 * difficulty + list version), giving a stable no-repeat ordering. Round N picks
 * position (N-1); once the pool is exhausted we wrap with a fresh reshuffle
 * seeded by the cycle number so later rounds stay deterministic too.
 *
 * DETERMINISM: identical inputs → identical word, on any platform, across
 * restarts. The client never calls this; only the server does.
 */
export function selectWord(
  roomCode: string,
  roundNumber: number, // 1-based
  difficulty: WordleDifficulty,
): string {
  const pool = getAnswerPool(difficulty);
  if (pool.length === 0) throw new Error("selectWord: empty answer pool");

  const idx0 = roundNumber - 1; // 0-based
  const cycle = Math.floor(idx0 / pool.length);
  const posInCycle = idx0 % pool.length;

  const seed = `${roomCode}#${difficulty}#v${WORDLIST_VERSION}#cycle${cycle}`;
  const shuffled = seededShuffle(pool, seed);
  return shuffled[posInCycle]!;
}

/** Exposed for tests / debugging: the raw seeded index (not word). */
export function _wordSeedHash(roomCode: string, difficulty: string, cycle: number): number {
  return cyrb53(`${roomCode}#${difficulty}#v${WORDLIST_VERSION}#cycle${cycle}`);
}
