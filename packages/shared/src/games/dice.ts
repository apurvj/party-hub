/**
 * DICE - "Dare Roulette" for two consenting adult partners who want to go
 * hard (built for long-distance couples ready to take it to the next level).
 *
 * THE LOOP: on your turn you SPIN the roulette (the server draws the next wild
 * dare from a seeded, no-repeat deck) and ROLL a six-sided HEAT die (a modifier
 * that dials the intensity up and sets how many points the dare is worth). The
 * spinner is the performer - so "whose task is it?" is never ambiguous: it's
 * whoever's turn it is. Mark it DONE to bank the points, or PASS (always allowed
 * - consent first) to draw the next one. First to the target score wins the set.
 *
 * TONE: this deck is WILD ONLY - explicit kink, BDSM, anal, impact, edging,
 * degradation, the works - snapped out as short second-person COMMANDS ("Kneel.
 * Count each one out loud."), which is what sets Dice's voice apart from Match's
 * flowing first-person desire menu. There is no sweet/flirty option by design.
 *
 * NO SECRETS: unlike Match, nothing here is hidden per-player - both partners
 * see the same dare, die, and scores. `sanitizeFor` still withholds the UNDRAWN
 * deck order (so the next dare stays a surprise) and exposes only the current
 * draw + resolved history.
 *
 * CONSENT / SAFETY (first-class, because this is intense adult play):
 *   • Every category is opt-in at room creation - a couple excludes anything
 *     they're not into, and the deck is filtered to exactly what they picked.
 *   • PASS carries no penalty beyond not scoring: you can always decline a
 *     specific dare without ending the session.
 *   • Either partner can hit the SAFEWORD at any moment to end it for both,
 *     no questions asked.
 *   • Media cards (photo/video/voice) are flagged and can be excluded entirely.
 */

/**
 * Dice owns the hard-KINK MECHANIC vocabulary (impact, edging, degradation,
 * climax control, …) - deliberately different from Match's acts-and-positions
 * language, so the two decks never read alike. Note `improv` instead of "toys":
 * Dice leans on HANDS & HOUSEHOLD objects (a cucumber, a hairbrush handle, a
 * belt, ice) so nobody needs to own gear - toys are welcome but never required.
 */
import { bodyCanPerform, type BodyReq, type Sex } from "../sex.js";

export type DiceCategory =
  | "bdsm"
  | "anal"
  | "oral"
  | "improv"
  | "impact"
  | "edging"
  | "worship"
  | "exhibition"
  | "roleplay"
  | "dirtytalk"
  | "degradation"
  | "climax";

export const DICE_CATEGORIES: DiceCategory[] = [
  "bdsm",
  "anal",
  "oral",
  "improv",
  "impact",
  "edging",
  "worship",
  "exhibition",
  "roleplay",
  "dirtytalk",
  "degradation",
  "climax",
];

export const DICE_CATEGORY_META: Record<DiceCategory, { label: string; emoji: string }> = {
  bdsm: { label: "Dom / sub", emoji: "⛓️" },
  anal: { label: "Anal", emoji: "🍑" },
  oral: { label: "Oral", emoji: "👅" },
  improv: { label: "Improvise", emoji: "🥒" },
  impact: { label: "Impact", emoji: "✋" },
  edging: { label: "Edging", emoji: "🥵" },
  worship: { label: "Worship", emoji: "🙇" },
  exhibition: { label: "Show off", emoji: "🎥" },
  roleplay: { label: "Roleplay", emoji: "🎭" },
  dirtytalk: { label: "Filthy talk", emoji: "🗣️" },
  degradation: { label: "Degradation", emoji: "😈" },
  climax: { label: "Climax control", emoji: "💦" },
};

/** A single wild dare. Card TEXT is public (both partners rate/see it). */
export interface DiceCard {
  id: string;
  category: DiceCategory;
  text: string;
  /** Involves sending/recording a photo, video, or voice note. */
  media?: boolean;
  /**
   * Which body the PERFORMER needs. Dice dares are solo (you do them to
   * yourself on your own turn), so this is filtered per-performer via
   * bodyCanPerform: "female" = a dare for a vulva, "male" = a dare for a penis.
   * Omitted ⇒ anatomy-neutral (anyone can do it). "mixed" is never used here.
   */
  requires?: BodyReq;
}

