import type { AppError } from "./errors.js";
import type { GameId, RoomStatePayload } from "./room.js";
import type { WordleConfig } from "./games/wordle.js";
import type { UnoConfig } from "./games/uno.js";

/**
 * The socket event catalog — the single source of truth for the wire protocol.
 * Both server and client import these types so payloads can never drift.
 *
 * Convention: `namespace:verb`. One canonical action event (`game:action`)
 * carries every game-specific move, so adding Uno / Guess-the-Person needs no
 * new socket events — only a new action union inside the game module.
 */

/** Sent in the Socket.io connection `auth` object on every (re)connect. */
export interface HandshakeAuth {
  playerId: string;
  nickname: string;
  /** Present when landing on /room/:code so the server can auto-join. */
  roomCode?: string;
}

// ---- Client → Server -------------------------------------------------------

export interface CreateRoomReq {
  gameId: GameId;
  wordle?: Partial<WordleConfig>;
  uno?: Partial<UnoConfig>;
}
export interface CreateRoomRes {
  code: string;
}

export interface JoinRoomReq {
  code: string;
}

export interface GameActionReq {
  type: string; // discriminant of the game's action union
  payload?: unknown;
}

/** Client→Server events. `ack` responses use Socket.io callbacks. */
export interface ClientToServerEvents {
  "room:create": (
    req: CreateRoomReq,
    ack: (res: Result<CreateRoomRes>) => void,
  ) => void;
  "room:join": (req: JoinRoomReq, ack: (res: Result<RoomStatePayload>) => void) => void;
  "room:rematch": (ack: (res: Result<null>) => void) => void;
  "game:action": (req: GameActionReq, ack: (res: Result<null>) => void) => void;
  "room:sync": (ack: (res: Result<RoomStatePayload>) => void) => void;
  ping: (ack: (serverTime: number) => void) => void;
}

// ---- Server → Client -------------------------------------------------------

export interface ServerToClientEvents {
  /** Authoritative snapshot. Sent on join, reconnect, and every state change. */
  "room:state": (state: RoomStatePayload) => void;
  /** Lightweight presence / lobby update (opponent joined, disconnected, ...). */
  "room:notice": (notice: RoomNotice) => void;
  /** Transient, ephemeral game moment (e.g. round result banner, confetti). */
  "game:event": (event: GameEvent) => void;
  error: (err: AppError) => void;
}

export type RoomNoticeKind =
  | "opponent_joined"
  | "opponent_left"
  | "opponent_disconnected"
  | "opponent_reconnected";

export interface RoomNotice {
  kind: RoomNoticeKind;
  message: string;
}

// NOTE: rejected moves (invalid word, wrong turn, wrong length, …) are NOT
// broadcast as events — they're returned to the acting player via the
// `game:action` ack error envelope. `GameEvent` is reserved for moments BOTH
// players should observe (a round/match ending, a new round starting).
export type GameEvent =
  // `answer` is Wordle-specific (the revealed word); omitted for games without
  // one (e.g. Uno). `winnerSeat` is null when nobody solved/won the round.
  | { kind: "round_over"; winnerSeat: "A" | "B" | "tie" | null; answer?: string }
  | { kind: "match_over"; winnerSeat: "A" | "B" | "tie" }
  | { kind: "round_started"; roundNumber: number };

// ---- ack result envelope ---------------------------------------------------

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}
export function fail<T = never>(error: AppError): Result<T> {
  return { ok: false, error };
}
