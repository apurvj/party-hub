import {
  DEFAULT_MATCH_CONFIG,
  ErrorCode,
  MATCH_TIERS,
  matchPool,
  makeError,
  publicMatchCard,
  seededShuffle,
  type GameContext,
  type GameEvent,
  type GameModule,
  type MatchAction,
  type MatchCard,
  type MatchConfig,
  type MatchDare,
  type MatchDareOutcome,
  type MatchHit,
  type MatchPublicView,
  type MatchStage,
  type MatchVote,
  type ReduceResult,
  type RoomPhase,
  type Seat,
  type Sex,
} from "@party-hub/shared";

/**
 * MATCH - server-authoritative state for the couples' desire-matching game.
 *
 * PRIVACY INVARIANT (the entire reason this game exists): each seat's per-card
 * votes are SECRET, exactly like a Wordle answer or an Uno hand. `sanitizeFor`
 * projects a view that contains YOUR OWN votes but only a COUNT of the
 * opponent's progress plus the set of MUTUAL matches (cards you BOTH said yes
 * to - safe to reveal because both consented). A player's individual
 * yes/maybe/no on a card the other didn't also say yes to NEVER leaves the
 * server. This is enforced structurally in sanitizeFor, not by UI convention.
 *
 * DETERMINISM: the session deck is a seeded shuffle of the allowed card pool
 * (tier + media filters), keyed by room/match/round - so reconnect replays the
 * identical deck and "new deck" (next round) reshuffles differently.
 *
 * PLAY-OUT: once both partners finish voting, the matched pile is frozen into an
 * ordered list of DARES (`stage === "dares"`). Partners alternate as performer
 * (starting seat seeded per round for fairness), taking turns marking each dare
 * done or skipped. When every dare is resolved the stage moves to "summary".
 */
export interface MatchState {
  config: MatchConfig;
  roundNumber: number;

  roomCode: string;
  matchEpoch: number;

  /** setup → voting → dares → summary. Drives phaseOf and the client layout. */
  stage: MatchStage;

  /**
   * Each seat's self-declared body, or null until they set it. The deck can't be
   * built until BOTH are known (the couple's bodies decide which body-specific
   * cards belong), so a fresh round starts in the "setup" stage with an empty
   * deck and only fills it once both are declared.
   */
  sexes: Record<Seat, Sex | null>;

  /** This session's ordered deck (card text is public; votes are the secret). */
  deck: MatchCard[];

  /** SECRET: each seat's private vote per card id. Never sanitized to the peer. */
  votes: Record<Seat, Record<string, MatchVote>>;

  /** Card ids both seats said "yes" to, in the order the match completed. */
  matchedCardIds: string[];

  /**
   * The frozen play-out list - populated when voting ends. Empty until then and
   * whenever there were no mutual matches. `outcome` is null while pending.
   */
  dares: MatchDare[];
  /** Cursor into `dares`; every dare before it is resolved. */
  currentDareIndex: number;

  /** True once either partner ends the session early (the safeword). */
  sessionEnded: boolean;

  readyForNext: Record<Seat, boolean>;
}

function otherSeat(s: Seat): Seat {
  return s === "A" ? "B" : "A";
}

// ---- deterministic deck -----------------------------------------------------

/** Bump when the card set / build changes so seeds intentionally diverge. */
const MATCH_DECK_VERSION = "2";

function buildDeck(
  config: MatchConfig,
  roomCode: string,
  roundNumber: number,
  matchEpoch: number,
  sexA: Sex,
  sexB: Sex,
): MatchCard[] {
  const pool = matchPool(config, sexA, sexB);
  // Fold the two bodies into the seed so two different couples (or the same
  // couple who re-declared) get an intentionally different shuffle, and so the
  // seed is stable for a given couple across reconnects.
  const seed = `${roomCode}#match#v${MATCH_DECK_VERSION}#epoch${matchEpoch}#round${roundNumber}#${sexA}${sexB}`;
  const shuffled = seededShuffle(pool, seed);
  const size = Math.max(1, Math.min(config.deckSize, shuffled.length));
  return shuffled.slice(0, size);
}

/** Normalize an incoming config into a safe, in-range shape. */
function normalizeConfig(config: MatchConfig): MatchConfig {
  const tiers = MATCH_TIERS.filter((t) => config.tiers?.includes(t));
  const safeTiers = tiers.length > 0 ? tiers : DEFAULT_MATCH_CONFIG.tiers;
  const size = Number.isFinite(config.deckSize) ? Math.round(config.deckSize) : DEFAULT_MATCH_CONFIG.deckSize;
  return {
    tiers: safeTiers,
    deckSize: Math.max(4, Math.min(60, size)),
    allowMedia: config.allowMedia !== false,
  };
}

