/**
 * Guess the Person ("Who am I?") domain types, shared between server and client.
 *
 * THE GAME (2-player, turn-based):
 *   • Both players see the SAME public board of {@link PEOPLE} faces, each with a
 *     fixed set of visible attributes (gender, eye color, skin tone, accessories,
 *     facial hair, hair length).
 *   • SELECTION: each round opens with both players secretly CHOOSING their own
 *     identity - the person their opponent must guess - by picking a face (or
 *     tapping "Surprise me" for a client-side random pick). The hunt doesn't begin
 *     until both have committed. Neither pick is ever revealed to the opponent
 *     until the round is over.
 *   • Play ALTERNATES. On your turn you either ask ONE yes/no question about your
 *     opponent's person ("blue eyes?", "wears a hat?") OR commit your one guess,
 *     then the turn passes. You cannot race ahead while your opponent is thinking:
 *     you act, they act, you act. Non-matching faces are eliminated by each answer.
 *   • You get ONE guess. The moment EITHER player commits a guess (right or wrong),
 *     the other player is LOCKED into guess-only  -  no more questions, they must
 *     take their one shot. When both have guessed the round resolves:
 *       – exactly one correct → that player wins the round (+1);
 *       – both correct → the player who used FEWER questions wins; a tie on
 *         question count is a draw (no point);
 *       – both wrong → draw (no point).
 *   • Match is best-of-N, reusing the room engine's round/score/rematch machinery.
 *
 * SECURITY INVARIANT (mirrors Wordle's hidden answer / Uno's hidden hands): a
 * player's CHOSEN identity is NEVER present in the OPPONENT's sanitized view until
 * the round is over (`revealedOpponentPersonId`); during selection we leak only
 * WHETHER the opponent has committed yet, never who they picked. We also never leak
 * WHETHER the opponent's guess was correct mid-round  -  only that they guessed.
 * Question answers leak only the single bit the player asked for. The board of
 * people and their attributes ARE public (that's how Guess Who works). Because
 * players choose their own person, "Surprise me" is a CLIENT-side random pick -
 * never a server seed the opponent could reproduce.
 *
 * DETERMINISM: the first-asker is chosen server-side from a stable seed (roomCode +
 * matchEpoch + {@link PEOPLE_VERSION}) via the same platform-stable helpers used
 * everywhere else, so a reconnect/refresh re-derives the identical turn order.
 * Identities are now player-chosen, so they are NOT seeded.
 */

import type { Seat } from "../room.js";

export type Gender = "male" | "female";
export type EyeColor = "black" | "brown" | "green" | "blue";
export type SkinTone = "black" | "olive" | "white";
export type Accessory = "hat" | "jewelry" | "glasses";
export type HairLength = "bald" | "short" | "long";

/**
 * One face on the board. Every field except `hairColor` is a QUESTIONABLE, public
 * attribute (the game is played by asking about them). `hairColor` is cosmetic  - 
 * it drives the avatar art but is never asked about.
 */
export interface Person {
  id: string;
  name: string;
  gender: Gender;
  eyeColor: EyeColor;
  skinTone: SkinTone;
  /** A person may wear several accessories, or none. */
  accessories: Accessory[];
  facialHair: boolean;
  hairLength: HairLength;
  /** Cosmetic-only hair color token (hex) for the avatar; not a question. */
  hairColor: string;
}

/** The six attribute sections a question can target. */
export type QuestionSection =
  | "gender"
  | "eyeColor"
  | "skinTone"
  | "accessories"
  | "facialHair"
  | "hairLength";

/** A single yes/no question: does the target have `value` in `section`? */
export interface GuessWhoQuestion {
  section: QuestionSection;
  value: string;
}

/** A question the player asked, with the yes/no answer about the opponent. */
export interface AskedQuestion {
  section: QuestionSection;
  value: string;
  answer: boolean;
}

// ---- domain value lists (order is cosmetic; used for panel layout) ----------

