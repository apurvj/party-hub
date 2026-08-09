/**
 * MATCH - a private desire-matching game for two consenting adult partners
 * (built for long-distance couples). Each partner privately swipes yes / maybe /
 * no on a shared deck of intimate ideas. NEITHER partner ever sees the other's
 * individual votes. The ONLY thing revealed is a MUTUAL match: a card both said
 * "yes" to. That privacy is structural, not a policy - see the SECURITY
 * INVARIANT below - so no one is ever exposed for wanting something the other
 * didn't.
 *
 * SECURITY / PRIVACY INVARIANT (the whole point of the game):
 *   • A player's own votes are their secret, exactly like the Wordle answer or an
 *     Uno hand. `sanitizeFor` NEVER includes the opponent's per-card votes.
 *   • The opponent is represented only by a COUNT (how many cards they've voted
 *     on) and by the set of MUTUAL matches (cards you BOTH said yes to - safe to
 *     reveal because both consented). Nothing else about their choices leaks.
 *
 * CONSENT / SAFETY DESIGN (this is adult content, so the rails are first-class):
 *   • Spice tiers (sweet → flirty → spicy → wild) are chosen at room creation so
 *     a couple sets their own comfort ceiling. "wild" includes explicit
 *     kink/BDSM ideas; it is opt-in.
 *   • Media cards (send a photo / video / voice note) are flagged and can be
 *     excluded entirely with `allowMedia: false`. The app itself stores no media
 *     - any capture/sharing happens on the couple's own call. These are prompts.
 *   • Either partner can end the session at any moment (the "safeword" action);
 *     it ends immediately for both, no questions asked.
 */

import { coupleCanPerform, type BodyReq, type Sex } from "../sex.js";

export type MatchTier = "sweet" | "flirty" | "spicy" | "wild";

/** Ordered from tamest to most intense - used for ramp + UI ordering. */
export const MATCH_TIERS: MatchTier[] = ["sweet", "flirty", "spicy", "wild"];

export const MATCH_TIER_META: Record<
  MatchTier,
  { label: string; blurb: string; emoji: string }
> = {
  sweet: { label: "Sweet", blurb: "Slow, sensual & intimate", emoji: "💗" },
  flirty: { label: "Flirty", blurb: "Teasing & hands-on", emoji: "😏" },
  spicy: { label: "Spicy", blurb: "Explicit acts & positions", emoji: "🔥" },
  wild: { label: "Wild", blurb: "Rough, kink & power", emoji: "⛓️" },
};

/**
 * Match's category vocabulary is deliberately the language of ACTS & POSITIONS
 * (a shared "desire menu") - distinct from Dice, which owns the hard-kink
 * MECHANIC vocabulary (impact/edging/degradation/…). This keeps the two games
 * from overlapping: Match is "what do we both want to do to each other", Dice is
 * "the raw command the wheel just handed you".
 */
export type MatchCategory =
  | "romance"
  | "foreplay"
  | "oral"
  | "positions"
  | "tempo"
  | "toys"
  | "roleplay"
  | "messages";

/** A single desire prompt. Card TEXT is not secret (both partners rate it); only
 *  each player's VOTE is secret. `media` flags cards that involve capturing or
 *  sending a photo / video / voice note, so they can be filtered out. */
export interface MatchCard {
  id: string;
  tier: MatchTier;
  category: MatchCategory;
  text: string;
  /** Involves sending/recording a photo, video, or voice note. */
  media?: boolean;
  /**
   * Which bodies the couple needs for this act. Match filters the shared deck by
   * the COUPLE (see coupleCanPerform): "female" = both partners have a vulva,
   * "male" = both have a penis, "mixed" = one of each. Omitted ⇒ anatomy-neutral
   * (any couple can do it). Cards are written so the neutral ones dominate and
   * the body-specific ones fill in the raw, explicit acts one body enables.
   */
  requires?: BodyReq;
}

export type MatchVote = "yes" | "maybe" | "no";

export interface MatchConfig {
  /** Which spice tiers are in play (chosen at room creation). */
  tiers: MatchTier[];
  /** How many cards this session's deck holds (server clamps to pool size). */
  deckSize: number;
  /** Include media cards (photo/video/voice prompts)? */
  allowMedia: boolean;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  tiers: ["sweet", "flirty", "spicy", "wild"],
  deckSize: 24,
  allowMedia: true,
};

export type MatchSeat = "A" | "B";

/** How a matched dare was resolved during the play-out phase. */
export type MatchDareOutcome = "done" | "skip";

