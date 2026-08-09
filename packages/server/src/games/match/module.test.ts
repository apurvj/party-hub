import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_CONFIG,
  type GameContext,
  type GameEvent,
  type MatchConfig,
  type Seat,
  type Sex,
} from "@party-hub/shared";
import { createMatchModule, type MatchState } from "./module.js";

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

/**
 * Spin up a Match module. By default both bodies are declared (so the state
 * lands in "voting" with a built deck); pass `declare: null` to inspect the raw
 * "setup" stage, or a [sexA, sexB] pair to exercise the couple-body filter.
 */
function setup(
  config: Partial<MatchConfig> = {},
  declare: [Sex, Sex] | null = ["female", "male"],
) {
  const mod = createMatchModule({ ...DEFAULT_MATCH_CONFIG, ...config });
  const ctx = ctxWith({ A: PA, B: PB });
  const state = mod.createInitialState(ctx) as MatchState;
  if (declare) {
    mod.reduce(state, { type: "set_sex", payload: { sex: declare[0] } }, PA, ctx);
    mod.reduce(state, { type: "set_sex", payload: { sex: declare[1] } }, PB, ctx);
  }
  return { mod, ctx, state };
}

/** Vote a whole deck for one seat with a chooser fn, returning the LAST vote's
 *  emitted events (empty if that reduce rejected - the accepted branch only). */
function voteAll(
  mod: ReturnType<typeof createMatchModule>,
  state: MatchState,
  ctx: GameContext,
  player: string,
  choose: (cardId: string, i: number) => "yes" | "maybe" | "no",
): GameEvent[] {
  let lastEvents: GameEvent[] = [];
  state.deck.forEach((card, i) => {
    const r = mod.reduce(state, { type: "vote", payload: { cardId: card.id, vote: choose(card.id, i) } }, player, ctx);
    lastEvents = "error" in r ? [] : (r.events ?? []);
  });
  return lastEvents;
}

describe("Match - setup / bodies", () => {
  it("starts in setup with an empty deck until both declare", () => {
    const { mod, ctx, state } = setup({}, null);
    expect(state.stage).toBe("setup");
    expect(state.deck).toEqual([]);
    // No voting during setup (no deck yet).
    expect(
      mod.reduce(state, { type: "vote", payload: { cardId: "x", vote: "yes" } }, PA, ctx).error?.code,
    ).toBe("GAME_NOT_ACTIVE");
  });

  it("builds the deck + enters voting once both declare", () => {
    const { mod, ctx, state } = setup({}, null);
    mod.reduce(state, { type: "set_sex", payload: { sex: "female" } }, PA, ctx);
    expect(state.stage).toBe("setup"); // still waiting on B
    expect(state.deck).toEqual([]);
    mod.reduce(state, { type: "set_sex", payload: { sex: "male" } }, PB, ctx);
    expect(state.stage).toBe("voting");
    expect(state.deck.length).toBeGreaterThan(0);
  });

  it("a same-sex couple gets that body's cards, never the other's or mixed", () => {
    const { state } = setup({ deckSize: 60 }, ["female", "female"]);
    expect(state.deck.some((c) => c.requires === "male")).toBe(false);
    expect(state.deck.some((c) => c.requires === "mixed")).toBe(false);
    expect(state.deck.some((c) => c.requires === "female")).toBe(true);
  });

  it("a mixed couple gets mixed + neutral cards, never single-body-only ones", () => {
    const { state } = setup({ deckSize: 60 }, ["female", "male"]);
    expect(state.deck.some((c) => c.requires === "female")).toBe(false);
    expect(state.deck.some((c) => c.requires === "male")).toBe(false);
    expect(state.deck.some((c) => c.requires === "mixed")).toBe(true);
  });

  it("rejects a repeat / invalid / too-late set_sex", () => {
    const { mod, ctx, state } = setup({}, null);
    mod.reduce(state, { type: "set_sex", payload: { sex: "female" } }, PA, ctx);
    expect(
      mod.reduce(state, { type: "set_sex", payload: { sex: "male" } }, PA, ctx).error?.code,
    ).toBe("INVALID_ACTION");
    expect(
      mod.reduce(state, { type: "set_sex", payload: { sex: "nope" as never } }, PB, ctx).error?.code,
    ).toBe("INVALID_ACTION");
    mod.reduce(state, { type: "set_sex", payload: { sex: "male" } }, PB, ctx);
    expect(state.stage).toBe("voting");
    expect(
      mod.reduce(state, { type: "set_sex", payload: { sex: "female" } }, PA, ctx).error?.code,
    ).toBe("INVALID_ACTION");
  });

  it("exposes yourSex + opponentSexSet without leaking the peer's body", () => {
    const { mod, ctx, state } = setup({}, null);
    mod.reduce(state, { type: "set_sex", payload: { sex: "female" } }, PA, ctx);
    const va = mod.sanitizeFor(state, PA, ctx);
    expect(va.yourSex).toBe("female");
    expect(va.opponentSexSet).toBe(false);
    const vb = mod.sanitizeFor(state, PB, ctx);
    expect(vb.yourSex).toBeNull();
    expect(vb.opponentSexSet).toBe(true);
    // The sanitized view carries only a boolean for the peer, not their body.
    expect(JSON.stringify(vb)).not.toContain('"opponentSex"');
  });

  it("bodies persist into the next round (declare once per match)", () => {
    // Full deck so the round-2 slice is guaranteed to surface a female-only card.
    const { mod, ctx, state } = setup({ deckSize: 60 }, ["female", "female"]);
    voteAllMutual(mod, state, ctx);
    playOutDares(mod, state, ctx);
    expect(state.stage).toBe("summary");
    mod.reduce(state, { type: "next_round" }, PA, ctx);
    mod.reduce(state, { type: "next_round" }, PB, ctx);
    // Straight back to voting - no re-declaring bodies within a match.
    expect(state.stage).toBe("voting");
    expect(state.sexes).toEqual({ A: "female", B: "female" });
    // Filter still applies in round 2: female cards present, never male/mixed.
    expect(state.deck.some((c) => c.requires === "female")).toBe(true);
    expect(state.deck.some((c) => c.requires === "male" || c.requires === "mixed")).toBe(false);
  });
});