export const GENDERS: Gender[] = ["male", "female"];
export const EYE_COLORS: EyeColor[] = ["black", "brown", "green", "blue"];
export const SKIN_TONES: SkinTone[] = ["black", "olive", "white"];
export const ACCESSORIES: Accessory[] = ["hat", "jewelry", "glasses"];
export const HAIR_LENGTHS: HairLength[] = ["bald", "short", "long"];

/**
 * Section metadata for both validation (server) and the question panel (client).
 *
 *   • `binary` sections have exactly two mutually-exclusive answers, so asking
 *     EITHER value answers the whole section  -  the section closes after one ask.
 *   • `exclusive` sections are single-valued (a person has exactly one). Once a
 *     question returns YES the value is pinned, so the rest of the section closes.
 *     (`accessories` is the one NON-exclusive section: a person can have several,
 *     so each value is asked independently and the section never fully closes.)
 */
export const QUESTION_SECTIONS: {
  section: QuestionSection;
  label: string;
  binary: boolean;
  exclusive: boolean;
  values: { value: string; label: string }[];
}[] = [
  {
    section: "gender",
    label: "Gender",
    binary: true,
    exclusive: true,
    values: [
      { value: "male", label: "Male" },
      { value: "female", label: "Female" },
    ],
  },
  {
    section: "eyeColor",
    label: "Eye color",
    binary: false,
    exclusive: true,
    values: [
      { value: "black", label: "Black" },
      { value: "brown", label: "Brown" },
      { value: "green", label: "Green" },
      { value: "blue", label: "Blue" },
    ],
  },
  {
    section: "skinTone",
    label: "Skin tone",
    binary: false,
    exclusive: true,
    values: [
      { value: "black", label: "Black" },
      { value: "olive", label: "Olive" },
      { value: "white", label: "White" },
    ],
  },
  {
    section: "accessories",
    label: "Accessories",
    binary: false,
    exclusive: false,
    values: [
      { value: "hat", label: "Hat" },
      { value: "jewelry", label: "Jewelry" },
      { value: "glasses", label: "Glasses" },
    ],
  },
  {
    section: "facialHair",
    label: "Facial hair",
    binary: true,
    exclusive: true,
    values: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    section: "hairLength",
    label: "Hair length",
    binary: false,
    exclusive: true,
    values: [
      { value: "bald", label: "Bald" },
      { value: "short", label: "Short" },
      { value: "long", label: "Long" },
    ],
  },
];

/**
 * Whether `value` is within the valid domain of `section`. Used to reject
 * malformed/forged questions at the socket boundary and in the module.
 */
export function isValidQuestionValue(section: QuestionSection, value: string): boolean {
  const meta = QUESTION_SECTIONS.find((s) => s.section === section);
  return meta ? meta.values.some((v) => v.value === value) : false;
}

/**
 * Does `person` match the fact (section, value)? This is the single source of
 * truth for BOTH the yes/no answer about a target AND candidate elimination  -  a
 * candidate stays viable iff `personMatches(candidate, s, v) === answerAboutTarget`.
 */
export function personMatches(person: Person, section: QuestionSection, value: string): boolean {
  switch (section) {
    case "gender":
      return person.gender === value;
    case "eyeColor":
      return person.eyeColor === value;
    case "skinTone":
      return person.skinTone === value;
    case "hairLength":
      return person.hairLength === value;
    case "accessories":
      return person.accessories.includes(value as Accessory);
    case "facialHair":
      return value === "yes" ? person.facialHair : !person.facialHair;
    default: {
      const _exhaustive: never = section;
      return Boolean(_exhaustive);
    }
  }
}

/**
 * Bump when the {@link PEOPLE} board changes (added/removed/reordered/edited),
 * so seeds intentionally diverge and old rooms don't silently shift identities.
 * The board order is part of the seed  -  treat it as immutable + versioned, like
 * the Wordle word lists.
 *
 *   v1 → v2: expanded the cast from 24 to 30 people.
 */
export const PEOPLE_VERSION = "2";

