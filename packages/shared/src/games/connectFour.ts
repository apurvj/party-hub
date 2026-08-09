import type { Seat } from "../room.js";

/**
 * CONNECT FOUR - the fourth Party Hub game, on the same GameModule contract as
 * Wordle / Uno / Guess-the-Person.
 *
 * It's the simplest possible fit for the engine: PERFECT INFORMATION (the whole
 * board is public to both players, so `sanitizeFor` only projects turn/scores)
 * and ZERO randomness in gameplay. The one deterministic-but-varying bit is which
 * seat drops first each round - seeded from the room code like Guess-the-Person's
 * first-asker, so a reconnect/refresh reproduces it and a rematch (new matchEpoch)
 * reshuffles the opening move. No `Date.now`/`Math.random` anywhere, so replay is
 * exact.
 *
 * Board geometry is the classic 7 columns × 6 rows, connect 4 to win.
 */

export const CONNECT_FOUR_COLS = 7;
export const CONNECT_FOUR_ROWS = 6;
/** Pieces in a line (any direction) needed to win. */
export const CONNECT_FOUR_CONNECT = 4;

/** A single board cell: the seat that dropped a disc there, or null if empty. */
export type ConnectFourCell = Seat | null;

/**
 * The board, indexed `board[row][col]`. Row 0 is the TOP row and row ROWS-1 is
 * the BOTTOM - discs fall to the lowest empty row of a column (gravity), so a
 * full column has a non-null cell in row 0.
 */
export type ConnectFourBoard = ConnectFourCell[][];

/** A board coordinate. */
export interface ConnectFourCoord {
  row: number;
  col: number;
}

// ---- pure board helpers -----------------------------------------------------
// All deterministic and side-effect-free so the server, the tests, and (if ever
// needed) the client resolve identical results. The client never NEEDS these to
// play - the server is authoritative - but they're safe to share.

/** A fresh, empty ROWS×COLS board (all null). */
export function emptyBoard(): ConnectFourBoard {
  return Array.from({ length: CONNECT_FOUR_ROWS }, () =>
    Array.from({ length: CONNECT_FOUR_COLS }, () => null as ConnectFourCell),
  );
}

/** A deep copy of a board (rows copied), so callers can't mutate shared state. */
export function cloneBoard(board: ConnectFourBoard): ConnectFourBoard {
  return board.map((r) => r.slice());
}

/**
 * The row a disc would land in if dropped in `col` (the lowest empty row), or
 * null if the column is out of range or full. Scans bottom-up so gravity holds.
 */
export function dropRow(board: ConnectFourBoard, col: number): number | null {
  if (!Number.isInteger(col) || col < 0 || col >= CONNECT_FOUR_COLS) return null;
  for (let row = CONNECT_FOUR_ROWS - 1; row >= 0; row--) {
    if (board[row]?.[col] == null) return row;
  }
  return null;
}

/** The columns that still have room for a disc (legal drop targets). */
export function availableColumns(board: ConnectFourBoard): number[] {
  const cols: number[] = [];
  for (let c = 0; c < CONNECT_FOUR_COLS; c++) {
    if (dropRow(board, c) !== null) cols.push(c);
  }
  return cols;
}

/** True once every column is full (the top row has no empty cell). */
export function isBoardFull(board: ConnectFourBoard): boolean {
  return board[0]?.every((c) => c != null) ?? false;
}

// Half-directions to probe from a placed disc: horizontal, vertical, and the two
// diagonals. Each is extended BOTH ways from the origin, so these four cover all
// eight compass directions without double-counting a line.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // horizontal   -
  [1, 0], // vertical     |
  [1, 1], // diagonal     \
  [1, -1], // diagonal    /
];

function cellKey(c: ConnectFourCoord): string {
  return `${c.row},${c.col}`;
}

/**
 * If the disc most recently placed at (row, col) completes a line of at least
 * CONNECT_FOUR_CONNECT same-seat discs, return every cell in the winning line(s);
 * otherwise null. Only the just-placed disc can create a new line, so callers
 * check exactly this cell after a drop - O(1) rather than scanning the board.
 *
 * The union of all winning directions is returned (deduped), so the rare
 * double-line win highlights fully. Out-of-range probes read as `undefined` and
 * simply stop a run - no bounds bookkeeping needed.
 */
export function findWinningLine(
  board: ConnectFourBoard,
  row: number,
  col: number,
): ConnectFourCoord[] | null {
  const seat = board[row]?.[col];
  if (seat == null) return null;

  const winning = new Map<string, ConnectFourCoord>();
  for (const [dr, dc] of DIRECTIONS) {
    const line: ConnectFourCoord[] = [{ row, col }];
    // Extend forward along the direction.
    for (let step = 1; board[row + dr * step]?.[col + dc * step] === seat; step++) {
      line.push({ row: row + dr * step, col: col + dc * step });
    }
    // Extend backward along the direction.
    for (let step = 1; board[row - dr * step]?.[col - dc * step] === seat; step++) {
      line.push({ row: row - dr * step, col: col - dc * step });
    }
    if (line.length >= CONNECT_FOUR_CONNECT) {
      for (const cell of line) winning.set(cellKey(cell), cell);
    }
  }
  return winning.size > 0 ? [...winning.values()] : null;
}

// ---- config -----------------------------------------------------------------

export interface ConnectFourConfig {
  bestOf: number; // e.g. 3 → first to 2 round wins (draws don't score)
}

export const DEFAULT_CONNECT_FOUR_CONFIG: ConnectFourConfig = {
  bestOf: 3,
};

// ---- actions ----------------------------------------------------------------

/** Actions a client can dispatch for Connect Four (via `game:action`). */
export type ConnectFourAction =
  // Drop a disc into a column (only on your turn; the column must have room).
  | { type: "drop"; payload: { column: number } }
  // Between rounds: signal ready for the next round (mirrors Wordle/Uno).
  | { type: "next_round"; payload?: Record<string, never> };

// ---- sanitized public view --------------------------------------------------

/**
 * The per-player public view. Connect Four is perfect information, so unlike
 * Wordle/Uno/Guess-the-Person this hides nothing about the board - both players
 * legitimately see the full grid. `sanitizeFor` only tailors the "which seat am
 * I / is it my turn / am I ready" projection.
 */
export interface ConnectFourPublicView {
  gameId: "connect-four";
  config: ConnectFourConfig;
  roundNumber: number; // 1-based

  /** The full board (public to both players). `board[row][col]`, row 0 = top. */
  board: ConnectFourBoard;

  /** Which seat you occupy (so the client knows which color is "you"). */
  yourSeat: Seat;
  /** Whose turn it is to drop (both players see the same value). */
  turn: Seat;
  /** Convenience: it's your turn AND the round is live. */
  isYourTurn: boolean;
  /** Columns that still have room - the legal drop targets right now. */
  availableColumns: number[];

  /** The most recent drop's landing cell (drives the fall animation), or null. */
  lastMove: { row: number; col: number; seat: Seat } | null;
  /** When the round was won, every cell in the winning line(s); null otherwise. */
  winningLine: ConnectFourCoord[] | null;
  /** True when the round ended in a full-board draw (no line). */
  roundDraw: boolean;

  scores: { A: number; B: number };
  roundWinnerSeat: "A" | "B" | "tie" | null;
  matchWinnerSeat: "A" | "B" | "tie" | null;

  youReady: boolean;
  opponentReady: boolean;
}
