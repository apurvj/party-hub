import { describe, expect, it } from "vitest";
import {
  CONNECT_FOUR_COLS,
  CONNECT_FOUR_ROWS,
  emptyBoard,
  findWinningLine,
  type ConnectFourBoard,
  type GameContext,
  type Seat,
} from "@party-hub/shared";
import { createConnectFourModule, type ConnectFourState } from "./module.js";

function ctxWith(seats: { A: string | null; B: string | null }, matchEpoch = 0): GameContext {
  return {
    code: "TESTRM",
    seatOf: (pid) => (seats.A === pid ? "A" : seats.B === pid ? "B" : null),
    playerIdOf: (seat: Seat) => seats[seat],
    matchEpoch,
  };
}

const PA = "playerA";
const PB = "playerB";
const other = (s: Seat): Seat => (s === "A" ? "B" : "A");
const pid = (s: Seat): string => (s === "A" ? PA : PB);

function setup(bestOf = 3, matchEpoch = 0) {
  const mod = createConnectFourModule({ bestOf });
  const ctx = ctxWith({ A: PA, B: PB }, matchEpoch);
  const state = mod.createInitialState(ctx);
  return { mod, ctx, state };
}

type Mod = ReturnType<typeof createConnectFourModule>;
function drop(mod: Mod, state: ConnectFourState, ctx: GameContext, seat: Seat, column: number) {
  return mod.reduce(state, { type: "drop", payload: { column } }, pid(seat), ctx);
}
function next(mod: Mod, state: ConnectFourState, ctx: GameContext, seat: Seat) {
  return mod.reduce(state, { type: "next_round" }, pid(seat), ctx);
}

/**
 * Play a whole round through the reducer so `target` wins it, no matter who the
 * seeded opener is. `target` stacks column 0 four-high; the opponent parks
 * harmlessly, alternating between columns 1 and 2 so it never lines up four of
 * its own. Because `target` completes its vertical four on its 4th drop and the
 * opponent's discs are split across two columns, `target` always wins first.
 */
function winRoundFor(mod: Mod, s: ConnectFourState, ctx: GameContext, target: Seat): ConnectFourState {
  const opp = other(target);
  let parks = 0;
  let guard = 0;
  while (!s.roundOver) {
    if (++guard > 200) throw new Error("winRoundFor did not converge");
    const res =
      s.turn === target
        ? drop(mod, s, ctx, target, 0)
        : drop(mod, s, ctx, opp, parks++ % 2 === 0 ? 1 : 2);
    if (res.error) throw new Error(`winRoundFor unexpected drop error: ${res.error.code}`);
    s = res.state;
  }
  return s;
}