/**
 * The HEAT die. Each face is a modifier that reshapes the drawn dare and sets
 * its point value - higher heat, bigger risk, more points. Rolled together with
 * every spin. `value` is the literal d6 pip count (1–6) for the die visual.
 */
export interface DiceFace {
  value: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  modifier: string;
  points: number;
  emoji: string;
}

export const DICE_FACES: DiceFace[] = [
  { value: 1, emoji: "🐌", label: "Slow burn", modifier: "Do it teasingly slow - drag every second out and don't rush the finish.", points: 1 },
  { value: 2, emoji: "🎯", label: "As dared", modifier: "Exactly as written. No more, no less.", points: 1 },
  { value: 3, emoji: "✌️", label: "Double down", modifier: "Twice as long and twice as filthy - and say every dirty word out loud.", points: 2 },
  { value: 4, emoji: "🥒", label: "Improvise", modifier: "Grab a cucumber, a handle, ice - anything to hand - and work it in.", points: 2 },
  { value: 5, emoji: "🥵", label: "Edge", modifier: "Take yourself right to the brink - then stop dead. Do NOT finish.", points: 3 },
  { value: 6, emoji: "🔥", label: "No limits", modifier: "Go all the way. Your partner sets the pace and barks the orders - you obey.", points: 3 },
];

export interface DiceConfig {
  /** Which kink categories are in the deck (chosen at room creation). */
  categories: DiceCategory[];
  /** Points needed to win the set. */
  targetScore: number;
  /** Include media cards (photo/video/voice prompts)? */
  allowMedia: boolean;
}

export const DEFAULT_DICE_CONFIG: DiceConfig = {
  categories: [...DICE_CATEGORIES],
  targetScore: 12,
  allowMedia: true,
};

export type DiceSeat = "A" | "B";

/** How a dare was resolved. */
export type DiceOutcome = "done" | "pass";

/** Which stage the turn is in - drives the client layout. */
export type DiceStage =
  // Waiting for BOTH players to declare their body (set_sex) so each seat's deck
  // can be built to only the dares that seat's body can perform.
  | "setup"
  // The current player must SPIN (draw a dare + roll the heat die).
  | "rolling"
  // A dare is on the table; the performer marks it done or passes.
  | "resolving"
  // Someone hit the target score, or a safeword ended the set.
  | "over";

/** Actions a client dispatches for Dice (carried inside `game:action`). */
export type DiceAction =
  // Declare your body (once, at the consent gate) so your own deck only ever
  // hands you dares your body can perform. Must happen before the first spin.
  | { type: "set_sex"; payload: { sex: Sex } }
  // Your turn: spin the roulette + roll the heat die (one atomic move).
  | { type: "spin"; payload?: Record<string, never> }
  // Resolve the dare on the table: bank the points (done) or skip it (pass).
  | { type: "resolve"; payload: { outcome: DiceOutcome } }
  // End the whole set immediately for BOTH partners (the safeword). No blame.
  | { type: "safeword"; payload?: Record<string, never> };

/** A live draw: the dare on the table + the heat die + who performs it. */
export interface DiceDraw {
  card: DiceCard;
  face: DiceFace;
  performerSeat: DiceSeat;
}

/** A resolved dare, kept for the running history / recap. */
export interface DiceHistoryEntry {
  card: DiceCard;
  face: DiceFace;
  performerSeat: DiceSeat;
  outcome: DiceOutcome;
  /** Points banked (die points if done, 0 if passed). */
  scored: number;
}

/**
 * The per-player public view of Dice. Nothing here is a per-player secret - both
 * partners see the same board - but the UNDRAWN deck never ships, so the next
 * dare stays a surprise.
 */
export interface DicePublicView {
  gameId: "dice";
  config: DiceConfig;

