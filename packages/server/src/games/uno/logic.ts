import {
  seededShuffle,
  type UnoCard,
  type UnoCardKind,
  type UnoColor,
} from "@party-hub/shared";

/**
 * UNO ENGINE - deck construction, deterministic dealing, and playability rules.
 *
 * DETERMINISM: like Wordle, the initial deck order for a room's hand is derived
 * from a stable seed (roomCode + round + matchEpoch), so a reconnect/refresh
 * reproduces the SAME deal, and "Play again" produces a DIFFERENT one (matchEpoch
 * differs). `seededShuffle` is the same platform-stable Fisher–Yates used
 * everywhere else. The client never runs any of this - only the server does.
 */

export const UNO_COLORS: UnoColor[] = ["red", "yellow", "green", "blue"];
export const STARTING_HAND = 7;

/** Bump when the deck composition changes so seeds intentionally diverge. */
export const UNO_DECK_VERSION = "1";

/**
 * Build a fresh, ordered 108-card standard Uno deck. Card ids are stable and
 * unique within the deck (e.g. "red-7-b", "wild-2") so a specific physical card
 * can be referenced and animated. The ORDER here is canonical; shuffling is done
 * separately with a seed, keeping this function pure and testable.
 *
 * Composition (108):
 *   • Per color (×4): one 0, two each of 1–9, two Skip, two Reverse, two Draw Two
 *       = 1 + 18 + 2 + 2 + 2 = 25 → ×4 = 100
 *   • 4 Wild + 4 Wild Draw Four = 8
 */
export function buildDeck(): UnoCard[] {
  const deck: UnoCard[] = [];

  for (const color of UNO_COLORS) {
    // One 0.
    deck.push({ id: `${color}-0`, kind: "number", color, value: 0 });
    // Two each of 1–9.
    for (let v = 1; v <= 9; v++) {
      deck.push({ id: `${color}-${v}-a`, kind: "number", color, value: v });
      deck.push({ id: `${color}-${v}-b`, kind: "number", color, value: v });
    }
    // Two each of the colored action cards.
    for (const kind of ["skip", "reverse", "draw_two"] as UnoCardKind[]) {
      deck.push({ id: `${color}-${kind}-a`, kind, color, value: null });
      deck.push({ id: `${color}-${kind}-b`, kind, color, value: null });
    }
  }

  // 4 Wild + 4 Wild Draw Four (color null until played).
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `wild-${i}`, kind: "wild", color: null, value: null });
    deck.push({ id: `wildfour-${i}`, kind: "wild_draw_four", color: null, value: null });
  }

  return deck;
}

/** Deterministic shuffle of a fresh deck for a specific room/round/match. */
export function shuffledDeck(roomCode: string, roundNumber: number, matchEpoch: number): UnoCard[] {
  const seed = `${roomCode}#uno#v${UNO_DECK_VERSION}#match${matchEpoch}#round${roundNumber}`;
  return seededShuffle(buildDeck(), seed);
}

/**
 * Whether `card` may be legally played on top of a discard with the given active
 * color and top card, when there is NO pending draw stack.
 *
 *   • Wild is always playable.
 *   • Wild Draw Four is (in this ruleset) always playable - we don't enforce the
 *     optional "only if you have no matching color" restriction, matching how
 *     most casual/app Uno plays and keeping the UI honest about what's allowed.
 *   • A colored card matches if its color equals the active color, OR its
 *     number equals the top card's number, OR its action kind equals the top
 *     card's kind (e.g. Skip on Skip).
 */
export function isPlayable(card: UnoCard, activeColor: UnoColor, topCard: UnoCard): boolean {
  if (card.kind === "wild" || card.kind === "wild_draw_four") return true;
  if (card.color === activeColor) return true;
  if (card.kind === "number" && topCard.kind === "number" && card.value === topCard.value) {
    return true;
  }
  // Action-on-same-action (Skip on Skip, Reverse on Reverse, Draw Two on Draw
  // Two) regardless of color.
  if (card.kind !== "number" && card.kind === topCard.kind) return true;
  return false;
}

/**
 * When a draw stack is pending, the ONLY legal plays are cards that extend the
 * same stack: a Draw Two extends a draw_two stack; a Wild Draw Four extends a
 * wild_draw_four stack. (We keep +2 and +4 stacks separate - you can't chain a
 * +2 onto a +4 or vice-versa, which is the most common stacking house rule.)
 */
export function canStackOn(card: UnoCard, pendingType: "draw_two" | "wild_draw_four"): boolean {
  return card.kind === pendingType;
}
