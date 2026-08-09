import {
  DEFAULT_GUESS_WHO_CONFIG,
  ErrorCode,
  getPerson,
  makeError,
  PEOPLE,
  type AskedQuestion,
  type GameContext,
  type GameEvent,
  type GameModule,
  type GuessWhoAction,
  type GuessWhoConfig,
  type GuessWhoPublicView,
  type Person,
  type QuestionSection,
  type ReduceResult,
  type RoomPhase,
  type Seat,
} from "@party-hub/shared";
import {
  answerFor,
  availableQuestions,
  canAsk,
  firstAsker,
  remainingCandidateIds,
} from "./logic.js";

/**
 * Full server-side Guess-the-Person state. NOT sent as-is: each seat's `identity`
 * is the secret the OTHER player is hunting, so `sanitizeFor` exposes only the
 * viewer's own identity + their own question answers, and reveals the opponent's
 * identity solely once the round is over - the same way Wordle hides its answer
 * and Uno hides both hands. State lives on the room, so a refresh replays the
 * identical round with no recomputation.
 */
export interface GuessWhoState {
  config: GuessWhoConfig;
  roundNumber: number;

  /** Seed inputs for the deterministic first-asker draw - fixed for a match's life. */
  roomCode: string;
  matchEpoch: number;

  /**
   * The person each seat CHOSE to be (the identity the OPPOSITE seat must guess).
   * `null` until that seat commits its pick in the selection phase. The round is
   * "selecting" while either is null; the hunt begins once both are set.
   */
  identity: Record<Seat, string | null>;
  /** Each seat's asked questions + the yes/no answers about their opponent. */
  asked: Record<Seat, AskedQuestion[]>;
  /** Each seat's single committed guess (null until they spend their one chance). */
  guess: Record<Seat, { personId: string; correct: boolean } | null>;

  /**
   * Whose turn it is. Play alternates: on your turn you take EXACTLY one action
   * (ask one question OR commit your guess), then the turn passes to the opponent.
   * This prevents a fast player racing ahead while the other is still thinking.
   */
  turn: Seat;

  roundOver: boolean;
  roundWinnerSeat: Seat | "tie" | null;
  matchWinnerSeat: Seat | "tie" | null;
  scores: { A: number; B: number };
  readyForNext: Record<Seat, boolean>;
}

function otherSeat(s: Seat): Seat {
  return s === "A" ? "B" : "A";
}

/**
 * The round is in its SELECTION phase while either seat hasn't committed an
 * identity yet. No questions or guesses are allowed until both have chosen.
 */
function isSelecting(state: GuessWhoState): boolean {
  return state.identity.A === null || state.identity.B === null;
}

/**
 * A seat is LOCKED into its one final guess - questions closed, guessing the only
 * move left - the moment the OPPONENT commits ANY guess (right or wrong), as long
 * as this seat hasn't already guessed. Once someone locks in an answer, the other
 * player's only remaining option is to take their own guess.
 */
function lockedFor(state: GuessWhoState, seat: Seat): boolean {
  if (state.roundOver) return false;
  const opp = otherSeat(seat);
  return state.guess[opp] !== null && state.guess[seat] === null;
}

/**
 * A seat has SOLVED the board once exactly one candidate remains consistent with
 * its answers. Because every face has a unique attribute signature and the target
 * always stays in the candidate set, that single survivor is provably the target -
 * so a guess at this point is a guaranteed win. This is the one moment the turn
 * stays with the asker (so they can finish immediately) and the only time `pass`
 * is legal.
 */
function hasSolved(state: GuessWhoState, seat: Seat): boolean {
  return remainingCandidateIds(state.asked[seat]).length === 1;
}

/**
 * A seat may ask iff the round is live and past selection, it's that seat's turn,
 * it hasn't guessed, it isn't locked into a forced final guess, and it hasn't
 * already solved the board (once solved, the only moves are guess or pass).
 */
