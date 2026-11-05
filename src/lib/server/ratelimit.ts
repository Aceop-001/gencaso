/** Per-client token bucket for the analyse endpoint (in-memory; swap for Redis when horizontally scaled). */
const g = globalThis as unknown as { __gencasoBuckets?: Map<string, { tokens: number; at: number }> };
const buckets = (g.__gencasoBuckets ??= new Map());

const CAPACITY = 6;
const REFILL_PER_MS = 6 / 60_000; // 6 analyses per minute

export function allow(clientId: string, now = Date.now()): { ok: boolean; retryAfterS: number } {
  const b = buckets.get(clientId) ?? { tokens: CAPACITY, at: now };
  b.tokens = Math.min(CAPACITY, b.tokens + (now - b.at) * REFILL_PER_MS);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(clientId, b);
    return { ok: false, retryAfterS: Math.ceil((1 - b.tokens) / REFILL_PER_MS / 1000) };
  }
  b.tokens -= 1;
  buckets.set(clientId, b);
  return { ok: true, retryAfterS: 0 };
}
