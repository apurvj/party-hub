import { describe, expect, it } from "vitest";
import {
  DEFAULT_DICE_CONFIG,
  type DiceConfig,
  type DiceOutcome,
  type GameContext,
  type Seat,
  type Sex,
} from "@party-hub/shared";
import { createDiceModule, type DiceState } from "./module.js";

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
 * Spin up a Dice module. By default both bodies are declared (so the state lands
 * in "rolling" ready to play); pass `declare: null` to inspect the raw "setup"
 * stage, or a [sexA, sexB] pair to exercise the anatomy filter per seat.
 */
function setup(
  config: Partial<DiceConfig> = {},
  matchEpoch = 0,
  declare: [Sex, Sex] | null = ["female", "female"],
) {
  const mod = createDiceModule({ ...DEFAULT_DICE_CONFIG, ...config });
  const ctx = ctxWith({ A: PA, B: PB }, matchEpoch);
  const state = mod.createInitialState(ctx) as DiceState;
  if (declare) {
    mod.reduce(state, { type: "set_sex", payload: { sex: declare[0] } }, PA, ctx);
    mod.reduce(state, { type: "set_sex", payload: { sex: declare[1] } }, PB, ctx);
  }
  return { mod, ctx, state };
}

/** The playerId whose turn it currently is. */
function turnPlayer(state: DiceState): string {
  return state.turnSeat === "A" ? PA : PB;
}

/** Spin as the current player, then resolve with the given outcome. Returns the
 *  emitted events from the resolve (empty if it rejected). */
function playTurn(
  mod: ReturnType<typeof createDiceModule>,
  state: DiceState,
  ctx: GameContext,
  outcome: DiceOutcome,
) {
  const player = turnPlayer(state);
  mod.reduce(state, { type: "spin" }, player, ctx);
  const r = mod.reduce(state, { type: "resolve", payload: { outcome } }, player, ctx);
  return "error" in r ? [] : (r.events ?? []);
}

describe("Dice - setup / bodies", () => {
  it("starts in setup with empty decks until both declare", () => {
    const { mod, ctx, state } = setup({}, 0, null);
    expect(state.stage).toBe("setup");
    expect(state.decks.A.length).toBe(0);
    expect(state.decks.B.length).toBe(0);
    // No spinning during setup.
    expect(mod.reduce(state, { type: "spin" }, turnPlayer(state), ctx).error?.code).toBe(
      "GAME_NOT_ACTIVE",
    );
  });

  it("builds both decks + enters rolling once both declare", () => {
    const { mod, ctx, state } = setup({}, 0, null);
    mod.reduce(state, { type: "set_sex", payload: { sex: "female" } }, PA, ctx);
    expect(state.stage).toBe("setup"); // still waiting on B
    mod.reduce(state, { type: "set_sex", payload: { sex: "male" } }, PB, ctx);
    expect(state.stage).toBe("rolling");
    expect(state.decks.A.length).toBeGreaterThan(0);
    expect(state.decks.B.length).toBeGreaterThan(0);
  });

  it("deals each seat only dares its own body can perform", () => {
    const { state } = setup({}, 0, ["female", "male"]);
    // Seat A is female: never a male-only card, and includes its female-only dares.
    expect(state.decks.A.some((c) => c.requires === "male")).toBe(false);
    expect(state.decks.A.some((c) => c.requires === "female")).toBe(true);
    // Seat B is male: mirror image.
    expect(state.decks.B.some((c) => c.requires === "female")).toBe(false);
    expect(state.decks.B.some((c) => c.requires === "male")).toBe(true);
  });

  it("rejects a repeat / invalid / too-late set_sex", () => {
    const { mod, ctx, state } = setup({}, 0, null);
    mod.reduce(state, { type: "set_sex", payload: { sex: "female" } }, PA, ctx);
    // Same seat can't declare twice.
    expect(
      mod.reduce(state, { type: "set_sex", payload: { sex: "male" } }, PA, ctx).error?.code,
    ).toBe("INVALID_ACTION");
    // Garbage body is refused.
    expect(
      mod.reduce(state, { type: "set_sex", payload: { sex: "other" as never } }, PB, ctx).error
        ?.code,
    ).toBe("INVALID_ACTION");
    // Finish declaring → rolling, after which set_sex is closed.
    mod.reduce(state, { type: "set_sex", payload: { sex: "male" } }, PB, ctx);
    expect(state.stage).toBe("rolling");
    expect(
      mod.reduce(state, { type: "set_sex", payload: { sex: "female" } }, PA, ctx).error?.code,
    ).toBe("INVALID_ACTION");
  });

  it("exposes yourSex + opponentSexSet without leaking the peer's body", () => {
    const { mod, ctx, state } = setup({}, 0, null);
    mod.reduce(state, { type: "set_sex", payload: { sex: "female" } }, PA, ctx);
    const va = mod.sanitizeFor(state, PA, ctx);
    expect(va.yourSex).toBe("female");
    expect(va.opponentSexSet).toBe(false);
    const vb = mod.sanitizeFor(state, PB, ctx);
    // B hasn't declared: sees own null, but knows A is in.
    expect(vb.yourSex).toBeNull();
    expect(vb.opponentSexSet).toBe(true);
  });
});

