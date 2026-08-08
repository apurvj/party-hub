import {
  DEFAULT_WORDLE_CONFIG,
  ErrorCode,
  makeError,
  MAX_GUESSES,
  WORD_LENGTH,
  type GameContext,
  type GameEvent,
  type GameModule,
  type GuessFeedback,
  type LetterState,
  type PlayerRoundStatus,
  type ReduceResult,
  type RoomPhase,
  type Seat,
  type WordleAction,
  type WordleConfig,
  type WordlePublicView,
} from "@party-hub/shared";
import { computeFeedback, isWinningFeedback, selectWord } from "./logic.js";
import { isValidGuess } from "./wordlist.js";

/**
 * A hint may be requested once a player is down to their last two guesses. It
 * reveals exactly ONE correct letter + position — a bounded nudge that never
 * discloses the whole word before the round is over.
 */
const HINT_UNLOCK_AT_GUESSES = MAX_GUESSES - 2; // 4 used → 2 remaining

/** Per-player, per-round record kept on the server (may contain secrets). */
interface PlayerRound {
  guesses: string[];
  feedback: GuessFeedback[];
  status: PlayerRoundStatus;
  solvedInGuesses: number | null;
  finishedOrder: number | null; // 0 = first to finish this round, 1 = second
  /** Index (0..WORD_LENGTH-1) of the revealed hint letter, or null if unused. */
  hintIndex: number | null;
}

/** Full server-side Wordle state (NOT sent to clients as-is). */
export interface WordleState {
  config: WordleConfig;
  roundNumber: number; // 1-based
  answer: string; // SECRET — never leaves the server until round is over
  roundOver: boolean;
  finishCounter: number; // increments as players finish → assigns finishedOrder
  rounds: Record<Seat, PlayerRound>;
  scores: { A: number; B: number };
  /** Winner of the CURRENT round once it's over: seat, "tie", or null (nobody). */
  roundWinnerSeat: Seat | "tie" | null;
  matchWinnerSeat: Seat | "tie" | null;
  /** For co-op: whose turn it is to type the shared guess. */
  coopTurn: Seat;
  /**
   * Between-rounds readiness. After a round ends both players must signal ready
   * before the next round starts. Reset to all-false at the top of each round.
   */
  readyForNext: Record<Seat, boolean>;
}

function emptyRound(): PlayerRound {
  return {
    guesses: [],
    feedback: [],
    status: "playing",
    solvedInGuesses: null,
    finishedOrder: null,
    hintIndex: null,
  };
}

/** Fresh per-seat round records — the single source of the round shape. */
function emptyRounds(): Record<Seat, PlayerRound> {
  return { A: emptyRound(), B: emptyRound() };
}

function otherSeat(s: Seat): Seat {
  return s === "A" ? "B" : "A";
}

function newRound(state: WordleState, ctx: GameContext, roundNumber: number): void {
  state.roundNumber = roundNumber;
  // matchEpoch keeps successive matches in the same room from replaying the
  // identical word sequence after "Play again" (which restarts at round 1).
  state.answer = selectWord(ctx.code, roundNumber, state.config.difficulty, ctx.matchEpoch);
  state.roundOver = false;
  state.finishCounter = 0;
  state.rounds = emptyRounds();
  state.coopTurn = "A";
  state.readyForNext = { A: false, B: false };
  state.roundWinnerSeat = null;
}

function bothFinished(state: WordleState): boolean {
  return state.rounds.A.status !== "playing" && state.rounds.B.status !== "playing";
}

/** Decide the round outcome and update cumulative scores. */
function resolveRound(state: WordleState): GameEvent[] {
  state.roundOver = true;
  const a = state.rounds.A;
  const b = state.rounds.B;

  let winnerSeat: Seat | "tie" | null = null;

  if (state.config.mode === "coop") {
    // Co-op: shared board (tracked on seat A). Win together or lose together.
    const solved = a.status === "won";
    winnerSeat = solved ? "tie" : null; // "tie" here = "both win"
    if (solved) {
      state.scores.A += 1;
      state.scores.B += 1;
    }
  } else {
    // Race: whoever solved with the better (order, fewer guesses) wins the round.
    const aWon = a.status === "won";
    const bWon = b.status === "won";
    if (aWon && !bWon) winnerSeat = "A";
    else if (bWon && !aWon) winnerSeat = "B";
    else if (aWon && bWon) {
      // Both solved: earlier finisher wins; tie-break fewer guesses; then tie.
      if (a.finishedOrder! !== b.finishedOrder!) {
        winnerSeat = a.finishedOrder! < b.finishedOrder! ? "A" : "B";
      } else if (a.guesses.length !== b.guesses.length) {
        winnerSeat = a.guesses.length < b.guesses.length ? "A" : "B";
      } else winnerSeat = "tie";
    } else {
      winnerSeat = null; // neither solved
    }
    if (winnerSeat === "A") state.scores.A += 1;
    else if (winnerSeat === "B") state.scores.B += 1;
  }

  // Persist the round outcome so the sanitized view (and thus the overlay) can
  // show who won THIS round — not just who won the match. The transient event
  // below is fire-and-forget; a reconnect during round-over would otherwise
  // lose this.
  state.roundWinnerSeat = winnerSeat;

  const events: GameEvent[] = [
    { kind: "round_over", winnerSeat, answer: state.answer },
  ];

  // Match end check (best-of-N → first to majority).
  const needed = Math.floor(state.config.bestOf / 2) + 1;
  if (state.scores.A >= needed || state.scores.B >= needed) {
    const mw: Seat | "tie" =
      state.scores.A > state.scores.B ? "A" : state.scores.B > state.scores.A ? "B" : "tie";
    state.matchWinnerSeat = mw;
    events.push({ kind: "match_over", winnerSeat: mw });
  }

  return events;
}

