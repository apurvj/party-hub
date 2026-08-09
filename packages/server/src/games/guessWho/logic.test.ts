import { describe, expect, it } from "vitest";
import {
  PEOPLE,
  personMatches,
  QUESTION_SECTIONS,
  type AskedQuestion,
} from "@party-hub/shared";
import {
  answerFor,
  availableQuestions,
  canAsk,
  firstAsker,
  isSectionClosed,
  remainingCandidateIds,
} from "./logic.js";

describe("guess-the-person board integrity", () => {
  it("every person has a UNIQUE full-attribute signature (board stays solvable to one)", () => {
    const sigs = PEOPLE.map((p) =>
      JSON.stringify({
        g: p.gender,
        e: p.eyeColor,
        s: p.skinTone,
        a: [...p.accessories].sort(),
        f: p.facialHair,
        h: p.hairLength,
      }),
    );
    expect(new Set(sigs).size).toBe(PEOPLE.length);
  });

  it("all person ids are unique", () => {
    expect(new Set(PEOPLE.map((p) => p.id)).size).toBe(PEOPLE.length);
  });

  it("has a diverse cast across every attribute (each value appears at least once)", () => {
    for (const meta of QUESTION_SECTIONS) {
      for (const v of meta.values) {
        if (meta.section === "facialHair") continue; // yes/no covered below
        const anyone = PEOPLE.some((p) => personMatches(p, meta.section, v.value));
        expect(anyone, `no person has ${meta.section}=${v.value}`).toBe(true);
      }
    }
    expect(PEOPLE.some((p) => p.facialHair)).toBe(true);
    expect(PEOPLE.some((p) => !p.facialHair)).toBe(true);
  });

  it("has exactly 30 people", () => {
    expect(PEOPLE.length).toBe(30);
  });

  it("only male faces have facial hair (the avatar art draws a beard)", () => {
    for (const p of PEOPLE) {
      if (p.facialHair) expect(p.gender, `${p.id} has facial hair but isn't male`).toBe("male");
    }
  });
});

describe("firstAsker - seeded + alternating", () => {
  it("is deterministic for the same seed (reconnect-safe)", () => {
    expect(firstAsker("ROOM12", 1, 0)).toBe(firstAsker("ROOM12", 1, 0));
  });

  it("alternates every round within a match", () => {
    const r1 = firstAsker("ROOM12", 1, 0);
    const r2 = firstAsker("ROOM12", 2, 0);
    const r3 = firstAsker("ROOM12", 3, 0);
    expect(r2).not.toBe(r1);
    expect(r3).toBe(r1); // flips back after two rounds
  });

  it("always returns a valid seat", () => {
    for (let round = 1; round <= 5; round++) {
      expect(["A", "B"]).toContain(firstAsker("XYZ999", round, 4));
    }
  });
});

describe("answerFor + remaining candidates", () => {
  it("answers a question about a target from its attributes", () => {
    const maya = PEOPLE.find((p) => p.id === "maya")!;
    expect(answerFor(maya, "gender", "female")).toBe(true);
    expect(answerFor(maya, "gender", "male")).toBe(false);
    expect(answerFor(maya, "accessories", "jewelry")).toBe(true);
    expect(answerFor(maya, "accessories", "hat")).toBe(false);
    expect(answerFor(maya, "facialHair", "no")).toBe(true);
  });

  it("keeps only people consistent with all answers, and always the target", () => {
    const target = PEOPLE.find((p) => p.id === "liam")!; // male, blue eyes, glasses, beard
    const asked: AskedQuestion[] = [
      { section: "gender", value: "male", answer: answerFor(target, "gender", "male") },
      { section: "eyeColor", value: "blue", answer: answerFor(target, "eyeColor", "blue") },
      { section: "facialHair", value: "yes", answer: answerFor(target, "facialHair", "yes") },
    ];
    const remaining = remainingCandidateIds(asked);
    expect(remaining).toContain("liam"); // the target always survives
    // Every survivor genuinely matches all answers.
    for (const id of remaining) {
      const p = PEOPLE.find((x) => x.id === id)!;
      for (const q of asked) expect(personMatches(p, q.section, q.value)).toBe(q.answer);
    }
  });

  it("returns the whole board when nothing has been asked", () => {
    expect(remainingCandidateIds([]).length).toBe(PEOPLE.length);
  });
});

describe("section closing + availability rules", () => {
  it("binary sections close after ANY ask (gender, facial hair)", () => {
    expect(isSectionClosed([{ section: "gender", value: "male", answer: false }], "gender")).toBe(true);
    expect(isSectionClosed([{ section: "facialHair", value: "yes", answer: false }], "facialHair")).toBe(
      true,
    );
  });

  it("exclusive multi-value sections close only on a YES (eye color)", () => {
    // A 'no' keeps the section open (other colors still possible).
    expect(isSectionClosed([{ section: "eyeColor", value: "blue", answer: false }], "eyeColor")).toBe(
      false,
    );
    // A 'yes' pins the value and closes the section.
    expect(isSectionClosed([{ section: "eyeColor", value: "brown", answer: true }], "eyeColor")).toBe(
      true,
    );
  });

  it("accessories never close - each value is independent", () => {
    const asked: AskedQuestion[] = [{ section: "accessories", value: "hat", answer: true }];
    expect(isSectionClosed(asked, "accessories")).toBe(false);
    // ...but the already-asked value is not offered again.
    const avail = availableQuestions(asked);
    expect(avail.some((q) => q.section === "accessories" && q.value === "hat")).toBe(false);
    expect(avail.some((q) => q.section === "accessories" && q.value === "glasses")).toBe(true);
  });

  it("canAsk rejects out-of-domain, closed-section, and duplicate questions", () => {
    expect(canAsk([], "eyeColor", "purple")).toBe(false); // not a real value
    expect(canAsk([], "eyeColor", "blue")).toBe(true);
    const askedBlueNo: AskedQuestion[] = [{ section: "eyeColor", value: "blue", answer: false }];
    expect(canAsk(askedBlueNo, "eyeColor", "blue")).toBe(false); // duplicate
    expect(canAsk(askedBlueNo, "eyeColor", "green")).toBe(true); // still open
    const askedGender: AskedQuestion[] = [{ section: "gender", value: "male", answer: true }];
    expect(canAsk(askedGender, "gender", "female")).toBe(false); // binary section closed
  });

  it("availableQuestions drops closed sections and asked values", () => {
    const asked: AskedQuestion[] = [
      { section: "gender", value: "female", answer: true }, // closes gender
      { section: "eyeColor", value: "blue", answer: true }, // closes eyeColor (yes)
    ];
    const avail = availableQuestions(asked);
    expect(avail.some((q) => q.section === "gender")).toBe(false);
    expect(avail.some((q) => q.section === "eyeColor")).toBe(false);
    expect(avail.some((q) => q.section === "skinTone")).toBe(true); // untouched, open
  });
});
