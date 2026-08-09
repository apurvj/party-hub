import { describe, expect, it } from "vitest";
import {
  PEOPLE,
  QUESTION_SECTIONS,
  getPerson,
  personMatches,
  type GameContext,
  type QuestionSection,
  type Seat,
} from "@party-hub/shared";
import { createGuessWhoModule, type GuessWhoState } from "./module.js";
import { canAsk, remainingCandidateIds } from "./logic.js";

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

// Two distinct board faces the seats pick in the selection phase for tests.
const AID = PEOPLE[0]!.id; // A's chosen identity (B hunts this)
const BID = PEOPLE[1]!.id; // B's chosen identity (A hunts this)

function setup(bestOf = 3) {
  const mod = createGuessWhoModule({ bestOf });
  const ctx = ctxWith({ A: PA, B: PB });
  const state = mod.createInitialState(ctx);
  return { mod, ctx, state };
}

const other = (s: Seat): Seat => (s === "A" ? "B" : "A");
const pid = (s: Seat): string => (s === "A" ? PA : PB);

type Mod = ReturnType<typeof createGuessWhoModule>;
/** Commit a seat's secret identity (selection phase). */
function choose(mod: Mod, state: GuessWhoState, ctx: GameContext, seat: Seat, personId: string) {
  return mod.reduce(state, { type: "choose", payload: { personId } }, pid(seat), ctx);
}
/**
 * Drive both seats through the selection phase so the hunt can begin: A commits
 * `aId`, B commits `bId`. Returns the ready-to-play state.
 */
function play(mod: Mod, state: GuessWhoState, ctx: GameContext, aId = AID, bId = BID): GuessWhoState {
  const r1 = choose(mod, state, ctx, "A", aId);
  return choose(mod, r1.state, ctx, "B", bId).state;
}
/** Ask as a specific seat (drives reduce with that seat's player id). */
function ask(mod: Mod, state: GuessWhoState, ctx: GameContext, seat: Seat, section: QuestionSection, value: string) {
  return mod.reduce(state, { type: "ask", payload: { section, value } }, pid(seat), ctx);
}
/** Guess as a specific seat. */
function guess(mod: Mod, state: GuessWhoState, ctx: GameContext, seat: Seat, personId: string) {
  return mod.reduce(state, { type: "guess", payload: { personId } }, pid(seat), ctx);
}
/** Pass (end turn without guessing) as a specific seat. */
function pass(mod: Mod, state: GuessWhoState, ctx: GameContext, seat: Seat) {
  return mod.reduce(state, { type: "pass" }, pid(seat), ctx);
}

/**
 * White-box: force `seat` into the SOLVED state (exactly one candidate = its
 * target) by directly building the `asked` list. Asking every truthful question
 * the board offers narrows to a unique face, because every person has a unique
 * attribute signature. We assign that directly and put the turn on `seat` - this
 * sidesteps the turn-passing dance and gives a deterministic solved fixture. It
 * mirrors exactly what the reducer produces when a real answer leaves one candidate.
 */
function forceSolved(state: GuessWhoState, seat: Seat): GuessWhoState {
  const target = getPerson(targetOf(state, seat))!;
  const asked: { section: QuestionSection; value: string; answer: boolean }[] = [];
  for (const meta of QUESTION_SECTIONS) {
    for (const v of meta.values) {
      if (!canAsk(asked, meta.section, v.value)) continue;
      asked.push({
        section: meta.section,
        value: v.value,
        answer: personMatches(target, meta.section, v.value),
      });
    }
  }
  const remaining = remainingCandidateIds(asked);
  if (remaining.length !== 1 || remaining[0] !== target.id) {
    throw new Error(`forceSolved failed to isolate the target (got ${remaining.length})`);
  }
  state.asked[seat] = asked;
  state.turn = seat;
  return state;
}

/** The person the given seat must GUESS (their opponent's identity). */
function targetOf(state: GuessWhoState, seat: Seat): string {
  return state.identity[other(seat)]!;
}
/** Some person on the board that is NOT the seat's target - a guaranteed wrong guess. */
function wrongFor(state: GuessWhoState, seat: Seat): string {
  const t = targetOf(state, seat);
  return PEOPLE.find((p) => p.id !== t)!.id;
}