describe("connect-four module: setup + turns", () => {
  it("creates a fresh empty board on round 1 with a seeded first mover", () => {
    const { state } = setup();
    expect(state.roundNumber).toBe(1);
    expect(state.board).toHaveLength(CONNECT_FOUR_ROWS);
    expect(state.board.flat().every((c) => c === null)).toBe(true);
    expect(["A", "B"]).toContain(state.turn);
    expect(state.scores).toEqual({ A: 0, B: 0 });
  });

  it("rejects a drop from the seat that isn't on turn", () => {
    const { mod, ctx, state } = setup();
    const opener = state.turn;
    const res = drop(mod, state, ctx, other(opener), 0);
    expect(res.error?.code).toBe("NOT_YOUR_TURN");
    // State unchanged (rejected reduce contract).
    expect(res.state.board.flat().every((c) => c === null)).toBe(true);
    expect(res.state.turn).toBe(opener);
  });

  it("accepts a legal drop, lands it on the floor, and passes the turn", () => {
    const { mod, ctx, state } = setup();
    const opener = state.turn;
    const res = drop(mod, state, ctx, opener, 3);
    expect(res.error).toBeUndefined();
    expect(res.state.board[CONNECT_FOUR_ROWS - 1]![3]).toBe(opener);
    expect(res.state.lastMove).toEqual({ row: CONNECT_FOUR_ROWS - 1, col: 3, seat: opener });
    expect(res.state.turn).toBe(other(opener));
  });

  it("rejects a drop from a seatless player", () => {
    const { mod, state } = setup();
    const soloCtx = ctxWith({ A: PA, B: PB });
    const res = mod.reduce(state, { type: "drop", payload: { column: 0 } }, "stranger", soloCtx);
    expect(res.error?.code).toBe("NOT_IN_ROOM");
  });

  it("rejects a full column and an out-of-range / non-integer column", () => {
    const { mod, ctx, state } = setup();
    let s = state;
    let turn = s.turn;
    // Fill column 0 to the brim.
    for (let i = 0; i < CONNECT_FOUR_ROWS; i++) {
      const r = drop(mod, s, ctx, turn, 0);
      // A vertical stack of the same seat would win at 4; alternate columns to
      // avoid ending the round, then re-target col 0. Instead: alternate seats by
      // parking the off-turn move elsewhere. Simplest: fill col 0 alternating seats.
      s = r.state;
      turn = other(turn);
    }
    // Column 0 is now full (6 discs, alternating so no vertical win).
    expect(drop(mod, s, ctx, s.turn, 0).error?.code).toBe("INVALID_ACTION");
    expect(drop(mod, s, ctx, s.turn, CONNECT_FOUR_COLS).error?.code).toBe("INVALID_ACTION");
    expect(drop(mod, s, ctx, s.turn, -1).error?.code).toBe("INVALID_ACTION");
  });

  it("rejects a non-numeric/malformed drop payload as INVALID_ACTION", () => {
    const { mod, ctx, state } = setup();
    const t = state.turn;
    expect(
      mod.reduce(state, { type: "drop", payload: { column: "3" } } as never, pid(t), ctx).error?.code,
    ).toBe("INVALID_ACTION");
    expect(
      mod.reduce(state, { type: "drop", payload: { column: 2.5 } } as never, pid(t), ctx).error?.code,
    ).toBe("INVALID_ACTION");
    expect(mod.reduce(state, { type: "drop" } as never, pid(t), ctx).error?.code).toBe(
      "INVALID_ACTION",
    );
    expect(mod.reduce(state, { type: "bogus" } as never, pid(t), ctx).error?.code).toBe(
      "INVALID_ACTION",
    );
  });
});

describe("connect-four module: winning + resolution", () => {
  it("a vertical four wins the round and awards a point", () => {
    const { mod, ctx, state } = setup(3);
    const winner = state.turn;
    const loser = other(winner);
    let s = state;
    // winner stacks col 0 four high; loser parks in col 1 between turns.
    let res = drop(mod, s, ctx, winner, 0);
    s = res.state;
    res = drop(mod, s, ctx, loser, 1);
    s = res.state;
    res = drop(mod, s, ctx, winner, 0);
    s = res.state;
    res = drop(mod, s, ctx, loser, 1);
    s = res.state;
    res = drop(mod, s, ctx, winner, 0);
    s = res.state;
    res = drop(mod, s, ctx, loser, 1);
    s = res.state;
    res = drop(mod, s, ctx, winner, 0); // fourth in column 0 → win
    s = res.state;

    expect(s.roundOver).toBe(true);
    expect(s.roundWinnerSeat).toBe(winner);
    expect(s.winningLine).not.toBeNull();
    expect(s.winningLine!).toHaveLength(4);
    expect(s.scores[winner]).toBe(1);
    expect(s.scores[loser]).toBe(0);
    expect((res.events ?? []).some((e) => e.kind === "round_over" && e.winnerSeat === winner)).toBe(
      true,
    );
    // Best-of-3: one win isn't a clinch, so no match_over yet.
    expect(s.matchWinnerSeat).toBeNull();
  });

  it("rejects any drop once the round is over", () => {
    const { mod, ctx, state } = setup(3);
    const winner = state.turn;
    const loser = other(winner);
    let s = state;
    for (let i = 0; i < 3; i++) {
      s = drop(mod, s, ctx, winner, 0).state;
      s = drop(mod, s, ctx, loser, 1).state;
    }
    s = drop(mod, s, ctx, winner, 0).state; // win
    expect(s.roundOver).toBe(true);
    expect(drop(mod, s, ctx, loser, 2).error?.code).toBe("GAME_NOT_ACTIVE");
  });

  it("a full board with no line is a draw (no point) and can end the match", () => {
    // bestOf 1: the single round is the whole match, so a draw ends it as a tie.
    const { mod, ctx, state } = setup(1);
    // White-box (mirrors guessWho's forceSolved): drive only the FINAL drop
    // through the reducer to exercise the draw branch. We build a verified no-win
    // FULL coloring, then pop the top of column 0 so the reducer's drop fills the
    // board and resolves a tie. How the rest was "reached" doesn't matter to the
    // reducer - it only reads the current board + turn.
    const full = noWinFullBoard();
    // Sanity: the complete coloring truly has no four-in-a-row anywhere.
    expect(hasAnyLine(full)).toBe(false);
    const target = full[0]![0] as Seat; // color that belongs at the top of col 0
    const board = full.map((r) => r.slice());
    board[0]![0] = null; // pop the top of column 0 → one legal drop remains

    const s0: ConnectFourState = { ...state, board, turn: target };
    const res = drop(mod, s0, ctx, target, 0);
    const s = res.state;

    expect(res.error).toBeUndefined();
    expect(s.roundOver).toBe(true);
    expect(s.roundDraw).toBe(true);
    expect(s.roundWinnerSeat).toBe("tie");
    expect(s.winningLine).toBeNull();
    expect(s.scores).toEqual({ A: 0, B: 0 });
    expect(s.matchWinnerSeat).toBe("tie"); // bestOf 1 → the drawn round ends the match
    expect((res.events ?? []).some((e) => e.kind === "match_over" && e.winnerSeat === "tie")).toBe(
      true,
    );
  });
});

