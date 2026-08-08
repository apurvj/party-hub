import { describe, expect, it } from "vitest";
import type { UnoCard } from "@party-hub/shared";
import { buildDeck, canStackOn, isPlayable, shuffledDeck } from "./logic.js";

function card(partial: Partial<UnoCard> & Pick<UnoCard, "kind">): UnoCard {
  return { id: partial.id ?? "x", color: partial.color ?? null, value: partial.value ?? null, ...partial };
}

describe("uno deck", () => {
  it("builds a standard 108-card deck with unique ids", () => {
    const deck = buildDeck();
    expect(deck.length).toBe(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });

  it("has the correct composition", () => {
    const deck = buildDeck();
    const count = (pred: (c: UnoCard) => boolean) => deck.filter(pred).length;
    expect(count((c) => c.kind === "number" && c.value === 0)).toBe(4); // one 0 per color
    expect(count((c) => c.kind === "number" && c.value === 5)).toBe(8); // two 5s per color
    expect(count((c) => c.kind === "skip")).toBe(8);
    expect(count((c) => c.kind === "reverse")).toBe(8);
    expect(count((c) => c.kind === "draw_two")).toBe(8);
    expect(count((c) => c.kind === "wild")).toBe(4);
    expect(count((c) => c.kind === "wild_draw_four")).toBe(4);
  });
});

describe("uno deterministic shuffle", () => {
  it("same seed inputs → identical order (replay-safe)", () => {
    const a = shuffledDeck("ROOM01", 1, 0).map((c) => c.id);
    const b = shuffledDeck("ROOM01", 1, 0).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it("different match epoch → different order (rematch doesn't replay a deal)", () => {
    const a = shuffledDeck("ROOM01", 1, 0).map((c) => c.id);
    const b = shuffledDeck("ROOM01", 1, 1).map((c) => c.id);
    expect(a).not.toEqual(b);
  });
});

describe("uno playability", () => {
  const top = card({ kind: "number", color: "red", value: 7 });

  it("matches on color", () => {
    expect(isPlayable(card({ kind: "number", color: "red", value: 3 }), "red", top)).toBe(true);
  });
  it("matches on number across colors", () => {
    expect(isPlayable(card({ kind: "number", color: "blue", value: 7 }), "red", top)).toBe(true);
  });
  it("rejects a non-matching color+number", () => {
    expect(isPlayable(card({ kind: "number", color: "blue", value: 3 }), "red", top)).toBe(false);
  });
  it("wild and wild-draw-four are always playable", () => {
    expect(isPlayable(card({ kind: "wild" }), "red", top)).toBe(true);
    expect(isPlayable(card({ kind: "wild_draw_four" }), "red", top)).toBe(true);
  });
  it("action-on-same-action matches across colors (skip on skip)", () => {
    const topSkip = card({ kind: "skip", color: "green" });
    expect(isPlayable(card({ kind: "skip", color: "blue" }), "green", topSkip)).toBe(true);
  });
  it("respects the active color after a wild set it", () => {
    // Top is a wild that set active color to blue; a blue card is playable.
    const topWild = card({ kind: "wild", color: null });
    expect(isPlayable(card({ kind: "number", color: "blue", value: 2 }), "blue", topWild)).toBe(true);
    expect(isPlayable(card({ kind: "number", color: "red", value: 2 }), "blue", topWild)).toBe(false);
  });

  it("stacking only allows same +type", () => {
    expect(canStackOn(card({ kind: "draw_two", color: "red" }), "draw_two")).toBe(true);
    expect(canStackOn(card({ kind: "wild_draw_four" }), "draw_two")).toBe(false);
    expect(canStackOn(card({ kind: "wild_draw_four" }), "wild_draw_four")).toBe(true);
    expect(canStackOn(card({ kind: "draw_two", color: "red" }), "wild_draw_four")).toBe(false);
  });
});