describe("Match - deterministic deck", () => {
  it("builds the same deck for the same room/epoch/round", () => {
    const a = setup();
    const b = setup();
    expect(a.state.deck.map((c) => c.id)).toEqual(b.state.deck.map((c) => c.id));
  });

  it("clamps deck size into range and never exceeds the pool", () => {
    const { state } = setup({ deckSize: 999 });
    // Whole default pool is finite; deck can't exceed it.
    expect(state.deck.length).toBeGreaterThan(0);
    expect(state.deck.length).toBeLessThanOrEqual(62);
  });

  it("only includes cards from the selected tiers", () => {
    const { state } = setup({ tiers: ["sweet"], deckSize: 60 });
    expect(state.deck.every((c) => c.tier === "sweet")).toBe(true);
  });

  it("excludes media cards when allowMedia is false", () => {
    const { state } = setup({ allowMedia: false, deckSize: 60 });
    expect(state.deck.some((c) => c.media)).toBe(false);
  });
});

describe("Match - PRIVACY INVARIANT (the whole point)", () => {
  it("never exposes the opponent's individual votes - only a count", () => {
    const { mod, ctx, state } = setup({ deckSize: 6 });
    // B votes a distinctive pattern; none of these values may surface to A.
    voteAll(mod, state, ctx, PB, (_id, i) => (i % 2 === 0 ? "yes" : "no"));

    const viewA = mod.sanitizeFor(state, PA, ctx);
    const serialized = JSON.stringify(viewA);

    // A sees only a COUNT of the opponent's progress.
    expect(viewA.opponentVotedCount).toBe(6);
    // The word "opponent" appears only as a count field - no votes array leaks.
    expect(serialized).not.toContain('"opponentVotes"');
    // A hasn't voted, so no matches are revealed and A's own votes are empty.
    expect(viewA.yourVotes).toEqual([]);
    expect(viewA.matches).toEqual([]);
    // Structurally: the sanitized view has no key holding B's raw votes.
    expect(Object.keys(viewA)).not.toContain("votes");
  });

  it("reveals a card ONLY when both said yes (mutual match)", () => {
    const { mod, ctx, state } = setup({ deckSize: 4 });
    const [c0, c1] = state.deck;

    // A: yes on both. B: yes only on c0, no on c1.
    mod.reduce(state, { type: "vote", payload: { cardId: c0!.id, vote: "yes" } }, PA, ctx);
    mod.reduce(state, { type: "vote", payload: { cardId: c1!.id, vote: "yes" } }, PA, ctx);
    mod.reduce(state, { type: "vote", payload: { cardId: c0!.id, vote: "yes" } }, PB, ctx);
    mod.reduce(state, { type: "vote", payload: { cardId: c1!.id, vote: "no" } }, PB, ctx);

    const ids = mod.sanitizeFor(state, PA, ctx).matches.map((m) => m.card.id);
    expect(ids).toContain(c0!.id); // both yes → revealed
    expect(ids).not.toContain(c1!.id); // A yes, B no → hidden
  });

  it("a one-sided yes is never revealed to either player", () => {
    const { mod, ctx, state } = setup({ deckSize: 4 });
    const c0 = state.deck[0]!;
    mod.reduce(state, { type: "vote", payload: { cardId: c0.id, vote: "yes" } }, PA, ctx);
    mod.reduce(state, { type: "vote", payload: { cardId: c0.id, vote: "maybe" } }, PB, ctx);

    expect(mod.sanitizeFor(state, PA, ctx).matches).toEqual([]);
    expect(mod.sanitizeFor(state, PB, ctx).matches).toEqual([]);
  });

  it("a seatless viewer gets no votes at all", () => {
    const { mod, state } = setup({ deckSize: 4 });
    const seatless = ctxWith({ A: PA, B: PB });
    const view = mod.sanitizeFor(state, "stranger", { ...seatless, seatOf: () => null });
    expect(view.yourVotes).toEqual([]);
    expect(view.opponentVotedCount).toBe(0);
    expect(view.currentCard).toBeNull();
  });

  it("never leaks a card's `requires` anatomy tag to the client", () => {
    // A female+female couple's deck is FILTERED to female/neutral cards, so if
    // `requires` shipped, a peer could read it off the deck and infer the bodies.
    // Full deck + all-yes → cards surface through currentCard, matches, and dares.
    const { mod, ctx, state } = setup({ deckSize: 60 }, ["female", "female"]);
    // Deck genuinely contains a body-specific card (else the test proves nothing).
    expect(state.deck.some((c) => c.requires === "female")).toBe(true);

    // Mid-voting: currentCard is exposed.
    const voting = mod.sanitizeFor(state, PA, ctx);
    expect(voting.currentCard).not.toBeNull();
    expect(JSON.stringify(voting)).not.toContain('"requires"');

    // Through the dares play-out: matches + dares carry full cards.
    voteAllMutual(mod, state, ctx);
    expect(state.stage).toBe("dares");
    const dares = mod.sanitizeFor(state, PA, ctx);
    expect(dares.matches.length).toBeGreaterThan(0);
    expect(dares.dares.length).toBeGreaterThan(0);
    expect(JSON.stringify(dares)).not.toContain('"requires"');
    // The seatless view (which ships matches + dares too) is equally clean.
    const seatless = mod.sanitizeFor(state, "stranger", { ...ctx, seatOf: () => null });
    expect(JSON.stringify(seatless)).not.toContain('"requires"');
  });
});