// ---- round / session helpers -----------------------------------------------

/**
 * Reset for a fresh round. Bodies (`sexes`) persist across rounds within a match
 * - a couple declares once - so if both are already known we build the deck and
 * jump straight to voting; otherwise we sit in "setup" until both declare, at
 * which point applySetSex builds the deck. `preserveSexes` is false only on a
 * brand-new match (createInitialState / rematch via a fresh epoch) where nobody
 * has declared yet.
 */
function newRound(state: MatchState, ctx: GameContext, roundNumber: number, preserveSexes: boolean): void {
  state.roundNumber = roundNumber;
  state.roomCode = ctx.code;
  state.matchEpoch = ctx.matchEpoch;
  if (!preserveSexes) state.sexes = { A: null, B: null };
  state.votes = { A: {}, B: {} };
  state.matchedCardIds = [];
  state.dares = [];
  state.currentDareIndex = 0;
  state.sessionEnded = false;
  state.readyForNext = { A: false, B: false };

  const { A, B } = state.sexes;
  if (A && B) {
    state.stage = "voting";
    state.deck = buildDeck(state.config, ctx.code, roundNumber, ctx.matchEpoch, A, B);
  } else {
    // Bodies not both known yet - wait for set_sex to build the deck.
    state.stage = "setup";
    state.deck = [];
  }
}

/** Both bodies known ⇒ build this round's deck and open voting. */
function maybeBeginVoting(state: MatchState): void {
  const { A, B } = state.sexes;
  if (state.stage !== "setup" || !A || !B) return;
  state.deck = buildDeck(state.config, state.roomCode, state.roundNumber, state.matchEpoch, A, B);
  state.stage = "voting";
}

/** First deck card this seat has NOT yet voted on (their "current" card). */
function currentCardFor(state: MatchState, seat: Seat): MatchCard | null {
  const mine = state.votes[seat];
  return state.deck.find((c) => !(c.id in mine)) ?? null;
}

function seatFinished(state: MatchState, seat: Seat): boolean {
  return currentCardFor(state, seat) === null;
}

function votingComplete(state: MatchState): boolean {
  return seatFinished(state, "A") && seatFinished(state, "B");
}

/** The matched cards in match-completion order, resolved to full card objects. */
function matchedCards(state: MatchState): MatchCard[] {
  return state.matchedCardIds
    .map((id) => state.deck.find((c) => c.id === id))
    .filter((c): c is MatchCard => Boolean(c));
}

/**
 * Freeze the matched pile into performer-assigned dares and enter the play-out
 * stage - or skip straight to the summary when there were no mutual matches.
 * Deterministic: the starting performer is seeded per round so a reconnect
 * rebuilds the identical turn order, and the two seats strictly alternate so the
 * dares are shared evenly.
 */
function beginDares(state: MatchState): void {
  const cards = matchedCards(state);
  // Seed the starting performer off the round so it's stable across reconnects
  // but varies round to round.
  const startSeed = `${state.roomCode}#match#dares#epoch${state.matchEpoch}#round${state.roundNumber}`;
  const startSeat: Seat = seededShuffle<Seat>(["A", "B"], startSeed)[0] ?? "A";

  state.dares = cards.map((card, i) => ({
    card,
    performerSeat: (i % 2 === 0 ? startSeat : otherSeat(startSeat)) as Seat,
    outcome: null,
  }));
  state.currentDareIndex = 0;
  state.stage = state.dares.length > 0 ? "dares" : "summary";
}

// ---- actions ----------------------------------------------------------------

type ActionResult = { events: GameEvent[]; error?: ReturnType<typeof makeError> };
const reject = (code: ErrorCode): ActionResult => ({ events: [], error: makeError(code) });

function applySetSex(state: MatchState, seat: Seat, sex: Sex): ActionResult {
  if (state.sessionEnded) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (sex !== "female" && sex !== "male") return reject(ErrorCode.INVALID_ACTION);
  // Only settable during setup, and only once - after the deck is built the
  // couple's bodies are baked into it, so changing a body mid-deck is nonsense.
  if (state.stage !== "setup") return reject(ErrorCode.INVALID_ACTION);
  if (state.sexes[seat] !== null) return reject(ErrorCode.INVALID_ACTION);

  state.sexes[seat] = sex;
  // When both are in, build the deck and open voting.
  maybeBeginVoting(state);
  return { events: [] };
}