describe("Dice - deterministic setup", () => {
  it("builds the same decks + opening seat for the same room/epoch", () => {
    const a = setup();
    const b = setup();
    expect(a.state.decks.A.map((c) => c.id)).toEqual(b.state.decks.A.map((c) => c.id));
    expect(a.state.decks.B.map((c) => c.id)).toEqual(b.state.decks.B.map((c) => c.id));
    expect(a.state.turnSeat).toBe(b.state.turnSeat);
  });

  it("only includes cards from the selected categories", () => {
    const { state } = setup({ categories: ["anal"] });
    expect(state.decks.A.length).toBeGreaterThan(0);
    expect(state.decks.A.every((c) => c.category === "anal")).toBe(true);
  });

  it("excludes media cards when allowMedia is false", () => {
    const { state } = setup({ allowMedia: false });
    expect(state.decks.A.some((c) => c.media)).toBe(false);
  });

  it("clamps the target score into range", () => {
    expect(setup({ targetScore: 1 }).state.config.targetScore).toBe(3);
    expect(setup({ targetScore: 999 }).state.config.targetScore).toBe(30);
  });

  it("a rematch (new epoch) reshuffles to a different deck", () => {
    const a = setup({}, 0);
    const b = setup({}, 1);
    expect(a.state.decks.A.map((c) => c.id)).not.toEqual(b.state.decks.A.map((c) => c.id));
  });
});

describe("Dice - turn flow", () => {
  it("spin draws a dare + heat die and enters the resolving stage", () => {
    const { mod, ctx, state } = setup();
    expect(state.stage).toBe("rolling");
    const player = turnPlayer(state);
    mod.reduce(state, { type: "spin" }, player, ctx);
    expect(state.stage).toBe("resolving");
    expect(state.current).not.toBeNull();
    expect(state.current!.performerSeat).toBe(state.turnSeat);
    expect(state.current!.face.value).toBeGreaterThanOrEqual(1);
    expect(state.current!.face.value).toBeLessThanOrEqual(6);
  });

  it("only the player whose turn it is may spin", () => {
    const { mod, ctx, state } = setup();
    const offTurn = state.turnSeat === "A" ? PB : PA;
    const r = mod.reduce(state, { type: "spin" }, offTurn, ctx);
    expect(r.error?.code).toBe("NOT_YOUR_TURN");
  });

  it("rejects resolve before a spin", () => {
    const { mod, ctx, state } = setup();
    const r = mod.reduce(state, { type: "resolve", payload: { outcome: "done" } }, turnPlayer(state), ctx);
    expect(r.error?.code).toBe("GAME_NOT_ACTIVE");
  });

  it("rejects a second spin while a dare is on the table", () => {
    const { mod, ctx, state } = setup();
    const player = turnPlayer(state);
    mod.reduce(state, { type: "spin" }, player, ctx);
    const r = mod.reduce(state, { type: "spin" }, player, ctx);
    expect(r.error?.code).toBe("GAME_NOT_ACTIVE");
  });

  it("only the performer can resolve the dare", () => {
    const { mod, ctx, state } = setup();
    const player = turnPlayer(state);
    mod.reduce(state, { type: "spin" }, player, ctx);
    const watcher = state.turnSeat === "A" ? PB : PA;
    const r = mod.reduce(state, { type: "resolve", payload: { outcome: "done" } }, watcher, ctx);
    expect(r.error?.code).toBe("NOT_YOUR_TURN");
  });

  it("done banks the die's points; resolving passes the turn to the other seat", () => {
    const { mod, ctx, state } = setup({ targetScore: 30 });
    const firstSeat = state.turnSeat;
    const player = turnPlayer(state);
    mod.reduce(state, { type: "spin" }, player, ctx);
    const pts = state.current!.face.points;
    mod.reduce(state, { type: "resolve", payload: { outcome: "done" } }, player, ctx);
    expect(state.scores[firstSeat]).toBe(pts);
    expect(state.turnSeat).toBe(firstSeat === "A" ? "B" : "A");
    expect(state.turnNumber).toBe(2);
    expect(state.stage).toBe("rolling");
    expect(state.history.length).toBe(1);
    expect(state.history[0]!.outcome).toBe("done");
  });

  it("pass scores nothing but still records history + passes the turn", () => {
    const { mod, ctx, state } = setup({ targetScore: 30 });
    const firstSeat = state.turnSeat;
    const player = turnPlayer(state);
    mod.reduce(state, { type: "spin" }, player, ctx);
    mod.reduce(state, { type: "resolve", payload: { outcome: "pass" } }, player, ctx);
    expect(state.scores[firstSeat]).toBe(0);
    expect(state.history[0]!.outcome).toBe("pass");
    expect(state.history[0]!.scored).toBe(0);
    expect(state.turnSeat).toBe(firstSeat === "A" ? "B" : "A");
  });

  it("rejects an invalid resolve outcome", () => {
    const { mod, ctx, state } = setup();
    const player = turnPlayer(state);
    mod.reduce(state, { type: "spin" }, player, ctx);
    const r = mod.reduce(state, { type: "resolve", payload: { outcome: "meh" as never } }, player, ctx);
    expect(r.error?.code).toBe("INVALID_ACTION");
  });
});