describe("guess-the-person - selection phase", () => {
  it("round 1 opens in SELECTION: no identities yet, fresh board, seeded first turn", () => {
    const { mod, ctx, state } = setup();
    expect(state.roundNumber).toBe(1);
    expect(state.identity).toEqual({ A: null, B: null });
    expect(state.asked).toEqual({ A: [], B: [] });
    expect(state.guess).toEqual({ A: null, B: null });
    expect(state.scores).toEqual({ A: 0, B: 0 });
    expect(["A", "B"]).toContain(state.turn);
    const view = mod.sanitizeFor(state, PA, ctx);
    expect(view.selecting).toBe(true);
    expect(view.youChose).toBe(false);
    expect(view.opponentChose).toBe(false);
    expect(view.yourPersonId).toBe("");
    expect(view.isYourTurn).toBe(false); // no turn until the hunt begins
    expect(view.availableQuestions).toHaveLength(0);
  });

  it("blocks asking and guessing until both players have chosen", () => {
    const { mod, ctx, state } = setup();
    const first = state.turn;
    expect(ask(mod, state, ctx, first, "gender", "male").error?.code).toBe("GAME_NOT_ACTIVE");
    expect(guess(mod, state, ctx, first, PEOPLE[0]!.id).error?.code).toBe("GAME_NOT_ACTIVE");
    // A chooses, B still hasn't → still no play (even the turn-holder is blocked).
    const r1 = choose(mod, state, ctx, "A", AID);
    expect(ask(mod, r1.state, ctx, first, "gender", "male").error?.code).toBe("GAME_NOT_ACTIVE");
    expect(guess(mod, r1.state, ctx, first, PEOPLE[0]!.id).error?.code).toBe("GAME_NOT_ACTIVE");
  });

  it("validates the pick, forbids re-picking, and never leaks the opponent's choice", () => {
    const { mod, ctx, state } = setup();
    // Not a real board face → rejected.
    expect(choose(mod, state, ctx, "A", "not-a-person").error?.code).toBe("INVALID_ACTION");
    // A commits a valid pick.
    const r1 = choose(mod, state, ctx, "A", AID);
    expect(r1.error).toBeUndefined();
    expect(r1.state.identity.A).toBe(AID);
    // A cannot change their mind once committed.
    expect(choose(mod, r1.state, ctx, "A", BID).error?.code).toBe("INVALID_ACTION");
    // Views mid-selection: A sees its own pick; B knows A committed but NOT who.
    const viewA = mod.sanitizeFor(r1.state, PA, ctx);
    const viewB = mod.sanitizeFor(r1.state, PB, ctx);
    expect(viewA.youChose).toBe(true);
    expect(viewA.opponentChose).toBe(false);
    expect(viewA.yourPersonId).toBe(AID);
    expect(viewB.youChose).toBe(false);
    expect(viewB.opponentChose).toBe(true);
    expect(viewB.yourPersonId).toBe(""); // B hasn't chosen
    expect(viewB.revealedOpponentPersonId).toBeNull(); // and can't see A's pick
    expect(viewB.selecting).toBe(true);
  });

  it("both chosen flips out of selection and begins the hunt; no re-picking after", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    expect(s.identity).toEqual({ A: AID, B: BID });
    const view = mod.sanitizeFor(s, PA, ctx);
    expect(view.selecting).toBe(false);
    expect(view.isYourTurn).toBe(s.turn === "A");
    // Selection is closed: choose is now rejected for either seat.
    expect(choose(mod, s, ctx, "A", "diego").error?.code).toBe("INVALID_ACTION");
    expect(choose(mod, s, ctx, "B", "diego").error?.code).toBe("INVALID_ACTION");
  });

  it("allows both seats to pick the SAME face (independent secret picks)", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx, AID, AID);
    expect(s.identity).toEqual({ A: AID, B: AID });
    expect(mod.sanitizeFor(s, PA, ctx).selecting).toBe(false);
    // Both hunt the same face; each still gets their own correct guess.
    const first = s.turn;
    const second = other(first);
    const rA = guess(mod, s, ctx, first, targetOf(s, first));
    const rB = guess(mod, rA.state, ctx, second, targetOf(s, second));
    expect(rB.state.guess[first]!.correct).toBe(true);
    expect(rB.state.guess[second]!.correct).toBe(true);
  });
});

