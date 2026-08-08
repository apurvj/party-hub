import { describe, expect, it } from "vitest";
import type { GameContext, Seat, UnoCard } from "@party-hub/shared";
import { createUnoModule, type UnoState } from "./module.js";

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

function setup(bestOf = 3) {
  const mod = createUnoModule({ bestOf });
  const ctx = ctxWith({ A: PA, B: PB });
  const state = mod.createInitialState(ctx);
  return { mod, ctx, state };
}

function c(partial: Partial<UnoCard> & Pick<UnoCard, "id" | "kind">): UnoCard {
  return { color: partial.color ?? null, value: partial.value ?? null, ...partial };
}

/** Rig a controlled board: seat hands, discard top, active color, turn. */
function rig(
  state: UnoState,
  opts: {
    turn?: Seat;
    activeColor?: UnoState["activeColor"];
    top?: UnoCard;
    handA?: UnoCard[];
    handB?: UnoCard[];
    drawPile?: UnoCard[];
  },
): void {
  if (opts.turn) state.turn = opts.turn;
  if (opts.activeColor) state.activeColor = opts.activeColor;
  if (opts.top) state.discard = [opts.top];
  if (opts.handA) state.hands.A = opts.handA;
  if (opts.handB) state.hands.B = opts.handB;
  if (opts.drawPile) state.drawPile = opts.drawPile;
  state.hasDrawn = false;
  state.drawnCardId = null;
  state.pendingDraw = 0;
  state.pendingDrawType = null;
}

describe("uno module — setup", () => {
  it("deals 7 cards each and starts on a number card, A to move", () => {
    const { state } = setup();
    expect(state.hands.A.length).toBe(7);
    expect(state.hands.B.length).toBe(7);
    expect(state.discard.length).toBe(1);
    expect(state.discard[0]!.kind).toBe("number");
    expect(state.turn).toBe("A");
    expect(state.roundNumber).toBe(1);
    // 108 total = 7 + 7 + 1 top + draw pile.
    expect(state.drawPile.length).toBe(108 - 15);
  });

  it("never leaks the opponent's hand in a sanitized view", () => {
    const { mod, ctx, state } = setup();
    const viewA = mod.sanitizeFor(state, PA, ctx);
    expect(viewA.opponentCardCount).toBe(7);
    // The opponent's actual cards must not appear anywhere in A's view.
    const json = JSON.stringify(viewA);
    for (const card of state.hands.B) {
      // Card ids are unique; B's ids must not surface in A's view.
      expect(json).not.toContain(card.id);
    }
    // Nor should the draw pile order leak.
    expect(json).not.toContain(state.drawPile[0]!.id);
  });
});

describe("uno module — turn + play rules", () => {
  it("rejects a play out of turn", () => {
    const { mod, ctx, state } = setup();
    rig(state, { turn: "A", activeColor: "red", top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handB: [c({ id: "b1", kind: "number", color: "red", value: 5 })] });
    const r = mod.reduce(state, { type: "play_card", payload: { cardId: "b1" } }, PB, ctx);
    expect(r.error?.code).toBe("NOT_YOUR_TURN");
  });

  it("rejects an unplayable card and accepts a matching one", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "blue", value: 3 }), c({ id: "a2", kind: "number", color: "red", value: 9 })],
    });
    expect(mod.reduce(state, { type: "play_card", payload: { cardId: "a1" } }, PA, ctx).error?.code).toBe(
      "INVALID_ACTION",
    );
    const ok = mod.reduce(state, { type: "play_card", payload: { cardId: "a2" } }, PA, ctx);
    expect(ok.error).toBeUndefined();
    expect(ok.state.discard.at(-1)!.id).toBe("a2");
    expect(ok.state.turn).toBe("B"); // plain number → opponent's turn
  });

  it("Skip and Reverse both give the player another turn (2-player rule)", () => {
    for (const kind of ["skip", "reverse"] as const) {
      const { mod, ctx, state } = setup();
      rig(state, {
        turn: "A",
        activeColor: "green",
        top: c({ id: "t", kind: "number", color: "green", value: 1 }),
        handA: [c({ id: "a1", kind, color: "green" }), c({ id: "a2", kind: "number", color: "green", value: 4 })],
      });
      const r = mod.reduce(state, { type: "play_card", payload: { cardId: "a1" } }, PA, ctx);
      expect(r.error).toBeUndefined();
      expect(r.state.turn).toBe("A"); // still A's turn
    }
  });

  it("requires a chosen color for a wild and applies it", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "w", kind: "wild" }), c({ id: "a2", kind: "number", color: "red", value: 2 })],
    });
    expect(mod.reduce(state, { type: "play_card", payload: { cardId: "w" } }, PA, ctx).error?.code).toBe(
      "INVALID_ACTION",
    ); // no color chosen
    const r = mod.reduce(state, { type: "play_card", payload: { cardId: "w", chosenColor: "blue" } }, PA, ctx);
    expect(r.error).toBeUndefined();
    expect(r.state.activeColor).toBe("blue");
    expect(r.state.turn).toBe("B");
  });
});

