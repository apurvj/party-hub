import {
  DEFAULT_UNO_CONFIG,
  ErrorCode,
  isWildKind,
  makeError,
  seededShuffle,
  type GameContext,
  type GameEvent,
  type GameModule,
  type PublicCard,
  type ReduceResult,
  type RoomPhase,
  type Seat,
  type UnoAction,
  type UnoCard,
  type UnoColor,
  type UnoConfig,
  type UnoPublicView,
} from "@party-hub/shared";
import { canStackOn, isPlayable, shuffledDeck, STARTING_HAND, UNO_COLORS } from "./logic.js";

/**
 * Full server-side Uno state (2-player). NOT sent to clients as-is: both hands
 * and the draw-pile order are secret. `sanitizeFor` projects the per-player
 * view (your hand + opponent COUNT only), exactly the way Wordle hides its
 * answer. The state lives on the room and persists across reconnect, so a
 * refresh replays the identical hand with no recomputation.
 */
export interface UnoState {
  config: UnoConfig;
  roundNumber: number;

  /** Seed inputs for deterministic (re)shuffles — fixed for a match's life. */
  roomCode: string;
  matchEpoch: number;

  drawPile: UnoCard[]; // draw from the END (pop)
  discard: UnoCard[]; // top of pile = last element
  activeColor: UnoColor; // what the next play must match (post-wild)
  hands: Record<Seat, UnoCard[]>;

  turn: Seat;
  /** The current player has drawn their one card this turn (draw-then-play). */
  hasDrawn: boolean;
  drawnCardId: string | null;

  /** Accumulated Draw Two / Wild Draw Four penalty awaiting the player to move. */
  pendingDraw: number;
  pendingDrawType: "draw_two" | "wild_draw_four" | null;

  /** Whether each seat has a valid UNO call registered (they're on one card). */
  calledUno: Record<Seat, boolean>;

  /** Deterministic reshuffle counter (folded into the reshuffle seed). */
  reshuffleCount: number;

  roundOver: boolean;
  roundWinnerSeat: Seat | "tie" | null;
  matchWinnerSeat: Seat | "tie" | null;
  scores: { A: number; B: number };
  readyForNext: Record<Seat, boolean>;
}

function otherSeat(s: Seat): Seat {
  return s === "A" ? "B" : "A";
}

function topOf(state: UnoState): UnoCard {
  return state.discard[state.discard.length - 1]!;
}

// ---- deterministic draw pile ------------------------------------------------

/**
 * Reshuffle the discard pile (all but the current top) back into the draw pile
 * when it runs dry. Uses a seeded shuffle keyed by a per-match/round/reshuffle
 * counter — never Math.random — so the reducer stays replay-safe.
 */
function reshuffle(state: UnoState): void {
  if (state.discard.length <= 1) return; // nothing to recycle
  const top = state.discard[state.discard.length - 1]!;
  const rest = state.discard.slice(0, -1);
  state.discard = [top];
  const seed = `${state.roomCode}#uno#match${state.matchEpoch}#round${state.roundNumber}#reshuffle${state.reshuffleCount++}`;
  state.drawPile = seededShuffle(rest, seed);
}

function drawOne(state: UnoState): UnoCard | null {
  if (state.drawPile.length === 0) reshuffle(state);
  return state.drawPile.pop() ?? null;
}

/** Draw `n` cards into a seat's hand; drawing invalidates any UNO call. */
function drawInto(state: UnoState, seat: Seat, n: number): void {
  for (let i = 0; i < n; i++) {
    const card = drawOne(state);
    if (!card) break; // both piles exhausted — nothing more to draw
    state.hands[seat].push(card);
  }
  state.calledUno[seat] = false;
}

// ---- round / match resolution ----------------------------------------------

function resolveRound(state: UnoState, winnerSeat: Seat): GameEvent[] {
  state.roundOver = true;
  state.roundWinnerSeat = winnerSeat;
  state.scores[winnerSeat] += 1;

  const events: GameEvent[] = [{ kind: "round_over", winnerSeat }];

  const needed = Math.floor(state.config.bestOf / 2) + 1;
  if (state.scores.A >= needed || state.scores.B >= needed) {
    const mw: Seat | "tie" =
      state.scores.A > state.scores.B ? "A" : state.scores.B > state.scores.A ? "B" : "tie";
    state.matchWinnerSeat = mw;
    events.push({ kind: "match_over", winnerSeat: mw });
  }
  return events;
}