describe("guess-the-person - after selection", () => {
  it("never leaks the opponent's identity in a mid-round view", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const viewA = mod.sanitizeFor(s, PA, ctx);
    expect(viewA.yourPersonId).toBe(s.identity.A);
    expect(viewA.revealedOpponentPersonId).toBeNull();
    expect(viewA.questionCounts).toBeNull(); // no leak of counts mid-round
    expect(viewA.yourPersonId).not.toBe(s.identity.B);
    expect(viewA.remainingPersonIds.length).toBe(PEOPLE.length); // nothing eliminated yet
  });

  it("both players agree on whose turn it is; only the turn-holder may act", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const viewFirst = mod.sanitizeFor(s, pid(first), ctx);
    const viewSecond = mod.sanitizeFor(s, pid(other(first)), ctx);
    expect(viewFirst.turn).toBe(first);
    expect(viewSecond.turn).toBe(first);
    expect(viewFirst.isYourTurn).toBe(true);
    expect(viewSecond.isYourTurn).toBe(false);
    // The player who is NOT on turn is offered no questions and cannot ask.
    expect(viewSecond.availableQuestions).toHaveLength(0);
    expect(ask(mod, s, ctx, other(first), "gender", "male").error?.code).toBe("NOT_YOUR_TURN");
  });
});

describe("guess-the-person - asking questions (turn-based)", () => {
  it("records a truthful answer, narrows candidates, and passes the turn", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const target = PEOPLE.find((p) => p.id === targetOf(s, first))!;
    const r = ask(mod, s, ctx, first, "gender", "male");
    expect(r.error).toBeUndefined();
    const asked = r.state.asked[first];
    expect(asked).toHaveLength(1);
    expect(asked[0]!.answer).toBe(target.gender === "male");
    expect(r.state.turn).toBe(other(first)); // one action, then the turn passes
    const view = mod.sanitizeFor(r.state, pid(first), ctx);
    expect(view.remainingPersonIds).toContain(target.id); // target never eliminated
  });

  it("rejects a duplicate question and a closed-section (binary) re-ask on your turn", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    // first asks (turn -> second), second asks (turn -> first) so it's first's turn again.
    const r1 = ask(mod, s, ctx, first, "gender", "male");
    expect(r1.error).toBeUndefined();
    const r2 = ask(mod, r1.state, ctx, second, "skinTone", "olive");
    expect(r2.error).toBeUndefined();
    expect(r2.state.turn).toBe(first);
    // Same value again → duplicate.
    expect(ask(mod, r2.state, ctx, first, "gender", "male").error?.code).toBe("INVALID_ACTION");
    // Other value in a binary section → section already closed.
    expect(ask(mod, r2.state, ctx, first, "gender", "female").error?.code).toBe("INVALID_ACTION");
  });

  it("rejects an out-of-domain question value", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    expect(ask(mod, s, ctx, first, "eyeColor", "purple").error?.code).toBe("INVALID_ACTION");
  });

  it("does not offer questions once the player has guessed", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const guessed = guess(mod, s, ctx, first, wrongFor(s, first));
    const view = mod.sanitizeFor(guessed.state, pid(first), ctx);
    expect(view.yourGuess).not.toBeNull();
    expect(view.availableQuestions).toHaveLength(0);
    // Any further ask by that player is rejected (they never regain the turn).
    expect(ask(mod, guessed.state, ctx, first, "skinTone", "olive").error).toBeDefined();
  });
});