  stage: DiceStage;
  /** Your seat (so the client can say "your turn" vs "their turn"). */
  yourSeat: DiceSeat | null;

  /** Your declared body, or null until you've set it (drives the setup gate). */
  yourSex: Sex | null;
  /** Whether your partner has declared theirs yet (drives the "waiting" copy). */
  opponentSexSet: boolean;

  /** Whose turn it is to spin / perform. */
  turnSeat: DiceSeat;
  /** Convenience: is it YOUR turn? */
  yourTurn: boolean;
  /** How many dares have been drawn so far this set. */
  turnNumber: number;

  /** Running score per seat, and the points needed to win. */
  scores: Record<DiceSeat, number>;
  targetScore: number;

  /** The dare currently on the table (present only in the "resolving" stage). */
  current: DiceDraw | null;
  /** Resolved dares so far, most recent last. */
  history: DiceHistoryEntry[];

  /** Set when someone ended the set early via the safeword. */
  sessionEnded: boolean;
  /** The winning seat once the set is decided (by score or safeword-tie=null). */
  winnerSeat: DiceSeat | null;
}

/**
 * THE CONTENT DECK - original, explicit, consenting-adults dares from the wild
 * end of the spectrum only. Written so they work for a couple on a video call or
 * across distance. Media-flagged cards are excluded when a couple turns media
 * off; categories let them exclude anything they're not into. Keep ids STABLE
 * (used as deterministic deck keys).
 *
 * ANATOMY: most dares are body-neutral (they say "yourself" / "where it counts",
 * never naming parts) and can be drawn by anyone. The `requires`-tagged blocks at
 * the end are the explicit, body-specific dares; because Dice dares are SOLO,
 * each seat is dealt a deck filtered to its OWN declared body (see dicePool +
 * bodyCanPerform), so a player is never handed a dare their body can't perform.
 */