describe("Match - voting rules", () => {
  it("rejects a second vote on the same card", () => {
    const { mod, ctx, state } = setup();
    const c0 = state.deck[0]!;
    expect(mod.reduce(state, { type: "vote", payload: { cardId: c0.id, vote: "yes" } }, PA, ctx).error).toBeUndefined();
    const dup = mod.reduce(state, { type: "vote", payload: { cardId: c0.id, vote: "no" } }, PA, ctx);
    expect(dup.error?.code).toBe("INVALID_ACTION");
  });

  it("rejects a vote for an unknown card", () => {
    const { mod, ctx, state } = setup();
    const r = mod.reduce(state, { type: "vote", payload: { cardId: "nope", vote: "yes" } }, PA, ctx);
    expect(r.error?.code).toBe("INVALID_ACTION");
  });

  it("rejects an invalid vote value", () => {
    const { mod, ctx, state } = setup();
    const c0 = state.deck[0]!;
    const r = mod.reduce(state, { type: "vote", payload: { cardId: c0.id, vote: "love" as never } }, PA, ctx);
    expect(r.error?.code).toBe("INVALID_ACTION");
  });

  it("advances currentCard past cards already voted, in deck order", () => {
    const { mod, ctx, state } = setup({ deckSize: 4 });
    const c0 = state.deck[0]!;
    expect(mod.sanitizeFor(state, PA, ctx).currentCard?.id).toBe(c0.id);
    mod.reduce(state, { type: "vote", payload: { cardId: c0.id, vote: "no" } }, PA, ctx);
    expect(mod.sanitizeFor(state, PA, ctx).currentCard?.id).toBe(state.deck[1]!.id);
  });
});

