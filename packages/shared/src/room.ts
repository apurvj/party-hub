import type { WordleConfig, WordlePublicView } from "./games/wordle.js";

export type Seat = "A" | "B";

export type GameId = "wordle"; // "uno" | "guess-the-person" added later

/** Room-level lifecycle. Both players transition together. */
export type RoomPhase =
  | "waiting" // room created, fewer than 2 players seated
  | "ready" // 2 players present, game not started
  | "in_game" // a round is active
  | "round_over" // round finished, awaiting next round
  | "game_over"; // match (best-of-N) decided

/** Public, per-player view of another player (or self) in the lobby/room. */
export interface PlayerView {
  playerId: string;
  nickname: string;
  seat: Seat | null;
  connected: boolean;
  isYou: boolean;
}

/** Config bundle chosen at room creation. Only wordle for now. */
export interface RoomConfig {
  wordle: WordleConfig;
}

/** Discriminated union of the per-game public view carried in RoomStatePayload. */
export type GamePublicView = WordlePublicView; // | UnoPublicView | ...

/**
 * The single snapshot the server sends on join AND on reconnect. Everything the
 * client needs to render the room from scratch lives here — this is what makes
 * refresh / shared-URL resumption reliable.
 */
export interface RoomStatePayload {
  code: string;
  gameId: GameId;
  phase: RoomPhase;
  you: PlayerView;
  players: PlayerView[]; // includes you
  yourSeat: Seat | null;
  config: RoomConfig;
  /** Sanitized game view for THIS player. Null before the game initializes. */
  game: GamePublicView | null;
}