/** Which stage the session is in - drives what the client renders. */
export type MatchStage =
  // Waiting for BOTH partners to declare their body (set_sex). The deck can't be
  // built until then, because which cards are in play depends on both bodies.
  | "setup"
  // Partners are still privately swiping the deck.
  | "voting"
  // Both finished; the matched cards are now dares, performed turn by turn.
  | "dares"
  // Every dare resolved (or there were none) - the wrap-up recap.
  | "summary";

/** Actions a client dispatches for Match (carried inside `game:action`). */
export type MatchAction =
  // Declare your body (once, at the consent gate) so the deck is filtered to
  // acts your couple can perform. Must happen before voting can begin.
  | { type: "set_sex"; payload: { sex: Sex } }
  // Rate the current card. Recorded privately; a mutual "yes" becomes a match.
  | { type: "vote"; payload: { cardId: string; vote: MatchVote } }
  // During play-out: mark the CURRENT dare done (or skipped) and pass the turn.
  | { type: "dare_advance"; payload: { outcome: MatchDareOutcome } }
  // End the whole session immediately for BOTH partners (the safeword). No blame.
  | { type: "safeword"; payload?: Record<string, never> }
  // After the deck is done, both signal ready for a fresh deck (new epoch).
  | { type: "next_round"; payload?: Record<string, never> };

/** A revealed mutual match - both partners said "yes" to this card. */
export interface MatchHit {
  card: MatchCard;
}

/**
 * A matched card promoted to a dare in the play-out phase. `performerSeat` is who
 * carries it out; the two seats alternate through the matched pile so the work is
 * shared. `outcome` is null while the dare is still pending.
 */
export interface MatchDare {
  card: MatchCard;
  performerSeat: MatchSeat;
  outcome: MatchDareOutcome | null;
}

/**
 * The sanitized, per-player view of Match state. Safe to inspect in devtools:
 * your OWN votes/progress are here; the opponent is only a progress COUNT plus
 * the mutually-agreed matches. Their individual yes/maybe/no choices are absent.
 */
export interface MatchPublicView {
  gameId: "match";
  config: MatchConfig;

  /** Which stage the session is in - the client switches its whole layout on this. */
  stage: MatchStage;
  /** Your seat, so the client can tell "your turn" from "their turn" in the dares. */
  yourSeat: MatchSeat | null;

  /** Your declared body, or null until you've set it (drives the setup gate). */
  yourSex: Sex | null;
  /** Whether your partner has declared theirs yet (never WHICH - not needed here). */
  opponentSexSet: boolean;

  /** Total cards in this session's deck. */
  deckSize: number;
  /** The next card YOU still need to vote on, or null if you've finished. */
  currentCard: MatchCard | null;
  /** How many cards you have voted on so far. */
  youVotedCount: number;
  /** Your own vote on each card you've rated (your private info - you may see it). */
  yourVotes: { cardId: string; vote: MatchVote }[];

  /** Opponent progress - a COUNT only. Never their individual votes. */
  opponentVotedCount: number;

  /** Cards you BOTH said yes to, revealed (order = when the match completed). */
  matches: MatchHit[];

  youFinished: boolean;
  opponentFinished: boolean;

  // ---- play-out (stage === "dares") ----------------------------------------
  /** The full matched pile as ordered, performer-assigned dares. */
  dares: MatchDare[];
  /** Index into `dares` of the dare being performed now (−1 when none pending). */
  currentDareIndex: number;
  /** The dare being performed right now, or null outside the dares stage. */
  currentDare: MatchDare | null;
  /** Convenience: is the current dare YOURS to perform? */
  yourTurn: boolean;
  /** How many dares are done/skipped so far (for the progress readout). */
  daresResolved: number;

  /** Set when someone ended the session early via the safeword. */
  sessionEnded: boolean;

  /** Between-decks readiness (mirrors the other games' next_round handshake). */
  youReady: boolean;
  opponentReady: boolean;
}