/** Both partners vote yes on the whole deck → every card becomes a mutual match. */
function voteAllMutual(
  mod: ReturnType<typeof createMatchModule>,
  state: MatchState,
  ctx: GameContext,
) {
  voteAll(mod, state, ctx, PA, () => "yes");
  voteAll(mod, state, ctx, PB, () => "yes");
}

/** Perform every pending dare in order (each performer marks their own done). */
function playOutDares(mod: ReturnType<typeof createMatchModule>, state: MatchState, ctx: GameContext) {
  let guard = 0;
  while (state.stage === "dares" && guard++ < 200) {
    const performer = state.dares[state.currentDareIndex]!.performerSeat === "A" ? PA : PB;
    mod.reduce(state, { type: "dare_advance", payload: { outcome: "done" } }, performer, ctx);
  }
}

describe("Match - round lifecycle", () => {
  it("enters the DARES stage (not round_over) once BOTH finish the deck", () => {
    const { mod, ctx, state } = setup({ deckSize: 3 });
    voteAll(mod, state, ctx, PA, () => "yes");
    // A finished, B hasn't → still voting, phase still in_game.
    expect(state.stage).toBe("voting");
    expect(mod.phaseOf(state)).toBe("in_game");
    expect(mod.sanitizeFor(state, PA, ctx).youFinished).toBe(true);

    voteAll(mod, state, ctx, PB, () => "yes");
    // Both done + matches exist → play-out begins, still in_game (turns to take).
    expect(state.stage).toBe("dares");
    expect(mod.phaseOf(state)).toBe("in_game");
    // Every mutually-yes card is a dare (deckSize clamps up to the 4-card floor).
    expect(state.dares.length).toBe(state.deck.length);
  });

  it("skips straight to summary + round_over when there are no matches", () => {
    const { mod, ctx, state } = setup({ deckSize: 3 });
    voteAll(mod, state, ctx, PA, () => "yes");
    const last = voteAll(mod, state, ctx, PB, () => "no"); // no mutual yes
    expect(state.stage).toBe("summary");
    expect(state.dares).toEqual([]);
    expect(last.some((e) => e.kind === "round_over")).toBe(true);
    expect(mod.phaseOf(state)).toBe("round_over");
  });

  it("next_round is rejected until the summary (dares all played out)", () => {
    const { mod, ctx, state } = setup({ deckSize: 3 });
    expect(mod.reduce(state, { type: "next_round" }, PA, ctx).error?.code).toBe("INVALID_ACTION");
    voteAllMutual(mod, state, ctx);
    // In the dares stage now - next_round still not allowed.
    expect(state.stage).toBe("dares");
    expect(mod.reduce(state, { type: "next_round" }, PA, ctx).error?.code).toBe("INVALID_ACTION");
  });

  it("both-ready starts a fresh deck after the summary", () => {
    const { mod, ctx, state } = setup({ deckSize: 3 });
    voteAllMutual(mod, state, ctx);
    playOutDares(mod, state, ctx);
    expect(state.stage).toBe("summary");

    const before = state.roundNumber;
    mod.reduce(state, { type: "next_round" }, PA, ctx);
    const r = mod.reduce(state, { type: "next_round" }, PB, ctx);
    expect(state.roundNumber).toBe(before + 1);
    expect(r.nextPhase).toBe("in_game");
    expect(state.stage).toBe("voting");
    expect(state.matchedCardIds).toEqual([]); // fresh deck, no matches yet
    expect(state.dares).toEqual([]);
  });
});