/**
 * The fixed, public board of 30 people. Attributes are chosen so that every
 * person has a UNIQUE full-attribute signature  -  this guarantees the board is
 * always solvable to exactly one answer by questions alone (asserted by a test).
 * A deliberately diverse cast across gender, skin tone, eye color, accessories,
 * facial hair, and hair length. `facialHair` is only ever true for `male` faces
 * (the avatar art draws a beard), so the cast stays believable  -  also asserted.
 */
export const PEOPLE: Person[] = [
  { id: "maya", name: "Maya", gender: "female", eyeColor: "brown", skinTone: "olive", accessories: ["jewelry"], facialHair: false, hairLength: "long", hairColor: "#2b2b2b" },
  { id: "liam", name: "Liam", gender: "male", eyeColor: "blue", skinTone: "white", accessories: ["glasses"], facialHair: true, hairLength: "short", hairColor: "#5a3a22" },
  { id: "aisha", name: "Aisha", gender: "female", eyeColor: "black", skinTone: "black", accessories: ["hat", "jewelry"], facialHair: false, hairLength: "long", hairColor: "#1c1c1c" },
  { id: "diego", name: "Diego", gender: "male", eyeColor: "brown", skinTone: "olive", accessories: [], facialHair: true, hairLength: "short", hairColor: "#2b2b2b" },
  { id: "noah", name: "Noah", gender: "male", eyeColor: "green", skinTone: "white", accessories: ["hat"], facialHair: false, hairLength: "short", hairColor: "#d9b45b" },
  { id: "priya", name: "Priya", gender: "female", eyeColor: "brown", skinTone: "olive", accessories: ["glasses"], facialHair: false, hairLength: "short", hairColor: "#2b2b2b" },
  { id: "kwame", name: "Kwame", gender: "male", eyeColor: "black", skinTone: "black", accessories: [], facialHair: true, hairLength: "bald", hairColor: "#1c1c1c" },
  { id: "sofia", name: "Sofia", gender: "female", eyeColor: "green", skinTone: "white", accessories: ["hat"], facialHair: false, hairLength: "long", hairColor: "#a55b2a" },
  { id: "chen", name: "Chen", gender: "male", eyeColor: "black", skinTone: "olive", accessories: ["glasses"], facialHair: false, hairLength: "short", hairColor: "#1c1c1c" },
  { id: "fatima", name: "Fatima", gender: "female", eyeColor: "brown", skinTone: "black", accessories: ["jewelry", "glasses"], facialHair: false, hairLength: "long", hairColor: "#1c1c1c" },
  { id: "ethan", name: "Ethan", gender: "male", eyeColor: "blue", skinTone: "white", accessories: [], facialHair: false, hairLength: "bald", hairColor: "#5a3a22" },
  { id: "zara", name: "Zara", gender: "female", eyeColor: "blue", skinTone: "olive", accessories: ["jewelry"], facialHair: false, hairLength: "short", hairColor: "#2b2b2b" },
  { id: "marcus", name: "Marcus", gender: "male", eyeColor: "brown", skinTone: "black", accessories: ["hat"], facialHair: true, hairLength: "short", hairColor: "#1c1c1c" },
  { id: "elena", name: "Elena", gender: "female", eyeColor: "green", skinTone: "white", accessories: ["jewelry", "glasses"], facialHair: false, hairLength: "short", hairColor: "#5a3a22" },
  { id: "omar", name: "Omar", gender: "male", eyeColor: "black", skinTone: "olive", accessories: [], facialHair: true, hairLength: "long", hairColor: "#1c1c1c" },
  { id: "grace", name: "Grace", gender: "female", eyeColor: "black", skinTone: "black", accessories: ["jewelry"], facialHair: false, hairLength: "bald", hairColor: "#1c1c1c" },
  { id: "tomas", name: "Tomas", gender: "male", eyeColor: "green", skinTone: "olive", accessories: ["hat", "glasses"], facialHair: false, hairLength: "short", hairColor: "#5a3a22" },
  { id: "ingrid", name: "Ingrid", gender: "female", eyeColor: "blue", skinTone: "white", accessories: [], facialHair: false, hairLength: "long", hairColor: "#d9b45b" },
  { id: "rahul", name: "Rahul", gender: "male", eyeColor: "brown", skinTone: "olive", accessories: ["glasses"], facialHair: true, hairLength: "bald", hairColor: "#1c1c1c" },
  { id: "nia", name: "Nia", gender: "female", eyeColor: "brown", skinTone: "black", accessories: ["hat"], facialHair: false, hairLength: "long", hairColor: "#1c1c1c" },
  { id: "sam", name: "Sam", gender: "male", eyeColor: "blue", skinTone: "olive", accessories: [], facialHair: false, hairLength: "short", hairColor: "#5a3a22" },
  { id: "yuki", name: "Yuki", gender: "female", eyeColor: "black", skinTone: "white", accessories: ["glasses"], facialHair: false, hairLength: "short", hairColor: "#1c1c1c" },
  { id: "andre", name: "Andre", gender: "male", eyeColor: "green", skinTone: "black", accessories: ["jewelry"], facialHair: true, hairLength: "long", hairColor: "#1c1c1c" },
  { id: "lucia", name: "Lucia", gender: "female", eyeColor: "green", skinTone: "olive", accessories: ["hat", "jewelry"], facialHair: false, hairLength: "long", hairColor: "#2b2b2b" },
  { id: "ravi", name: "Ravi", gender: "male", eyeColor: "brown", skinTone: "olive", accessories: ["hat", "jewelry"], facialHair: true, hairLength: "short", hairColor: "#1c1c1c" },
  { id: "hana", name: "Hana", gender: "female", eyeColor: "brown", skinTone: "white", accessories: ["hat"], facialHair: false, hairLength: "short", hairColor: "#5a3a22" },
  { id: "kofi", name: "Kofi", gender: "male", eyeColor: "brown", skinTone: "black", accessories: ["glasses"], facialHair: false, hairLength: "long", hairColor: "#1c1c1c" },
  { id: "leila", name: "Leila", gender: "female", eyeColor: "blue", skinTone: "black", accessories: ["hat", "jewelry", "glasses"], facialHair: false, hairLength: "short", hairColor: "#1c1c1c" },
  { id: "bruno", name: "Bruno", gender: "male", eyeColor: "green", skinTone: "white", accessories: ["glasses"], facialHair: true, hairLength: "bald", hairColor: "#5a3a22" },
  { id: "mei", name: "Mei", gender: "female", eyeColor: "black", skinTone: "olive", accessories: ["jewelry", "glasses"], facialHair: false, hairLength: "long", hairColor: "#1c1c1c" },
];

