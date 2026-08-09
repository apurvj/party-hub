import { describe, expect, it } from "vitest";
import {
  CONNECT_FOUR_COLS,
  CONNECT_FOUR_ROWS,
  availableColumns,
  cloneBoard,
  dropRow,
  emptyBoard,
  findWinningLine,
  isBoardFull,
  type ConnectFourBoard,
  type Seat,
} from "@party-hub/shared";
import { firstMover } from "./logic.js";

/** Drop a disc for `seat` into `col`, mutating the board; returns the row. */
function drop(board: ConnectFourBoard, col: number, seat: Seat): number {
  const row = dropRow(board, col);
  if (row === null) throw new Error(`column ${col} is full`);
  board[row]![col] = seat;
  return row;
}

describe("connect-four board helpers", () => {
  it("emptyBoard has the right dimensions and is all null", () => {
    const b = emptyBoard();
    expect(b).toHaveLength(CONNECT_FOUR_ROWS);
    for (const row of b) {
      expect(row).toHaveLength(CONNECT_FOUR_COLS);
      expect(row.every((c) => c === null)).toBe(true);
    }
  });

  it("dropRow stacks discs from the bottom up", () => {
    const b = emptyBoard();
    expect(dropRow(b, 3)).toBe(CONNECT_FOUR_ROWS - 1); // lands on the floor
    drop(b, 3, "A");
    expect(dropRow(b, 3)).toBe(CONNECT_FOUR_ROWS - 2); // stacks above
  });

  it("dropRow returns null for a full column and out-of-range/invalid columns", () => {
    const b = emptyBoard();
    for (let i = 0; i < CONNECT_FOUR_ROWS; i++) drop(b, 0, i % 2 === 0 ? "A" : "B");
    expect(dropRow(b, 0)).toBeNull(); // full
    expect(dropRow(b, -1)).toBeNull();
    expect(dropRow(b, CONNECT_FOUR_COLS)).toBeNull();
    expect(dropRow(b, 1.5)).toBeNull();
    expect(dropRow(b, NaN)).toBeNull();
  });

  it("availableColumns reflects which columns still have room", () => {
    const b = emptyBoard();
    expect(availableColumns(b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (let i = 0; i < CONNECT_FOUR_ROWS; i++) drop(b, 2, i % 2 === 0 ? "A" : "B");
    expect(availableColumns(b)).toEqual([0, 1, 3, 4, 5, 6]);
  });

  it("isBoardFull is true only when every cell is filled", () => {
    const b = emptyBoard();
    expect(isBoardFull(b)).toBe(false);
    for (let c = 0; c < CONNECT_FOUR_COLS; c++) {
      for (let i = 0; i < CONNECT_FOUR_ROWS; i++) drop(b, c, i % 2 === 0 ? "A" : "B");
    }
    expect(isBoardFull(b)).toBe(true);
  });

  it("cloneBoard is a deep copy (row mutation doesn't leak)", () => {
    const b = emptyBoard();
    drop(b, 0, "A");
    const copy = cloneBoard(b);
    copy[CONNECT_FOUR_ROWS - 1]![0] = "B";
    expect(b[CONNECT_FOUR_ROWS - 1]![0]).toBe("A"); // original untouched
  });
});

describe("connect-four findWinningLine", () => {
  it("detects a horizontal four", () => {
    const b = emptyBoard();
    let lastRow = 0;
    for (let c = 0; c < 4; c++) lastRow = drop(b, c, "A");
    const line = findWinningLine(b, lastRow, 3);
    expect(line).not.toBeNull();
    expect(line!).toHaveLength(4);
  });

  it("detects a vertical four", () => {
    const b = emptyBoard();
    let lastRow = 0;
    for (let i = 0; i < 4; i++) lastRow = drop(b, 5, "B");
    const line = findWinningLine(b, lastRow, 5);
    expect(line).not.toBeNull();
    expect(line!).toHaveLength(4);
  });

  it("detects a '/' diagonal four", () => {
    // Build a staircase so A occupies (r,c),(r-1,c+1),(r-2,c+2),(r-3,c+3).
    const b = emptyBoard();
    // Column heights beneath the diagonal, filled with B to raise A into place.
    drop(b, 0, "A"); // (5,0)
    drop(b, 1, "B");
    drop(b, 1, "A"); // (4,1)
    drop(b, 2, "B");
    drop(b, 2, "B");
    drop(b, 2, "A"); // (3,2)
    drop(b, 3, "B");
    drop(b, 3, "B");
    drop(b, 3, "B");
    const r = drop(b, 3, "A"); // (2,3)
    const line = findWinningLine(b, r, 3);
    expect(line).not.toBeNull();
    expect(line!).toHaveLength(4);
  });

  it("detects a '\\' diagonal four", () => {
    // A at (2,0),(3,1),(4,2),(5,3).
    const b = emptyBoard();
    drop(b, 0, "B");
    drop(b, 0, "B");
    drop(b, 0, "B");
    const r0 = drop(b, 0, "A"); // (2,0)
    drop(b, 1, "B");
    drop(b, 1, "B");
    drop(b, 1, "A"); // (3,1)
    drop(b, 2, "B");
    drop(b, 2, "A"); // (4,2)
    drop(b, 3, "A"); // (5,3)
    // The just-placed disc completing the line is (2,0) in this order, but any
    // cell in the line works; verify from the top of the diagonal.
    const line = findWinningLine(b, r0, 0);
    expect(line).not.toBeNull();
    expect(line!).toHaveLength(4);
  });

  it("returns null when there's no line and for an empty cell", () => {
    const b = emptyBoard();
    const r = drop(b, 0, "A");
    expect(findWinningLine(b, r, 0)).toBeNull();
    expect(findWinningLine(b, 0, 0)).toBeNull(); // empty top cell
  });

  it("does not treat three-in-a-row as a win", () => {
    const b = emptyBoard();
    let r = 0;
    for (let c = 0; c < 3; c++) r = drop(b, c, "A");
    expect(findWinningLine(b, r, 2)).toBeNull();
  });

  it("counts a five-in-a-row as a win (all cells returned)", () => {
    const b = emptyBoard();
    let r = 0;
    for (let c = 0; c < 5; c++) r = drop(b, c, "A");
    const line = findWinningLine(b, r, 4);
    expect(line).not.toBeNull();
    expect(line!.length).toBeGreaterThanOrEqual(4);
  });
});

describe("connect-four firstMover", () => {
  it("is deterministic for the same room/epoch/round", () => {
    expect(firstMover("ROOMAB", 1, 0)).toBe(firstMover("ROOMAB", 1, 0));
  });

  it("alternates the opener every round", () => {
    const r1 = firstMover("ROOMAB", 1, 0);
    const r2 = firstMover("ROOMAB", 2, 0);
    const r3 = firstMover("ROOMAB", 3, 0);
    expect(r2).not.toBe(r1);
    expect(r3).toBe(r1);
  });

  it("returns a valid seat", () => {
    for (let round = 1; round <= 6; round++) {
      expect(["A", "B"]).toContain(firstMover("ROOMXY", round, 2));
    }
  });
});