describe("Dice - winning the set", () => {
  it("first to the target score wins + emits match_over, and phase is game_over", () => {
    const { mod, ctx, state } = setup({ targetScore: 3, categories: ["climax"] });
    let lastEvents: ReturnType<typeof playTurn> = [];
    let guard = 0;
    while (state.stage !== "over" && guard++ < 100) {
      lastEvents = playTurn(mod, state, ctx, "done");
    }
    expect(state.stage).toBe("over");
    expect(state.winnerSeat).not.toBeNull();
    expect(state.scores[state.winnerSeat!]).toBeGreaterThanOrEqual(3);
    expect(lastEvents.some((e) => e.kind === "match_over" && e.winnerSeat === state.winnerSeat)).toBe(true);
    expect(mod.phaseOf(state)).toBe("game_over");
  });

  it("blocks further spins once the set is over", () => {
    const { mod, ctx, state } = setup({ targetScore: 3, categories: ["climax"] });
    let guard = 0;
    while (state.stage !== "over" && guard++ < 100) playTurn(mod, state, ctx, "done");
    const r = mod.reduce(state, { type: "spin" }, turnPlayer(state), ctx);
    expect(r.error?.code).toBe("GAME_NOT_ACTIVE");
  });
});

describe("Dice - deck exhaustion", () => {
  it("reshuffles a fresh cycle when a seat's deck runs out (never crashes)", () => {
    // A single tiny category so each seat's deck is short and easily exhausted.
    const { mod, ctx, state } = setup({ categories: ["worship"], targetScore: 30 });
    const firstSeat = state.turnSeat;
    const deckLen = state.decks[firstSeat].length;
    // Each seat draws once every two turns, so play well past a single deck.
    for (let i = 0; i < 2 * (deckLen + 2); i++) {
      expect(state.stage).toBe("rolling");
      const player = turnPlayer(state);
      mod.reduce(state, { type: "spin" }, player, ctx);
      expect(state.current).not.toBeNull();
      mod.reduce(state, { type: "resolve", payload: { outcome: "pass" } }, player, ctx);
    }
    expect(state.deckCycle[firstSeat]).toBeGreaterThanOrEqual(1);
  });

  it("repairs a degenerate empty-pool config (exhibition-only + no media)", () => {
    // Every exhibition card is media: true, so { exhibition, allowMedia:false }
    // yields an empty pool for BOTH bodies - which used to build empty decks and
    // crash on the first spin (drawCard's [][0]! → undefined card → thrown in
    // sanitizeFor / on the client). normalizeConfig now repairs it (re-enabling
    // media is the least-surprising fix), so the decks are playable and a spin
    // puts a real card on the table.
    const { mod, ctx, state } = setup(
      { categories: ["exhibition"], allowMedia: false },
      0,
      ["female", "female"],
    );
    expect(state.config.allowMedia).toBe(true); // repaired
    expect(state.decks.A.length).toBeGreaterThan(0);
    expect(state.decks.B.length).toBeGreaterThan(0);

    const player = turnPlayer(state);
    const result = mod.reduce(state, { type: "spin" }, player, ctx);
    expect(result.error).toBeUndefined();
    expect(result.state.current?.card).toBeDefined();
    // And the sanitized view (which used to throw on an undefined card) is clean.
    expect(() => mod.sanitizeFor(result.state, player, ctx)).not.toThrow();
    expect(mod.sanitizeFor(result.state, player, ctx).current?.card.id).toBeDefined();
  });
});

