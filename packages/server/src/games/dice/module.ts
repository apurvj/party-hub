import {
  DEFAULT_DICE_CONFIG,
  DICE_CATEGORIES,
  DICE_FACES,
  dicePool,
  ErrorCode,
  makeError,
  publicDiceCard,
  seededIndex,
  seededShuffle,
  type DiceAction,
  type DiceCard,
  type DiceConfig,
  type DiceDraw,
  type DiceFace,
  type DiceHistoryEntry,
  type DiceOutcome,
  type DicePublicView,
  type DiceStage,
  type GameContext,
  type GameEvent,
  type GameModule,
  type ReduceResult,
  type RoomPhase,
  type Seat,
  type Sex,
} from "@party-hub/shared";

/**
 * DICE - "Dare Roulette", server-authoritative state for the wild couples' game.
 *
 * THE LOOP: it's one seat's turn. They SPIN (the server draws the next dare from
 * a seeded, no-repeat deck) and ROLL a heat die (a modifier + point value). The
 * spinner is the performer. They mark it DONE (bank the die's points) or PASS
 * (score nothing - consent first, always allowed), then the turn passes. First
 * to the target score wins the set; a safeword ends it instantly for both.
 *
 * DETERMINISM: the deck is a seeded shuffle of the allowed pool, keyed by
 * room/epoch/cycle; the heat die is a seeded index keyed by room/epoch/turn. So
 * a reconnect replays the identical draw and a rematch (new epoch) plays fresh.
 *
 * NO PER-PLAYER SECRETS: both partners see the same board. `sanitizeFor` only
 * withholds the UNDRAWN deck (so the next dare stays a surprise).
 */
export interface DiceState {
  config: DiceConfig;

  roomCode: string;
  matchEpoch: number;

  /** setup → rolling → resolving → over. Drives phaseOf and the client layout. */
  stage: DiceStage;

  /**
   * Each seat's self-declared body, or null until set. Dice dares are solo, so
   * each seat draws from its OWN deck filtered to its OWN body - which is why we
   * can't build a deck (or leave "setup") until both have declared.
   */
  sexes: Record<Seat, Sex | null>;

  /** Whose turn it is to spin / perform. */
  turnSeat: Seat;
  /** 1-based index of the current turn (folded into the heat-die seed). */
  turnNumber: number;

  scores: Record<Seat, number>;

  /**
   * Per-seat draw state. Each seat has its OWN shuffled deck (filtered to that
   * seat's body), its own cursor, and its own reshuffle cycle - so the dares one
   * partner draws never depend on or collide with the other's. SECRET beyond the
   * card currently on the table.
   */
  decks: Record<Seat, DiceCard[]>;
  drawIndex: Record<Seat, number>;
  deckCycle: Record<Seat, number>;

  /** The dare on the table (present only while resolving). */
  current: DiceDraw | null;
  history: DiceHistoryEntry[];

  sessionEnded: boolean;
  winnerSeat: Seat | null;
}

function otherSeat(s: Seat): Seat {
  return s === "A" ? "B" : "A";
}

// ---- deterministic deck + die ----------------------------------------------

/** Bump when the card set / build changes so seeds intentionally diverge. */
const DICE_DECK_VERSION = "5";

function buildDeck(
  config: DiceConfig,
  roomCode: string,
  matchEpoch: number,
  cycle: number,
  seat: Seat,
  sex: Sex,
): DiceCard[] {
  const pool = dicePool(config, sex);
  // Seed per-seat (and per-body) so each partner's deck is independent and
  // reconnect-stable, and so a rematch/new cycle reshuffles differently.
  const seed = `${roomCode}#dice#v${DICE_DECK_VERSION}#epoch${matchEpoch}#seat${seat}#${sex}#cycle${cycle}`;
  return seededShuffle(pool, seed);
}

/** The heat-die face for a given turn - deterministic + reconnect-stable. */
function rollFace(state: DiceState): DiceFace {
  const seed = `${state.roomCode}#dice#heat#epoch${state.matchEpoch}#turn${state.turnNumber}`;
  return DICE_FACES[seededIndex(seed, DICE_FACES.length)] ?? DICE_FACES[1]!;
}