export const DICE_CARDS: DiceCard[] = [
  // ---- BDSM / power exchange ------------------------------------------------
  { id: "d-bd-01", category: "bdsm", text: "Kneel. Hands behind your back. Beg for permission before you touch yourself - and don't until you get it." },
  { id: "d-bd-02", category: "bdsm", text: "You're theirs now. For three minutes you do only what they say, the instant they say it." },
  { id: "d-bd-03", category: "bdsm", text: "Collar up - belt or scarf around your throat. You call them Sir / Miss until your next turn." },
  { id: "d-bd-04", category: "bdsm", text: "Tie your own wrists with a scarf. Now you can't touch - just take whatever they describe doing to you." },
  { id: "d-bd-05", category: "bdsm", text: "Blindfold on. Hands off. You move only on their word, and not one second before." },
  { id: "d-bd-06", category: "bdsm", text: "On all fours, ass to the camera. Hold the pose and don't break it until they say you're done." },
  { id: "d-bd-07", category: "bdsm", text: "Ask permission out loud before every single touch for the next minute. No permission, no touch." },

  // ---- Anal -----------------------------------------------------------------
  { id: "d-an-01", category: "anal", text: "Slick a finger and work yourself open on camera - their pace, not yours. Slower means slower." },
  { id: "d-an-02", category: "anal", text: "Seat a plug and wear it the rest of the set. Clench on command, face to the camera every turn." },
  { id: "d-an-03", category: "anal", text: "Fill yourself and say out loud, filthily, exactly how deep and how full it feels." },
  { id: "d-an-04", category: "anal", text: "Spread on your knees and take their instructions for how hard they'd give it to you from behind." },
  { id: "d-an-05", category: "anal", text: "Rim a slicked finger in slow circles, teasing, until they tell you to push in." },

  // ---- Oral -----------------------------------------------------------------
  { id: "d-or-01", category: "oral", text: "Take two fingers all the way to the back of your throat, slow, exactly how they count it." },
  { id: "d-or-02", category: "oral", text: "Spit, get it messy, and show them the wet, sloppy way you'd suck them off." },
  { id: "d-or-03", category: "oral", text: "Tongue out. Show them the flat, dragging licks you'd give - base to tip - until they twitch." },
  { id: "d-or-04", category: "oral", text: "Beg them to sit on your face and say, out loud, every filthy thing you'd do down there." },

  // ---- Improvise: hands & household (no gear required) ----------------------
  { id: "d-ty-01", category: "improv", text: "Grab a cucumber or a thick handle. Take it slow and deep on camera, their tempo, no hands-free excuses." },
  { id: "d-ty-02", category: "improv", text: "Ride a pillow (or a wrapped bottle) like it's them - hips working, until they tell you to stop." },
  { id: "d-ty-03", category: "improv", text: "Press the back of an electric toothbrush / phone-on-vibrate where it counts and hold it there on their word." },
  { id: "d-ty-04", category: "improv", text: "Whatever's in reach - handle, ice, your own fist - use it exactly how they dictate, speed and depth." },
  { id: "d-ty-05", category: "improv", text: "Slick your palm and stroke / rub to the pace they clap out - faster, slower, stop, all on them." },

  // ---- Impact ---------------------------------------------------------------
  { id: "d-im-01", category: "impact", text: "Spank yourself hard. Count each one out loud. They decide the number - and when you stop." },
  { id: "d-im-02", category: "impact", text: "They pick the spot - leave a mark there. Bite, pinch or slap until it shows, then hold it to the camera." },
  { id: "d-im-03", category: "impact", text: "Take ten on the ass and thank them, out loud, after every single one." },
  { id: "d-im-04", category: "impact", text: "Slap your inner thigh closer and closer to the center - they call how high you're allowed to go." },

  // ---- Edging ---------------------------------------------------------------
  { id: "d-ed-01", category: "edging", text: "Right to the brink - then hands off. Show them the ruined, desperate face you're making." },
  { id: "d-ed-02", category: "edging", text: "Edge three times, no finishing. They count each one - lose count and you start over." },
  { id: "d-ed-03", category: "edging", text: "Stroke fast for ten of their counts, then dead stop for ten. Repeat until they let you off." },

  // ---- Climax control -------------------------------------------------------
  { id: "d-cl-01", category: "climax", text: "You finish only on their word. Hold it as long as they drag it out - beg if you have to." },
  { id: "d-cl-02", category: "climax", text: "Ruin it: take yourself over the edge, then rip your hands away the instant it starts. Show them." },
  { id: "d-cl-03", category: "climax", text: "Race - first one to finish while watching the other wins, and has to shout it as it happens." },
  { id: "d-cl-04", category: "climax", text: "Denied. You do NOT get to finish this turn - work yourself to the edge and leave it aching." },

  // ---- Worship --------------------------------------------------------------
  { id: "d-wo-01", category: "worship", text: "Hands everywhere they name, in the order they name it - worship your own body as their stand-in." },
  { id: "d-wo-02", category: "worship", text: "Lick and kiss slowly over the part of you they say they're obsessed with. Make them watch every second." },

  // ---- Exhibition (private, on camera) --------------------------------------
  { id: "d-ex-01", category: "exhibition", text: "Strip bare and stand fully exposed on camera. Turn slow when they tell you to. Let them look their fill.", media: true },
  { id: "d-ex-02", category: "exhibition", text: "Send a filthy full-length photo, posed down to the last detail exactly how they order it.", media: true },
  { id: "d-ex-03", category: "exhibition", text: "Record a ten-second clip finishing 'I want you to…' with the single filthiest thing in your head.", media: true },

  // ---- Filthy talk ----------------------------------------------------------
  { id: "d-dt-01", category: "dirtytalk", text: "Say your filthiest fantasy out loud, start to finish, no skipping the parts that embarrass you." },
  { id: "d-dt-02", category: "dirtytalk", text: "Beg, shameless, for exactly why you deserve to finish tonight. Sell it or you don't." },

  // ---- Degradation (consensual) ---------------------------------------------
  { id: "d-dg-01", category: "degradation", text: "Give them one minute to talk you down the fun way - and tell them, out loud, how much you love it." },
  { id: "d-dg-02", category: "degradation", text: "Say it plain: you're theirs to use. Then list every way you want them to use you." },

  // ---- Roleplay -------------------------------------------------------------
  { id: "d-rp-01", category: "roleplay", text: "Strangers who couldn't wait. No names, no giggling - pick it up mid-scene and stay filthy." },
  { id: "d-rp-02", category: "roleplay", text: "One of you is in trouble and has to earn forgiveness however the other demands. Pick who. Then obey." },

  // ---- BODY-SPECIFIC: female-bodied performer (a vulva) ---------------------
  // Only ever dealt to a seat that declared "female" - explicit clit/pussy dares.
  { id: "d-bf-01", category: "edging", requires: "female", text: "Rub your clit in tight circles right to the edge - then hands off and show them your soaked, twitching hips." },
  { id: "d-bf-02", category: "oral", requires: "female", text: "Two fingers deep, curled to the front wall, while your thumb works your clit. Narrate how wet you are." },
  { id: "d-bf-03", category: "climax", requires: "female", text: "Grind your clit against the heel of your hand and don't stop until they say you're allowed to soak the sheets." },
  { id: "d-bf-04", category: "impact", requires: "female", text: "Slap your clit lightly, then rub it hard - alternate on their count of 'sting' and 'soothe'." },
  { id: "d-bf-05", category: "improv", requires: "female", text: "Ride a wrapped bottle or your own fingers, hips working, and spread wide so they see exactly how deep you take it." },

  // ---- BODY-SPECIFIC: male-bodied performer (a cock) ------------------------
  // Only ever dealt to a seat that declared "male" - explicit cock/balls dares.
  { id: "d-bm-01", category: "edging", requires: "male", text: "Stroke slow, thumb over the head, right to the leak - then let go and show them how hard you're aching." },
  { id: "d-bm-02", category: "climax", requires: "male", text: "Grip the base tight like a cock ring and jerk fast. You finish only when they finish the countdown." },
  { id: "d-bm-03", category: "worship", requires: "male", text: "Tug your balls and stroke at once, slow, and tell them out loud exactly how badly you need to come." },
  { id: "d-bm-04", category: "degradation", requires: "male", text: "Jerk it rough to their filthy commentary - faster, slower, 'don't you dare come yet' - and thank them for it." },
  { id: "d-bm-05", category: "improv", requires: "male", text: "Slick your fist and fuck it hard at the pace they clap out - hips off the bed, no slowing down until they say." },
];

