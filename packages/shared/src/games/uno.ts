/**
 * Uno domain types shared between server and client (2-player variant).
 *
 * SECURITY INVARIANT: a player's view NEVER contains the opponent's actual
 * cards or the order of the draw pile. The opponent is represented only by a
 * hand COUNT; the draw pile only by a count. The full deck + both hands live on
 * the server, exactly like the Wordle answer.
 *
 * RULES (2-player, faithful + two chosen house rules):
 *   • Standard 108-card deck.
 *   • Reverse acts as a Skip in 2-player (official rule): you go again.
 *   • Skip / Draw Two skip the opponent (you go again).
 *   • Wild lets you pick the active color; Wild Draw Four also forces 4 draws.
 *   • Draw-then-play: if you can't (or won't) play, you draw ONE card; if that
 *     card is playable you MAY play it immediately, otherwise your turn ends.
 *   • MANUAL "UNO!" + catch: when you play your second-to-last card you must
 *     call UNO. If you don't and the opponent catches you before your next
 *     turn resolves, you draw 2 as a penalty.
 *   • STACKING on: a Draw Two can be answered with another Draw Two, and a Wild
 *     Draw Four with another Wild Draw Four, passing the accumulated penalty to
 *     the opponent. Whoever can't (or won't) continue the chain draws the whole
 *     pile and loses their turn.
 *   • A hand ends when a player empties their hand → they win the round. Match
 *     is best-of-N (reusing the room engine's round/score/rematch machinery).
 */

export type UnoColor = "red" | "yellow" | "green" | "blue";

/** Non-color cards ("wild", "wild_draw_four") carry color `null` until played. */
export type CardColor = UnoColor | null;

export type UnoCardKind =
  | "number" // value 0-9
  | "skip"
  | "reverse"
  | "draw_two"
  | "wild"
  | "wild_draw_four";

/**
 * A single card. `id` is a stable per-deck identifier so the client can animate
 * specific cards and the server can validate "play THIS card" unambiguously
 * (two red 7s are distinct ids). `value` is only meaningful for number cards.
 */
export interface UnoCard {
  id: string;
  kind: UnoCardKind;
  color: CardColor;
  value: number | null; // 0-9 for kind==="number", else null
}

/** True for the two wild kinds (color chosen on play). */
export function isWildKind(kind: UnoCardKind): boolean {
  return kind === "wild" || kind === "wild_draw_four";
}

export interface UnoConfig {
  bestOf: number; // e.g. 3 → first to 2 round wins
}

export const DEFAULT_UNO_CONFIG: UnoConfig = {
  bestOf: 3,
};

/** Actions a client can dispatch for Uno (carried inside `game:action`). */
export type UnoAction =
  // Play a card from your hand. For wild kinds, `chosenColor` MUST be set.
  | { type: "play_card"; payload: { cardId: string; chosenColor?: UnoColor } }
  // Draw from the pile. In a pending-penalty state this draws the accumulated
  // penalty (and ends your turn); otherwise it draws the single "draw-then-play"
  // card.
  | { type: "draw_card"; payload?: Record<string, never> }
  // End your turn after drawing a card you chose not to / couldn't play.
  | { type: "pass"; payload?: Record<string, never> }
  // Call UNO (must be done as/just after you reach one card).
  | { type: "call_uno"; payload?: Record<string, never> }
  // Catch an opponent who failed to call UNO → they draw 2.
  | { type: "catch_uno"; payload?: Record<string, never> }
  // Between rounds: signal ready for the next hand (mirrors Wordle next_round).
  | { type: "next_round"; payload?: Record<string, never> };

/** Colors-only summary of one card for the discard pile / last-played display. */
export interface PublicCard {
  id: string;
  kind: UnoCardKind;
  color: CardColor;
  value: number | null;
}

/**
 * The sanitized, per-player public view of Uno state. Safe to log / inspect in
 * devtools: your OWN hand is here, but the opponent is only a count and the
 * draw pile is only a count.
 */
export interface UnoPublicView {
  gameId: "uno";
  config: UnoConfig;
  roundNumber: number; // 1-based

  /** Whose turn it is right now (by seat). */
  turn: "A" | "B";
  /** The active color in play (what the next card must match, post-wild). */
  activeColor: UnoColor;
  /** The top of the discard pile. */
  topCard: PublicCard;
  /** How many cards remain to be drawn (draw pile). */
  drawPileCount: number;

  /** YOUR hand — full detail (this is your own info). */
  hand: UnoCard[];
  /** Of your hand, the subset you may legally play right now (card ids). */
  playableCardIds: string[];
  /**
   * True if it's your turn and you have already drawn your one card this turn
   * (so your only remaining options are to play that drawable card or pass).
   */
  hasDrawn: boolean;

  /** Opponent, secret-safe: just how many cards they hold + whether on UNO. */
  opponentCardCount: number;
  /** Whether the opponent has validly called UNO (they're on one card). */
  opponentCalledUno: boolean;
  /** Whether YOU have a valid UNO call registered. */
  youCalledUno: boolean;
  /**
   * Whether the opponent is CATCHABLE right now: they're on one card and never
   * called UNO. Drives the "Catch!" button on your side.
   */
  canCatchOpponent: boolean;

  /**
   * Pending draw penalty from a stack of Draw Two / Wild Draw Four. When > 0 the
   * player to move must either extend the stack (play a matching +2/+4) or draw
   * this many cards. `pendingDrawType` says which kind can extend it.
   */
  pendingDraw: number;
  pendingDrawType: "draw_two" | "wild_draw_four" | null;

  /** Cumulative round wins across the match, keyed by seat. */
  scores: { A: number; B: number };
  roundWinnerSeat: "A" | "B" | "tie" | null;
  matchWinnerSeat: "A" | "B" | "tie" | null;

  /** Between-rounds readiness (mirrors Wordle). */
  youReady: boolean;
  opponentReady: boolean;
}