/** Normalize an incoming config into a safe, in-range shape. */
function normalizeConfig(config: DiceConfig): DiceConfig {
  const cats = DICE_CATEGORIES.filter((c) => config.categories?.includes(c));
  const safeCats = cats.length > 0 ? cats : DEFAULT_DICE_CONFIG.categories;
  const target = Number.isFinite(config.targetScore)
    ? Math.round(config.targetScore)
    : DEFAULT_DICE_CONFIG.targetScore;
  const safe: DiceConfig = {
    categories: safeCats,
    targetScore: Math.max(3, Math.min(30, target)),
    allowMedia: config.allowMedia !== false,
  };

  // Each seat's deck is built PER BODY (dicePool filters by the performer's sex)
  // and an empty deck can't be spun. Some selections yield NOTHING once media is
  // off - e.g. "exhibition" only, whose every dare is a media card - which would
  // strand a seat with no dares to draw and hang the whole turn. Guarantee a
  // playable deck for BOTH bodies: first re-enable media (the least-surprising
  // repair, since the emptiness comes from all-media categories), then, if still
  // empty, fall back to the full default category set. Belt-and-suspenders with
  // drawCard's own null guard so a degenerate config can never crash a room.
  const playable = (c: DiceConfig) =>
    dicePool(c, "female").length > 0 && dicePool(c, "male").length > 0;
  if (playable(safe)) return safe;
  const withMedia: DiceConfig = { ...safe, allowMedia: true };
  if (playable(withMedia)) return withMedia;
  return { ...withMedia, categories: [...DEFAULT_DICE_CONFIG.categories] };
}

// ---- set lifecycle ----------------------------------------------------------

function newSet(state: DiceState, ctx: GameContext): void {
  state.roomCode = ctx.code;
  state.matchEpoch = ctx.matchEpoch;
  // A fresh set/rematch always re-collects bodies (a new epoch could be a
  // different pair on the same device pair, and it's a natural re-consent point).
  state.sexes = { A: null, B: null };
  state.stage = "setup";
  // Seed the opening turn off the room/epoch so it's stable across reconnects
  // but varies on a rematch.
  const startSeed = `${ctx.code}#dice#start#epoch${ctx.matchEpoch}`;
  state.turnSeat = seededShuffle<Seat>(["A", "B"], startSeed)[0] ?? "A";
  state.turnNumber = 1;
  state.scores = { A: 0, B: 0 };
  state.deckCycle = { A: 0, B: 0 };
  state.decks = { A: [], B: [] };
  state.drawIndex = { A: 0, B: 0 };
  state.current = null;
  state.history = [];
  state.sessionEnded = false;
  state.winnerSeat = null;
}

/** Both bodies known ⇒ build each seat's own deck and open the first spin. */
function maybeBeginRolling(state: DiceState): void {
  const { A, B } = state.sexes;
  if (state.stage !== "setup" || !A || !B) return;
  state.decks = {
    A: buildDeck(state.config, state.roomCode, state.matchEpoch, 0, "A", A),
    B: buildDeck(state.config, state.roomCode, state.matchEpoch, 0, "B", B),
  };
  state.drawIndex = { A: 0, B: 0 };
  state.deckCycle = { A: 0, B: 0 };
  state.stage = "rolling";
}

/**
 * Draw the next card for a given seat from ITS OWN deck, reshuffling a fresh
 * cycle when that seat's deck runs out. Returns null only if the seat's pool is
 * genuinely empty (a degenerate config normalizeConfig is meant to have already
 * repaired) - the caller must handle that rather than deal an undefined card.
 */
