import type { AppError } from "./errors.js";
import type { GameEvent } from "./events.js";
import type { GameId, RoomPhase, Seat } from "./room.js";

/**
 * The generic contract every game implements on the SERVER. This is what lets
 * Wordle, Uno, and Guess-the-Person plug into the same room engine.
 *
 * The engine owns rooms, seats, connections, and reconnection. A GameModule
 * owns only game rules: it's a pure(ish) reducer over its own private state.
 *
 *   S = full server-side state (may contain secrets like the Wordle answer)
 *   A = the game's action union (dispatched via the `game:action` socket event)
 *   V = the sanitized per-player public view (safe to send to a client)
 */
export interface GameContext {
  code: string;
  seatOf: (playerId: string) => Seat | null;
  playerIdOf: (seat: Seat) => string | null;
}

/**
 * The result of applying one action.
 *
 * CONTRACT: `error` and `events`/`nextPhase` are mutually exclusive. If `error`
 * is set the action was rejected — `state` MUST be the unchanged input state and
 * the engine broadcasts nothing (it only relays the error to the acting player
 * via the ack). A successful reduce sets `events`/`nextPhase` and leaves `error`
 * undefined. The `RejectedReduce | AcceptedReduce` union below makes this
 * unrepresentable rather than merely documented.
 */
export type ReduceResult<S> =
  | {
      /** The rejected action left state untouched. */
      state: S;
      error: AppError;
      events?: never;
      nextPhase?: never;
    }
  | {
      /** Next full server state. */
      state: S;
      error?: never;
      /** Ephemeral moments to broadcast to both players (round_over, ...). */
      events?: GameEvent[];
      /** Optional room phase the engine should transition to after this action. */
      nextPhase?: RoomPhase;
    };

export interface GameModule<S, A, V> {
  readonly id: GameId;

  /** Build the initial full server state for a fresh match. */
  createInitialState(ctx: GameContext): S;

  /**
   * Apply a player's action. MUST be pure w.r.t. inputs (no Date.now/random for
   * anything that affects derived state — determinism matters for replay).
   */
  reduce(state: S, action: A, playerId: string, ctx: GameContext): ReduceResult<S>;

  /** Project the full state down to what a specific player is allowed to see. */
  sanitizeFor(state: S, playerId: string, ctx: GameContext): V;

  /** Map full state → room phase (used on load/reconnect to sync lifecycle). */
  phaseOf(state: S): RoomPhase;

  /** Runtime type guard for incoming action payloads (defense in depth). */
  isValidAction(action: unknown): action is A;
}
