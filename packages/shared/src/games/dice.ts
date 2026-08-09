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
   * Omitted ⇒ anatomy-neutral, but the shipping deck sets it on EVERY card - each
   * is raw and body-specific, so a seat only ever draws dares its declared body
   * can perform. "mixed" is never used here (Dice is solo, never a couple act).
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
 * ANATOMY: EVERY dare is body-specific and raw - each one names the exact parts
 * (clit / pussy / folds / nipples / g-spot for a vulva; cock / dick / balls /
 * shaft / head for a penis) and the exact act. There are no body-neutral cards.
 * Because Dice dares are SOLO (done on your own turn to your own body), each seat
 * is dealt a deck filtered to its OWN declared body (see dicePool +
 * bodyCanPerform), so a player is only ever handed dares their body can perform.
 * Every category carries both a female-bodied (`d-f-*`) and a male-bodied
 * (`d-m-*`) variant, so any category selection is playable for either body.
 */
export const DICE_CARDS: DiceCard[] = [
  // ---- FEMALE-BODIED performer (a vulva) - explicit clit/pussy/folds dares ---
  // Only ever dealt to a seat that declared "female". Two per category.
  { id: "d-f-01", category: "bdsm", requires: "female", text: "Pin your nipples between your fingers, hold them tight - you don't come until I say. Kneel and prove you can take it." },
  { id: "d-f-02", category: "bdsm", requires: "female", text: "Sit with legs spread wide, hands behind your back. Clench your pussy muscles, pulse your clit with your inner walls. Hold that edge for two minutes." },
  { id: "d-f-03", category: "anal", requires: "female", text: "Press your finger against your asshole, feel it open. Work it in slow, one knuckle at a time. Make it burn." },
  { id: "d-f-04", category: "anal", requires: "female", text: "Spit on your finger and circle your ass. Push inside, twist deep, feel your sphincter clench around it. Three times, then stop." },
  { id: "d-f-05", category: "oral", requires: "female", text: "Suck two fingers deep into your mouth like it's a cock. Slobber on them, swirl your tongue around them and bob your head. No hands guiding - all mouth." },
  { id: "d-f-06", category: "oral", requires: "female", text: "Gag on your thumb - deep in your throat. Do it again. Let the spit drip down your chin. Three gags, count them." },
  { id: "d-f-07", category: "improv", requires: "female", text: "Find a smooth object from your kitchen - ice, handle, fruit. Slide it slowly over your pussy. Feel every inch. Don't rush." },
  { id: "d-f-08", category: "improv", requires: "female", text: "Take something cold from your fridge, rub it across your nipples until they're hard and tight. Then press it to your clit." },
  { id: "d-f-09", category: "impact", requires: "female", text: "Slap your pussy hard, five times. Count them out loud. Feel the sting on your folds. Make them red." },
  { id: "d-f-10", category: "impact", requires: "female", text: "Spank your ass cheeks until they're warm and red. Alternate sides. Feel the blood rush. Don't stop until you see the marks." },
  { id: "d-f-11", category: "edging", requires: "female", text: "Stroke your clit fast until you're right there, trembling. Then stop. Take your hands away for thirty seconds. Do it twice." },
  { id: "d-f-12", category: "edging", requires: "female", text: "Rub your pussy in circles, building it up. Get close, feel it building. Then pull back. Tease your clit for two minutes." },
  { id: "d-f-13", category: "worship", requires: "female", text: "Run your hands all over your body. Squeeze your breasts, drag your nails down your stomach, kiss your own neck. Worship what you are." },
  { id: "d-f-14", category: "worship", requires: "female", text: "Trace your folds with your finger, slowly, like you're discovering them for the first time. Appreciate every inch of your pussy." },
  { id: "d-f-15", category: "exhibition", requires: "female", media: true, text: "Spread your legs wide and show your pussy to the camera. Hold it open, let them see inside. Keep it there for thirty seconds." },
  { id: "d-f-16", category: "exhibition", requires: "female", media: true, text: "Record yourself playing with your tits. Suck your own nipple, squeeze them, show them off for the lens." },
  { id: "d-f-17", category: "roleplay", requires: "female", text: "Say you're a desperate whore. Stroke your clit while you beg. 'Please, I need it so bad.' Mean it." },
  { id: "d-f-18", category: "roleplay", requires: "female", text: "Act like you're being ordered. 'Show me your clit.' 'Touch your pussy.' Talk dirty as if someone's commanding you. Do what they say." },
  { id: "d-f-19", category: "dirtytalk", requires: "female", text: "Narrate what you're doing: 'I'm rubbing my clit, it's so wet and swollen.' Keep going, describe every sensation like you're telling a story." },
  { id: "d-f-20", category: "dirtytalk", requires: "female", text: "Say it out loud while you rub your clit. 'This pussy is for you. Look how wet I am.' Dirty, filthy, loud." },
  { id: "d-f-21", category: "degradation", requires: "female", text: "Say you're a slut while you rub your pussy. 'I'm such a dirty slut, look at me fuck myself.' Say it until you believe it." },
  { id: "d-f-22", category: "degradation", requires: "female", text: "Spit on your fingers and use the spit to rub your clit. Say what a mess you are: 'This is all I'm good for.' Own it." },
  { id: "d-f-23", category: "climax", requires: "female", text: "Rub your clit with your fingers, hard and fast. Build it up and let it crash. Don't stop. Cum." },
  { id: "d-f-24", category: "climax", requires: "female", text: "Fuck your pussy with your fingers, going deeper each time. Find your g-spot and rub it. Ride it until you cum hard." },

  // ---- MALE-BODIED performer (a cock) - explicit cock/balls/shaft dares ------
  // Only ever dealt to a seat that declared "male". Two per category.
  { id: "d-m-01", category: "bdsm", requires: "male", text: "Bind your balls tight with your belt. Stroke your cock slow while you're locked down. Earn the release." },
  { id: "d-m-02", category: "bdsm", requires: "male", text: "Tell yourself you're a filthy toy. Spit on your cock, stroke it hard. You don't come till I say you can." },
  { id: "d-m-03", category: "anal", requires: "male", text: "Lube your ass. Work one finger in slow, then two. Stroke your dick while you're opening up back there." },
  { id: "d-m-04", category: "anal", requires: "male", text: "Get on your knees, ass up. Finger-fuck your hole while you pump your cock. Don't waste it yet." },
  { id: "d-m-05", category: "oral", requires: "male", text: "Grip your shaft tight and stroke hard. Suck your thumb deep in your mouth like it's your cock. Choke on it. Then pump faster." },
  { id: "d-m-06", category: "oral", requires: "male", text: "Spit in your palm and stroke your cock. Lick your fingers, taste the pre mixed with spit. Suck your thumb deep and gag on it while you keep stroking." },
  { id: "d-m-07", category: "improv", requires: "male", text: "Grab a cucumber or bottle. Run it down your shaft while you stroke your cock with your other hand." },
  { id: "d-m-08", category: "improv", requires: "male", text: "Use a pillow under your hips. Hump it while you grip your dick tight, make it messy and wet." },
  { id: "d-m-09", category: "impact", requires: "male", text: "Slap your balls hard. Count to ten, one slap per number. Then stroke your cock fast to reward it." },
  { id: "d-m-10", category: "impact", requires: "male", text: "Slap your ass hard, then whip your cock against your thigh. Leave it red and throbbing. Stroke the pain away." },
  { id: "d-m-11", category: "edging", requires: "male", text: "Stroke your cock fast till your balls tighten. Get right to the edge. Then hands off. Watch it pulse. Do it three times." },
  { id: "d-m-12", category: "edging", requires: "male", text: "Grip the base of your shaft. Stroke the head only, fast, till you're leaking pre. Stop. Breathe. Repeat till you're shaking." },
  { id: "d-m-13", category: "worship", requires: "male", text: "Worship your cock with your hands. Massage your shaft slow and deliberate. Stroke it like you're adoring it. Tell it what a perfect tool it is." },
  { id: "d-m-14", category: "worship", requires: "male", text: "Massage your balls gently, tell them thank you. Run your fingers up your cock from base to tip slow, worship every inch. Treat yourself like a god." },
  { id: "d-m-15", category: "exhibition", requires: "male", media: true, text: "Show your hard cock on camera. Stroke it slow, let them watch every drip. Own it." },
  { id: "d-m-16", category: "exhibition", requires: "male", media: true, text: "Pump your dick fast on camera till you're glistening. Show them your balls, show them you're ready." },
  { id: "d-m-17", category: "roleplay", requires: "male", text: "You're a stripper. Dance for them, stroking your cock slow, showing it off. Build the tension." },
  { id: "d-m-18", category: "roleplay", requires: "male", text: "Pretend you're their personal toy. Stroke your dick on command, beg them to watch you work." },
  { id: "d-m-19", category: "dirtytalk", requires: "male", text: "Narrate what you're doing. 'Watch me stroke this cock. Balls tight. Shaft soaking wet.' Keep going, dirty." },
  { id: "d-m-20", category: "dirtytalk", requires: "male", text: "Tell them what your cock wants. 'My dick needs your mouth, your pussy, your ass.' Stroke and talk." },
  { id: "d-m-21", category: "degradation", requires: "male", text: "Tell yourself you're a cum-hungry slut. Stroke your desperate dick. You live to come for them." },
  { id: "d-m-22", category: "degradation", requires: "male", text: "Say 'I'm a dirty cocksucker.' Stroke your shaft hard while you say it. Own your filth." },
  { id: "d-m-23", category: "climax", requires: "male", text: "Build to it. Stroke your cock faster, grip tighter, make it throb. Let it explode, let them see every pulse." },
  { id: "d-m-24", category: "climax", requires: "male", text: "Edge once, twice, three times. On the fourth stroke, come hard. Paint your stomach, show them you're drained." },
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