/** True if ANY cell on a filled board sits in a four-in-a-row (any direction). */
function hasAnyLine(board: ConnectFourBoard): boolean {
  for (let r = 0; r < CONNECT_FOUR_ROWS; r++) {
    for (let c = 0; c < CONNECT_FOUR_COLS; c++) {
      if (board[r]![c] != null && findWinningLine(board, r, c)) return true;
    }
  }
  return false;
}

/**
 * A completely FILLED 6×7 board 2-colored so that no seat ever has four in a row
 * (horizontal, vertical, or either diagonal) - i.e. a drawn Connect Four game.
 * Found by a deterministic backtracking search (row-major, try A then B, prune
 * the moment a placement completes a line). Such a coloring provably exists
 * because real drawn games do; the search is bounded and self-contained.
 */
function noWinFullBoard(): ConnectFourBoard {
  const board = emptyBoard();
  const seats: Seat[] = ["A", "B"];
  const solve = (idx: number): boolean => {
    if (idx === CONNECT_FOUR_ROWS * CONNECT_FOUR_COLS) return true;
    const r = Math.floor(idx / CONNECT_FOUR_COLS);
    const c = idx % CONNECT_FOUR_COLS;
    for (const seat of seats) {
      board[r]![c] = seat;
      if (!findWinningLine(board, r, c) && solve(idx + 1)) return true;
    }
    board[r]![c] = null;
    return false;
  };
  if (!solve(0)) throw new Error("no drawn full-board coloring found");
  return board;
}

