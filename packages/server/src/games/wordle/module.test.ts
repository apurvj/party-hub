import { describe, expect, it } from "vitest";
import type { GameContext, Seat } from "@party-hub/shared";
import { createWordleModule, type WordleState } from "./module.js";

function ctxWith(
  seats: { A: string | null; B: string | null },
  matchEpoch = 0,
): GameContext {
  return {
    code: "TESTRM",
    seatOf: (pid) => (seats.A === pid ? "A" : seats.B === pid ? "B" : null),
    playerIdOf: (seat: Seat) => seats[seat],
    matchEpoch,
  };
}

const PA = "playerA";
const PB = "playerB";

function setup(mode: "race" | "coop" = "race", bestOf = 3) {
  const mod = createWordleModule({ mode, difficulty: "normal", bestOf });
  const ctx = ctxWith({ A: PA, B: PB });
  const state = mod.createInitialState(ctx);
  return { mod, ctx, state };
}

/** Peek at the secret answer (test-only). */
function answerOf(state: WordleState): string {
  return state.answer;
}

describe("wordle module — race mode", () => {
  it("initializes round 1 with a real 5-letter answer and zeroed scores", () => {
    const { state } = setup();
    expect(state.roundNumber).toBe(1);
    expect(answerOf(state)).toMatch(/^[A-Z]{5}$/);
    expect(state.scores).toEqual({ A: 0, B: 0 });
  });

  it("never leaks the answer in a mid-round sanitized view", () => {
    const { mod, ctx, state } = setup();
    const view = mod.sanitizeFor(state, PA, ctx);
    expect(view.revealedAnswer).toBeNull();
    expect(JSON.stringify(view)).not.toContain(answerOf(state));
  });

  it("rejects wrong-length and non-dictionary guesses", () => {
    const { mod, ctx, state } = setup();
    const short = mod.reduce(state, { type: "submit_guess", payload: { guess: "CAT" } }, PA, ctx);
    expect(short.error?.code).toBe("WORD_WRONG_LENGTH");
    const gibberish = mod.reduce(state, { type: "submit_guess", payload: { guess: "ZXQWK" } }, PA, ctx);
    expect(gibberish.error?.code).toBe("WORD_NOT_IN_LIST");
  });

  it("player A guessing the answer wins the round and scores", () => {
    const { mod, ctx, state } = setup();
    const answer = answerOf(state);
    // A solves immediately.
    let r = mod.reduce(state, { type: "submit_guess", payload: { guess: answer } }, PA, ctx);
    expect(r.error).toBeUndefined();
    // B is still playing → round not over yet in race mode.
    let view = mod.sanitizeFor(r.state, PA, ctx);
    expect(view.self.status).toBe("won");
    // B exhausts guesses to end the round (guess a valid non-answer word 6×).
    const wrong = answer === "PLANT" ? "BREAD" : "PLANT";
    for (let i = 0; i < 6; i++) {
      r = mod.reduce(r.state, { type: "submit_guess", payload: { guess: wrong } }, PB, ctx);
      // ALREADY_GUESSED will trigger after first; that's fine — just drive state.
    }
    view = mod.sanitizeFor(r.state, PA, ctx);
    // A should have the round; answer now revealed since round is over.
    expect(r.state.scores.A).toBe(1);
    expect(view.revealedAnswer).toBe(answer);
  });

  it("opponent view exposes colors but not letters", () => {
    const { mod, ctx, state } = setup();
    const answer = answerOf(state);
    const r = mod.reduce(state, { type: "submit_guess", payload: { guess: answer } }, PB, ctx);
    const aView = mod.sanitizeFor(r.state, PA, ctx);
    expect(aView.opponent).not.toBeNull();
    // Opponent solved → a row of 5 'correct' states, but no letters anywhere.
    expect(aView.opponent!.rowStates[0]).toEqual([
      "correct",
      "correct",
      "correct",
      "correct",
      "correct",
    ]);
    expect(JSON.stringify(aView.opponent)).not.toContain(answer);
  });
});

