import {
  cloneBoard,
  ConnectFourAction,
  ConnectFourConfig,
  ConnectFourPublicView,
  DEFAULT_CONNECT_FOUR_CONFIG,
  dropRow,
  emptyBoard,
  ErrorCode,
  findWinningLine,
  isBoardFull,
  makeError,
  availableColumns as sharedAvailableColumns,
  type ConnectFourBoard,
  type ConnectFourCoord,
  type GameContext,
  type GameEvent,
  type GameModule,
  type ReduceResult,
  type RoomPhase,
  type Seat,
} from "@party-hub/shared";
import { firstMover } from "./logic.js";

/**
 * Full server-side Connect Four state. Connect Four is PERFECT INFORMATION - the
 * board is public to both players - so this holds no secrets and `sanitizeFor`
 * simply projects the per-viewer turn/ready fields. State lives on the room, so a
 * refresh replays the identical position with no recomputation. The only seeded
 * value is the first mover (see logic.ts), keeping reconnect deterministic.
 */
export interface ConnectFourState {
  config: ConnectFourConfig;
  roundNumber: number;

  /** Seed inputs for the deterministic first-mover draw - fixed for a match's life. */
  roomCode: string;
  matchEpoch: number;

  /** The board, `board[row][col]`; row 0 is the top, discs fall to the bottom. */
  board: ConnectFourBoard;
  /** Whose turn it is to drop. */
  turn: Seat;
  /** The most recent drop's landing cell + seat (drives the client's fall anim). */
  lastMove: { row: number; col: number; seat: Seat } | null;
  /** The winning line's cells once the round is won by a connect-4; null otherwise. */
  winningLine: ConnectFourCoord[] | null;
  /** True when the round ended in a full-board draw (no line). */
  roundDraw: boolean;

  roundOver: boolean;
  roundWinnerSeat: Seat | "tie" | null;
  matchWinnerSeat: Seat | "tie" | null;
  scores: { A: number; B: number };
  readyForNext: Record<Seat, boolean>;
}

function otherSeat(s: Seat): Seat {
  return s === "A" ? "B" : "A";
}

type ActionResult = { events: GameEvent[]; error?: ReturnType<typeof makeError> };
const reject = (code: ErrorCode): ActionResult => ({ events: [], error: makeError(code) });

// ---- round / match resolution ----------------------------------------------

/**
 * Resolve a finished round. `winner` is the seat that connected four, or "tie"
 * for a full-board draw. Draws score 0. The match ends when someone clinches a
 * majority of rounds OR all `bestOf` rounds are played (the latter matters
 * because draws don't score, so the match can run out without a clinch).
 */
function resolveRound(state: ConnectFourState, winner: Seat | "tie"): GameEvent[] {
  state.roundOver = true;
  state.roundWinnerSeat = winner;
  if (winner !== "tie") state.scores[winner] += 1;

  const events: GameEvent[] = [{ kind: "round_over", winnerSeat: winner }];

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

function applyDrop(state: ConnectFourState, seat: Seat, column: number): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (state.turn !== seat) return reject(ErrorCode.NOT_YOUR_TURN);
  // dropRow validates the column range AND that it has room; null = illegal drop.
  const row = dropRow(state.board, column);
  if (row === null) return reject(ErrorCode.INVALID_ACTION);

  state.board[row]![column] = seat;
  state.lastMove = { row, col: column, seat };

  // Only the just-placed disc can complete a line, so we check exactly it.
  const line = findWinningLine(state.board, row, column);
  if (line) {
    state.winningLine = line;
    return { events: resolveRound(state, seat) };
  }
  if (isBoardFull(state.board)) {
    state.roundDraw = true;
    return { events: resolveRound(state, "tie") };
  }

  state.turn = otherSeat(seat);
  return { events: [] };
}

// ---- new round --------------------------------------------------------------

function newRound(state: ConnectFourState, ctx: GameContext, roundNumber: number): void {
  state.roundNumber = roundNumber;
  state.roomCode = ctx.code;
  state.matchEpoch = ctx.matchEpoch;
  state.board = emptyBoard();
  // Seeded opener, alternating each round so the first-move advantage rotates.
  state.turn = firstMover(ctx.code, roundNumber, ctx.matchEpoch);
  state.lastMove = null;
  state.winningLine = null;
  state.roundDraw = false;
  state.roundOver = false;
  state.roundWinnerSeat = null;
  state.readyForNext = { A: false, B: false };
}

// ---- the module -------------------------------------------------------------