describe("guess-the-person - finishing when solved (guess-in-turn)", () => {
  it("a question that leaves ONE candidate keeps the turn and marks the view solved", () => {
    const { mod, ctx, state } = setup();
    const s0 = play(mod, state, ctx);
    const first = s0.turn;
    // A real ask-path: narrow `first` to exactly one candidate. We reproduce a
    // solved fixture the same way the reducer would, then assert the invariants.
    const s = forceSolved(s0, first);
    const view = mod.sanitizeFor(s, pid(first), ctx);
    expect(view.remainingPersonIds).toEqual([targetOf(s, first)]);
    expect(view.solved).toBe(true);
    expect(view.isYourTurn).toBe(true); // the turn stayed with the solver
    // Questions are closed once solved - no more asking.
    expect(view.availableQuestions).toHaveLength(0);
  });

  it("rejects asking once solved (only guess or pass remain)", () => {
    const { mod, ctx, state } = setup();
    const s = forceSolved(play(mod, state, ctx), "A");
    const first = s.turn; // forceSolved set turn to A
    expect(first).toBe("A");
    // Every question value is now rejected - the board is solved.
    for (const meta of QUESTION_SECTIONS) {
      for (const v of meta.values) {
        const r = ask(mod, s, ctx, first, meta.section, v.value);
        expect(r.error?.code).toBe("INVALID_ACTION");
      }
    }
  });

  it("lets the solver guess the sure thing immediately, in the same turn", () => {
    const { mod, ctx, state } = setup();
    const s = forceSolved(play(mod, state, ctx), "A");
    const g = guess(mod, s, ctx, "A", targetOf(s, "A"));
    expect(g.error).toBeUndefined();
    expect(g.state.guess.A).toEqual({ personId: targetOf(s, "A"), correct: true });
    // Round isn't over yet - it locks B into their one final guess.
    expect(g.state.roundOver).toBe(false);
    expect(g.state.turn).toBe("B");
    expect(mod.sanitizeFor(g.state, PB, ctx).mustGuess).toBe(true);
  });

  it("pass ends the solver's turn without guessing (turn hands over)", () => {
    const { mod, ctx, state } = setup();
    const s = forceSolved(play(mod, state, ctx), "A");
    const p = pass(mod, s, ctx, "A");
    expect(p.error).toBeUndefined();
    expect(p.state.turn).toBe("B");
    expect(p.state.guess.A).toBeNull(); // no guess committed
    // A can still come back and guess later (their one guess is intact).
    expect(p.state.asked.A.length).toBeGreaterThan(0);
  });

  it("rejects pass when NOT solved (must ask or guess - can't stall)", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    // Fresh board: 30 candidates, nothing solved. Passing is illegal.
    expect(pass(mod, s, ctx, first).error?.code).toBe("INVALID_ACTION");
  });

  it("rejects pass out of turn and while it's the opponent's move", () => {
    const { mod, ctx, state } = setup();
    const s = forceSolved(play(mod, state, ctx), "A");
    // B is not on turn; even a stray pass from B is rejected.
    expect(pass(mod, s, ctx, "B").error?.code).toBe("NOT_YOUR_TURN");
  });

  it("a solved player forced to guess (opponent locked them in) still can't pass", () => {
    const { mod, ctx, state } = setup();
    const s = forceSolved(play(mod, state, ctx), "A");
    // B guesses first (wrong is fine), locking A. A is solved AND locked: the only
    // move is the forced final guess - pass must not offer an escape.
    const bGuess = guess(mod, { ...s, turn: "B" }, ctx, "B", wrongFor(s, "B"));
    expect(bGuess.error).toBeUndefined();
    expect(bGuess.state.turn).toBe("A");
    expect(pass(mod, bGuess.state, ctx, "A").error?.code).toBe("INVALID_ACTION");
    expect(mod.sanitizeFor(bGuess.state, PA, ctx).mustGuess).toBe(true);
  });

  it("rejects pass once BOTH players have solved (no infinite pass livelock)", () => {
    const { mod, ctx, state } = setup();
    // Drive both seats into the solved state, then put the turn on A.
    const s = forceSolved(forceSolved(play(mod, state, ctx), "A"), "B");
    s.turn = "A";
    // Both are down to one candidate; neither has guessed. If A could pass to B and
    // B could pass back, the round would never resolve. So pass is now rejected -
    // the player on the move must take their guaranteed guess.
    expect(pass(mod, s, ctx, "A").error?.code).toBe("INVALID_ACTION");
    // The guaranteed guess is still available and resolves toward round-end.
    const g = guess(mod, s, ctx, "A", targetOf(s, "A"));
    expect(g.error).toBeUndefined();
    expect(g.state.guess.A).toEqual({ personId: targetOf(s, "A"), correct: true });
  });

  it("still allows pass when only YOU have solved (opponent still searching)", () => {
    const { mod, ctx, state } = setup();
    // Only A is solved; B is on a fresh board. Deferring is legitimate here.
    const s = forceSolved(play(mod, state, ctx), "A");
    expect(mod.sanitizeFor(s, PA, ctx).opponentSolved).toBe(false);
    const p = pass(mod, s, ctx, "A");
    expect(p.error).toBeUndefined();
    expect(p.state.turn).toBe("B");
  });

  it("view exposes opponentSolved (progress only) when the opponent has narrowed to one", () => {
    const { mod, ctx, state } = setup();
    const s = forceSolved(forceSolved(play(mod, state, ctx), "A"), "B");
    // Each side sees that the OTHER has solved - but never their identity/target.
    const viewA = mod.sanitizeFor(s, PA, ctx);
    const viewB = mod.sanitizeFor(s, PB, ctx);
    expect(viewA.opponentSolved).toBe(true);
    expect(viewB.opponentSolved).toBe(true);
    // No leak: the opponent's identity stays hidden mid-round.
    expect(viewA.revealedOpponentPersonId).toBeNull();
    expect(viewB.revealedOpponentPersonId).toBeNull();
  });
});