function applyGuess(
  state: WordleState,
  seat: Seat,
  guessRaw: string,
): { events: GameEvent[]; error?: ReturnType<typeof makeError> } {
  const guess = guessRaw.trim().toUpperCase();

  if (state.roundOver) return { events: [], error: makeError(ErrorCode.GAME_NOT_ACTIVE) };
  if (guess.length !== WORD_LENGTH) return { events: [], error: makeError(ErrorCode.WORD_WRONG_LENGTH) };
  if (!/^[A-Z]{5}$/.test(guess)) return { events: [], error: makeError(ErrorCode.WORD_NOT_IN_LIST) };
  if (!isValidGuess(guess)) return { events: [], error: makeError(ErrorCode.WORD_NOT_IN_LIST) };

  // In co-op, guesses land on the shared board (seat A slot) and turns alternate.
  const boardSeat: Seat = state.config.mode === "coop" ? "A" : seat;
  if (state.config.mode === "coop" && seat !== state.coopTurn) {
    return { events: [], error: makeError(ErrorCode.NOT_YOUR_TURN) };
  }

  const round = state.rounds[boardSeat];
  if (round.status !== "playing") return { events: [], error: makeError(ErrorCode.GAME_NOT_ACTIVE) };
  if (round.guesses.includes(guess)) return { events: [], error: makeError(ErrorCode.ALREADY_GUESSED) };

  const fb = computeFeedback(guess, state.answer);
  round.guesses.push(guess);
  round.feedback.push(fb);

  if (isWinningFeedback(fb)) {
    round.status = "won";
    round.solvedInGuesses = round.guesses.length;
    round.finishedOrder = state.finishCounter++;
  } else if (round.guesses.length >= MAX_GUESSES) {
    round.status = "lost";
    round.finishedOrder = state.finishCounter++;
  } else if (state.config.mode === "coop") {
    state.coopTurn = otherSeat(state.coopTurn); // hand the shared board over
  }

  const events: GameEvent[] = [];
  // Race: the first player to SOLVE wins immediately (per the "first to solve
  // wins" design) — no waiting on a stalled opponent. If instead the current
  // player just used their last guess, the round only ends once BOTH have
  // finished (the opponent might still solve). Co-op: the shared board finishing
  // (won or lost) ends the round.
  const doneNow =
    state.config.mode === "coop"
      ? round.status !== "playing"
      : round.status === "won" || bothFinished(state);
  if (doneNow) events.push(...resolveRound(state));

  return { events };
}

// ---- hint helpers ----------------------------------------------------------

/** Positions this player has already turned green across any guess this round. */
function greenIndices(round: PlayerRound): Set<number> {
  const greens = new Set<number>();
  for (const row of round.feedback) {
    row.forEach((cell, i) => {
      if (cell.state === "correct") greens.add(i);
    });
  }
  return greens;
}

/** True if a hint may be requested for this board right now. */
function canRequestHint(state: WordleState, round: PlayerRound): boolean {
  return (
    !state.roundOver &&
    round.status === "playing" &&
    round.hintIndex === null &&
    round.guesses.length >= HINT_UNLOCK_AT_GUESSES
  );
}

/**
 * Reveal exactly one correct letter: the lowest-index position the player hasn't
 * already solved (so the hint always adds new information). Returns the chosen
 * index, or null if the request isn't allowed.
 */
function applyHint(state: WordleState, boardSeat: Seat): number | null {
  const round = state.rounds[boardSeat];
  if (!canRequestHint(state, round)) return null;
  const solved = greenIndices(round);
  let index = 0;
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (!solved.has(i)) {
      index = i;
      break;
    }
  }
  round.hintIndex = index;
  return index;
}

// ---- opponent-view helper: colors only, never letters ---------------------

function opponentRowStates(round: PlayerRound): LetterState[][] {
  return round.feedback.map((row) => row.map((c) => c.state));
}

// ---- the module -----------------------------------------------------------

