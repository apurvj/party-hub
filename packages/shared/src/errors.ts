/**
 * Centralized error taxonomy. The server returns a `code` (stable, machine
 * readable) plus a default user-facing `message`. The client can override the
 * message for i18n/tone but should key logic off `code`.
 */
export const ErrorCode = {
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_FULL: "ROOM_FULL",
  NICKNAME_REQUIRED: "NICKNAME_REQUIRED",
  INVALID_ROOM_CODE: "INVALID_ROOM_CODE",
  NOT_IN_ROOM: "NOT_IN_ROOM",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  GAME_NOT_ACTIVE: "GAME_NOT_ACTIVE",
  INVALID_ACTION: "INVALID_ACTION",
  WORD_WRONG_LENGTH: "WORD_WRONG_LENGTH",
  WORD_NOT_IN_LIST: "WORD_NOT_IN_LIST",
  ALREADY_GUESSED: "ALREADY_GUESSED",
  RATE_LIMITED: "RATE_LIMITED",
  UNKNOWN_GAME: "UNKNOWN_GAME",
  INTERNAL: "INTERNAL",
  /** Client-only: the request never reached the server, or no ack came back. */
  NETWORK: "NETWORK",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: "We couldn't find that room. Check the code and try again.",
  ROOM_FULL: "This room already has two players.",
  NICKNAME_REQUIRED: "Please enter a nickname first.",
  INVALID_ROOM_CODE: "That doesn't look like a valid room code.",
  NOT_IN_ROOM: "You're not in this room.",
  NOT_YOUR_TURN: "Hang tight — it's not your turn yet.",
  GAME_NOT_ACTIVE: "The game isn't running right now.",
  INVALID_ACTION: "That move isn't allowed right now.",
  WORD_WRONG_LENGTH: "Guesses must be 5 letters.",
  WORD_NOT_IN_LIST: "Not in the word list.",
  ALREADY_GUESSED: "You already played that guess.",
  RATE_LIMITED: "Slow down a little!",
  UNKNOWN_GAME: "That game isn't available.",
  INTERNAL: "Something went wrong on our end. Try again.",
  NETWORK: "We couldn't reach the game server. Check your connection and try again.",
};

export interface AppError {
  code: ErrorCode;
  message: string;
}

export function makeError(code: ErrorCode, message?: string): AppError {
  return { code, message: message ?? DEFAULT_ERROR_MESSAGES[code] };
}