/** Look up a person by id (or undefined). */
export function getPerson(id: string): Person | undefined {
  return PEOPLE.find((p) => p.id === id);
}

// ---- config -----------------------------------------------------------------

export interface GuessWhoConfig {
  bestOf: number; // e.g. 3 → first to 2 round wins (draws don't score)
}

export const DEFAULT_GUESS_WHO_CONFIG: GuessWhoConfig = {
  bestOf: 3,
};

// ---- actions ----------------------------------------------------------------

/** Actions a client can dispatch for Guess the Person (via `game:action`). */
export type GuessWhoAction =
  // Selection phase: commit YOUR secret identity (the person your opponent hunts).
  // `personId` must be a real board face. "Surprise me" is a client-side random
  // pick that dispatches this same action - the server just validates the id.
  | { type: "choose"; payload: { personId: string } }
  // Ask a yes/no question about the opponent's identity (only on your turn).
  | { type: "ask"; payload: { section: QuestionSection; value: string } }
  // Commit your ONE final guess (only on your turn; must be a viable candidate).
  | { type: "guess"; payload: { personId: string } }
  // End your turn WITHOUT guessing. Legal only when you've solved the board (one
  // candidate remains) - the one moment the turn stays with you after a question,
  // letting you finish immediately instead of passing. Before you've solved it
  // there's always a question to ask, so passing then is never allowed.
  | { type: "pass"; payload?: Record<string, never> }
  // Between rounds: signal ready for the next round (mirrors Wordle/Uno).
  | { type: "next_round"; payload?: Record<string, never> };