function canAskNow(state: GuessWhoState, seat: Seat): boolean {
  return (
    !state.roundOver &&
    !isSelecting(state) &&
    state.turn === seat &&
    state.guess[seat] === null &&
    !lockedFor(state, seat) &&
    !hasSolved(state, seat)
  );
}

type ActionResult = { events: GameEvent[]; error?: ReturnType<typeof makeError> };
const reject = (code: ErrorCode): ActionResult => ({ events: [], error: makeError(code) });

// ---- round / match resolution ----------------------------------------------

/**
 * Resolve once BOTH seats have guessed.
 *   • exactly one correct → that seat wins;
 *   • both correct → the seat that asked FEWER questions wins (they pinned the
 *     answer more efficiently); an equal question count is a draw;
 *   • both wrong → draw.
 * Draws score 0.
 */
function resolveRound(state: GuessWhoState): GameEvent[] {
  const aCorrect = state.guess.A!.correct;
  const bCorrect = state.guess.B!.correct;

  let winner: Seat | "tie";
  if (aCorrect && bCorrect) {
    const aAsked = state.asked.A.length;
    const bAsked = state.asked.B.length;
    winner = aAsked < bAsked ? "A" : bAsked < aAsked ? "B" : "tie";
  } else if (aCorrect) winner = "A";
  else if (bCorrect) winner = "B";
  else winner = "tie";

  state.roundOver = true;
  state.roundWinnerSeat = winner;
  if (winner !== "tie") state.scores[winner] += 1;

  const events: GameEvent[] = [{ kind: "round_over", winnerSeat: winner }];

  // Match ends when someone clinches (majority of rounds) OR all rounds are
  // played out - the latter matters here because draws don't score, so the match
  // can reach `bestOf` without either side hitting the clinch threshold.
  const needed = Math.floor(state.config.bestOf / 2) + 1;
  const clinched = state.scores.A >= needed || state.scores.B >= needed;
  const exhausted = state.roundNumber >= state.config.bestOf;
  if (clinched || exhausted) {
    const mw: Seat | "tie" =
      state.scores.A > state.scores.B ? "A" : state.scores.B > state.scores.A ? "B" : "tie";
    state.matchWinnerSeat = mw;
    events.push({ kind: "match_over", winnerSeat: mw });
  }
  return events;
}

// ---- actions ----------------------------------------------------------------

/**
 * Commit YOUR secret identity during the selection phase. `personId` must be a
 * real board face; "Surprise me" is a client-side random pick that dispatches
 * this same action, so the server only validates the id (never trusts a seed the
 * opponent could reproduce). Selection is simultaneous, not turn-based - choosing
 * doesn't pass the turn; the seeded first-asker takes the opening move once both
 * players have committed and the hunt begins.
 */
function applyChoose(state: GuessWhoState, seat: Seat, personId: string): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  // Selection is over once both seats have chosen - no re-picking mid-hunt.
  if (!isSelecting(state)) return reject(ErrorCode.INVALID_ACTION);
  // One pick per round; you can't change your identity once committed.
  if (state.identity[seat] !== null) return reject(ErrorCode.INVALID_ACTION);
  // Must be a real board face (guards forged or malformed client picks).
  if (!getPerson(personId)) return reject(ErrorCode.INVALID_ACTION);

  state.identity[seat] = personId;
  return { events: [] };
}

function applyAsk(
  state: GuessWhoState,
  seat: Seat,
  section: QuestionSection,
  value: string,
): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  // The hunt hasn't begun until both players have chosen their identity.
  if (isSelecting(state)) return reject(ErrorCode.GAME_NOT_ACTIVE);
  // Not your turn: play strictly alternates, one action per turn.
  if (state.turn !== seat) return reject(ErrorCode.NOT_YOUR_TURN);
  // You've spent your chance (guessed) or you're locked into a forced final guess.
  if (state.guess[seat] !== null || lockedFor(state, seat)) return reject(ErrorCode.INVALID_ACTION);
  // Already down to one candidate: the board is solved, so asking more is pointless
  // and disallowed - your only moves are to guess (a sure thing) or pass.
  if (hasSolved(state, seat)) return reject(ErrorCode.INVALID_ACTION);
  if (!canAsk(state.asked[seat], section, value)) return reject(ErrorCode.INVALID_ACTION);

  const target = getPerson(state.identity[otherSeat(seat)]!)!;
  state.asked[seat].push({ section, value, answer: answerFor(target, section, value) });
  // Asking is one action. If this answer solved the board (one candidate left),
  // the turn STAYS with you so you can finish right away - guess the sure thing or
  // pass to hand it over. Otherwise the turn passes to the opponent as usual.
  if (!hasSolved(state, seat)) state.turn = otherSeat(seat);
  return { events: [] };
}