describe("guess-the-person - guessing, locking, and resolution", () => {
  it("committing ANY guess (even wrong) locks the opponent into their one final guess", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    const r = guess(mod, s, ctx, first, wrongFor(s, first));
    expect(r.error).toBeUndefined();
    expect(r.state.guess[first]).toEqual({ personId: wrongFor(s, first), correct: false });
    expect(r.state.roundOver).toBe(false);
    expect(r.state.turn).toBe(second); // turn passes to the forced guesser
    const viewSecond = mod.sanitizeFor(r.state, pid(second), ctx);
    expect(viewSecond.mustGuess).toBe(true);
    expect(viewSecond.opponentGuessed).toBe(true);
    // We must NOT leak whether the opponent's guess was correct - the forced
    // final guess has to stay a genuine guess.
    expect((viewSecond as unknown as Record<string, unknown>).opponentGuessedCorrectly).toBeUndefined();
    expect(viewSecond.availableQuestions).toHaveLength(0);
    // The locked player cannot ask even though it's their turn.
    expect(ask(mod, r.state, ctx, second, "gender", "male").error?.code).toBe("INVALID_ACTION");
  });

  it("rejects a second guess (one chance only) and a guess for an eliminated face", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    // Narrow `first` with a gender question (via a round-trip so it's their turn).
    const a1 = ask(mod, s, ctx, first, "gender", "male");
    const a2 = ask(mod, a1.state, ctx, second, "skinTone", "white");
    const remaining = mod.sanitizeFor(a2.state, pid(first), ctx).remainingPersonIds;
    const eliminated = PEOPLE.find((p) => !remaining.includes(p.id));
    if (eliminated) {
      expect(guess(mod, a2.state, ctx, first, eliminated.id).error?.code).toBe("INVALID_ACTION");
    }
    // A wrong guess that is STILL a remaining candidate.
    const wrongButLive = remaining.find((id) => id !== targetOf(s, first))!;
    const g = guess(mod, a2.state, ctx, first, wrongButLive);
    expect(g.error).toBeUndefined();
    // Second guess by the same seat rejected (already spent their one chance).
    expect(guess(mod, g.state, ctx, first, targetOf(s, first)).error?.code).toBe("INVALID_ACTION");
  });

  it("a correct guess LOCKS the opponent into their one final guess", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    const r = guess(mod, s, ctx, first, targetOf(s, first));
    expect(r.error).toBeUndefined();
    expect(r.state.guess[first]).toEqual({ personId: targetOf(s, first), correct: true });
    expect(r.state.roundOver).toBe(false); // round waits for the forced guess
    expect(r.state.turn).toBe(second);
    const viewSecond = mod.sanitizeFor(r.state, pid(second), ctx);
    expect(viewSecond.mustGuess).toBe(true);
    expect(viewSecond.availableQuestions).toHaveLength(0);
    // Locked → can't ask, only guess.
    expect(ask(mod, r.state, ctx, second, "gender", "male").error?.code).toBe("INVALID_ACTION");
  });

  it("both correct with EQUAL question counts → draw (no score), reveals identities + counts", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    const rA = guess(mod, s, ctx, first, targetOf(s, first));
    const rB = guess(mod, rA.state, ctx, second, targetOf(s, second));
    expect(rB.state.roundOver).toBe(true);
    expect(rB.state.roundWinnerSeat).toBe("tie"); // 0 == 0 questions asked
    expect(rB.state.scores).toEqual({ A: 0, B: 0 });
    expect(rB.events?.some((e) => e.kind === "round_over")).toBe(true);
    // Identities + question counts are revealed to both once the round is over.
    expect(mod.sanitizeFor(rB.state, PA, ctx).revealedOpponentPersonId).toBe(s.identity.B);
    expect(mod.sanitizeFor(rB.state, PB, ctx).revealedOpponentPersonId).toBe(s.identity.A);
    expect(mod.sanitizeFor(rB.state, PA, ctx).questionCounts).toEqual({ A: 0, B: 0 });
  });

  it("both correct → the seat that asked FEWER questions wins the round", () => {
    const { mod, ctx, state } = setup();
    const s0 = play(mod, state, ctx);
    const first = s0.turn;
    const second = other(first);
    // Alternate asks so `first` ends up with 2 questions and `second` with 1,
    // then both guess correctly. Fewer questions (second) wins.
    let s = ask(mod, s0, ctx, first, "accessories", "hat").state; // first: 1 → second
    s = ask(mod, s, ctx, second, "accessories", "hat").state; // second: 1 → first
    s = ask(mod, s, ctx, first, "accessories", "glasses").state; // first: 2 → second
    s = guess(mod, s, ctx, second, targetOf(s, second)).state; // second correct → first (locked)
    const done = guess(mod, s, ctx, first, targetOf(s, first));
    expect(done.state.roundOver).toBe(true);
    expect(done.state.asked[first].length).toBe(2);
    expect(done.state.asked[second].length).toBe(1);
    expect(done.state.roundWinnerSeat).toBe(second);
    expect(done.state.scores[second]).toBe(1);
    expect(done.state.scores[first]).toBe(0);
    expect(mod.sanitizeFor(done.state, pid(first), ctx).questionCounts).toEqual({
      A: done.state.asked.A.length,
      B: done.state.asked.B.length,
    });
  });

  it("exactly one correct → that player wins the round (+1)", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    const rA = guess(mod, s, ctx, first, targetOf(s, first));
    const rB = guess(mod, rA.state, ctx, second, wrongFor(s, second));
    expect(rB.state.roundOver).toBe(true);
    expect(rB.state.roundWinnerSeat).toBe(first);
    expect(rB.state.scores[first]).toBe(1);
    expect(rB.state.scores[second]).toBe(0);
  });

  it("both wrong → draw, no score", () => {
    const { mod, ctx, state } = setup();
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    const rA = guess(mod, s, ctx, first, wrongFor(s, first));
    const rB = guess(mod, rA.state, ctx, second, wrongFor(s, second));
    expect(rB.state.roundOver).toBe(true);
    expect(rB.state.roundWinnerSeat).toBe("tie");
    expect(rB.state.scores).toEqual({ A: 0, B: 0 });
  });
});