function applyVote(state: MatchState, seat: Seat, cardId: string, vote: MatchVote): ActionResult {
  if (state.sessionEnded) return reject(ErrorCode.GAME_NOT_ACTIVE);
  // No voting until the deck exists (both bodies declared).
  if (state.stage !== "voting") return reject(ErrorCode.GAME_NOT_ACTIVE);
  const card = state.deck.find((c) => c.id === cardId);
  if (!card) return reject(ErrorCode.INVALID_ACTION);
  // One vote per card - no changing your mind (keeps the reveal honest and the
  // opponent's count monotonic). Also blocks a client voting out of order.
  if (cardId in state.votes[seat]) return reject(ErrorCode.INVALID_ACTION);
  if (vote !== "yes" && vote !== "maybe" && vote !== "no") return reject(ErrorCode.INVALID_ACTION);

  state.votes[seat][cardId] = vote;

  const events: GameEvent[] = [];
  // A mutual YES becomes a revealed match (only when BOTH have said yes).
  if (
    vote === "yes" &&
    state.votes[otherSeat(seat)][cardId] === "yes" &&
    !state.matchedCardIds.includes(cardId)
  ) {
    state.matchedCardIds.push(cardId);
  }

  // When both partners finish the whole deck, freeze the matched pile into dares
  // and enter the play-out stage. If there were no matches, beginDares() drops
  // straight to the summary - which IS round-over, so signal it.
  if (votingComplete(state)) {
    beginDares(state);
    // No mutual matches ⇒ beginDares drops straight to summary (empty dare list),
    // which IS round-over. (Checked via dares length, not stage: TS has narrowed
    // stage to "voting" from the guard above and can't see beginDares' mutation.)
    if (state.dares.length === 0) events.push({ kind: "round_over", winnerSeat: null });
  }
  return { events };
}

/**
 * Resolve the current dare (done/skip) and pass the turn. Only the performer of
 * the current dare may advance it - the watcher can't skip on their behalf. When
 * the last dare resolves, the stage moves to "summary" (round over).
 */
function applyDareAdvance(state: MatchState, seat: Seat, outcome: MatchDareOutcome): ActionResult {
  if (state.sessionEnded) return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (state.stage !== "dares") return reject(ErrorCode.GAME_NOT_ACTIVE);
  if (outcome !== "done" && outcome !== "skip") return reject(ErrorCode.INVALID_ACTION);

  const dare = state.dares[state.currentDareIndex];
  if (!dare) return reject(ErrorCode.INVALID_ACTION);
  // Only the person whose turn it is can advance - no acting for your partner.
  if (dare.performerSeat !== seat) return reject(ErrorCode.NOT_YOUR_TURN);

  dare.outcome = outcome;
  state.currentDareIndex += 1;

  const events: GameEvent[] = [];
  if (state.currentDareIndex >= state.dares.length) {
    state.stage = "summary";
    events.push({ kind: "round_over", winnerSeat: null });
  }
  return { events };
}

function applySafeword(state: MatchState): ActionResult {
  if (state.sessionEnded) return reject(ErrorCode.GAME_NOT_ACTIVE);
  // Ends immediately for BOTH, no blame. The room goes to game_over; a fresh
  // session requires an explicit rematch (a new, mutually-initiated start).
  state.sessionEnded = true;
  return { events: [{ kind: "match_over", winnerSeat: "tie" }] };
}

// ---- the module -------------------------------------------------------------