function drawCard(state: DiceState, seat: Seat): DiceCard | null {
  const sex = state.sexes[seat]!; // guaranteed set once past setup
  if (state.drawIndex[seat] >= state.decks[seat].length) {
    state.deckCycle[seat] += 1;
    state.decks[seat] = buildDeck(
      state.config,
      state.roomCode,
      state.matchEpoch,
      state.deckCycle[seat],
      seat,
      sex,
    );
    state.drawIndex[seat] = 0;
  }
  // A rebuilt-but-still-empty deck means an empty pool: bail instead of reading
  // [][0] (which would fabricate `undefined` past a non-null assertion and crash
  // sanitizeFor / the client). This is a backstop; normalizeConfig prevents it.
  const card = state.decks[seat][state.drawIndex[seat]] ?? null;
  if (card === null) return null;
  state.drawIndex[seat] += 1;
  return card;
}

// ---- actions ----------------------------------------------------------------

type ActionResult = { events: GameEvent[]; error?: ReturnType<typeof makeError> };
const reject = (code: ErrorCode): ActionResult => ({ events: [], error: makeError(code) });

function applySetSex(state: DiceState, seat: Seat, sex: Sex): ActionResult {
  if (state.sessionEnded) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (sex !== "female" && sex !== "male") return reject(ErrorCode.INVALID_ACTION);
  // Only settable during setup, and only once - each seat's deck is baked to its
  // declared body the moment both are in, so changing it mid-set is nonsense.
  if (state.stage !== "setup") return reject(ErrorCode.INVALID_ACTION);
  if (state.sexes[seat] !== null) return reject(ErrorCode.INVALID_ACTION);

  state.sexes[seat] = sex;
  // When both are in, build each seat's deck and open the first spin.
  maybeBeginRolling(state);
  return { events: [] };
}

/** Your turn: draw the next dare + roll the heat die. */
function applySpin(state: DiceState, seat: Seat): ActionResult {
  if (state.sessionEnded) return reject(ErrorCode.GAME_NOT_ACTIVE);
  // No spinning until both bodies are declared and the decks are built.
  if (state.stage !== "rolling") return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (seat !== state.turnSeat) return reject(ErrorCode.NOT_YOUR_TURN);

  const card = drawCard(state, seat);
  // Backstop for a degenerate (empty-pool) deck that slipped past normalizeConfig:
  // reject the spin cleanly instead of putting an undefined card on the table.
  if (!card) return reject(ErrorCode.GAME_NOT_ACTIVE);
  const face = rollFace(state);
  state.current = { card, face, performerSeat: seat };
  state.stage = "resolving";
  return { events: [] };
}

/** Resolve the dare on the table: bank the points (done) or skip it (pass). */
function applyResolve(state: DiceState, seat: Seat, outcome: DiceOutcome): ActionResult {
  if (state.sessionEnded) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (state.stage !== "resolving") return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (outcome !== "done" && outcome !== "pass") return reject(ErrorCode.INVALID_ACTION);

  const draw = state.current;
  if (!draw) return reject(ErrorCode.INVALID_ACTION);
  // Only the performer (whose turn it is) resolves - no acting for your partner.
  if (draw.performerSeat !== seat) return reject(ErrorCode.NOT_YOUR_TURN);

  const scored = outcome === "done" ? draw.face.points : 0;
  state.scores[seat] += scored;
  state.history.push({
    card: draw.card,
    face: draw.face,
    performerSeat: draw.performerSeat,
    outcome,
    scored,
  });
  state.current = null;

  const events: GameEvent[] = [];
  if (state.scores[seat] >= state.config.targetScore) {
    // Target reached - the set is decided.
    state.stage = "over";
    state.winnerSeat = seat;
    events.push({ kind: "match_over", winnerSeat: seat });
  } else {
    // Pass the turn to the other seat and cue their spin.
    state.turnSeat = otherSeat(seat);
    state.turnNumber += 1;
    state.stage = "rolling";
  }
  return { events };
}

function applySafeword(state: DiceState): ActionResult {
  if (state.sessionEnded) return reject(ErrorCode.GAME_NOT_ACTIVE);
  // Ends immediately for BOTH, no blame. A fresh set requires an explicit
  // rematch (a new, mutually-initiated start).
  state.sessionEnded = true;
  state.stage = "over";
  state.winnerSeat = null;
  return { events: [{ kind: "match_over", winnerSeat: "tie" }] };
}