// ---- card effects -----------------------------------------------------------

function applyEffect(state: UnoState, card: UnoCard, seat: Seat): void {
  const opp = otherSeat(seat);
  switch (card.kind) {
    case "number":
    case "wild":
      state.turn = opp;
      break;
    // 2-player: Skip AND Reverse both hand the turn straight back to you.
    case "skip":
    case "reverse":
      state.turn = seat;
      break;
    // Start / extend a draw stack; the opponent moves next (to stack or draw).
    case "draw_two":
      state.pendingDraw += 2;
      state.pendingDrawType = "draw_two";
      state.turn = opp;
      break;
    case "wild_draw_four":
      state.pendingDraw += 4;
      state.pendingDrawType = "wild_draw_four";
      state.turn = opp;
      break;
  }
}

type ActionResult = { events: GameEvent[]; error?: ReturnType<typeof makeError> };
const reject = (code: ErrorCode): ActionResult => ({ events: [], error: makeError(code) });

function applyPlay(
  state: UnoState,
  seat: Seat,
  cardId: string,
  chosenColor: UnoColor | undefined,
): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (state.turn !== seat) return reject(ErrorCode.NOT_YOUR_TURN);

  const hand = state.hands[seat];
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return reject(ErrorCode.INVALID_ACTION);
  const card = hand[idx]!;
  const top = topOf(state);

  if (state.pendingDraw > 0) {
    // Only a matching +2/+4 may be played onto an active draw stack.
    if (!canStackOn(card, state.pendingDrawType!)) return reject(ErrorCode.INVALID_ACTION);
  } else {
    // Drawing takes your one card for the turn, but does NOT lock you into the
    // drawn card: you may play ANY playable card still in hand (keep the drawn
    // one and play a card you were already holding, as a matter of strategy).
    if (!isPlayable(card, state.activeColor, top)) return reject(ErrorCode.INVALID_ACTION);
  }

  // Resolve the resulting active color.
  let newColor: UnoColor;
  if (isWildKind(card.kind)) {
    if (!chosenColor || !UNO_COLORS.includes(chosenColor)) return reject(ErrorCode.INVALID_ACTION);
    newColor = chosenColor;
  } else {
    newColor = card.color as UnoColor; // colored card always has a color
  }

  // Commit the play.
  hand.splice(idx, 1);
  state.discard.push(card);
  state.activeColor = newColor;
  state.hasDrawn = false;
  state.drawnCardId = null;

  // Emptying your hand wins the round immediately (no UNO check on the last card).
  if (hand.length === 0) {
    return { events: resolveRound(state, seat) };
  }

  applyEffect(state, card, seat);
  return { events: [] };
}

function applyDraw(state: UnoState, seat: Seat): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (state.turn !== seat) return reject(ErrorCode.NOT_YOUR_TURN);

  // Facing a draw stack: take the whole accumulated penalty. House rule — taking
  // the penalty does NOT forfeit your turn. You've now "drawn" for the turn, so
  // you may play any playable card (including one you just drew: a matching color,
  // a Draw Two, a Wild, or a Wild Draw Four) or pass. This mirrors the normal
  // draw-then-play flow, just after paying the stack.
  if (state.pendingDraw > 0) {
    drawInto(state, seat, state.pendingDraw);
    state.pendingDraw = 0;
    state.pendingDrawType = null;
    state.hasDrawn = true;
    state.drawnCardId = null;
    return { events: [] };
  }

  // Normal draw-then-play: exactly one card per turn.
  if (state.hasDrawn) return reject(ErrorCode.INVALID_ACTION);
  const card = drawOne(state);
  state.calledUno[seat] = false;
  if (!card) {
    // Both piles empty — can't draw; end the turn rather than deadlock.
    state.turn = otherSeat(seat);
    state.hasDrawn = false;
    state.drawnCardId = null;
    return { events: [] };
  }
  state.hands[seat].push(card);
  state.hasDrawn = true;
  state.drawnCardId = card.id;
  return { events: [] };
}

function applyPass(state: UnoState, seat: Seat): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (state.turn !== seat) return reject(ErrorCode.NOT_YOUR_TURN);
  if (state.pendingDraw > 0) return reject(ErrorCode.INVALID_ACTION); // must draw the pile
  if (!state.hasDrawn) return reject(ErrorCode.INVALID_ACTION); // must draw before passing
  state.turn = otherSeat(seat);
  state.hasDrawn = false;
  state.drawnCardId = null;
  return { events: [] };
}