describe("guess-the-person - match end + between rounds", () => {
  it("best-of-1: a decisive round ends the match", () => {
    const { mod, ctx, state } = setup(1);
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    const rA = guess(mod, s, ctx, first, targetOf(s, first));
    const rB = guess(mod, rA.state, ctx, second, wrongFor(s, second));
    expect(rB.state.matchWinnerSeat).toBe(first);
    expect(rB.events?.some((e) => e.kind === "match_over")).toBe(true);
    expect(mod.phaseOf(rB.state)).toBe("game_over");
  });

  it("best-of-1 draw still ends the match as a tie (rounds exhausted, no score)", () => {
    const { mod, ctx, state } = setup(1);
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    const rA = guess(mod, s, ctx, first, wrongFor(s, first));
    const rB = guess(mod, rA.state, ctx, second, wrongFor(s, second));
    expect(rB.state.roundWinnerSeat).toBe("tie");
    expect(rB.state.matchWinnerSeat).toBe("tie");
    expect(rB.events?.some((e) => e.kind === "match_over")).toBe(true);
  });

  it("advances to the next round only after both ready, re-entering selection + flipping the first turn", () => {
    const { mod, ctx, state } = setup(3);
    const s = play(mod, state, ctx);
    const first = s.turn;
    const second = other(first);
    const rA = guess(mod, s, ctx, first, targetOf(s, first));
    const rB = guess(mod, rA.state, ctx, second, wrongFor(s, second));
    expect(rB.state.roundOver).toBe(true);
    const aReady = mod.reduce(rB.state, { type: "next_round" }, PA, ctx);
    expect(aReady.state.roundNumber).toBe(1); // still waiting on the other
    const bReady = mod.reduce(aReady.state, { type: "next_round" }, PB, ctx);
    expect(bReady.state.roundNumber).toBe(2);
    expect(bReady.state.roundOver).toBe(false);
    expect(bReady.state.guess).toEqual({ A: null, B: null });
    expect(bReady.state.asked).toEqual({ A: [], B: [] });
    // A fresh round re-opens the selection phase.
    expect(bReady.state.identity).toEqual({ A: null, B: null });
    expect(mod.sanitizeFor(bReady.state, PA, ctx).selecting).toBe(true);
    // The opening move rotates: round 2 is opened by the other seat.
    expect(bReady.state.turn).toBe(second);
  });

  it("rejects next_round before the round is over", () => {
    const { mod, ctx, state } = setup();
    expect(mod.reduce(state, { type: "next_round" }, PA, ctx).error?.code).toBe("INVALID_ACTION");
  });
});

