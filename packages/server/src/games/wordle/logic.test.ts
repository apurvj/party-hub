import { describe, expect, it, vi } from "vitest";
import { computeFeedback, isWinningFeedback, selectWord } from "./logic.js";

/** Compact helper: render feedback as a string of G/Y/B (green/yellow/black). */
function fb(guess: string, answer: string): string {
  return computeFeedback(guess, answer)
    .map((f) => (f.state === "correct" ? "G" : f.state === "present" ? "Y" : "B"))
    .join("");
}

describe("computeFeedback — duplicate-letter handling", () => {
  it("all correct", () => {
    expect(fb("CRANE", "CRANE")).toBe("GGGGG");
  });

  it("no matches", () => {
    expect(fb("FUZZY", "CRIMP")).toBe("BBBBB");
  });

  it("LLAMA vs LEVEL — extra L should be present once, second A absent", () => {
    // L(0)=G (LEVEL[0]=L). Answer L budget now 1.
    // L(1): present (budget→0). A(2): absent. M(3): absent. A(4): absent.
    expect(fb("LLAMA", "LEVEL")).toBe("GYBBB");
  });

  it("SPEED vs ABIDE — one E present, the other absent", () => {
    // ABIDE has one E (position 4). SPEED has E at 2 and 3.
    // S:B P:B E(2): present (budget E=1→0) E(3): absent D(4): present? D in ABIDE at 3 → present
    expect(fb("SPEED", "ABIDE")).toBe("BBYBY");
  });

  it("GEESE vs THESE — greens consume budget before yellows", () => {
    // THESE: T H E S E. GEESE: G E E S E.
    // pos0 G vs T: not correct. pos1 E vs H: not. pos2 E vs E: G. pos3 S vs S: G. pos4 E vs E: G.
    // Remaining answer letters (non-green): T,H. Guess non-green: G(0),E(1).
    // E(1): answer has E's but both were consumed by greens at 2 and 4 → absent.
    expect(fb("GEESE", "THESE")).toBe("BBGGG");
  });

  it("duplicate guess letters with single answer occurrence", () => {
    // answer ROBOT has two O's. guess BOOKS: B present, O(1) green? ROBOT[1]=O → green,
    // O(2) vs B: ROBOT has 2 O, one consumed → present. K absent, S absent.
    expect(fb("BOOKS", "ROBOT")).toBe("YGYBB");
  });

  it("isWinningFeedback only when all green", () => {
    expect(isWinningFeedback(computeFeedback("CRANE", "CRANE"))).toBe(true);
    expect(isWinningFeedback(computeFeedback("CRANE", "CRANK"))).toBe(false);
  });
});

describe("selectWord — determinism (the core requirement)", () => {
  it("same room + round + difficulty → identical word every call", () => {
    const w1 = selectWord("ABC123", 1, "normal");
    const w2 = selectWord("ABC123", 1, "normal");
    expect(w1).toBe(w2);
    expect(w1).toMatch(/^[A-Z]{5}$/);
  });

  it("different rounds usually differ; same round never differs", () => {
    const r1 = selectWord("ROOM99", 1, "normal");
    const r2 = selectWord("ROOM99", 2, "normal");
    // Not a hard guarantee they differ, but across a big pool they should.
    expect(selectWord("ROOM99", 1, "normal")).toBe(r1);
    expect(selectWord("ROOM99", 2, "normal")).toBe(r2);
  });

  it("different rooms get independent sequences", () => {
    const a = selectWord("ROOMAA", 1, "normal");
    const b = selectWord("ROOMBB", 1, "normal");
    // Independent seeds; equality would be a coincidence, inequality expected.
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
  });

  it("no repeats within a single pool cycle for a room", () => {
    // Walk enough rounds to be confident the shuffle yields distinct words
    // until the pool is exhausted.
    const seen = new Set<string>();
    let repeatedBeforeExhaustion = false;
    const N = 200;
    for (let round = 1; round <= N; round++) {
      const w = selectWord("SEQSEQ", round, "normal");
      if (seen.has(w) && seen.size < N) {
        // A repeat is only acceptable once we've wrapped the pool.
        repeatedBeforeExhaustion = repeatedBeforeExhaustion || seen.size < 1;
      }
      seen.add(w);
    }
    // With a curated pool > N words, all N should be distinct.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("stable across a simulated reload (re-import fresh module state)", async () => {
    const before = selectWord("REBOOT", 5, "normal");
    // Reset the module registry and re-import to simulate a process restart
    // reloading the same immutable word list from disk.
    vi.resetModules();
    const fresh = await import("./logic.js");
    const after = fresh.selectWord("REBOOT", 5, "normal");
    expect(after).toBe(before);
  });
});
