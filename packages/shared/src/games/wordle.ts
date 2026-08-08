/**
 * Wordle domain types shared between server and client.
 *
 * SECURITY INVARIANT: the target word never appears in any type the client
 * receives. The client only ever sees per-letter `LetterFeedback[]`.
 */

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

/** Per-letter result. Colorblind-safe cues are added in the UI on top of these. */
export type LetterState = "correct" | "present" | "absent";

export interface LetterFeedback {
  letter: string; // uppercase A-Z
  state: LetterState;
}

/** One fully-scored guess (a row on the board). */
export type GuessFeedback = LetterFeedback[]; // length === WORD_LENGTH

export type WordleMode = "race" | "coop";
export type WordleDifficulty = "easy" | "normal" | "hard";

export interface WordleConfig {
  mode: WordleMode;
  difficulty: WordleDifficulty;
  bestOf: number; // e.g. 3 → first to 2 round wins
}

export const DEFAULT_WORDLE_CONFIG: WordleConfig = {
  mode: "race",
  difficulty: "normal",
  bestOf: 3,
};

/** Status of the CURRENT round for a single player. */
export type PlayerRoundStatus = "playing" | "won" | "lost";

/** Status of the round as a whole. */
export type RoundStatus = "active" | "over";

/**
 * What the client knows about ITSELF this round: full guesses + feedback.
 */
export interface SelfRoundView {
  guesses: string[]; // the actual words this player typed
  feedback: GuessFeedback[]; // aligned with guesses
  status: PlayerRoundStatus;
  solvedInGuesses: number | null; // set when won
  /**
   * A single opt-in hint — ONE correct letter and its position — populated only
   * after this player requests it. `null` until then. This is the ONLY place a
   * fragment of the answer appears mid-round, it's bounded to one letter, and
   * it's gated to a player's last two guesses (see `canHint`). The full word is
   * never sent before the round is over.
   */
  hint: { index: number; letter: string } | null;
  /** Whether a hint may be requested right now (last 2 guesses, still playing). */
  canHint: boolean;
}

/**
 * What the client knows about its OPPONENT this round. Crucially NOT the words —
 * only the color pattern per row, so you can feel the race without cheating off
 * their letters.
 */
export interface OpponentRoundView {
  rowStates: LetterState[][]; // one row per opponent guess, colors only
  status: PlayerRoundStatus;
  solvedInGuesses: number | null;
}

/**
 * The sanitized, per-player public view of Wordle state. This is what the
 * server sends to a given player. It is safe to log / inspect in devtools.
 */
export interface WordlePublicView {
  gameId: "wordle";
  config: WordleConfig;
  roundNumber: number; // 1-based; the "stage" the user asked about
  roundStatus: RoundStatus;
  self: SelfRoundView;
  opponent: OpponentRoundView | null; // null until an opponent joins
  /** Cumulative round wins across the match, keyed by seat. */
  scores: { A: number; B: number };
  /**
   * Winner of the CURRENT round once it's over (seat, "tie", or null for nobody
   * solved). Distinct from `matchWinnerSeat`, which is only set when the whole
   * best-of-N is decided. The round-over overlay uses this to say who won.
   */
  roundWinnerSeat: "A" | "B" | "tie" | null;
  /** Set once the whole match (best-of-N) is decided. */
  matchWinnerSeat: "A" | "B" | "tie" | null;
  /**
   * Co-op only: which seat may type the next shared guess. `null` in race mode
   * (both players type on their own board simultaneously). The client compares
   * this to its own seat to enforce strict turn-taking in the UI.
   */
  coopTurn: "A" | "B" | null;
  /** When the round ended, the answer IS revealed (round is over — safe). */
  revealedAnswer: string | null;
  /**
   * Between-rounds readiness. Once the round is over, BOTH players must signal
   * ready before the next round begins (so no one is dropped mid-thought into a
   * fresh board). `youReady` reflects this player; `opponentReady` the other.
   * Both `false` in co-op-vs-nobody / pre-round states — only meaningful when
   * `roundStatus === "over"` and the match isn't decided.
   */
  youReady: boolean;
  opponentReady: boolean;
}

/** Actions a client can dispatch for Wordle (carried inside `game:action`). */
export type WordleAction =
  | { type: "submit_guess"; payload: { guess: string } }
  // Signal readiness for the next round. The round only advances once BOTH
  // players are ready (see WordlePublicView.youReady / opponentReady).
  | { type: "next_round"; payload?: Record<string, never> }
  // Request the one-letter hint (only honored on the last two guesses).
  | { type: "hint"; payload?: Record<string, never> };