/**
 * THE CONTENT DECK - a shared DESIRE MENU. Every card is written in the FIRST
 * PERSON PLURAL ("I want us to…", "Let's…", "Show me how you'd…") because Match
 * is about finding what you BOTH want to do together - the mutual "yes" pile
 * becomes the night's playlist. This voice, and the focus on ACTS & POSITIONS
 * (much of it drawn from the Kamasutra / Ananga Ranga tradition), is what keeps
 * Match distinct from Dice's snapped-out one-line commands.
 *
 * Tiered by intensity; `wild` is opt-in rough/kink. Toys are deliberately RARE
 * and every toy card names a hands/household alternative, so nobody needs gear.
 * Media-flagged cards are excluded when a couple turns media off. Keep ids STABLE
 * (used as deterministic deck keys).
 *
 * ANATOMY: most cards are body-neutral ("stroke / rub yourself", "where it
 * counts") and play for any couple. The `requires`-tagged blocks at the end are
 * the explicit, body-specific acts (two vulvas / two cocks / one of each) and are
 * only dealt to a couple whose two declared bodies can actually do them - see
 * matchPool + coupleCanPerform. That's what lets a couple go raw and specific
 * without ever handing someone an act their body can't perform.
 */
export const MATCH_CARDS: MatchCard[] = [
  // ---- SWEET - slow, sensual, building heat --------------------------------
  { id: "m-sw-01", tier: "sweet", category: "romance", text: "I want us to undress each other slowly on camera, one piece at a time, no rushing." },
  { id: "m-sw-02", tier: "sweet", category: "foreplay", text: "Let's trace our own necks, collarbones and inner thighs in sync - wherever we wish the other's mouth was." },
  { id: "m-sw-03", tier: "sweet", category: "tempo", text: "I want us to kiss the air like we're kissing each other - deep and slow - for one full minute." },
  { id: "m-sw-04", tier: "sweet", category: "foreplay", text: "Let's give ourselves a slow oil massage on camera, hands drifting lower each pass." },
  { id: "m-sw-05", tier: "sweet", category: "romance", text: "I want us to lie back, look into the camera, and say the filthiest thing we've ever wanted from each other." },
  { id: "m-sw-06", tier: "sweet", category: "foreplay", text: "Let's run an ice cube slowly over our lips, throat and chest while the other watches." },
  { id: "m-sw-07", tier: "sweet", category: "tempo", text: "I want us to touch ourselves over our underwear only - no skin yet - until one of us begs to go further." },
  { id: "m-sw-08", tier: "sweet", category: "romance", text: "Let's take turns naming one thing we'd do to each other the second we're finally in the same bed." },
  { id: "m-sw-09", tier: "sweet", category: "messages", text: "I want us to send a voice note breathing out exactly what we're aching for right now.", media: true },
  { id: "m-sw-10", tier: "sweet", category: "foreplay", text: "Let's suck on two fingers, slow, showing each other exactly how we'd use our mouths." },

  // ---- FLIRTY - hands-on, teasing, foreplay proper -------------------------
  { id: "m-fl-01", tier: "flirty", category: "foreplay", text: "I want us to strip fully naked on the call and just look, hands behind our backs, until we can't stand it." },
  { id: "m-fl-02", tier: "flirty", category: "tempo", text: "Let's touch ourselves at the exact same slow pace - one of us calls faster / slower / stop." },
  { id: "m-fl-03", tier: "flirty", category: "oral", text: "I want us to show each other, on our fingers, precisely how we'd lick, suck and swirl our tongue over the other." },
  { id: "m-fl-04", tier: "flirty", category: "positions", text: "Let's get on all fours facing away, look back over our shoulder, and show how we'd want to be taken like this." },
  { id: "m-fl-05", tier: "flirty", category: "foreplay", text: "I want us to spit in our palm and stroke / rub ourselves slow while holding eye contact." },
  { id: "m-fl-06", tier: "flirty", category: "messages", text: "Let's each send one filthy photo, framed exactly how the other asks for it.", media: true },
  { id: "m-fl-07", tier: "flirty", category: "positions", text: "I want us to lie back and pull our knees to our chest, fully open to the camera, and hold it there." },
  { id: "m-fl-08", tier: "flirty", category: "tempo", text: "Let's edge together: right to the brink, then hands off and show each other our desperate faces." },
  { id: "m-fl-09", tier: "flirty", category: "roleplay", text: "I want us to play it like we snuck away mid-party - quiet, quick, can't-get-caught energy." },
  { id: "m-fl-10", tier: "flirty", category: "oral", text: "Let's grind against a pillow between our legs like it's the other, and let them hear it." },
  { id: "m-fl-11", tier: "flirty", category: "foreplay", text: "I want us to give running dirty commentary out loud on every single thing we're doing to ourselves." },
  { id: "m-fl-12", tier: "flirty", category: "messages", text: "Let's each record a ten-second clip finishing 'When I get you alone I'm going to…'", media: true },

  // ---- SPICY - explicit acts & Kamasutra positions -------------------------
  { id: "m-sp-01", tier: "spicy", category: "oral", text: "I want us to go down on each other in a filthy mimed 69 - both of us working, moaning into it." },
  { id: "m-sp-02", tier: "spicy", category: "positions", text: "Let's act out cowgirl: one rides an upright pillow / hand, the other lies back and watches every bounce." },
  { id: "m-sp-03", tier: "spicy", category: "positions", text: "I want us to do the Kamasutra 'lotus' - seated, wrapped around each other - and grind in that clinch." },
  { id: "m-sp-04", tier: "spicy", category: "tempo", text: "Let's finish together on a shared countdown from ten, no stopping, eyes locked." },
  { id: "m-sp-05", tier: "spicy", category: "positions", text: "I want us to do doggy against the headboard - on our knees, back arched, thrusting into our own hand." },
  { id: "m-sp-06", tier: "spicy", category: "oral", text: "Let's take a cucumber / two fingers all the way and show each other exactly how deep we can go." },
  { id: "m-sp-07", tier: "spicy", category: "positions", text: "I want us to try the 'Ananga Ranga' rider - lie flat, one straddles high on the hips and rolls slow." },
  { id: "m-sp-08", tier: "spicy", category: "tempo", text: "Let's race - first one over the edge while watching the other wins, and has to say so out loud." },
  { id: "m-sp-09", tier: "spicy", category: "toys", text: "I want us to use whatever's within reach - a toy, a hairbrush handle, or just fingers - and narrate every second." },
  { id: "m-sp-10", tier: "spicy", category: "positions", text: "Let's do the 'splitting bamboo' - one leg up on our shoulder - and show how deep that angle would let us go." },
  { id: "m-sp-11", tier: "spicy", category: "messages", text: "I want us to trade a full-length nude video moving exactly how the other tells us to.", media: true },
  { id: "m-sp-12", tier: "spicy", category: "oral", text: "Let's sit back, spread, and touch ourselves right where we'd guide the other's tongue - slow circles." },
  { id: "m-sp-13", tier: "spicy", category: "positions", text: "I want us to mime spooning sex: on our side, one behind, hips rolling in that lazy deep rhythm." },
  { id: "m-sp-14", tier: "spicy", category: "tempo", text: "Let's do stop-and-start five times - full stop the instant the other says 'stop', hold, then go again." },

  // ---- WILD - rough, kink, power, degradation ------------------------------
  { id: "m-wl-01", tier: "wild", category: "roleplay", text: "I want us to pick dom and sub for the next ten minutes - the sub does nothing without permission." },
  { id: "m-wl-02", tier: "wild", category: "positions", text: "Let's do 'the press' rough - knees pinned to chest, pounding into our own hand hard and fast on command." },
  { id: "m-wl-03", tier: "wild", category: "roleplay", text: "I want us to spank ourselves where the other points and count each one out loud - they say when to stop." },
  { id: "m-wl-04", tier: "wild", category: "roleplay", text: "Let's each put a belt or scarf around our own throat as a collar and answer to Sir / Miss all round." },
  { id: "m-wl-05", tier: "wild", category: "tempo", text: "I want the dom to run the other's orgasm entirely - allowed only on their word, denied as long as they like." },
  { id: "m-wl-06", tier: "wild", category: "positions", text: "Let's do face-down, ass-up, and rut into the mattress hard while the other calls the pace." },
  { id: "m-wl-07", tier: "wild", category: "roleplay", text: "I want us to tie our own wrists with a soft scarf and be talked through being used, completely helpless." },
  { id: "m-wl-08", tier: "wild", category: "roleplay", text: "Let's leave a mark - a bite or a hard pinch where the other chooses - and show the camera the proof." },
  { id: "m-wl-09", tier: "wild", category: "roleplay", text: "I want us to beg, out loud and shameless, for exactly what we want done to us - no dignity left." },
  { id: "m-wl-10", tier: "wild", category: "positions", text: "Let's mime standing-carry sex against the wall - pinned, legs up, taken hard and fast." },
  { id: "m-wl-11", tier: "wild", category: "toys", text: "I want us to work a toy (or a cucumber / thick handle) while the other dictates depth, speed and 'don't you dare stop'." },
  { id: "m-wl-12", tier: "wild", category: "roleplay", text: "Let's play strangers who couldn't wait - filthy, no names, pure use, both fully in character." },

  // ---- BODY-SPECIFIC: two vulvas (both partners female-bodied) --------------
  // Only dealt when BOTH partners declared "female" - explicit clit/pussy acts.
  { id: "m-bf-01", tier: "flirty", category: "foreplay", requires: "female", text: "I want us to roll our own nipples and tease slow circles just around our clits - never quite on it - until we're begging." },
  { id: "m-bf-02", tier: "spicy", category: "tempo", requires: "female", text: "Let's rub our clits in exact sync - slow, then fast on a shared count - and see who soaks through first." },
  { id: "m-bf-03", tier: "spicy", category: "oral", requires: "female", text: "I want us to push two fingers deep, drag them out slow, and show each other on camera how wet we are." },
  { id: "m-bf-04", tier: "spicy", category: "positions", requires: "female", text: "Let's fuck ourselves with two fingers curled to the front wall and grind the heel of our hand on our clit." },
  { id: "m-bf-05", tier: "wild", category: "roleplay", requires: "female", text: "I want us to lightly slap our own clit then rub it hard - the other calls 'sting', then 'soothe', over and over." },

  // ---- BODY-SPECIFIC: two cocks (both partners male-bodied) ------------------
  // Only dealt when BOTH partners declared "male" - explicit cock/balls acts.
  { id: "m-bm-01", tier: "flirty", category: "foreplay", requires: "male", text: "I want us to spit in our palms and stroke slow, thumbs working the head, edging right to the leak and backing off." },
  { id: "m-bm-02", tier: "spicy", category: "tempo", requires: "male", text: "Let's fist our cocks matched stroke for stroke - same rhythm - until one of us has to slow the other down." },
  { id: "m-bm-03", tier: "spicy", category: "foreplay", requires: "male", text: "I want us to tug our balls and stroke at the same time, narrating out loud exactly how close we are." },
  { id: "m-bm-04", tier: "wild", category: "positions", requires: "male", text: "Let's grip the base tight like a cock ring and stroke hard and fast - the other counts down to when we're allowed to finish." },
  { id: "m-bm-05", tier: "wild", category: "roleplay", requires: "male", text: "I want us to jerk it rough to the other's filthy commentary - faster, slower, don't you dare come yet." },

  // ---- BODY-SPECIFIC: one of each (a mixed couple) --------------------------
  // Only dealt when the two bodies differ - acts that play the two parts off each other.
  { id: "m-bx-01", tier: "spicy", category: "tempo", requires: "mixed", text: "I want the one with the cock to stroke while the one with the pussy rides two fingers - matched pace, finish together." },
  { id: "m-bx-02", tier: "spicy", category: "positions", requires: "mixed", text: "Let's mime it from behind - she grinds back on her hand while he fucks his fist at the pace she calls." },
  { id: "m-bx-03", tier: "wild", category: "roleplay", requires: "mixed", text: "I want her to ride his face in mime while he strokes - she says the word before he's allowed to move his hand." },
  { id: "m-bx-04", tier: "flirty", category: "oral", requires: "mixed", text: "Let's do a countdown 69 - each working ourselves exactly how we'd work the other's parts, moaning into it." },
];