describe("connect-four module: best-of + ready gate", () => {
  it("clinches the match at a majority of rounds (best-of-3)", () => {
    const { mod, ctx } = setup(3);
    let s = mod.createInitialState(ctx);
    // Seat A wins two rounds regardless of who opens each round → clinches at 2.
    s = winRoundFor(mod, s, ctx, "A");
    expect(s.scores.A).toBe(1);
    expect(s.matchWinnerSeat).toBeNull(); // one win isn't a clinch in best-of-3
    s = next(mod, s, ctx, "A").state;
    s = next(mod, s, ctx, "B").state;
    expect(s.roundNumber).toBe(2);
    s = winRoundFor(mod, s, ctx, "A");
    expect(s.scores.A).toBe(2);
    expect(s.matchWinnerSeat).toBe("A");
  });

  it("ready-gate: one player readying doesn't advance; both does", () => {
    const { mod, ctx, state } = setup(3);
    let s = state;
    const winner = s.turn;
    const loser = other(winner);
    for (let i = 0; i < 3; i++) {
      s = drop(mod, s, ctx, winner, 0).state;
      s = drop(mod, s, ctx, loser, 1).state;
    }
    s = drop(mod, s, ctx, winner, 0).state; // win round 1
    expect(s.roundOver).toBe(true);

    const r1 = next(mod, s, ctx, "A");
    expect(r1.state.roundOver).toBe(true); // still waiting on B
    expect(r1.state.roundNumber).toBe(1);
    const r2 = next(mod, r1.state, ctx, "B");
    expect(r2.state.roundNumber).toBe(2); // both ready → advanced
    expect(r2.state.roundOver).toBe(false);
    expect(r2.state.board.flat().every((c) => c === null)).toBe(true);
  });

  it("solo occupant can advance alone when the opponent seat is empty", () => {
    const mod = createConnectFourModule({ bestOf: 3 });
    const ctx = ctxWith({ A: PA, B: PB });
    let s = mod.createInitialState(ctx);
    const winner = s.turn;
    const loser = other(winner);
    for (let i = 0; i < 3; i++) {
      s = drop(mod, s, ctx, winner, 0).state;
      s = drop(mod, s, ctx, loser, 1).state;
    }
    s = drop(mod, s, ctx, winner, 0).state; // win round 1
    // Opponent left: their seat is now empty.
    const soloCtx = ctxWith({ A: PA, B: null });
    const r = next(mod, s, soloCtx, "A");
    expect(r.state.roundNumber).toBe(2); // advanced solo
  });

  it("rejects next_round before the round is over", () => {
    const { mod, ctx, state } = setup(3);
    expect(next(mod, state, ctx, state.turn).error?.code).toBe("INVALID_ACTION");
  });

  it("rejects next_round after the match is over", () => {
    const { mod, ctx } = setup(1);
    let s = mod.createInitialState(ctx);
    const winner = s.turn;
    const loser = other(winner);
    for (let i = 0; i < 3; i++) {
      s = drop(mod, s, ctx, winner, 0).state;
      s = drop(mod, s, ctx, loser, 1).state;
    }
    s = drop(mod, s, ctx, winner, 0).state; // win the only round → match over
    expect(s.matchWinnerSeat).toBe(winner);
    expect(next(mod, s, ctx, "A").error?.code).toBe("GAME_NOT_ACTIVE");
  });
});

