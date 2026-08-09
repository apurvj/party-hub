/**
 * Per-player body + per-card anatomy tags. This is what lets the adult games
 * hand each player only acts their own body can actually perform - a male player
 * never draws a "rub your clit" dare, a female player never draws a "stroke your
 * cock" one - while still letting a couple do everything neutral together.
 */

/**
 * A player's self-declared body. Collected once per device at the adult-game
 * consent gate (alongside the 18+ checkbox). NOT secret between partners - a
 * couple knows each other's bodies - so it's safe to expose in the public view;
 * it only ever gates which CONTENT a player is shown, never anything private.
 */
export type Sex = "female" | "male";

/**
 * What body (or bodies) a card's act needs. Games read this to filter content:
 *
 *   • Dice filters per PERFORMER - each solo dare is drawn from a deck built for
 *     that seat's own body, so "female"/"male" mean "the performer has that body"
 *     ("mixed" is never used by Dice - its dares are solo).
 *   • Match filters per COUPLE - the shared voting deck keeps a card only if the
 *     two bodies present can do it: "female" = BOTH partners have a vulva,
 *     "male" = BOTH have a penis, "mixed" = one of each.
 *
 * Omitted ⇒ "any" (anatomy-neutral: works for anybody / any couple).
 */
export type BodyReq = "any" | "female" | "male" | "mixed";

/** The declared bodies of the two seats (both non-null once play can start). */
export interface CoupleBodies {
  female: boolean;
  male: boolean;
}

/**
 * Does a couple of the given two bodies satisfy a card's anatomy requirement?
 * Shared by Match's deck build so the rule lives in exactly one place.
 */
export function coupleCanPerform(req: BodyReq | undefined, sexA: Sex, sexB: Sex): boolean {
  switch (req ?? "any") {
    case "any":
      return true;
    // A same-body mutual act (both partners do it to the same kind of body).
    case "female":
      return sexA === "female" && sexB === "female";
    case "male":
      return sexA === "male" && sexB === "male";
    // Needs one of each body present in the couple.
    case "mixed":
      return sexA !== sexB;
    default:
      return true;
  }
}

/** Can a single PERFORMER of the given body do this card (Dice's per-seat rule)? */
export function bodyCanPerform(req: BodyReq | undefined, sex: Sex): boolean {
  const r = req ?? "any";
  // "mixed" is meaningless for a solo performer; treat it as not-for-them.
  return r === "any" || r === sex;
}