/**
 * Build the pool of cards allowed by a config (tier + media filters) AND by the
 * couple's two bodies (anatomy filter, via coupleCanPerform). Pure and
 * order-stable (the canonical MATCH_CARDS order); the seeded shuffle is applied
 * separately so this stays testable.
 *
 * The two sexes are required: Match's deck is a MUTUAL menu, so a body-specific
 * card only belongs in the deck if the couple's bodies can actually do it. This
 * is why voting can't start until BOTH partners have declared (see the module's
 * "setup" stage) - there's no correct deck to build otherwise.
 */
export function matchPool(config: MatchConfig, sexA: Sex, sexB: Sex): MatchCard[] {
  const tiers = new Set(config.tiers);
  return MATCH_CARDS.filter(
    (c) =>
      tiers.has(c.tier) &&
      (config.allowMedia || !c.media) &&
      coupleCanPerform(c.requires, sexA, sexB),
  );
}

/**
 * Project a card to its CLIENT-SAFE shape by dropping the `requires` anatomy
 * tag. That tag is server-only: it's used to build the body-filtered deck and is
 * never rendered. Because the deck is already filtered by the couple's bodies,
 * leaking `requires` to the client would let a peer read it off the deck in
 * devtools and infer the opponent's declared body - which sanitizeFor otherwise
 * exposes only as the boolean `opponentSexSet`. Everything the client actually
 * shows (text, tier, category, media) is preserved. Order-stable + pure.
 */
export function publicMatchCard(card: MatchCard): MatchCard {
  if (card.requires === undefined) return card;
  const { requires: _omit, ...rest } = card;
  return rest;
}
