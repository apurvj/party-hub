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
   * "male" = both have a penis, "mixed" = one of each. Omitted ⇒ anatomy-neutral,
   * but the shipping deck sets it on EVERY card - each is raw and body-specific,
   * so a couple only ever sees acts their two declared bodies can perform.
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
 * PERSON PLURAL ("I want him…", "Let's have her…", "I want us to…") because Match
 * is about finding what you BOTH want to do together - the mutual "yes" pile
 * becomes the night's playlist. This shared "we/us" voice is what keeps Match
 * distinct from Dice's snapped-out one-line commands.
 *
 * Tiered by intensity; `wild` is opt-in rough/kink. Media-flagged cards are
 * excluded when a couple turns media off. Keep ids STABLE (deterministic keys).
 *
 * ANATOMY: EVERY card is body-specific, raw and explicit - each one names the
 * exact parts (clit / pussy / folds / nipples for a vulva; cock / dick / balls /
 * shaft / head for a penis) and the exact act. There are no body-neutral cards.
 * The deck is split into three `requires` blocks - MIXED (one of each body, and
 * every card spells out what HE does with his cock and what SHE does with her
 * pussy), FEMALE (two vulvas), and MALE (two cocks) - and matchPool +
 * coupleCanPerform deal a couple only the block their two declared bodies can
 * actually do. Each block covers all four tiers, so any tier selection is
 * playable for any couple. That's what lets a couple go raw and specific without
 * ever handing them an act their bodies can't perform.
 */