/**
 * End your turn WITHOUT guessing. Only legal once you've solved the board (one
 * candidate left) - that's the sole case where the turn stays with you after a
 * question, so `pass` exists to hand it back if you'd rather not commit your one
 * guess yet (e.g. to let a still-searching opponent burn more questions before the
 * fewer-questions tiebreak). Before solving there's always a question available, so
 * a pass then is rejected (it would let a player stall indefinitely).
 *
 * CRUCIAL: passing is forbidden once the OPPONENT has ALSO solved. Otherwise two
 * solved players could pass to each other forever (a livelock) - the round would
 * never resolve because neither ever commits a guess. When both have narrowed to a
 * single face, deferring buys nothing (there's nothing left for either to learn),
 * so we require the player on the move to take their guaranteed guess, which locks
 * the opponent into theirs and resolves the round.
 */
function applyPass(state: GuessWhoState, seat: Seat): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (isSelecting(state)) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (state.turn !== seat) return reject(ErrorCode.NOT_YOUR_TURN);
  if (state.guess[seat] !== null || lockedFor(state, seat)) return reject(ErrorCode.INVALID_ACTION);
  // Passing is only for the solved state; otherwise you must ask or guess.
  if (!hasSolved(state, seat)) return reject(ErrorCode.INVALID_ACTION);
  // Both solved: no more deferring - guess now, or the round could never end.
  if (hasSolved(state, otherSeat(seat))) return reject(ErrorCode.INVALID_ACTION);
  state.turn = otherSeat(seat);
  return { events: [] };
}

function applyGuess(state: GuessWhoState, seat: Seat, personId: string): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  // No guessing until both players have chosen their identity.
  if (isSelecting(state)) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (state.guess[seat] !== null) return reject(ErrorCode.INVALID_ACTION); // one guess only
  // Guessing is your one turn action. A player forced to guess (opponent already
  // locked them in) always holds the turn at that point, so this stays consistent.
  if (state.turn !== seat) return reject(ErrorCode.NOT_YOUR_TURN);
  if (!getPerson(personId)) return reject(ErrorCode.INVALID_ACTION);
  // You may only guess someone still consistent with your own answers - you
  // can't name a face you've already eliminated (and the UI only offers these).
  if (!remainingCandidateIds(state.asked[seat]).includes(personId)) {
    return reject(ErrorCode.INVALID_ACTION);
  }

  const correct = personId === state.identity[otherSeat(seat)];
  state.guess[seat] = { personId, correct };

  // The round resolves only once BOTH have guessed. Committing a guess (right or
  // wrong) locks the opponent into their one final guess; we pass the turn to
  // them so they can take it. When both have guessed, resolve.
  if (state.guess.A !== null && state.guess.B !== null) {
    return { events: resolveRound(state) };
  }
  state.turn = otherSeat(seat);
  return { events: [] };
}

// ---- new round --------------------------------------------------------------

function newRound(state: GuessWhoState, ctx: GameContext, roundNumber: number): void {
  state.roundNumber = roundNumber;
  state.roomCode = ctx.code;
  state.matchEpoch = ctx.matchEpoch;
  // Each round opens in the SELECTION phase: both seats pick their own identity
  // before any question or guess. Null until they commit (see applyChoose).
  state.identity = { A: null, B: null };
  state.asked = { A: [], B: [] };
  state.guess = { A: null, B: null };
  // Seeded first-asker, alternating each round so the opening move rotates. This
  // only matters once selection completes and the hunt begins.
  state.turn = firstAsker(ctx.code, roundNumber, ctx.matchEpoch);
  state.roundOver = false;
  state.roundWinnerSeat = null;
  state.readyForNext = { A: false, B: false };
}