describe("uno module — draw then play / pass", () => {
  it("draws exactly one card, may then pass, turn passes to opponent", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "blue", value: 3 })], // unplayable
      drawPile: [c({ id: "d1", kind: "number", color: "blue", value: 8 })], // also unplayable
    });
    const drew = mod.reduce(state, { type: "draw_card" }, PA, ctx);
    expect(drew.error).toBeUndefined();
    expect(drew.state.hands.A.length).toBe(2);
    expect(drew.state.hasDrawn).toBe(true);
    // Can't draw twice.
    expect(mod.reduce(drew.state, { type: "draw_card" }, PA, ctx).error?.code).toBe("INVALID_ACTION");
    // Pass ends the turn.
    const passed = mod.reduce(drew.state, { type: "pass" }, PA, ctx);
    expect(passed.error).toBeUndefined();
    expect(passed.state.turn).toBe("B");
  });

  it("after drawing, may play the drawn card OR a card already in hand", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "red", value: 1 })], // already-held, playable
      drawPile: [c({ id: "d1", kind: "number", color: "blue", value: 8 })], // drawn, unplayable
    });
    const drew = mod.reduce(state, { type: "draw_card" }, PA, ctx);
    expect(drew.state.hands.A.length).toBe(2);
    // Strategy: keep the drawn (unplayable blue) card and play the held red one.
    const ok = mod.reduce(drew.state, { type: "play_card", payload: { cardId: "a1" } }, PA, ctx);
    expect(ok.error).toBeUndefined();
    expect(ok.state.discard.at(-1)!.id).toBe("a1");
    expect(ok.state.hands.A.some((card) => card.id === "d1")).toBe(true); // drawn card kept
    expect(ok.state.turn).toBe("B");
  });

  it("after drawing, may still play the freshly drawn card", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "blue", value: 1 })], // unplayable
      drawPile: [c({ id: "d1", kind: "number", color: "red", value: 8 })], // drawn, playable
    });
    const drew = mod.reduce(state, { type: "draw_card" }, PA, ctx);
    const ok = mod.reduce(drew.state, { type: "play_card", payload: { cardId: "d1" } }, PA, ctx);
    expect(ok.error).toBeUndefined();
    expect(ok.state.discard.at(-1)!.id).toBe("d1");
  });
});