export const MATCH_CARDS: MatchCard[] = [
  // ---- BODY-SPECIFIC: one of each (a MIXED couple) --------------------------
  // Only dealt when the two bodies differ. Every card names what HE does with his
  // cock/balls and what SHE does with her clit/pussy, played off each other.
  { id: "m-sweet-01", tier: "sweet", category: "romance", requires: "mixed", text: "I want him stroking his dick slow and steady while she rubs her clit in easy circles - matched pace, eyes locked, like we're touching each other through the camera." },
  { id: "m-sweet-02", tier: "sweet", category: "foreplay", requires: "mixed", text: "Let's have him squeeze his shaft gently while she strokes her pussy lips slow - both taking our time, no rush, building that feeling together from across the distance." },
  { id: "m-sweet-03", tier: "sweet", category: "messages", requires: "mixed", text: "I want to watch you stroke your cock while reading what I'm typing about touching my clit for you - words and strokes in sync, slow and sensual." },
  { id: "m-sweet-04", tier: "sweet", category: "oral", requires: "mixed", text: "I want him stroking his cock slow while he sucks his own fingers like he's tasting her pussy, and her rubbing her clit while she sucks her fingers like they're his cock - both of us going down on each other in our heads, slow and sweet." },
  { id: "m-sweet-05", tier: "sweet", category: "positions", requires: "mixed", text: "I want him stroking his dick in long strokes while she spreads her pussy and plays with her folds - both of us stretched out naked, mirroring each other." },
  { id: "m-sweet-06", tier: "sweet", category: "tempo", requires: "mixed", text: "Let's have him match her rhythm - she rubs slow circles on her clit while he jerks his cock at that same peaceful pace, breathing together." },
  { id: "m-sweet-07", tier: "sweet", category: "roleplay", requires: "mixed", text: "I want him pretending he's inside you while stroking his cock slow, and you rubbing your clit like he's really there - roleplay the intimacy we're missing." },
  { id: "m-flirty-01", tier: "flirty", category: "romance", requires: "mixed", text: "I want him teasing his balls while you tease your clit - light touches, building tension, both of us watching for the moment we lose control together." },
  { id: "m-flirty-02", tier: "flirty", category: "foreplay", requires: "mixed", text: "Let's have him stroking his shaft hard and fast while she fingers her pussy faster too - matching energy, both getting more desperate, proving we want each other." },
  { id: "m-flirty-03", tier: "flirty", category: "toys", requires: "mixed", text: "I want to watch him stroke his cock while I'm using a toy on my clit - both of us playing with our favorite tools, racing to see who cums first." },
  { id: "m-flirty-04", tier: "flirty", category: "messages", requires: "mixed", media: true, text: "Send me a video of you jerking your cock while I film myself rubbing my clit - we'll watch each other's pleasure, tease about what we see." },
  { id: "m-flirty-05", tier: "flirty", category: "tempo", requires: "mixed", text: "I want him alternating slow and fast strokes on his dick while she does the same to her clit - keep me guessing, keep that heat building." },
  { id: "m-flirty-06", tier: "flirty", category: "oral", requires: "mixed", text: "Let's have him suck two fingers deep and moan like it's your pussy on his tongue while he strokes his cock, and you suck your fingers and moan like they're his cock while you rub your clit - filthy sounds traded back and forth." },
  { id: "m-flirty-07", tier: "flirty", category: "positions", requires: "mixed", text: "I want him on his back stroking his cock while you're on your back spreading your pussy wider - both of us spread open, completely exposed to each other." },
  { id: "m-spicy-01", tier: "spicy", category: "foreplay", requires: "mixed", text: "I want him rubbing his cock head between his balls and shaft fast and hard, and you rubbing your pussy hard while pushing fingers deep inside - both of us chasing it." },
  { id: "m-spicy-02", tier: "spicy", category: "oral", requires: "mixed", text: "Let's have him fuck his fist hard around his shaft while you ride your own fingers deep in your pussy - match each other's aggression, don't hold back." },
  { id: "m-spicy-03", tier: "spicy", category: "positions", requires: "mixed", text: "I want him on his knees jerking his cock hard while you're in the same position rubbing your pussy faster - both of us fucking our own hands like they're each other." },
  { id: "m-spicy-04", tier: "spicy", category: "tempo", requires: "mixed", text: "I want him stroking his dick slow at first, building faster and faster, while you do the same to your clit - let's race to the edge and jump together." },
  { id: "m-spicy-05", tier: "spicy", category: "toys", requires: "mixed", text: "Let's have him stroking his cock while you ride a dildo in your pussy hard and fast - both of us fucking, both of us loud, both of us close to losing it." },
  { id: "m-spicy-06", tier: "spicy", category: "roleplay", requires: "mixed", text: "I want to watch him jerk his cock like he's fucking you hard, and you rub your clit like you're actually taking him - make me believe you want me that badly." },
  { id: "m-spicy-07", tier: "spicy", category: "messages", requires: "mixed", media: true, text: "I want you stroking your cock to audio of me moaning while fingering my pussy - we'll trade recordings, both getting off to each other's sounds." },
  { id: "m-wild-01", tier: "wild", category: "positions", requires: "mixed", text: "I want him on his back, balls drawn tight, stroking his cock hard while you squat and rub your pussy - both of us wide open, grinding against the camera." },
  { id: "m-wild-02", tier: "wild", category: "tempo", requires: "mixed", text: "Let's have him jerk his cock in quick rough strokes while you rub your clit hard and fast - both of us panting, both of us desperate, both of us coming hard." },
  { id: "m-wild-03", tier: "wild", category: "toys", requires: "mixed", text: "I want him fucking his hand hard around his shaft while you rub a vibrator hard on your clit at full speed - both of us getting wrecked, making ourselves cum loud." },
  { id: "m-wild-04", tier: "wild", category: "roleplay", requires: "mixed", text: "I want him talking dirty about what he'd do to your pussy while stroking his cock, and you pushing your fingers deep in your pussy while listening to every word he says." },
  { id: "m-wild-05", tier: "wild", category: "oral", requires: "mixed", text: "Let's have him deep-throat a cucumber, gagging on it like it's a cock while he strokes himself, and you finger your pussy and rub your clit - both of us filthy, both of us taking it hard." },
  { id: "m-wild-06", tier: "wild", category: "foreplay", requires: "mixed", text: "I want him pulling his cock hard and rough, twisting at the tip, while you're fucking your pussy deep with your fingers, both of us violent and desperate." },
  { id: "m-wild-07", tier: "wild", category: "messages", requires: "mixed", media: true, text: "I want you to describe exactly how you're stroking your cock while I describe exactly how I'm fingering my pussy - raw voice notes, no censoring, just pure filth." },

  // ---- BODY-SPECIFIC: two vulvas (both partners FEMALE-bodied) --------------
  // Only dealt when BOTH declared "female" - explicit clit/pussy/nipple acts.
  { id: "m-f-01", tier: "sweet", category: "romance", requires: "female", text: "I want us to lie facing each other, touching our own clits while looking into each other's eyes the whole time." },
  { id: "m-f-02", tier: "sweet", category: "foreplay", requires: "female", text: "Let's trace our own nipples slowly, describing to each other how it feels, and see how turned on we can get just from talking." },
  { id: "m-f-03", tier: "sweet", category: "messages", requires: "female", media: true, text: "Send me a voice note whispering exactly what you want to do to my pussy - I want to hear your breathing get heavier." },
  { id: "m-f-04", tier: "sweet", category: "tempo", requires: "female", text: "Let's touch our own pussies at exactly the same pace - start slow, count aloud to stay in sync, build together." },
  { id: "m-f-05", tier: "flirty", category: "foreplay", requires: "female", text: "I want us to watch each other slip our hands into our pants and rub our clits through the fabric first - just teasing ourselves." },
  { id: "m-f-06", tier: "flirty", category: "oral", requires: "female", text: "Let's both get a toy shaped like a tongue and trace our own nipples and pussies with it while narrating what we'd do to each other." },
  { id: "m-f-07", tier: "flirty", category: "tempo", requires: "female", text: "Rub your clit in figure-eights, slow at first, then faster and faster - I'll do the same and we'll race to who cums first." },
  { id: "m-f-08", tier: "flirty", category: "roleplay", requires: "female", text: "Pretend we both just got home and desperate - narrate what you want me to do to your pussy while we rub our own clits and tease each other." },
  { id: "m-f-09", tier: "spicy", category: "positions", requires: "female", text: "Sit facing me and spread your pussy open with your fingers so I can see everything - I'll do the same and we'll both rub our clits." },
  { id: "m-f-10", tier: "spicy", category: "toys", requires: "female", text: "Let's each use a vibrator - you on your clit, me on mine - and trade off controlling each other's speed on a shared timer." },
  { id: "m-f-11", tier: "spicy", category: "foreplay", requires: "female", text: "I want to watch you fuck your pussy with a dildo while you play with your nipples - then I'll grab my own and use it exactly the way you just showed me while you watch." },
  { id: "m-f-12", tier: "spicy", category: "oral", requires: "female", text: "Let's pretend we're eating each other out - describe every lick on our clits and pussies while we finger ourselves exactly as you describe." },
  { id: "m-f-13", tier: "wild", category: "tempo", requires: "female", text: "Fuck yourself hard with your fingers on your pussy while rubbing your clit fast - I'll match your rhythm and we'll both cum hard together." },
  { id: "m-f-14", tier: "wild", category: "toys", requires: "female", text: "Use a vibrator on your clit to edge yourself three times before cumming - describe every denial to me while I do the same, and we cum on your count." },
  { id: "m-f-15", tier: "wild", category: "roleplay", requires: "female", text: "Take turns being in control - one tells the other exactly how fast to rub our clits and pussy, then we switch who decides." },
  { id: "m-f-16", tier: "wild", category: "positions", requires: "female", text: "Get on your knees, arch your back, and fuck your pussy with a dildo while I watch you rub your clit and pinch your nipples hard." },

  // ---- BODY-SPECIFIC: two cocks (both partners MALE-bodied) ------------------
  // Only dealt when BOTH declared "male" - explicit cock/balls/shaft acts.
  { id: "m-m-01", tier: "sweet", category: "romance", requires: "male", text: "I want us to strip slowly for each other on camera, touching our own chests and thighs, building anticipation before we even stroke our cocks." },
  { id: "m-m-02", tier: "sweet", category: "foreplay", requires: "male", text: "Let's kiss our own forearms and work our hands down to stroke our dicks slowly, making eye contact, showing each other every touch." },
  { id: "m-m-03", tier: "sweet", category: "messages", requires: "male", media: true, text: "Send me a voice note describing exactly what you want to do to my cock, then play it back while you stroke your cock slow and deep." },
  { id: "m-m-04", tier: "sweet", category: "tempo", requires: "male", text: "Let's masturbate together, matching each other's rhythm - slow and steady strokes on our shafts, breathing together." },
  { id: "m-m-05", tier: "flirty", category: "foreplay", requires: "male", text: "I want us to get our cocks hard, then use just our thumbs on the heads, teasing each other over video for five minutes without stroking." },
  { id: "m-m-06", tier: "flirty", category: "foreplay", requires: "male", text: "Let's lick our lips while stroking our cocks, tracing our fingers around the heads, making it obvious how turned on we are." },
  { id: "m-m-07", tier: "flirty", category: "roleplay", requires: "male", text: "Pretend you're watching me stroke my cock and you can't touch your dick - describe what you'd do if you could, then we both stroke our cocks faster." },
  { id: "m-m-08", tier: "flirty", category: "tempo", requires: "male", text: "Let's stroke our cocks fast then slow, alternating on command - you count to ten and we switch pace, building tension." },
  { id: "m-m-09", tier: "spicy", category: "positions", requires: "male", text: "I want us both on our knees facing the camera, stroking our hard cocks in sync, gripping the base and working the head the same way at the same time like we're jerking each other off." },
  { id: "m-m-10", tier: "spicy", category: "oral", requires: "male", text: "Let's both deep-throat a cucumber or a thick handle like it's the other's cock - gag on it, drool, stroke our own cocks while we do it, showing each other what we love." },
  { id: "m-m-11", tier: "spicy", category: "tempo", requires: "male", text: "Stroke your cock hard and fast to match my pace exactly - no mercy, building to the edge together, stopping just before we come." },
  { id: "m-m-12", tier: "spicy", category: "toys", requires: "male", text: "Use a toy on your cock - fuck it with your dick while I watch and stroke my cock, then describe how it feels and make me cum with words." },
  { id: "m-m-13", tier: "wild", category: "roleplay", requires: "male", text: "Tell me I'm not allowed to cum until you give permission - stroke your cock while you watch me edge, teasing and denying." },
  { id: "m-m-14", tier: "wild", category: "oral", requires: "male", text: "Let's both fuck our own mouths with a cucumber or dildo, gagging on it like it's the other's cock, jerking our cocks with the other hand till we come as hard as we can - raw, loud, no holding back." },
  { id: "m-m-15", tier: "wild", category: "tempo", requires: "male", text: "I want us to fist our cocks matched stroke for stroke, thumbs working the heads hard, rough and fast until one of us has to stop." },
  { id: "m-m-16", tier: "wild", category: "roleplay", requires: "male", text: "Demand I stroke my cock faster for you - use a commanding voice while you grip your shaft and pump hard, dominating me with your pleasure." },
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