// ---- sanitized public view --------------------------------------------------

/**
 * The per-player public view. Safe to inspect in devtools: it contains YOUR own
 * identity (you hold your own card) and the answers to YOUR questions, but never
 * the opponent's identity  -  nor whether their guess was right  -  until the round
 * is over (`revealedOpponentPersonId`).
 */
export interface GuessWhoPublicView {
  gameId: "guess-the-person";
  config: GuessWhoConfig;
  roundNumber: number; // 1-based

  /** The full public board  -  identical for both players. */
  people: Person[];

  /**
   * True while the round is in its SELECTION phase - both players are picking
   * their secret identity and no questions/guesses are allowed yet. Flips false
   * once BOTH have committed (the hunt begins).
   */
  selecting: boolean;
  /** Whether YOU have committed your identity this round. */
  youChose: boolean;
  /** Whether the OPPONENT has committed theirs (never WHO - just that they did). */
  opponentChose: boolean;

  /**
   * YOUR chosen identity (the person your opponent is hunting). Empty string until
   * you've committed your pick this round.
   */
  yourPersonId: string;

  /** Questions YOU have asked, with their yes/no answers about the opponent. */
  asked: AskedQuestion[];
  /** Person ids still consistent with your answers (drives which faces stay up). */
  remainingPersonIds: string[];
  /**
   * Questions still available to ask. Empty unless it's your turn and you're free
   * to ask (you haven't guessed and you aren't locked into a forced guess).
   */
  availableQuestions: GuessWhoQuestion[];

  /** YOUR one guess, once committed, with whether it was correct. */
  yourGuess: { personId: string; correct: boolean } | null;

  /**
   * You've narrowed the board to exactly ONE candidate. Because every face has a
   * unique attribute signature and your target always survives your answers, that
   * lone survivor is provably the answer - a guess now is a guaranteed win. When
   * this is true on your turn the client offers an immediate finish (guess the
   * sure thing, or `pass` to end your turn without committing). Questions are
   * closed once solved; the turn stays with you rather than auto-passing.
   */
  solved: boolean;

  /**
   * The opponent's guess, revealed ONLY once the round is over (null mid-round,
   * so we never leak whether their guess was correct while you still owe yours).
   * Lets the reveal show what they guessed and explain a fewer-questions win.
   */
  opponentGuess: { personId: string; correct: boolean } | null;

  /** Whose turn it is right now (both players see the same value). */
  turn: Seat;
  /** Convenience: `turn === yourSeat`. */
  isYourTurn: boolean;

  /** Secret-safe opponent status  -  count only, never their identity or accuracy. */
  opponentAskedCount: number;
  opponentGuessed: boolean;
  /**
   * Whether the OPPONENT has narrowed their own board to a single candidate. This
   * is game-progress info (like `opponentAskedCount`) about how efficiently they're
   * hunting YOU  -  it's orthogonal to your own hunt and never reveals your target,
   * their identity, or a committed guess's accuracy. Its one job is UX: once BOTH
   * players have solved, `pass` is disallowed server-side (two solved players could
   * otherwise pass forever), so the client hides the "end turn" option and offers
   * only the guaranteed guess.
   */
  opponentSolved: boolean;
  /**
   * You must guess now  -  the opponent has committed their guess, so questions are
   * closed for you and your only remaining move is your one guess. (You'll still
   * only actually act on your turn.)
   */
  mustGuess: boolean;

  /** The opponent's identity, revealed ONLY once the round is over. */
  revealedOpponentPersonId: string | null;
  /**
   * At round-over: how many questions each seat asked (drives the tie-break where
   * both guessed right  -  fewer questions wins). Null mid-round (no leak).
   */
  questionCounts: { A: number; B: number } | null;

  scores: { A: number; B: number };
  roundWinnerSeat: "A" | "B" | "tie" | null;
  matchWinnerSeat: "A" | "B" | "tie" | null;

  youReady: boolean;
  opponentReady: boolean;
}