describe("wordle module — hint", () => {
  // Six distinct valid words we can feed as non-answer guesses.
  const FILLERS = ["SLATE", "MOUNT", "BRICK", "FLUID", "GHOST", "PLUMB"];

  it("is locked until 4 guesses are used", () => {
    const { mod, ctx, state } = setup();
    const answer = answerOf(state);
    const words = FILLERS.filter((w) => w !== answer);

    // Fresh board: no hint, and a request is rejected.
    expect(mod.sanitizeFor(state, PA, ctx).self.canHint).toBe(false);
    expect(mod.reduce(state, { type: "hint" }, PA, ctx).error?.code).toBe("INVALID_ACTION");

    let s = state;
    for (let i = 0; i < 3; i++) {
      s = mod.reduce(s, { type: "submit_guess", payload: { guess: words[i]! } }, PA, ctx).state;
    }
    // 3 used → still locked.
    expect(mod.sanitizeFor(s, PA, ctx).self.canHint).toBe(false);
    // 4th guess → unlocked (assuming the round didn't already end).
    s = mod.reduce(s, { type: "submit_guess", payload: { guess: words[3]! } }, PA, ctx).state;
    if (!s.roundOver) expect(mod.sanitizeFor(s, PA, ctx).self.canHint).toBe(true);
  });

  it("reveals one true letter only to the requester and never the whole word", () => {
    const { mod, ctx, state } = setup();
    const answer = answerOf(state);
    const words = FILLERS.filter((w) => w !== answer);
    let s = state;
    // Play four distinct valid non-answer guesses to unlock the hint.
    for (let i = 0; i < 4; i++) {
      s = mod.reduce(s, { type: "submit_guess", payload: { guess: words[i]! } }, PA, ctx).state;
    }
    if (s.roundOver) return; // extremely unlikely; skip if the round already ended
    expect(mod.sanitizeFor(s, PA, ctx).self.canHint).toBe(true);

    const hinted = mod.reduce(s, { type: "hint" }, PA, ctx);
    expect(hinted.error).toBeUndefined();
    const aView = mod.sanitizeFor(hinted.state, PA, ctx);
    expect(aView.self.hint).not.toBeNull();
    // The revealed letter is genuinely correct at that position.
    expect(aView.self.hint!.letter).toBe(answer[aView.self.hint!.index]);
    // One hint per round: a second request is rejected.
    expect(mod.reduce(hinted.state, { type: "hint" }, PA, ctx).error?.code).toBe("INVALID_ACTION");
    // The OPPONENT never sees the requester's hint, and the whole answer is
    // still not present in their view.
    const bView = mod.sanitizeFor(hinted.state, PB, ctx);
    expect(bView.self.hint).toBeNull();
    expect(JSON.stringify(bView)).not.toContain(answer);
  });
});

describe("wordle module — between-rounds ready gate", () => {
  it("advances only after BOTH players signal ready", () => {
    const { mod, ctx, state } = setup();
    const answer = answerOf(state);
    // A solves → round over in race mode.
    const solved = mod.reduce(state, { type: "submit_guess", payload: { guess: answer } }, PA, ctx);
    expect(solved.state.roundOver).toBe(true);

    // A readies up: round must NOT advance yet.
    const aReady = mod.reduce(solved.state, { type: "next_round" }, PA, ctx);
    expect(aReady.state.roundOver).toBe(true);
    expect(aReady.state.roundNumber).toBe(1);
    expect(mod.sanitizeFor(aReady.state, PA, ctx).youReady).toBe(true);
    expect(mod.sanitizeFor(aReady.state, PB, ctx).opponentReady).toBe(true);

    // B readies up: NOW it advances to round 2 with a fresh board.
    const bReady = mod.reduce(aReady.state, { type: "next_round" }, PB, ctx);
    expect(bReady.state.roundNumber).toBe(2);
    expect(bReady.state.roundOver).toBe(false);
    expect(bReady.state.readyForNext).toEqual({ A: false, B: false });
    expect(bReady.events?.some((e) => e.kind === "round_started")).toBe(true);
  });

  it("lets a lone remaining player advance solo if the opponent's seat is empty", () => {
    const mod = createWordleModule({ mode: "race", difficulty: "normal", bestOf: 3 });
    // Only seat A is occupied (B left).
    const ctx = ctxWith({ A: PA, B: null });
    const state = mod.createInitialState(ctx);
    const answer = answerOf(state);
    const solved = mod.reduce(state, { type: "submit_guess", payload: { guess: answer } }, PA, ctx);
    expect(solved.state.roundOver).toBe(true);
    const aReady = mod.reduce(solved.state, { type: "next_round" }, PA, ctx);
    // No opponent to wait on → advances immediately.
    expect(aReady.state.roundNumber).toBe(2);
  });
});

