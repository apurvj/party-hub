/**
 * cyrb53 - a small, fast, stable 53-bit string hash by bryc (public domain).
 * https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 *
 * WHY THIS MATTERS FOR PARTY HUB:
 * The Wordle answer for a given round is chosen deterministically from a seed
 * string via `cyrb53(seed) % answerList.length`. This hash produces the SAME
 * output in Node (server) and the browser, and never changes between runs - so
 * both players always resolve to the same word, and a refresh / shared-URL
 * reconnect re-derives the identical word. Do NOT swap this for Math.random or
 * anything Date-based: determinism is the whole point.
 *
 * Returns an integer in the range [0, 2^53).
 */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Deterministic index into a list of `length` items from a seed string.
 * Guaranteed to be a valid array index for any length >= 1.
 */
export function seededIndex(seed: string, length: number): number {
  if (length <= 0) throw new Error("seededIndex: length must be >= 1");
  return cyrb53(seed) % length;
}

/**
 * A tiny deterministic PRNG (mulberry32) seeded from a string via cyrb53.
 * Used to shuffle a word list per-room so a session doesn't repeat words,
 * while remaining perfectly reproducible on reconnect / server restart.
 */
export function mulberry32(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher–Yates shuffle of a COPY of `items`, seeded by a string.
 * Same seed → same permutation, on any platform, forever.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = mulberry32(cyrb53(seed));
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
