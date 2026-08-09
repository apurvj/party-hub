import {
  PEOPLE,
  PEOPLE_VERSION,
  QUESTION_SECTIONS,
  isValidQuestionValue,
  personMatches,
  seededIndex,
  type AskedQuestion,
  type GuessWhoQuestion,
  type Person,
  type QuestionSection,
  type Seat,
} from "@party-hub/shared";

/**
 * GUESS THE PERSON ENGINE - deterministic first-asker draw, candidate
 * elimination, and question availability. All pure/deterministic (no Date.now,
 * no Math.random), exactly like the Wordle word selection and Uno deal, so a
 * reconnect/refresh reproduces the identical round and "Play again" (a new
 * matchEpoch) produces a different one. Identities are player-CHOSEN (see the
 * module's selection phase), so they are NOT derived here. The client never runs
 * any of this.
 */

/**
 * Which seat asks first this round. Seeded (so a refresh reproduces it) and
 * alternates every round: round 1's first-asker is chosen from the room seed,
 * and each subsequent round flips it, so neither seat keeps the opening move.
 */
export function firstAsker(roomCode: string, roundNumber: number, matchEpoch: number): Seat {
  const seed = `${roomCode}#gtp#v${PEOPLE_VERSION}#match${matchEpoch}#firstAsker`;
  const base = seededIndex(seed, 2); // 0 or 1, fixed for the match
  // roundNumber is 1-based; flip on each subsequent round.
  return (base + (roundNumber - 1)) % 2 === 0 ? "A" : "B";
}

/** The yes/no answer to a question asked about `target`. */
export function answerFor(target: Person, section: QuestionSection, value: string): boolean {
  return personMatches(target, section, value);
}

/**
 * The board people still consistent with every answer the player has received.
 * A candidate stays viable iff it matches each asked fact the same way the target
 * did - so the target itself always remains (guaranteeing ≥1 candidate).
 */
export function remainingCandidateIds(asked: AskedQuestion[]): string[] {
  return PEOPLE.filter((p) =>
    asked.every((q) => personMatches(p, q.section, q.value) === q.answer),
  ).map((p) => p.id);
}

/**
 * Whether a section can no longer be asked, given what's already been asked:
 *   • binary sections (gender, facial hair): asking either value answers the
 *     whole section, so ANY prior ask closes it;
 *   • exclusive single-valued sections (eye color, skin tone, hair length): a YES
 *     pins the value, closing the section (further asks are redundant);
 *   • non-exclusive sections (accessories): never close - each value is
 *     independent, so they're asked one at a time until individually exhausted.
 */
export function isSectionClosed(asked: AskedQuestion[], section: QuestionSection): boolean {
  const meta = QUESTION_SECTIONS.find((s) => s.section === section)!;
  const inSection = asked.filter((q) => q.section === section);
  if (inSection.length === 0) return false;
  if (meta.binary) return true;
  if (meta.exclusive) return inSection.some((q) => q.answer === true);
  return false; // accessories: independent values
}

/** Questions the player may still ask (section open + value not yet asked). */
export function availableQuestions(asked: AskedQuestion[]): GuessWhoQuestion[] {
  const out: GuessWhoQuestion[] = [];
  for (const meta of QUESTION_SECTIONS) {
    if (isSectionClosed(asked, meta.section)) continue;
    for (const v of meta.values) {
      const already = asked.some((q) => q.section === meta.section && q.value === v.value);
      if (!already) out.push({ section: meta.section, value: v.value });
    }
  }
  return out;
}

/**
 * Whether a fresh ask is legal against the current asked list: value in domain,
 * section still open, and not a duplicate. (Turn/round/lock checks live in the
 * module - this is purely the question-availability rule.)
 */
export function canAsk(asked: AskedQuestion[], section: QuestionSection, value: string): boolean {
  if (!isValidQuestionValue(section, value)) return false;
  if (isSectionClosed(asked, section)) return false;
  return !asked.some((q) => q.section === section && q.value === value);
}