function applyCallUno(state: UnoState, seat: Seat): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (state.hands[seat].length !== 1) return reject(ErrorCode.INVALID_ACTION);
  state.calledUno[seat] = true;
  return { events: [] };
}

function applyCatch(state: UnoState, catcherSeat: Seat): ActionResult {
  if (state.roundOver) return reject(ErrorCode.GAME_NOT_ACTIVE);
  const target = otherSeat(catcherSeat);
  // Catchable only if the target sits on exactly one card without having called.
  if (state.hands[target].length !== 1 || state.calledUno[target]) {
    return reject(ErrorCode.INVALID_ACTION);
  }
  drawInto(state, target, 2); // penalty; also clears their (absent) UNO flag
  return { events: [] };
}

// ---- new round --------------------------------------------------------------

function newRound(state: UnoState, ctx: GameContext, roundNumber: number): void {
  state.roundNumber = roundNumber;
  state.roomCode = ctx.code;
  state.matchEpoch = ctx.matchEpoch;

  const deck = shuffledDeck(ctx.code, roundNumber, ctx.matchEpoch);
  const handA = deck.splice(0, STARTING_HAND);
  const handB = deck.splice(0, STARTING_HAND);
  // Start on a plain number card so there's no first-turn action/wild to resolve.
  let starterIdx = deck.findIndex((c) => c.kind === "number");
  if (starterIdx < 0) starterIdx = 0;
  const [starter] = deck.splice(starterIdx, 1);

  state.drawPile = deck;
  state.discard = [starter!];
  state.activeColor = (starter!.color ?? "red") as UnoColor;
  state.hands = { A: handA, B: handB };
  state.turn = "A";
  state.hasDrawn = false;
  state.drawnCardId = null;
  state.pendingDraw = 0;
  state.pendingDrawType = null;
  state.calledUno = { A: false, B: false };
  state.reshuffleCount = 0;
  state.roundOver = false;
  state.roundWinnerSeat = null;
  state.readyForNext = { A: false, B: false };
}

// ---- view helpers -----------------------------------------------------------

function toPublicCard(c: UnoCard): PublicCard {
  return { id: c.id, kind: c.kind, color: c.color, value: c.value };
}

function playableIdsFor(state: UnoState, seat: Seat): string[] {
  if (state.roundOver || state.turn !== seat) return [];
  const hand = state.hands[seat];
  const top = topOf(state);
  if (state.pendingDraw > 0) {
    return hand.filter((c) => canStackOn(c, state.pendingDrawType!)).map((c) => c.id);
  }
  // Before OR after drawing, every playable card in hand is a legal move — the
  // drawn card doesn't restrict what else you may play this turn.
  return hand.filter((c) => isPlayable(c, state.activeColor, top)).map((c) => c.id);
}

// ---- the module -------------------------------------------------------------