describe("connect-four module: sanitizeFor (perfect information)", () => {
  it("shows the full board to both players, with per-seat turn projection", () => {
    const { mod, ctx, state } = setup();
    const opener = state.turn;
    const s = drop(mod, state, ctx, opener, 3).state;

    const viewA = mod.sanitizeFor(s, PA, ctx);
    const viewB = mod.sanitizeFor(s, PB, ctx);

    // Board is identical and public.
    expect(viewA.board).toEqual(viewB.board);
    expect(viewA.board[CONNECT_FOUR_ROWS - 1]![3]).toBe(opener);
    expect(viewA.yourSeat).toBe("A");
    expect(viewB.yourSeat).toBe("B");
    // After opener's move it's the other seat's turn.
    const onTurn = other(opener);
    expect((onTurn === "A" ? viewA : viewB).isYourTurn).toBe(true);
    expect((onTurn === "A" ? viewB : viewA).isYourTurn).toBe(false);
  });

  it("sanitized view is a snapshot  -  mutating any field can't corrupt server state", () => {
    const { mod, ctx, state } = setup();
    // Give the view some non-empty mutable fields to tamper with.
    const opener = state.turn;
    const s = drop(mod, state, ctx, opener, 3).state;
    s.scores.A = 1; // pretend a prior round was won

    const view = mod.sanitizeFor(s, PA, ctx);
    view.board[0]![0] = "A";
    view.scores.A = 999;
    view.scores.B = 999;
    if (view.lastMove) view.lastMove.col = 99;
    view.config.bestOf = 99;

    // None of that reached the authoritative server state.
    expect(s.board[0]![0]).toBeNull();
    expect(s.scores).toEqual({ A: 1, B: 0 });
    expect(s.lastMove).toEqual({ row: CONNECT_FOUR_ROWS - 1, col: 3, seat: opener });
    expect(s.config.bestOf).not.toBe(99);
  });

  it("availableColumns is empty once the round is over", () => {
    const { mod, ctx, state } = setup(1);
    let s = state;
    const winner = s.turn;
    const loser = other(winner);
    for (let i = 0; i < 3; i++) {
      s = drop(mod, s, ctx, winner, 0).state;
      s = drop(mod, s, ctx, loser, 1).state;
    }
    s = drop(mod, s, ctx, winner, 0).state; // win
    const view = mod.sanitizeFor(s, PA, ctx);
    expect(view.availableColumns).toEqual([]);
    expect(view.isYourTurn).toBe(false);
  });

  it("a seatless viewer sees the board but is never on turn", () => {
    const { mod, ctx, state } = setup();
    const view = mod.sanitizeFor(state, "stranger", ctx);
    expect(view.isYourTurn).toBe(false);
    expect(view.board).toHaveLength(CONNECT_FOUR_ROWS);
  });

  it("a seatless viewer never inherits seat A's ready state", () => {
    // Win round 1, then A readies up. A spectator (defaults to seat A for
    // coloring) must NOT read A's youReady, or their client would render the
    // "waiting for opponent" UI as if they were a player.
    const { mod, ctx, state } = setup(3);
    let s = state;
    const winner = s.turn;
    const loser = other(winner);
    for (let i = 0; i < 3; i++) {
      s = drop(mod, s, ctx, winner, 0).state;
      s = drop(mod, s, ctx, loser, 1).state;
    }
    s = drop(mod, s, ctx, winner, 0).state; // win round 1
    s = next(mod, s, ctx, "A").state; // seat A readies up
    expect(s.readyForNext.A).toBe(true);

    const spectator = mod.sanitizeFor(s, "stranger", ctx);
    expect(spectator.youReady).toBe(false);
    expect(spectator.opponentReady).toBe(false);
    // A real seated viewer still reads their own ready state correctly.
    expect(mod.sanitizeFor(s, PA, ctx).youReady).toBe(true);
    expect(mod.sanitizeFor(s, PB, ctx).opponentReady).toBe(true);
  });
});

describe("connect-four module: determinism / phase", () => {
  it("phaseOf reflects the lifecycle", () => {
    const { mod, ctx, state } = setup(3);
    expect(mod.phaseOf(state)).toBe("in_game");
    let s = state;
    const winner = s.turn;
    const loser = other(winner);
    for (let i = 0; i < 3; i++) {
      s = drop(mod, s, ctx, winner, 0).state;
      s = drop(mod, s, ctx, loser, 1).state;
    }
    s = drop(mod, s, ctx, winner, 0).state;
    expect(mod.phaseOf(s)).toBe("round_over");
  });

  it("the seeded first mover is stable across fresh state builds (reconnect-safe)", () => {
    const a = createConnectFourModule({ bestOf: 3 }).createInitialState(ctxWith({ A: PA, B: PB }, 0));
    const b = createConnectFourModule({ bestOf: 3 }).createInitialState(ctxWith({ A: PA, B: PB }, 0));
    expect(a.turn).toBe(b.turn);
  });

  it("a different matchEpoch can reshuffle the opener seed", () => {
    // Not guaranteed to differ, but the seed input changes; assert it's a valid seat.
    const e0 = createConnectFourModule({ bestOf: 3 }).createInitialState(ctxWith({ A: PA, B: PB }, 0));
    const e1 = createConnectFourModule({ bestOf: 3 }).createInitialState(ctxWith({ A: PA, B: PB }, 1));
    expect(["A", "B"]).toContain(e0.turn);
    expect(["A", "B"]).toContain(e1.turn);
  });

  it("isValidAction accepts drop/next_round and rejects others", () => {
    const { mod } = setup();
    expect(mod.isValidAction({ type: "drop", payload: { column: 0 } })).toBe(true);
    expect(mod.isValidAction({ type: "next_round" })).toBe(true);
    expect(mod.isValidAction({ type: "spin" })).toBe(false);
    expect(mod.isValidAction(null)).toBe(false);
    expect(mod.isValidAction("drop")).toBe(false);
  });
});
