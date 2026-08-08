import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WordleDifficulty } from "@party-hub/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

/**
 * WORD LIST INTEGRITY (see plan §"same word" invariant #4):
 * Answer lists are immutable + versioned. The version string is folded into the
 * word-selection seed, so if a list is ever replaced the mapping intentionally
 * changes for NEW rooms — but any in-flight room keeps deriving its word from
 * the same seed, so a refresh/reconnect always yields the identical word. We
 * also log a content hash at startup so accidental reordering is detectable.
 */
export const WORDLIST_VERSION = "2";

interface AnswerEntry {
  word: string;
  tier: "easy" | "normal";
}
interface AnswerFile {
  version: string;
  words: AnswerEntry[];
}

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as T;
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

// ---- load once at module init --------------------------------------------

const answerFile = loadJson<AnswerFile>("answers.json");
const guessArray = loadJson<string[]>("guesses.json");

/** Answer pools keyed by difficulty. Each is a plain array of UPPERCASE words. */
const answersByTier: Record<WordleDifficulty, string[]> = (() => {
  const easy: string[] = [];
  const normal: string[] = [];
  for (const { word, tier } of answerFile.words) {
    const up = word.toUpperCase();
    if (tier === "easy") easy.push(up);
    normal.push(up); // "normal" pool = easy + normal (everything)
  }
  // "hard" for now = the full normal pool (kept as a hook for a future
  // larger/less-common pool). Sorting keeps files deterministic; we never
  // reorder based on runtime state.
  const normalSorted = normal.slice().sort();
  const easySorted = easy.slice().sort();
  return {
    easy: easySorted,
    normal: normalSorted,
    hard: normalSorted,
  };
})();

/** Valid guesses = dictionary words ∪ every answer (answers must be guessable). */
const validGuesses: Set<string> = (() => {
  const s = new Set<string>();
  for (const w of guessArray) s.add(w.toUpperCase());
  // Answers are already uppercased in `answersByTier.normal` (the full pool) —
  // reuse it instead of re-uppercasing every answer a second time.
  for (const w of answersByTier.normal) s.add(w);
  return s;
})();

export function getAnswerPool(difficulty: WordleDifficulty): string[] {
  return answersByTier[difficulty];
}

export function isValidGuess(word: string): boolean {
  return validGuesses.has(word.toUpperCase());
}

export function logWordlistIntegrity(): void {
  const answerHash = sha(answerFile.words.map((w) => w.word).join(","));
  const guessHash = sha(guessArray.join(","));
  // eslint-disable-next-line no-console
  console.log(
    `[wordlist] version=${WORDLIST_VERSION} answers=${answerFile.words.length} ` +
      `(easy=${answersByTier.easy.length}) guesses=${validGuesses.size} ` +
      `answerHash=${answerHash} guessHash=${guessHash}`,
  );
}