describe("uno module — draw stacking (+2 / +4)", () => {
  it("a Draw Two can be stacked, and the non-stacker draws the full pile", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a2", kind: "draw_two", color: "red" }), c({ id: "ax", kind: "number", color: "red", value: 1 })],
      handB: [c({ id: "b2", kind: "draw_two", color: "blue" }), c({ id: "bx", kind: "number", color: "red", value: 2 })],
      drawPile: Array.from({ length: 10 }, (_, i) => c({ id: `d${i}`, kind: "number", color: "green", value: 0 })),
    });
    // A plays +2 → pending 2, B to move.
    let r = mod.reduce(state, { type: "play_card", payload: { cardId: "a2" } }, PA, ctx);
    expect(r.state.pendingDraw).toBe(2);
    expect(r.state.turn).toBe("B");
    // B stacks +2 → pending 4, A to move.
    r = mod.reduce(r.state, { type: "play_card", payload: { cardId: "b2" } }, PB, ctx);
    expect(r.state.pendingDraw).toBe(4);
    expect(r.state.turn).toBe("A");
    // A can't stack (only a number left) → must draw the pile.
    // A non-+2 play is rejected.
    expect(mod.reduce(r.state, { type: "play_card", payload: { cardId: "ax" } }, PA, ctx).error?.code).toBe(
      "INVALID_ACTION",
    );
    const drew = mod.reduce(r.state, { type: "draw_card" }, PA, ctx);
    expect(drew.error).toBeUndefined();
    expect(drew.state.hands.A.length).toBe(1 /* ax */ + 4 /* penalty */);
    expect(drew.state.pendingDraw).toBe(0);
    // House rule: taking the penalty is your draw for the turn — it does NOT
    // forfeit the turn. A keeps the move and may play a drawn/held card or pass.
    expect(drew.state.hasDrawn).toBe(true);
    expect(drew.state.turn).toBe("A");
    // Nothing A holds is playable on the blue draw-two top, so A passes to B.
    const passed = mod.reduce(drew.state, { type: "pass" }, PA, ctx);
    expect(passed.state.turn).toBe("B");
  });

  it("after drawing a +2 penalty, a playable drawn card may be played that turn", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "B",
      activeColor: "red",
      top: c({ id: "t", kind: "draw_two", color: "red" }),
      handB: [c({ id: "bx", kind: "number", color: "blue", value: 9 })], // can't stack
      // The two penalty cards drawn will include a playable red card.
      drawPile: [
        c({ id: "p2", kind: "number", color: "red", value: 4 }), // drawn 2nd (top of pile)
        c({ id: "p1", kind: "number", color: "green", value: 7 }), // drawn 1st
      ],
    });
    state.pendingDraw = 2;
    state.pendingDrawType = "draw_two";
    // B draws the +2 penalty; the turn stays with B (didn't forfeit it).
    const drew = mod.reduce(state, { type: "draw_card" }, PB, ctx);
    expect(drew.error).toBeUndefined();
    expect(drew.state.pendingDraw).toBe(0);
    expect(drew.state.hasDrawn).toBe(true);
    expect(drew.state.turn).toBe("B");
    expect(drew.state.hands.B.length).toBe(3); // bx + 2 penalty cards
    // The drawn red 4 matches the active color and may be played immediately.
    const played = mod.reduce(drew.state, { type: "play_card", payload: { cardId: "p2" } }, PB, ctx);
    expect(played.error).toBeUndefined();
    expect(played.state.discard.at(-1)!.id).toBe("p2");
    expect(played.state.turn).toBe("A"); // plain number → opponent's turn
  });

  it("after drawing a +2 penalty, a drawn different-color +2 may be re-stacked", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "B",
      activeColor: "red",
      top: c({ id: "t", kind: "draw_two", color: "red" }),
      handB: [c({ id: "bx", kind: "number", color: "green", value: 1 })],
      drawPile: [
        c({ id: "p2", kind: "draw_two", color: "blue" }), // drawn 2nd — a different-color +2
        c({ id: "p1", kind: "number", color: "green", value: 7 }), // drawn 1st
      ],
    });
    state.pendingDraw = 2;
    state.pendingDrawType = "draw_two";
    const drew = mod.reduce(state, { type: "draw_card" }, PB, ctx);
    expect(drew.state.pendingDraw).toBe(0);
    // The drawn blue +2 plays onto the red +2 top (action-on-action) and starts
    // a fresh stack against A.
    const played = mod.reduce(drew.state, { type: "play_card", payload: { cardId: "p2" } }, PB, ctx);
    expect(played.error).toBeUndefined();
    expect(played.state.pendingDraw).toBe(2);
    expect(played.state.pendingDrawType).toBe("draw_two");
    expect(played.state.turn).toBe("A");
  });

  it("after drawing a +2 penalty with nothing playable, the player passes", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "B",
      activeColor: "red",
      top: c({ id: "t", kind: "draw_two", color: "red" }),
      handB: [c({ id: "bx", kind: "number", color: "blue", value: 9 })],
      drawPile: [
        c({ id: "p2", kind: "number", color: "green", value: 4 }),
        c({ id: "p1", kind: "number", color: "green", value: 7 }),
      ],
    });
    state.pendingDraw = 2;
    state.pendingDrawType = "draw_two";
    const drew = mod.reduce(state, { type: "draw_card" }, PB, ctx);
    expect(drew.state.turn).toBe("B");
    // Nothing green/blue is playable on the red +2 top → B can't draw again, only pass.
    expect(mod.reduce(drew.state, { type: "draw_card" }, PB, ctx).error?.code).toBe("INVALID_ACTION");
    const passed = mod.reduce(drew.state, { type: "pass" }, PB, ctx);
    expect(passed.error).toBeUndefined();
    expect(passed.state.turn).toBe("A");
  });

  it("cannot pass while a draw stack is pending", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "B",
      activeColor: "red",
      top: c({ id: "t", kind: "draw_two", color: "red" }),
      handB: [c({ id: "bx", kind: "number", color: "red", value: 2 })],
    });
    state.pendingDraw = 2;
    state.pendingDrawType = "draw_two";
    expect(mod.reduce(state, { type: "pass" }, PB, ctx).error?.code).toBe("INVALID_ACTION");
  });
});