export function createWordleModule(
  config: WordleConfig = DEFAULT_WORDLE_CONFIG,
): GameModule<WordleState, WordleAction, WordlePublicView> {
  return {
    id: "wordle",

    createInitialState(ctx: GameContext): WordleState {
      // newRound() sets rounds/answer/roundNumber/coopTurn, so we only seed the
      // match-level fields here and let it fill the round in (no double-alloc).
      const state: WordleState = {
        config,
        roundNumber: 0,
        answer: "",
        roundOver: false,
        finishCounter: 0,
        rounds: emptyRounds(),
        scores: { A: 0, B: 0 },
        roundWinnerSeat: null,
        matchWinnerSeat: null,
        coopTurn: "A",
        readyForNext: { A: false, B: false },
      };
      newRound(state, ctx, 1);
      return state;
    },

    reduce(state, action, playerId, ctx): ReduceResult<WordleState> {
      const seat = ctx.seatOf(playerId);
      if (!seat) return { state, error: makeError(ErrorCode.NOT_IN_ROOM) };

      if (action.type === "submit_guess") {
        // Defense in depth: the payload crosses the socket boundary as `unknown`.
        // Only accept a string guess; anything else is an invalid action rather
        // than a value we coerce into "NaN"/"UNDEFINED" and mis-report.
        const rawGuess = (action.payload as { guess?: unknown } | undefined)?.guess;
        if (typeof rawGuess !== "string") return { state, error: makeError(ErrorCode.INVALID_ACTION) };
        const { events, error } = applyGuess(state, seat, rawGuess);
        if (error) return { state, error };
        return { state, events, nextPhase: this.phaseOf(state) };
      }

      if (action.type === "next_round") {
        if (!state.roundOver) return { state, error: makeError(ErrorCode.INVALID_ACTION) };
        if (state.matchWinnerSeat) return { state, error: makeError(ErrorCode.GAME_NOT_ACTIVE) };
        // Ready-gate: mark THIS seat ready and only advance once both are. This
        // stops one player dropping the other into a fresh board unprepared.
        state.readyForNext[seat] = true;
        const bothReady = state.readyForNext.A && state.readyForNext.B;
        // If the opponent's seat is empty (they left mid-match), don't strand the
        // remaining player waiting forever — a lone occupant can advance solo.
        const soloOccupant = ctx.playerIdOf(otherSeat(seat)) === null;
        if (!bothReady && !soloOccupant) {
          // Broadcast the readiness change (no round transition yet).
          return { state, events: [], nextPhase: this.phaseOf(state) };
        }
        newRound(state, ctx, state.roundNumber + 1);
        return {
          state,
          events: [{ kind: "round_started", roundNumber: state.roundNumber }],
          nextPhase: "in_game",
        };
      }

      if (action.type === "hint") {
        const boardSeat: Seat = state.config.mode === "coop" ? "A" : seat;
        const index = applyHint(state, boardSeat);
        if (index === null) return { state, error: makeError(ErrorCode.INVALID_ACTION) };
        // A hint mutates only the requester's own view; still broadcast so their
        // other tabs (same playerId) stay in sync and it survives a refresh.
        return { state, events: [], nextPhase: this.phaseOf(state) };
      }

      return { state, error: makeError(ErrorCode.INVALID_ACTION) };
    },

    sanitizeFor(state, playerId, ctx): WordlePublicView {
      const seat = ctx.seatOf(playerId) ?? "A";
      const oppSeat = otherSeat(seat);

      // In co-op both players share seat-A's board.
      const selfBoardSeat: Seat = state.config.mode === "coop" ? "A" : seat;
      const oppBoardSeat: Seat = state.config.mode === "coop" ? "A" : oppSeat;
      const self = state.rounds[selfBoardSeat];
      const opp = state.rounds[oppBoardSeat];

      // The hint is the ONLY sliver of the answer sent mid-round: one letter at
      // one position, and only after this player explicitly requested it.
      const hint =
        self.hintIndex !== null
          ? { index: self.hintIndex, letter: state.answer[self.hintIndex]! }
          : null;

      const oppView =
        state.config.mode === "coop"
          ? null // shared board — no separate opponent panel
          : {
              rowStates: opponentRowStates(opp),
              status: opp.status,
              solvedInGuesses: opp.solvedInGuesses,
            };

      return {
        gameId: "wordle",
        config: state.config,
        roundNumber: state.roundNumber,
        roundStatus: state.roundOver ? "over" : "active",
        self: {
          guesses: self.guesses,
          feedback: self.feedback,
          status: self.status,
          solvedInGuesses: self.solvedInGuesses,
          hint,
          canHint: canRequestHint(state, self),
        },
        opponent: oppView,
        scores: state.scores,
        roundWinnerSeat: state.roundWinnerSeat,
        matchWinnerSeat: state.matchWinnerSeat,
        coopTurn: state.config.mode === "coop" ? state.coopTurn : null,
        // Answer is revealed ONLY once the round is over — never mid-round.
        revealedAnswer: state.roundOver ? state.answer : null,
        // Between-rounds readiness keys on each player's ACTUAL seat (never the
        // shared co-op board), so both partners are tracked independently.
        youReady: state.readyForNext[seat],
        opponentReady: state.readyForNext[oppSeat],
      };
    },

    phaseOf(state): RoomPhase {
      if (state.matchWinnerSeat) return "game_over";
      if (state.roundOver) return "round_over";
      return "in_game";
    },

    isValidAction(action: unknown): action is WordleAction {
      if (typeof action !== "object" || action === null) return false;
      const t = (action as { type?: unknown }).type;
      return t === "submit_guess" || t === "next_round" || t === "hint";
    },
  };
}