describe("wordle module — loser sees the answer", () => {
  it("reveals the answer to the player who did NOT solve first", () => {
    const { mod, ctx, state } = setup();
    const answer = answerOf(state);
    // A solves first; round ends immediately (first-to-solve wins in race).
    const r = mod.reduce(state, { type: "submit_guess", payload: { guess: answer } }, PA, ctx);
    expect(r.state.roundOver).toBe(true);
    // B never guessed the word, but the round is over → B's view reveals it.
    const bView = mod.sanitizeFor(r.state, PB, ctx);
    expect(bView.revealedAnswer).toBe(answer);
    expect(bView.self.status).not.toBe("won");
  });

  it("reports the round winner to BOTH players mid-match (not just at match end)", () => {
    const { mod, ctx, state } = setup();
    const answer = answerOf(state);
    // A solves round 1; best-of-3 means the MATCH isn't over yet.
    const r = mod.reduce(state, { type: "submit_guess", payload: { guess: answer } }, PA, ctx);
    expect(r.state.matchWinnerSeat).toBeNull(); // match still going
    // Both views must agree A won THIS round (the loser's screen must not read
    // "nobody got it").
    expect(mod.sanitizeFor(r.state, PA, ctx).roundWinnerSeat).toBe("A");
    expect(mod.sanitizeFor(r.state, PB, ctx).roundWinnerSeat).toBe("A");
  });
});

describe("wordle module — rematch does not replay the same words", () => {
  it("a new match epoch in the same room yields a different word sequence", () => {
    const mod = createWordleModule({ mode: "race", difficulty: "normal", bestOf: 5 });

    // Walk several rounds of match 0 (epoch 0), collecting the answers.
    const seqFor = (epoch: number): string[] => {
      const ctx = ctxWith({ A: PA, B: PB }, epoch);
      let s = mod.createInitialState(ctx);
      const answers = [answerOf(s)];
      // Advance rounds by solving and readying both players.
      for (let round = 1; round < 5; round++) {
        s = mod.reduce(s, { type: "submit_guess", payload: { guess: answerOf(s) } }, PA, ctx).state;
        s = mod.reduce(s, { type: "next_round" }, PA, ctx).state;
        s = mod.reduce(s, { type: "next_round" }, PB, ctx).state;
        answers.push(answerOf(s));
      }
      return answers;
    };

    const match0 = seqFor(0);
    const match1 = seqFor(1);

    // Same room + same rounds, but a different match epoch → the sequences must
    // not be identical (this is the "Play again repeats words" bug guard).
    expect(match1).not.toEqual(match0);
  });

  it("a given match epoch is fully deterministic (reconnect-safe)", () => {
    const mod = createWordleModule({ mode: "race", difficulty: "normal", bestOf: 3 });
    const a = mod.createInitialState(ctxWith({ A: PA, B: PB }, 2));
    const b = mod.createInitialState(ctxWith({ A: PA, B: PB }, 2));
    expect(answerOf(a)).toBe(answerOf(b));
  });
});

describe("wordle module — coop mode", () => {
  it("enforces alternating turns on a shared board", () => {
    const { mod, ctx, state } = setup("coop");
    // It's A's turn first; B guessing should be rejected.
    const bFirst = mod.reduce(state, { type: "submit_guess", payload: { guess: "PLANT" } }, PB, ctx);
    expect(bFirst.error?.code).toBe("NOT_YOUR_TURN");
    // A guesses a valid word → turn passes to B.
    const aTurn = mod.reduce(state, { type: "submit_guess", payload: { guess: "PLANT" } }, PA, ctx);
    // If PLANT happened to be the answer the round ends; otherwise turn flips.
    if (!aTurn.state.roundOver) {
      expect(aTurn.state.coopTurn).toBe("B");
    }
  });
});