describe("uno module — draw pile exhaustion + reshuffle", () => {
  /** Count every physical card currently tracked in the state (must stay 108). */
  function totalCards(state: UnoState): number {
    return (
      state.hands.A.length + state.hands.B.length + state.drawPile.length + state.discard.length
    );
  }

  it("recycles the discard pile (minus its top) when the draw pile is empty", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "blue", value: 3 })], // unplayable → will draw
      drawPile: [], // empty: forces a reshuffle on draw
    });
    // A fat discard pile to recycle: current top + 5 buried cards.
    state.discard = [
      c({ id: "old1", kind: "number", color: "green", value: 1 }),
      c({ id: "old2", kind: "number", color: "green", value: 2 }),
      c({ id: "old3", kind: "number", color: "green", value: 3 }),
      c({ id: "old4", kind: "number", color: "green", value: 4 }),
      c({ id: "old5", kind: "number", color: "green", value: 5 }),
      c({ id: "t", kind: "number", color: "red", value: 5 }), // top stays in play
    ];
    const before = totalCards(state);

    const drew = mod.reduce(state, { type: "draw_card" }, PA, ctx);
    expect(drew.error).toBeUndefined();
    // Top card is untouched; the other 5 were recycled, one of which A just drew.
    expect(drew.state.discard.length).toBe(1);
    expect(drew.state.discard[0]!.id).toBe("t");
    expect(drew.state.drawPile.length).toBe(4); // 5 recycled − 1 drawn
    expect(drew.state.hands.A.length).toBe(2); // a1 + the drawn card
    expect(totalCards(drew.state)).toBe(before); // nothing created or destroyed
    expect(drew.state.reshuffleCount).toBe(1);
  });

  it("reshuffle is deterministic — identical states recycle to the identical order", () => {
    function exhaustAndDraw(): UnoState {
      const { mod, ctx, state } = setup();
      rig(state, {
        turn: "A",
        activeColor: "red",
        top: c({ id: "t", kind: "number", color: "red", value: 5 }),
        handA: [c({ id: "a1", kind: "number", color: "blue", value: 3 })],
        drawPile: [],
      });
      state.discard = [
        c({ id: "old1", kind: "number", color: "green", value: 1 }),
        c({ id: "old2", kind: "number", color: "green", value: 2 }),
        c({ id: "old3", kind: "number", color: "green", value: 3 }),
        c({ id: "old4", kind: "number", color: "green", value: 4 }),
        c({ id: "old5", kind: "number", color: "green", value: 5 }),
        c({ id: "t", kind: "number", color: "red", value: 5 }),
      ];
      return mod.reduce(state, { type: "draw_card" }, PA, ctx).state;
    }
    const s1 = exhaustAndDraw();
    const s2 = exhaustAndDraw();
    // Same seed inputs (room/match/round/reshuffleCount) → identical recycle,
    // which is what makes a reconnect right after a reshuffle replay-safe.
    expect(s1.drawPile.map((x) => x.id)).toEqual(s2.drawPile.map((x) => x.id));
    expect(s1.hands.A.map((x) => x.id)).toEqual(s2.hands.A.map((x) => x.id));
  });

  it("recycles mid-penalty so a +N draw larger than the pile still resolves", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "draw_two", color: "red" }),
      handA: [c({ id: "ax", kind: "number", color: "blue", value: 9 })], // can't stack
      drawPile: [c({ id: "d1", kind: "number", color: "green", value: 0 })], // only ONE card
    });
    // A faces +4 but the draw pile has a single card; the discard supplies the rest.
    state.pendingDraw = 4;
    state.pendingDrawType = "draw_two";
    state.discard = [
      c({ id: "buried1", kind: "number", color: "yellow", value: 1 }),
      c({ id: "buried2", kind: "number", color: "yellow", value: 2 }),
      c({ id: "buried3", kind: "number", color: "yellow", value: 3 }),
      c({ id: "t", kind: "draw_two", color: "red" }),
    ];
    const before = totalCards(state);
    const drew = mod.reduce(state, { type: "draw_card" }, PA, ctx);
    expect(drew.error).toBeUndefined();
    expect(drew.state.hands.A.length).toBe(1 /* ax */ + 4 /* full penalty paid */);
    expect(drew.state.pendingDraw).toBe(0);
    expect(drew.state.turn).toBe("A"); // penalty paid, turn retained (draw-then-play)
    expect(totalCards(drew.state)).toBe(before);
  });

  it("never deadlocks when BOTH piles are empty — the turn simply passes", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "blue", value: 3 })], // unplayable
      drawPile: [], // empty
    });
    state.discard = [c({ id: "t", kind: "number", color: "red", value: 5 })]; // only the top; nothing to recycle
    const drew = mod.reduce(state, { type: "draw_card" }, PA, ctx);
    expect(drew.error).toBeUndefined();
    expect(drew.state.hands.A.length).toBe(1); // couldn't draw anything
    expect(drew.state.turn).toBe("B"); // turn advances rather than hanging
    expect(drew.state.hasDrawn).toBe(false);
  });

  it("a penalty against two empty piles draws what it can without crashing", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "draw_two", color: "red" }),
      handA: [c({ id: "ax", kind: "number", color: "blue", value: 9 })],
      drawPile: [c({ id: "d1", kind: "number", color: "green", value: 0 })], // one card only
    });
    state.pendingDraw = 4; // demands 4 but only 1 is available and none to recycle
    state.pendingDrawType = "draw_two";
    state.discard = [c({ id: "t", kind: "draw_two", color: "red" })];
    const drew = mod.reduce(state, { type: "draw_card" }, PA, ctx);
    expect(drew.error).toBeUndefined();
    expect(drew.state.hands.A.length).toBe(2); // ax + the single drawable card
    expect(drew.state.pendingDraw).toBe(0); // stack cleared even if under-paid
    expect(drew.state.turn).toBe("A"); // penalty paid, turn retained
  });
});