describe("Dice - safeword", () => {
  it("ends the set immediately for both, no winner, phase game_over", () => {
    const { mod, ctx, state } = setup();
    const r = mod.reduce(state, { type: "safeword" }, PA, ctx);
    expect(r.events?.some((e) => e.kind === "match_over" && e.winnerSeat === "tie")).toBe(true);
    expect(state.sessionEnded).toBe(true);
    expect(state.winnerSeat).toBeNull();
    expect(mod.phaseOf(state)).toBe("game_over");
  });

  it("blocks spins/resolves after a safeword", () => {
    const { mod, ctx, state } = setup();
    mod.reduce(state, { type: "safeword" }, PA, ctx);
    expect(mod.reduce(state, { type: "spin" }, turnPlayer(state), ctx).error?.code).toBe("GAME_NOT_ACTIVE");
    expect(
      mod.reduce(state, { type: "resolve", payload: { outcome: "done" } }, turnPlayer(state), ctx).error?.code,
    ).toBe("GAME_NOT_ACTIVE");
  });
});

describe("Dice - sanitize + validation", () => {
  it("never ships any undrawn deck to the client", () => {
    const { mod, ctx, state } = setup();
    const view = mod.sanitizeFor(state, PA, ctx);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('"deck"');
    expect(serialized).not.toContain('"decks"');
    expect(serialized).not.toContain('"drawIndex"');
    // Before a spin there's no card on the table.
    expect(view.current).toBeNull();
    expect(view.stage).toBe("rolling");
  });

  it("never leaks a card's `requires` anatomy tag to the client", () => {
    // A female couple limited to `edging`: the deck mixes neutral edging cards
    // with the female-only d-bf-01, so a body-specific card is guaranteed to be
    // drawn - and if `requires` shipped, a peer could read the opponent's body
    // off the drawn card / history.
    const { mod, ctx, state } = setup({ categories: ["edging"], targetScore: 30 }, 0, ["female", "female"]);
    expect(state.decks.A.some((c) => c.requires === "female")).toBe(true);

    // Play through more than a full deck per seat so d-bf-01 is certainly drawn.
    const perSeat = state.decks.A.length;
    for (let i = 0; i < perSeat * 2 + 2 && state.stage !== "over"; i++) {
      playTurn(mod, state, ctx, "done");
    }
    // Non-vacuous: the raw server state DID surface a body-specific card...
    expect(state.history.some((h) => h.card.requires === "female")).toBe(true);

    // ...yet no `requires` ever reaches either client (current draw or history).
    const mid = setup({ categories: ["edging"], targetScore: 30 }, 0, ["female", "female"]);
    mod.reduce(mid.state, { type: "spin" }, turnPlayer(mid.state), mid.ctx);
    expect(JSON.stringify(mid.mod.sanitizeFor(mid.state, PA, mid.ctx))).not.toContain('"requires"');
    expect(JSON.stringify(mod.sanitizeFor(state, PA, ctx))).not.toContain('"requires"');
    expect(JSON.stringify(mod.sanitizeFor(state, PB, ctx))).not.toContain('"requires"');
  });

  it("exposes the current draw only while resolving", () => {
    const { mod, ctx, state } = setup();
    const player = turnPlayer(state);
    mod.reduce(state, { type: "spin" }, player, ctx);
    const perfView = mod.sanitizeFor(state, player, ctx);
    expect(perfView.current).not.toBeNull();
    // Both partners see the same dare (nothing is a per-player secret here).
    const other = mod.sanitizeFor(state, player === PA ? PB : PA, ctx);
    expect(other.current?.card.id).toBe(perfView.current?.card.id);
    expect(perfView.yourTurn).toBe(true);
    expect(other.yourTurn).toBe(false);
  });

  it("is deterministic: same room/epoch replays the identical first draw", () => {
    const a = setup();
    const b = setup();
    const pa = turnPlayer(a.state);
    a.mod.reduce(a.state, { type: "spin" }, pa, a.ctx);
    const pb = turnPlayer(b.state);
    b.mod.reduce(b.state, { type: "spin" }, pb, b.ctx);
    expect(a.state.current!.card.id).toBe(b.state.current!.card.id);
    expect(a.state.current!.face.value).toBe(b.state.current!.face.value);
  });

  it("accepts only set_sex / spin / resolve / safeword", () => {
    const { mod } = setup();
    expect(mod.isValidAction({ type: "set_sex" })).toBe(true);
    expect(mod.isValidAction({ type: "spin" })).toBe(true);
    expect(mod.isValidAction({ type: "resolve" })).toBe(true);
    expect(mod.isValidAction({ type: "safeword" })).toBe(true);
    expect(mod.isValidAction({ type: "vote" })).toBe(false);
    expect(mod.isValidAction(null)).toBe(false);
    expect(mod.isValidAction("spin")).toBe(false);
  });
});
