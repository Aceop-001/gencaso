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
  key: string;
  source: "env" | "auto";
  expiresAt?: number;
  /** True when this call had to mint a new free key (one extra request) */
  minted?: boolean;
}

interface Stored {
  api_key: string;
  expires_at: string;
}

const g = globalThis as unknown as { __gencasoOsKey?: { envRejected?: string; auto?: Stored } };
const state = (g.__gencasoOsKey ??= {});

export const autoKeysEnabled = () => process.env.OPENSEA_AUTO_KEY !== "0";

async function loadStored(): Promise<Stored | undefined> {
  if (state.auto) return state.auto;
  try {
    const s = JSON.parse(await readFile(store(), "utf8")) as Stored;
    if (s.api_key && s.expires_at) return (state.auto = s);
  } catch {
    // no stored key yet
  }
  return undefined;
}

async function mint(http: ProviderHttp): Promise<Stored> {
  const res = await http.postJson<Partial<Stored>>("opensea", MINT_URL, {});
  if (!res.api_key || !res.expires_at) throw new Error("opensea: key service returned no key");
  const s = { api_key: res.api_key, expires_at: res.expires_at };
  state.auto = s;
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
  if (env && state.envRejected !== env) return { key: env, source: "env" };
  if (!autoKeysEnabled()) return null;
  let s = await loadStored();
  const minted = !s || Date.parse(s.expires_at) - now < RENEW_BEFORE_MS;
  if (minted) s = await mint(http);
  return { key: s!.api_key, source: "auto", expiresAt: Date.parse(s!.expires_at), minted };
}

/** Called when OpenSea rejects a key (401/403): stop using it, so the next call renews. */
export function rejectOpenSeaKey(k: OpenSeaKey) {
  if (k.source === "env") state.envRejected = k.key;
  else state.auto = { api_key: "", expires_at: new Date(0).toISOString() };
}

export const isAuthError = (e: unknown) => /HTTP 40[13]\b/.test((e as Error)?.message ?? "");