// ---- view helpers -----------------------------------------------------------

/** A fully redacted view for the (never-expected) seatless viewer. */
function redactedView(state: GuessWhoState): GuessWhoPublicView {
  return {
    gameId: "guess-the-person",
    config: state.config,
    roundNumber: state.roundNumber,
    people: PEOPLE as Person[],
    selecting: isSelecting(state),
    youChose: false,
    opponentChose: false,
    yourPersonId: "",
    asked: [],
    remainingPersonIds: [],
    availableQuestions: [],
    yourGuess: null,
    solved: false,
    opponentGuess: null,
    turn: state.turn,
    isYourTurn: false,
    opponentAskedCount: 0,
    opponentGuessed: false,
    opponentSolved: false,
    mustGuess: false,
    revealedOpponentPersonId: null,
    questionCounts: null,
    scores: state.scores,
    roundWinnerSeat: state.roundWinnerSeat,
    matchWinnerSeat: state.matchWinnerSeat,
    youReady: false,
    opponentReady: false,
  };
}

// ---- the module -------------------------------------------------------------

export function createGuessWhoModule(
  config: GuessWhoConfig = DEFAULT_GUESS_WHO_CONFIG,
): GameModule<GuessWhoState, GuessWhoAction, GuessWhoPublicView> {
  return {
    id: "guess-the-person",

    createInitialState(ctx: GameContext): GuessWhoState {
      const state: GuessWhoState = {
        config,
        roundNumber: 0,
        roomCode: ctx.code,
        matchEpoch: ctx.matchEpoch,
        identity: { A: null, B: null },
        asked: { A: [], B: [] },
        guess: { A: null, B: null },
        turn: "A",
        roundOver: false,
        roundWinnerSeat: null,
        matchWinnerSeat: null,
        scores: { A: 0, B: 0 },
        readyForNext: { A: false, B: false },
      };
      newRound(state, ctx, 1);
      return state;
    },

    reduce(state, action, playerId, ctx): ReduceResult<GuessWhoState> {
      const seat = ctx.seatOf(playerId);
      if (!seat) return { state, error: makeError(ErrorCode.NOT_IN_ROOM) };

      if (action.type === "next_round") {
        if (!state.roundOver) return { state, error: makeError(ErrorCode.INVALID_ACTION) };
        if (state.matchWinnerSeat) return { state, error: makeError(ErrorCode.GAME_NOT_ACTIVE) };
        state.readyForNext[seat] = true;
        const bothReady = state.readyForNext.A && state.readyForNext.B;
        const soloOccupant = ctx.playerIdOf(otherSeat(seat)) === null;
        if (!bothReady && !soloOccupant) {
          return { state, events: [], nextPhase: this.phaseOf(state) };
        }
        newRound(state, ctx, state.roundNumber + 1);
        return {
          state,
          events: [{ kind: "round_started", roundNumber: state.roundNumber }],
          nextPhase: "in_game",
        };
      }

      let res: ActionResult;
      switch (action.type) {
        case "choose": {
          const p = action.payload as { personId?: unknown } | undefined;
          if (typeof p?.personId !== "string") {
            return { state, error: makeError(ErrorCode.INVALID_ACTION) };
          }
          res = applyChoose(state, seat, p.personId);
          break;
        }
        case "ask": {
          const p = action.payload as { section?: unknown; value?: unknown } | undefined;
          if (typeof p?.section !== "string" || typeof p?.value !== "string") {
            return { state, error: makeError(ErrorCode.INVALID_ACTION) };
          }
          res = applyAsk(state, seat, p.section as QuestionSection, p.value);
          break;
        }
        case "guess": {
          const p = action.payload as { personId?: unknown } | undefined;
          if (typeof p?.personId !== "string") {
            return { state, error: makeError(ErrorCode.INVALID_ACTION) };
          }
          res = applyGuess(state, seat, p.personId);
          break;
        }
        case "pass": {
          res = applyPass(state, seat);
          break;
        }
        default:
          return { state, error: makeError(ErrorCode.INVALID_ACTION) };
      }

      if (res.error) return { state, error: res.error };
      return { state, events: res.events, nextPhase: this.phaseOf(state) };
    },

    sanitizeFor(state, playerId, ctx): GuessWhoPublicView {
      const seat = ctx.seatOf(playerId);
      // Defense-in-depth: a seatless viewer never sees an identity (mirrors Uno).
      if (seat === null) return redactedView(state);

      const opp = otherSeat(seat);
      const selecting = isSelecting(state);
      const canAskingNow = canAskNow(state, seat);
      return {
        gameId: "guess-the-person",
        config: state.config,
        roundNumber: state.roundNumber,
        people: PEOPLE as Person[],
        // Selection status. We leak only WHETHER the opponent has committed, never
        // who they picked (their identity stays hidden until round-over).
        selecting,
        youChose: state.identity[seat] !== null,
        opponentChose: state.identity[opp] !== null,
        // Your own pick (empty until you commit it this round). It's yours to see.
        yourPersonId: state.identity[seat] ?? "",
        asked: state.asked[seat].slice(),
        remainingPersonIds: remainingCandidateIds(state.asked[seat]),
        availableQuestions: canAskingNow ? availableQuestions(state.asked[seat]) : [],
        yourGuess: state.guess[seat],
        // You've narrowed it to exactly one candidate - a guaranteed-correct guess.
        // On your turn this offers you an immediate finish (guess now, or pass).
        solved: !state.roundOver && !selecting && state.guess[seat] === null && hasSolved(state, seat),
        // The opponent's guess is revealed only at round-over - never mid-round,
        // so a forced final guess can't be informed by their result.
        opponentGuess: state.roundOver ? state.guess[opp] : null,
        turn: state.turn,
        isYourTurn: !state.roundOver && !selecting && state.turn === seat,
        opponentAskedCount: state.asked[opp].length,
        opponentGuessed: state.guess[opp] !== null,
        // Progress-only: has the opponent narrowed THEIR hunt to one face? Drives the
        // client's "both solved -> pass is disallowed, must guess" UX (see applyPass).
        // Never leaks your target, their identity, or any guess's accuracy.
        opponentSolved: !state.roundOver && !selecting && hasSolved(state, opp),
        // You're forced to guess: the opponent has committed a guess and you
        // haven't yet, so questions are closed and your only move is your guess.
        // We deliberately DON'T leak whether their guess was correct - a forced
        // final guess must stay a genuine guess.
        mustGuess: lockedFor(state, seat),
        // The opponent's identity (the person YOU were hunting) is revealed only
        // once the round is over - never mid-round, from any code path.
        revealedOpponentPersonId: state.roundOver ? state.identity[opp] : null,
        // Question counts drive the both-correct tie-break; revealed at round-over
        // only (mid-round we expose just the opponent's count, above).
        questionCounts: state.roundOver
          ? { A: state.asked.A.length, B: state.asked.B.length }
          : null,
        scores: state.scores,
        roundWinnerSeat: state.roundWinnerSeat,
        matchWinnerSeat: state.matchWinnerSeat,
        youReady: state.readyForNext[seat],
        opponentReady: state.readyForNext[opp],
      };
    },

    phaseOf(state): RoomPhase {
      if (state.matchWinnerSeat) return "game_over";
      if (state.roundOver) return "round_over";
      return "in_game";
    },

    isValidAction(action: unknown): action is GuessWhoAction {
      if (typeof action !== "object" || action === null) return false;
      const t = (action as { type?: unknown }).type;
      return (
        t === "choose" || t === "ask" || t === "guess" || t === "pass" || t === "next_round"
      );
    },
  };
}
