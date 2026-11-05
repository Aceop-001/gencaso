import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderHttp } from "../providers/types";

/**
 * OpenSea API key, server-side only.
 *
 * 1. OPENSEA_API_KEY from the environment (a permanent key from opensea.io/settings/developer).
 * 2. Otherwise, or once that key is rejected (e.g. an expired free key), a free instant key from
 *    `POST https://api.opensea.io/api/v2/auth/keys` (no signup; 7-day expiry). It is stored in
 *    .cache/opensea-key.json and replaced a day before it expires, as OpenSea's docs advise.
 *    Set OPENSEA_AUTO_KEY=0 to turn this off.
 *
 * Keys never leave the server: providers run in the /api/analyze route only.
 */

const MINT_URL = "https://api.opensea.io/api/v2/auth/keys";
const RENEW_BEFORE_MS = 24 * 3_600_000;
const store = () => process.env.OPENSEA_KEY_STORE ?? path.join(process.cwd(), ".cache", "opensea-key.json");

export interface OpenSeaKey {
  /** Empty for "keyless": send no x-api-key header */
  key: string;
  /** keyless = no free key could be minted right now; reads are tried without one (OpenSea refuses them since Nov 2026) */
  source: "env" | "auto" | "keyless";
  expiresAt?: number;
  /** True when this call had to mint a new free key (one extra request) */
  minted?: boolean;
  /** True when this call tried to mint a key and failed (one extra request) */
  mintFailed?: boolean;
}

interface Stored {
  api_key: string;
  expires_at: string;
}

/** After a failed mint (e.g. HTTP 429 on shared hosting), wait this long before trying again. */
const MINT_COOLDOWN_MS = 15 * 60_000;

const g = globalThis as unknown as { __gencasoOsKey?: { envRejected?: string; auto?: Stored; mintFailedAt?: number } };
/** Read fresh each time, so a reset of the global (tests, hot reload) takes effect. */
const st = () => (g.__gencasoOsKey ??= {});

export const autoKeysEnabled = () => process.env.OPENSEA_AUTO_KEY !== "0";

async function loadStored(): Promise<Stored | undefined> {
  if (st().auto) return st().auto;
  try {
    const s = JSON.parse(await readFile(store(), "utf8")) as Stored;
    if (s.api_key && s.expires_at) return (st().auto = s);
  } catch {
    // no stored key yet
  }
  return undefined;
}

async function mint(http: ProviderHttp): Promise<Stored> {
  const res = await http.postJson<Partial<Stored>>("opensea", MINT_URL, {});
  if (!res.api_key || !res.expires_at) throw new Error("opensea: key service returned no key");
  const s = { api_key: res.api_key, expires_at: res.expires_at };
  st().auto = s;
  try {
    await mkdir(path.dirname(store()), { recursive: true });
    await writeFile(store(), JSON.stringify(s), { mode: 0o600 });
  } catch {
    // Read-only hosting: keep the key in memory only (a new one is minted after a restart)
  }
  return s;
}

/** The key to use now, or null when none is configured and automatic keys are off. */
export async function openSeaKey(http: ProviderHttp, now: number): Promise<OpenSeaKey | null> {
  const env = process.env.OPENSEA_API_KEY?.trim();
  if (env && st().envRejected !== env) return { key: env, source: "env" };
  if (!autoKeysEnabled()) return null;
  const s = await loadStored();
  if (s && Date.parse(s.expires_at) - now >= RENEW_BEFORE_MS) return { key: s.api_key, source: "auto", expiresAt: Date.parse(s.expires_at), minted: false };
  // A mint failed recently: don't hammer the key service, read without a key meanwhile
  const failedAt = st().mintFailedAt;
  if (failedAt !== undefined && now - failedAt < MINT_COOLDOWN_MS) return { key: "", source: "keyless" };
  try {
    const fresh = await mint(http);
    st().mintFailedAt = undefined;
    return { key: fresh.api_key, source: "auto", expiresAt: Date.parse(fresh.expires_at), minted: true };
  } catch {
    st().mintFailedAt = now;
    return { key: "", source: "keyless", mintFailed: true };
  }
}

/** Called when OpenSea rejects a key (401/403): stop using it, so the next call renews. */
export function rejectOpenSeaKey(k: OpenSeaKey) {
  if (k.source === "env") st().envRejected = k.key;
  else if (k.source === "auto") st().auto = { api_key: "", expires_at: new Date(0).toISOString() };
}

export const isAuthError = (e: unknown) => /HTTP 40[13]\b/.test((e as Error)?.message ?? "");