describe("uno module — UNO call + catch", () => {
  it("catches an opponent on one card who didn't call → they draw 2", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handB: [c({ id: "b1", kind: "number", color: "green", value: 9 })],
      drawPile: [c({ id: "d1", kind: "number", color: "green", value: 0 }), c({ id: "d2", kind: "number", color: "green", value: 1 })],
    });
    state.calledUno.B = false;
    // A catches B (B has one card, no call).
    const caught = mod.reduce(state, { type: "catch_uno" }, PA, ctx);
    expect(caught.error).toBeUndefined();
    expect(caught.state.hands.B.length).toBe(3); // 1 + 2 penalty
  });

  it("cannot catch an opponent who validly called UNO", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handB: [c({ id: "b1", kind: "number", color: "green", value: 9 })],
    });
    state.calledUno.B = true;
    expect(mod.reduce(state, { type: "catch_uno" }, PA, ctx).error?.code).toBe("INVALID_ACTION");
  });

  it("call_uno only valid on exactly one card", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "red", value: 1 }), c({ id: "a2", kind: "number", color: "red", value: 2 })],
    });
    expect(mod.reduce(state, { type: "call_uno" }, PA, ctx).error?.code).toBe("INVALID_ACTION");
    state.hands.A = [c({ id: "a1", kind: "number", color: "red", value: 1 })];
    expect(mod.reduce(state, { type: "call_uno" }, PA, ctx).error).toBeUndefined();
  });
});