export function createConnectFourModule(
  config: ConnectFourConfig = DEFAULT_CONNECT_FOUR_CONFIG,
): GameModule<ConnectFourState, ConnectFourAction, ConnectFourPublicView> {
  return {
    id: "connect-four",

    createInitialState(ctx: GameContext): ConnectFourState {
      const state: ConnectFourState = {
        config,
        roundNumber: 0,
        roomCode: ctx.code,
        matchEpoch: ctx.matchEpoch,
        board: emptyBoard(),
        turn: "A",
        lastMove: null,
        winningLine: null,
        roundDraw: false,
        roundOver: false,
        roundWinnerSeat: null,
        matchWinnerSeat: null,
        scores: { A: 0, B: 0 },
        readyForNext: { A: false, B: false },
      };
      newRound(state, ctx, 1);
      return state;
    },

    reduce(state, action, playerId, ctx): ReduceResult<ConnectFourState> {
      const seat = ctx.seatOf(playerId);
      if (!seat) return { state, error: makeError(ErrorCode.NOT_IN_ROOM) };

      if (action.type === "next_round") {
        if (!state.roundOver) return { state, error: makeError(ErrorCode.INVALID_ACTION) };
        if (state.matchWinnerSeat) return { state, error: makeError(ErrorCode.GAME_NOT_ACTIVE) };
        state.readyForNext[seat] = true;
        const bothReady = state.readyForNext.A && state.readyForNext.B;
        // Don't strand a player if their opponent's seat is empty (they left).
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

      if (action.type === "drop") {
        // Defense in depth: the payload crosses the socket as `unknown`. Only a
        // real integer column is a valid drop; anything else is INVALID_ACTION.
        const rawCol = (action.payload as { column?: unknown } | undefined)?.column;
        if (typeof rawCol !== "number" || !Number.isInteger(rawCol)) {
          return { state, error: makeError(ErrorCode.INVALID_ACTION) };
        }
        const res = applyDrop(state, seat, rawCol);
        if (res.error) return { state, error: res.error };
        return { state, events: res.events, nextPhase: this.phaseOf(state) };
      }

      return { state, error: makeError(ErrorCode.INVALID_ACTION) };
    },

    sanitizeFor(state, playerId, ctx): ConnectFourPublicView {
      // Perfect information: the board is public. A seatless viewer (spectator)
      // still gets the full board but is NEVER "on turn" - so we track whether the
      // viewer is actually seated, and only default to seat A for coloring.
      const actualSeat = ctx.seatOf(playerId);
      const seat = actualSeat ?? "A";
      return {
        gameId: "connect-four",
        // Every mutable field is a fresh copy so a client (or an in-process unit
        // test) can't reach through the view into shared server state. Production
        // is already safe via JSON serialization on the socket, but cloning keeps
        // the "view is a snapshot" contract uniform across all fields.
        config: { ...state.config },
        roundNumber: state.roundNumber,
        board: cloneBoard(state.board),
        yourSeat: seat,
        turn: state.turn,
        // Gate on actualSeat: a seatless viewer defaults to "A" for coloring but
        // must never read as on-turn (which would wrongly enable the board UI).
        isYourTurn: actualSeat !== null && !state.roundOver && state.turn === actualSeat,
        availableColumns: state.roundOver ? [] : sharedAvailableColumns(state.board),
        lastMove: state.lastMove ? { ...state.lastMove } : null,
        winningLine: state.winningLine ? state.winningLine.map((c) => ({ ...c })) : null,
        roundDraw: state.roundDraw,
        scores: { ...state.scores },
        roundWinnerSeat: state.roundWinnerSeat,
        matchWinnerSeat: state.matchWinnerSeat,
        // Gate on actualSeat like isYourTurn: a seatless viewer defaults to "A"
        // only for coloring and must NOT inherit seat A's ready state (which would
        // make the client render the "waiting for opponent" UI as if they played).
        youReady: actualSeat !== null && state.readyForNext[actualSeat],
        opponentReady: actualSeat !== null && state.readyForNext[otherSeat(actualSeat)],
      };
    },

    phaseOf(state): RoomPhase {
      if (state.matchWinnerSeat) return "game_over";
      if (state.roundOver) return "round_over";
      return "in_game";
    },

    isValidAction(action: unknown): action is ConnectFourAction {
      if (typeof action !== "object" || action === null) return false;
      const t = (action as { type?: unknown }).type;
      return t === "drop" || t === "next_round";
    },
  };
}
