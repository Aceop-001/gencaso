import type { ProviderHttp } from "../providers/types";

/**
 * Metered HTTP client. Every outbound data request goes through here so API
 * consumption is tracked per provider and spaced per host.
 */

export interface UsageRecord {
  provider: string;
  requests: number;
  errors: number;
  bytes: number;
  lastAt: number;
}

const g = globalThis as unknown as { __gencasoUsage?: Map<string, UsageRecord>; __gencasoLastHit?: Map<string, number> };
const usage = (g.__gencasoUsage ??= new Map());
const lastHit = (g.__gencasoLastHit ??= new Map());

const MIN_INTERVAL_MS: Record<string, number> = { hyperliquid: 60, polymarket: 120, bulk: 100, hertzflow: 100, opensea: 250, coinbase: 120, fx: 0, "fx-cdn": 0 };
const TIMEOUT_MS: Record<string, number> = { fx: 8_000, "fx-cdn": 8_000 };

export function getUsage(): UsageRecord[] {
  return [...usage.values()];
}

function record(provider: string, ok: boolean, bytes: number) {
  const u = usage.get(provider) ?? { provider, requests: 0, errors: 0, bytes: 0, lastAt: 0 };
  u.requests++;
  if (!ok) u.errors++;
  u.bytes += bytes;
  u.lastAt = Date.now();
  usage.set(provider, u);
}

async function throttle(provider: string) {
  const gap = MIN_INTERVAL_MS[provider] ?? 100;
  const wait = (lastHit.get(provider) ?? 0) + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(provider, Date.now());
}

async function request<T>(provider: string, url: string, init?: RequestInit): Promise<T> {
  await throttle(provider);
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS[provider] ?? 20_000) });
  } catch (e) {
    record(provider, false, 0);
    throw new Error(`${provider}: network error (${(e as Error).message})`);
  }
  const text = await res.text();
  record(provider, res.ok, text.length);
  if (!res.ok) throw new Error(`${provider}: HTTP ${res.status}`);
  return JSON.parse(text) as T;
}

export const meteredHttp: ProviderHttp = {
  getJson: (provider, url, headers) => request(provider, url, headers ? { headers } : undefined),
  postJson: (provider, url, body) =>
    request(provider, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
};