describe("guess-the-person - determinism + validation", () => {
  it("same matchEpoch replays the identical opening turn and starts in selection (reconnect-safe)", () => {
    const mod = createGuessWhoModule({ bestOf: 3 });
    const a = mod.createInitialState(ctxWith({ A: PA, B: PB }, 2));
    const b = mod.createInitialState(ctxWith({ A: PA, B: PB }, 2));
    expect(a.turn).toBe(b.turn); // same seeded opening turn
    expect(a.identity).toEqual({ A: null, B: null }); // identities are player-chosen, not seeded
    expect(b.identity).toEqual({ A: null, B: null });
  });

  it("the opening turn alternates each round from a stable seed", () => {
    const mod = createGuessWhoModule({ bestOf: 3 });
    const ctx = ctxWith({ A: PA, B: PB }, 0);
    const s1 = mod.createInitialState(ctx);
    // Play round 1 to a decisive end, then advance.
    const first = s1.turn;
    const second = first === "A" ? "B" : "A";
    const played = play(mod, s1, ctx);
    const rA = mod.reduce(played, { type: "guess", payload: { personId: targetOf(played, first) } }, pid(first), ctx);
    const rB = mod.reduce(rA.state, { type: "guess", payload: { personId: wrongFor(played, second) } }, pid(second), ctx);
    // Not match-over at bestOf 3 after one decisive round; advance both.
    const n1 = mod.reduce(rB.state, { type: "next_round" }, PA, ctx);
    const n2 = mod.reduce(n1.state, { type: "next_round" }, PB, ctx);
    expect(n2.state.turn).toBe(second); // flipped
  });

  it("isValidAction guards the action union", () => {
    const { mod } = setup();
    expect(mod.isValidAction({ type: "choose", payload: { personId: "maya" } })).toBe(true);
    expect(mod.isValidAction({ type: "ask", payload: { section: "gender", value: "male" } })).toBe(true);
    expect(mod.isValidAction({ type: "guess", payload: { personId: "maya" } })).toBe(true);
    expect(mod.isValidAction({ type: "next_round" })).toBe(true);
    expect(mod.isValidAction({ type: "bogus" })).toBe(false);
    expect(mod.isValidAction(null)).toBe(false);
    expect(mod.isValidAction("ask")).toBe(false);
  });

  it("rejects any action from a seatless player", () => {
    const { mod, state } = setup();
    const ctx = ctxWith({ A: PA, B: PB });
    const r = mod.reduce(state, { type: "choose", payload: { personId: "maya" } }, "ghost", ctx);
    expect(r.error?.code).toBe("NOT_IN_ROOM");
  });
});