describe("uno module — winning and scoring", () => {
  it("emptying your hand wins the round and scores", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "red", value: 1 })],
    });
    const r = mod.reduce(state, { type: "play_card", payload: { cardId: "a1" } }, PA, ctx);
    expect(r.state.roundOver).toBe(true);
    expect(r.state.roundWinnerSeat).toBe("A");
    expect(r.state.scores.A).toBe(1);
    expect(r.events?.some((e) => e.kind === "round_over")).toBe(true);
  });

  it("playing a Draw Two as your LAST card wins immediately — no pending draw, no wait", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "draw_two", color: "red" })], // last card is a +2
    });
    const r = mod.reduce(state, { type: "play_card", payload: { cardId: "a1" } }, PA, ctx);
    expect(r.state.roundOver).toBe(true);
    expect(r.state.roundWinnerSeat).toBe("A");
    expect(r.state.scores.A).toBe(1);
    // The +2 effect must NOT run: no penalty is left waiting on B, and the turn
    // is not handed over — the round is simply over.
    expect(r.state.pendingDraw).toBe(0);
    expect(r.state.pendingDrawType).toBe(null);
    expect(r.state.hands.A.length).toBe(0);
    expect(r.events?.some((e) => e.kind === "round_over")).toBe(true);
  });

  it("playing a Wild Draw Four as your LAST card wins immediately — no pending draw", () => {
    const { mod, ctx, state } = setup();
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "wild_draw_four" })], // last card is a +4
    });
    const r = mod.reduce(state, { type: "play_card", payload: { cardId: "a1", chosenColor: "blue" } }, PA, ctx);
    expect(r.state.roundOver).toBe(true);
    expect(r.state.roundWinnerSeat).toBe("A");
    expect(r.state.pendingDraw).toBe(0);
    expect(r.state.pendingDrawType).toBe(null);
    expect(r.state.hands.A.length).toBe(0);
    expect(r.state.hands.B.length).toBe(7); // opponent untouched — never drew
  });

  it("best-of-1: winning a round ends the match", () => {
    const { mod, ctx, state } = setup(1);
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "red", value: 1 })],
    });
    const r = mod.reduce(state, { type: "play_card", payload: { cardId: "a1" } }, PA, ctx);
    expect(r.state.matchWinnerSeat).toBe("A");
    expect(r.events?.some((e) => e.kind === "match_over")).toBe(true);
  });
});

describe("uno module — between-rounds + rematch determinism", () => {
  it("advances only after both ready, dealing a fresh round", () => {
    const { mod, ctx, state } = setup(3);
    rig(state, {
      turn: "A",
      activeColor: "red",
      top: c({ id: "t", kind: "number", color: "red", value: 5 }),
      handA: [c({ id: "a1", kind: "number", color: "red", value: 1 })],
    });
    const won = mod.reduce(state, { type: "play_card", payload: { cardId: "a1" } }, PA, ctx);
    expect(won.state.roundOver).toBe(true);
    const aReady = mod.reduce(won.state, { type: "next_round" }, PA, ctx);
    expect(aReady.state.roundNumber).toBe(1); // not yet
    const bReady = mod.reduce(aReady.state, { type: "next_round" }, PB, ctx);
    expect(bReady.state.roundNumber).toBe(2);
    expect(bReady.state.roundOver).toBe(false);
    expect(bReady.state.hands.A.length).toBe(7);
  });

  it("a new match epoch deals a different opening hand in the same room", () => {
    const mod = createUnoModule({ bestOf: 3 });
    const s0 = mod.createInitialState(ctxWith({ A: PA, B: PB }, 0));
    const s1 = mod.createInitialState(ctxWith({ A: PA, B: PB }, 1));
    const ids0 = s0.hands.A.map((c) => c.id).join(",");
    const ids1 = s1.hands.A.map((c) => c.id).join(",");
    expect(ids0).not.toBe(ids1);
  });

  it("same epoch is fully deterministic (reconnect-safe deal)", () => {
    const mod = createUnoModule({ bestOf: 3 });
    const a = mod.createInitialState(ctxWith({ A: PA, B: PB }, 2));
    const b = mod.createInitialState(ctxWith({ A: PA, B: PB }, 2));
    expect(a.hands.A.map((c) => c.id)).toEqual(b.hands.A.map((c) => c.id));
    expect(a.discard[0]!.id).toBe(b.discard[0]!.id);
  });
});
