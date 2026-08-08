/** Server configuration, environment-driven with sensible local defaults. */

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num("PORT", 3001),

  /**
   * Allowed browser origins for CORS + Socket.io. In dev we allow the Vite
   * origins; in prod set CLIENT_ORIGIN (comma-separated) to your Vercel URL.
   */
  clientOrigins: (process.env.CLIENT_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  /** How long a disconnected player keeps their seat before it's freed (ms). */
  seatGraceMs: num("SEAT_GRACE_MS", 45_000),

  /** Idle rooms older than this (no activity) are swept (ms). */
  roomTtlMs: num("ROOM_TTL_MS", 2 * 60 * 60 * 1000),

  /** How often the cleanup sweep runs (ms). */
  cleanupIntervalMs: num("CLEANUP_INTERVAL_MS", 5 * 60 * 1000),

  /** Rate limits. */
  maxGuessesPerSec: num("MAX_GUESSES_PER_SEC", 4),
  /** Looser cap on all game actions (guesses + next_round + anything else). */
  maxActionsPerSec: num("MAX_ACTIONS_PER_SEC", 10),
  maxRoomCreatesPerMin: num("MAX_ROOM_CREATES_PER_MIN", 15),
  maxJoinsPerMin: num("MAX_JOINS_PER_MIN", 30),
} as const;