describe("Match - dares play-out", () => {
  it("assigns performers alternating across the matched pile", () => {
    const { mod, ctx, state } = setup({ deckSize: 4 });
    voteAllMutual(mod, state, ctx);
    expect(state.stage).toBe("dares");
    // Strict alternation: A,B,A,B or B,A,B,A - never two of the same in a row.
    const seats = state.dares.map((d) => d.performerSeat);
    for (let i = 1; i < seats.length; i++) expect(seats[i]).not.toBe(seats[i - 1]);
  });

  it("only the current performer may advance the dare", () => {
    const { mod, ctx, state } = setup({ deckSize: 3 });
    voteAllMutual(mod, state, ctx);
    const performer = state.dares[0]!.performerSeat;
    const watcher = performer === "A" ? PB : PA;
    // The watcher can't act for the performer.
    expect(mod.reduce(state, { type: "dare_advance", payload: { outcome: "done" } }, watcher, ctx).error?.code).toBe(
      "NOT_YOUR_TURN",
    );
    // The performer can.
    const performerId = performer === "A" ? PA : PB;
    expect(
      mod.reduce(state, { type: "dare_advance", payload: { outcome: "done" } }, performerId, ctx).error,
    ).toBeUndefined();
    expect(state.currentDareIndex).toBe(1);
  });

  it("records each outcome and reaches summary after the last dare", () => {
    const { mod, ctx, state } = setup({ deckSize: 3 });
    voteAllMutual(mod, state, ctx);
    playOutDares(mod, state, ctx);
    expect(state.stage).toBe("summary");
    expect(state.dares.every((d) => d.outcome === "done")).toBe(true);
    expect(mod.phaseOf(state)).toBe("round_over");
  });

  it("exposes yourTurn correctly and hides dare cursor outside the dares stage", () => {
    const { mod, ctx, state } = setup({ deckSize: 2 });
    // During voting there's no dare cursor.
    expect(mod.sanitizeFor(state, PA, ctx).currentDareIndex).toBe(-1);
    expect(mod.sanitizeFor(state, PA, ctx).currentDare).toBeNull();

    voteAllMutual(mod, state, ctx);
    const firstPerformer = state.dares[0]!.performerSeat;
    const pView = mod.sanitizeFor(state, firstPerformer === "A" ? PA : PB, ctx);
    const wView = mod.sanitizeFor(state, firstPerformer === "A" ? PB : PA, ctx);
    expect(pView.yourTurn).toBe(true);
    expect(wView.yourTurn).toBe(false);
    // Both see the same dare text (the card is mutually consented).
    expect(pView.currentDare?.card.id).toBe(wView.currentDare?.card.id);
  });

  it("is deterministic: same room/round rebuilds the identical performer order", () => {
    const a = setup({ deckSize: 4 });
    const b = setup({ deckSize: 4 });
    voteAllMutual(a.mod, a.state, a.ctx);
    voteAllMutual(b.mod, b.state, b.ctx);
    expect(a.state.dares.map((d) => d.performerSeat)).toEqual(b.state.dares.map((d) => d.performerSeat));
  });

  it("rejects dare_advance during voting", () => {
    const { mod, ctx, state } = setup({ deckSize: 3 });
    const r = mod.reduce(state, { type: "dare_advance", payload: { outcome: "done" } }, PA, ctx);
    expect(r.error?.code).toBe("GAME_NOT_ACTIVE");
  });
});

describe("Match - safeword", () => {
  it("ends the session immediately for both, no blame", () => {
    const { mod, ctx, state } = setup();
    const r = mod.reduce(state, { type: "safeword" }, PA, ctx);
    expect(r.events?.some((e) => e.kind === "match_over" && e.winnerSeat === "tie")).toBe(true);
    expect(state.sessionEnded).toBe(true);
    expect(mod.phaseOf(state)).toBe("game_over");
    expect(mod.sanitizeFor(state, PB, ctx).sessionEnded).toBe(true);
  });

  it("blocks further votes and next_round after safeword", () => {
    const { mod, ctx, state } = setup();
    mod.reduce(state, { type: "safeword" }, PA, ctx);
    const c0 = state.deck[0]!;
    expect(mod.reduce(state, { type: "vote", payload: { cardId: c0.id, vote: "yes" } }, PA, ctx).error?.code).toBe(
      "GAME_NOT_ACTIVE",
    );
    expect(mod.reduce(state, { type: "next_round" }, PA, ctx).error?.code).toBe("GAME_NOT_ACTIVE");
  });
});

describe("Match - action validation", () => {
  it("accepts only set_sex / vote / dare_advance / safeword / next_round", () => {
    const { mod } = setup();
    expect(mod.isValidAction({ type: "set_sex" })).toBe(true);
    expect(mod.isValidAction({ type: "vote" })).toBe(true);
    expect(mod.isValidAction({ type: "dare_advance" })).toBe(true);
    expect(mod.isValidAction({ type: "safeword" })).toBe(true);
    expect(mod.isValidAction({ type: "next_round" })).toBe(true);
    expect(mod.isValidAction({ type: "play_card" })).toBe(false);
    expect(mod.isValidAction(null)).toBe(false);
    expect(mod.isValidAction("vote")).toBe(false);
  });
});