// ---- the module -------------------------------------------------------------

export function createDiceModule(
  config: DiceConfig = DEFAULT_DICE_CONFIG,
): GameModule<DiceState, DiceAction, DicePublicView> {
  const safeConfig = normalizeConfig(config);

  return {
    id: "dice",

    createInitialState(ctx: GameContext): DiceState {
      const state: DiceState = {
        config: safeConfig,
        roomCode: ctx.code,
        matchEpoch: ctx.matchEpoch,
        stage: "setup",
        sexes: { A: null, B: null },
        turnSeat: "A",
        turnNumber: 1,
        scores: { A: 0, B: 0 },
        decks: { A: [], B: [] },
        drawIndex: { A: 0, B: 0 },
        deckCycle: { A: 0, B: 0 },
        current: null,
        history: [],
        sessionEnded: false,
        winnerSeat: null,
      };
      newSet(state, ctx);
      return state;
    },

    reduce(state, action, playerId, ctx): ReduceResult<DiceState> {
      const seat = ctx.seatOf(playerId);
      if (!seat) return { state, error: makeError(ErrorCode.NOT_IN_ROOM) };

      let res: ActionResult;
      switch (action.type) {
        case "set_sex": {
          const p = action.payload as { sex?: unknown } | undefined;
          if (typeof p?.sex !== "string") {
            return { state, error: makeError(ErrorCode.INVALID_ACTION) };
          }
          res = applySetSex(state, seat, p.sex as Sex);
          break;
        }
        case "spin":
          res = applySpin(state, seat);
          break;
        case "resolve": {
          const p = action.payload as { outcome?: unknown } | undefined;
          if (typeof p?.outcome !== "string") {
            return { state, error: makeError(ErrorCode.INVALID_ACTION) };
          }
          res = applyResolve(state, seat, p.outcome as DiceOutcome);
          break;
        }
        case "safeword":
          res = applySafeword(state);
          break;
        default:
          return { state, error: makeError(ErrorCode.INVALID_ACTION) };
      }

      if (res.error) return { state, error: res.error };
      return { state, events: res.events, nextPhase: this.phaseOf(state) };
    },

    sanitizeFor(state, playerId, ctx): DicePublicView {
      const seat = ctx.seatOf(playerId);
      const opp = seat ? otherSeat(seat) : null;
      return {
        gameId: "dice",
        config: state.config,
        stage: state.stage,
        yourSeat: seat,
        // Your own body (drives the setup gate); only whether the OTHER declared,
        // never any per-seat deck (those stay secret so the next dare surprises).
        yourSex: seat ? state.sexes[seat] : null,
        opponentSexSet: opp ? state.sexes[opp] !== null : false,
        turnSeat: state.turnSeat,
        yourTurn: seat !== null && seat === state.turnSeat,
        turnNumber: state.turnNumber,
        scores: { A: state.scores.A, B: state.scores.B },
        targetScore: state.config.targetScore,
        // The current draw is public to both - but only while it's on the table.
        // Strip each card's server-only `requires` tag (see publicDiceCard) so a
        // peer can't read the opponent's body off their body-filtered dares.
        current:
          state.stage === "resolving" && state.current
            ? { ...state.current, card: publicDiceCard(state.current.card) }
            : null,
        history: state.history.map((h) => ({ ...h, card: publicDiceCard(h.card) })),
        sessionEnded: state.sessionEnded,
        winnerSeat: state.winnerSeat,
      };
    },

    phaseOf(state): RoomPhase {
      // A single set to the target score IS the match - so "over" (won or
      // safeworded) maps straight to game_over, which gates the rematch.
      if (state.sessionEnded || state.stage === "over") return "game_over";
      return "in_game";
    },

    isValidAction(action: unknown): action is DiceAction {
      if (typeof action !== "object" || action === null) return false;
      const t = (action as { type?: unknown }).type;
      return t === "set_sex" || t === "spin" || t === "resolve" || t === "safeword";
    },
  };
}