export function createMatchModule(
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): GameModule<MatchState, MatchAction, MatchPublicView> {
  const safeConfig = normalizeConfig(config);

  return {
    id: "match",

    createInitialState(ctx: GameContext): MatchState {
      const state: MatchState = {
        config: safeConfig,
        roundNumber: 0,
        roomCode: ctx.code,
        matchEpoch: ctx.matchEpoch,
        stage: "setup",
        sexes: { A: null, B: null },
        deck: [],
        votes: { A: {}, B: {} },
        matchedCardIds: [],
        dares: [],
        currentDareIndex: 0,
        sessionEnded: false,
        readyForNext: { A: false, B: false },
      };
      // Fresh match - nobody has declared a body yet, so start in setup.
      newRound(state, ctx, 1, false);
      return state;
    },

    reduce(state, action, playerId, ctx): ReduceResult<MatchState> {
      const seat = ctx.seatOf(playerId);
      if (!seat) return { state, error: makeError(ErrorCode.NOT_IN_ROOM) };

      if (action.type === "next_round") {
        // Only from the SUMMARY (all dares played out), and never after a
        // safeword (that ends the whole session).
        if (state.sessionEnded) return { state, error: makeError(ErrorCode.GAME_NOT_ACTIVE) };
        if (state.stage !== "summary") {
          return { state, error: makeError(ErrorCode.INVALID_ACTION) };
        }
        state.readyForNext[seat] = true;
        const bothReady = state.readyForNext.A && state.readyForNext.B;
        const soloOccupant = ctx.playerIdOf(otherSeat(seat)) === null;
        if (!bothReady && !soloOccupant) {
          return { state, events: [], nextPhase: this.phaseOf(state) };
        }
        // Bodies persist across decks within a match - a couple declares once.
        newRound(state, ctx, state.roundNumber + 1, true);
        return {
          state,
          events: [{ kind: "round_started", roundNumber: state.roundNumber }],
          nextPhase: this.phaseOf(state),
        };
      }

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
        case "vote": {
          const p = action.payload as { cardId?: unknown; vote?: unknown } | undefined;
          if (typeof p?.cardId !== "string" || typeof p.vote !== "string") {
            return { state, error: makeError(ErrorCode.INVALID_ACTION) };
          }
          res = applyVote(state, seat, p.cardId, p.vote as MatchVote);
          break;
        }
        case "dare_advance": {
          const p = action.payload as { outcome?: unknown } | undefined;
          if (typeof p?.outcome !== "string") {
            return { state, error: makeError(ErrorCode.INVALID_ACTION) };
          }
          res = applyDareAdvance(state, seat, p.outcome as MatchDareOutcome);
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

    sanitizeFor(state, playerId, ctx): MatchPublicView {
      const seat = ctx.seatOf(playerId);
      // Every card shipped to the client is projected through publicMatchCard,
      // which strips the server-only `requires` anatomy tag. Otherwise a peer
      // could read it off the deck/matches/dares in devtools and infer the
      // couple's bodies - which is meant to be exposed only as opponentSexSet.
      const hits: MatchHit[] = state.matchedCardIds
        .map((id) => state.deck.find((c) => c.id === id))
        .filter((c): c is MatchCard => Boolean(c))
        .map((card) => ({ card: publicMatchCard(card) }));

      const dares: MatchDare[] = state.dares.map((d) => ({
        ...d,
        card: publicMatchCard(d.card),
      }));
      const currentDare = dares[state.currentDareIndex] ?? null;
      const daresResolved = Math.min(state.currentDareIndex, state.dares.length);

      // Defense-in-depth: a seatless viewer gets everything the peers can share
      // (the deck size + mutual matches + dares) but NO individual votes at all.
      if (seat === null) {
        return {
          gameId: "match",
          config: state.config,
          stage: state.stage,
          yourSeat: null,
          yourSex: null,
          opponentSexSet: false,
          deckSize: state.deck.length,
          currentCard: null,
          youVotedCount: 0,
          yourVotes: [],
          opponentVotedCount: 0,
          matches: hits,
          youFinished: false,
          opponentFinished: false,
          dares,
          currentDareIndex: dares.length ? state.currentDareIndex : -1,
          currentDare,
          yourTurn: false,
          daresResolved,
          sessionEnded: state.sessionEnded,
          youReady: false,
          opponentReady: false,
        };
      }

      const opp = otherSeat(seat);
      const myVotes = state.votes[seat];
      // Preserve deck order so "your votes" reads consistently on the client.
      const yourVotes = state.deck
        .filter((c) => c.id in myVotes)
        .map((c) => ({ cardId: c.id, vote: myVotes[c.id]! }));

      return {
        gameId: "match",
        config: state.config,
        stage: state.stage,
        yourSeat: seat,
        yourSex: state.sexes[seat],
        opponentSexSet: state.sexes[opp] !== null,
        deckSize: state.deck.length,
        currentCard: (() => {
          const c = currentCardFor(state, seat);
          return c ? publicMatchCard(c) : null;
        })(),
        youVotedCount: yourVotes.length,
        yourVotes,
        // CRITICAL: the opponent is a COUNT only - never their per-card votes.
        opponentVotedCount: Object.keys(state.votes[opp]).length,
        matches: hits,
        youFinished: seatFinished(state, seat),
        opponentFinished: seatFinished(state, opp),
        dares,
        currentDareIndex: state.stage === "dares" ? state.currentDareIndex : -1,
        currentDare: state.stage === "dares" ? currentDare : null,
        yourTurn: state.stage === "dares" && currentDare?.performerSeat === seat,
        daresResolved,
        sessionEnded: state.sessionEnded,
        youReady: state.readyForNext[seat],
        opponentReady: state.readyForNext[opp],
      };
    },

    phaseOf(state): RoomPhase {
      if (state.sessionEnded) return "game_over";
      // The round is "over" only once the play-out is done (summary). During
      // setup (declaring bodies) and dares the room is still in_game - there's
      // live input to give / turn-taking to do.
      if (state.stage === "summary") return "round_over";
      return "in_game";
    },

    isValidAction(action: unknown): action is MatchAction {
      if (typeof action !== "object" || action === null) return false;
      const t = (action as { type?: unknown }).type;
      return (
        t === "set_sex" ||
        t === "vote" ||
        t === "dare_advance" ||
        t === "safeword" ||
        t === "next_round"
      );
    },
  };
}
