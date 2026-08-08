#!/usr/bin/env node
/**
 * Word-list integrity check (run in CI).
 *
 * Guards the determinism invariant: the ANSWER list must never be silently
 * reordered or corrupted, because word selection is `shuffle(pool, seed)[n]`
 * and a reordered pool would change words for in-flight rooms on reconnect.
 *
 * This checks structure/format and prints a content hash. To lock the exact
 * contents, paste the printed hash into EXPECTED_ANSWER_HASH below (or set
 * EXPECTED_ANSWER_HASH env) and CI will fail if the list ever changes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(dir, "..", "src", "games", "wordle", "data");

const EXPECTED_ANSWER_HASH = process.env.EXPECTED_ANSWER_HASH ?? null;

function load(name) {
  return JSON.parse(readFileSync(join(dataDir, name), "utf8"));
}
function sha(s) {
  return createHash("sha256").update(s).digest("hex");
}

let failed = false;
const fail = (m) => {
  console.error("✗ " + m);
  failed = true;
};

const answers = load("answers.json");
const guesses = load("guesses.json");

if (typeof answers.version !== "string") fail("answers.json missing string `version`");
if (!Array.isArray(answers.words)) fail("answers.json `words` must be an array");

const seen = new Set();
for (const entry of answers.words ?? []) {
  const w = entry.word;
  if (!/^[a-z]{5}$/.test(w)) fail(`answer not 5 lowercase letters: ${JSON.stringify(w)}`);
  if (entry.tier !== "easy" && entry.tier !== "normal") fail(`bad tier for ${w}: ${entry.tier}`);
  if (seen.has(w)) fail(`duplicate answer: ${w}`);
  seen.add(w);
}

// Every answer must be an accepted guess.
const guessSet = new Set(guesses.map((g) => String(g).toUpperCase()));
for (const { word } of answers.words ?? []) {
  if (!guessSet.has(word.toUpperCase())) fail(`answer not in guess list: ${word}`);
}

for (const g of guesses) {
  if (!/^[A-Za-z]{5}$/.test(g)) fail(`invalid guess entry: ${JSON.stringify(g)}`);
}

const answerHash = sha(answers.words.map((w) => w.word).join(","));
const easy = answers.words.filter((w) => w.tier === "easy").length;

console.log(`answers: ${answers.words.length} (easy=${easy}, normal=${answers.words.length - easy})`);
console.log(`guesses: ${guesses.length}`);
console.log(`answer content hash: ${answerHash}`);

if (EXPECTED_ANSWER_HASH && EXPECTED_ANSWER_HASH !== answerHash) {
  fail(`answer hash changed! expected ${EXPECTED_ANSWER_HASH}, got ${answerHash}`);
}

if (failed) {
  console.error("\nWord-list verification FAILED.");
  process.exit(1);
}
console.log("\n✓ Word-list verification passed.");