/**
 * Build the pool of cards allowed by a config (category + media filters) AND by
 * the PERFORMER's body (anatomy filter, via bodyCanPerform). Pure and
 * order-stable (canonical DICE_CARDS order); the seeded shuffle is applied
 * separately so this stays testable.
 *
 * `performerSex` is required because every Dice dare is solo - it's done on your
 * own turn to your own body - so a body-specific dare only belongs in a seat's
 * deck if that seat's body can do it. Each seat gets its OWN filtered deck, which
 * is why Dice needs both players declared before the first spin.
 */
export function dicePool(config: DiceConfig, performerSex: Sex): DiceCard[] {
  const cats = new Set(config.categories);
  return DICE_CARDS.filter(
    (c) =>
      cats.has(c.category) &&
      (config.allowMedia || !c.media) &&
      bodyCanPerform(c.requires, performerSex),
  );
}

/**
 * Project a card to its CLIENT-SAFE shape by dropping the `requires` anatomy
 * tag. That tag is server-only (it builds each seat's body-filtered deck) and is
 * never rendered. The drawn card + full history ship to BOTH partners, so a
 * `requires: "male"`/`"female"` on the opponent's history entries would let a
 * peer infer their declared body in devtools - which sanitizeFor otherwise
 * exposes only as the boolean `opponentSexSet`. Everything the client shows
 * (text, category, media) is preserved. Pure.
 */
export function publicDiceCard(card: DiceCard): DiceCard {
  if (card.requires === undefined) return card;
  const { requires: _omit, ...rest } = card;
  return rest;
}
