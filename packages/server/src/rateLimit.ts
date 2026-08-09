/**
 * Tiny in-memory sliding-window rate limiter, keyed by an arbitrary string
 * (playerId, ip, or `${playerId}:action`). No external deps - fine for a
 * single-instance MVP.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if allowed, false if the limit is exceeded. */
  take(key: string, now = Date.now()): boolean {
    const arr = this.hits.get(key) ?? [];
    const cutoff = now - this.windowMs;
    // drop expired
    let i = 0;
    while (i < arr.length && arr[i]! < cutoff) i++;
    const recent = i > 0 ? arr.slice(i) : arr;
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /**
   * Drop keys whose most recent hit is older than the window - otherwise a key
   * that's hit once and never again lingers in the map forever (a slow leak as
   * players come and go). Call this periodically. Returns the count removed.
   */
  sweep(now = Date.now()): number {
    const cutoff = now - this.windowMs;
    let removed = 0;
    for (const [key, arr] of this.hits) {
      const last = arr[arr.length - 1];
      if (last === undefined || last < cutoff) {
        this.hits.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