export function createUnoModule(
  config: UnoConfig = DEFAULT_UNO_CONFIG,
): GameModule<UnoState, UnoAction, UnoPublicView> {
  return {
    id: "uno",

    createInitialState(ctx: GameContext): UnoState {
      const state: UnoState = {
        config,
        roundNumber: 0,
        roomCode: ctx.code,
        matchEpoch: ctx.matchEpoch,
        drawPile: [],
        discard: [],
        activeColor: "red",
        hands: { A: [], B: [] },
        turn: "A",
        hasDrawn: false,
        drawnCardId: null,
        pendingDraw: 0,
        pendingDrawType: null,
        calledUno: { A: false, B: false },
        reshuffleCount: 0,
        roundOver: false,
        roundWinnerSeat: null,
        matchWinnerSeat: null,
        scores: { A: 0, B: 0 },
        readyForNext: { A: false, B: false },
      };
      newRound(state, ctx, 1);
      return state;
    },

    reduce(state, action, playerId, ctx): ReduceResult<UnoState> {
      const seat = ctx.seatOf(playerId);
      if (!seat) return { state, error: makeError(ErrorCode.NOT_IN_ROOM) };

      if (action.type === "next_round") {
        if (!state.roundOver) return { state, error: makeError(ErrorCode.INVALID_ACTION) };
        if (state.matchWinnerSeat) return { state, error: makeError(ErrorCode.GAME_NOT_ACTIVE) };
        state.readyForNext[seat] = true;
        const bothReady = state.readyForNext.A && state.readyForNext.B;
        const soloOccupant = ctx.playerIdOf(otherSeat(seat)) === null;
        if (!bothReady && !soloOccupant) {
          return { state, events: [], nextPhase: this.phaseOf(state) };
        }
        newRound(state, ctx, state.roundNumber + 1);
        return {
          state,
          events: [{ kind: "round_started", roundNumber: state.roundNumber }],
          nextPhase: "in_game",
        };
      }

      let res: ActionResult;
      switch (action.type) {
        case "play_card": {
          const p = action.payload as { cardId?: unknown; chosenColor?: unknown } | undefined;
          if (typeof p?.cardId !== "string") return { state, error: makeError(ErrorCode.INVALID_ACTION) };
          const color =
            typeof p.chosenColor === "string" ? (p.chosenColor as UnoColor) : undefined;
          res = applyPlay(state, seat, p.cardId, color);
          break;
        }
        case "draw_card":
          res = applyDraw(state, seat);
          break;
        case "pass":
          res = applyPass(state, seat);
          break;
        case "call_uno":
          res = applyCallUno(state, seat);
          break;
        case "catch_uno":
          res = applyCatch(state, seat);
          break;
        default:
          return { state, error: makeError(ErrorCode.INVALID_ACTION) };
      }

      if (res.error) return { state, error: res.error };
      return { state, events: res.events, nextPhase: this.phaseOf(state) };
    },

    sanitizeFor(state, playerId, ctx): UnoPublicView {
      const seat = ctx.seatOf(playerId);
      // Defense-in-depth: a seatless viewer (shouldn't happen — every player in a
      // room holds a seat) gets a fully redacted view rather than a real hand.
      // This guarantees no hand can ever leak even if a future code path calls
      // sanitizeFor for a non-seated identity.
      if (seat === null) {
        return {
          gameId: "uno",
          config: state.config,
          roundNumber: state.roundNumber,
          turn: state.turn,
          activeColor: state.activeColor,
          topCard: toPublicCard(topOf(state)),
          drawPileCount: state.drawPile.length,
          hand: [],
          playableCardIds: [],
          hasDrawn: false,
          opponentCardCount: state.hands.A.length + state.hands.B.length,
          opponentCalledUno: false,
          youCalledUno: false,
          canCatchOpponent: false,
          pendingDraw: state.pendingDraw,
          pendingDrawType: state.pendingDrawType,
          scores: state.scores,
          roundWinnerSeat: state.roundWinnerSeat,
          matchWinnerSeat: state.matchWinnerSeat,
          youReady: false,
          opponentReady: false,
        };
      }
      const opp = otherSeat(seat);
      const hand = state.hands[seat];

      return {
        gameId: "uno",
        config: state.config,
        roundNumber: state.roundNumber,
        turn: state.turn,
        activeColor: state.activeColor,
        topCard: toPublicCard(topOf(state)),
        drawPileCount: state.drawPile.length,
        hand: hand.slice(),
        playableCardIds: playableIdsFor(state, seat),
        hasDrawn: state.turn === seat && state.hasDrawn,
        opponentCardCount: state.hands[opp].length,
        opponentCalledUno: state.calledUno[opp],
        youCalledUno: state.calledUno[seat],
        canCatchOpponent:
          !state.roundOver && state.hands[opp].length === 1 && !state.calledUno[opp],
        pendingDraw: state.pendingDraw,
        pendingDrawType: state.pendingDrawType,
        scores: state.scores,
        roundWinnerSeat: state.roundWinnerSeat,
        matchWinnerSeat: state.matchWinnerSeat,
        youReady: state.readyForNext[seat],
        opponentReady: state.readyForNext[opp],
      };
    },

    phaseOf(state): RoomPhase {
      if (state.matchWinnerSeat) return "game_over";
      if (state.roundOver) return "round_over";
      return "in_game";
    },

    isValidAction(action: unknown): action is UnoAction {
      if (typeof action !== "object" || action === null) return false;
      const t = (action as { type?: unknown }).type;
      return (
        t === "play_card" ||
        t === "draw_card" ||
        t === "pass" ||
        t === "call_uno" ||
        t === "catch_uno" ||
        t === "next_round"
      );
    },
  };
}
