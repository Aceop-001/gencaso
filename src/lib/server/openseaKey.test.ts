import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { OpenSeaDataProvider } from "../providers/opensea";
import type { ProviderHttp } from "../providers/types";

const NOW = Date.parse("2026-11-10T00:00:00Z");
const DAY = 86_400_000;

/** Fake OpenSea: accepts only `valid` keys, mints `minted-N` keys expiring 7 days after NOW. */
function fakeOpenSea(valid: Set<string>) {
  const calls: string[] = [];
  let n = 0;
  const http: ProviderHttp = {
    async getJson<T>(provider: string, url: string, headers?: Record<string, string>) {
      calls.push(`GET ${provider} ${headers?.["x-api-key"] ?? ""}`);
      if (provider === "opensea" && !valid.has(headers?.["x-api-key"] ?? "")) throw new Error("opensea: HTTP 401");
      return { asset_events: [], next: null } as T;
    },
    async postJson<T>(provider: string, url: string) {
      const key = `minted-${++n}`;
      valid.add(key);
      calls.push(`POST ${provider} ${url}`);
      return { api_key: key, expires_at: new Date(NOW + 7 * DAY).toISOString() } as T;
    },
  };
  return { http, calls };
}

beforeEach(() => {
  (globalThis as { __gencasoOsKey?: unknown }).__gencasoOsKey = {};
  process.env.OPENSEA_KEY_STORE = path.join(mkdtempSync(path.join(tmpdir(), "gencaso-")), "key.json");
  delete process.env.OPENSEA_API_KEY;
  delete process.env.OPENSEA_AUTO_KEY;
});

const run = (http: ProviderHttp, now = NOW) => OpenSeaDataProvider.fetch("0xd6c045df17c7b8938746d72923a6c7696ea4d5e8", { http, now });

describe("OpenSea key", () => {
  it("uses OPENSEA_API_KEY while it works", async () => {
    process.env.OPENSEA_API_KEY = "permanent";
    const { http, calls } = fakeOpenSea(new Set(["permanent"]));
    await run(http);
    expect(calls).toEqual(["GET opensea permanent"]);
  });

  it("switches to an automatic free key when the configured key has expired", async () => {
    process.env.OPENSEA_API_KEY = "expired-test-key";
    const { http, calls } = fakeOpenSea(new Set());
    const res = await run(http);
    expect(calls).toEqual(["GET opensea expired-test-key", "POST opensea https://api.opensea.io/api/v2/auth/keys", "GET opensea minted-1"]);
    expect(res.report.status).toBe("empty");
    expect(res.report.message).toMatch(/renewed automatically/);
    // Later analyses go straight to the stored key
    calls.length = 0;
    await run(http);
    expect(calls).toEqual(["GET opensea minted-1"]);
  });

  it("renews the free key a day before it expires", async () => {
    const { http, calls } = fakeOpenSea(new Set());
    await run(http);
    await run(http, NOW + 6.5 * DAY);
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(2);
    expect(calls.at(-1)).toBe("GET opensea minted-2");
  });

  it("stays disconnected when automatic keys are turned off and no key is set", async () => {
    process.env.OPENSEA_AUTO_KEY = "0";
    const { http, calls } = fakeOpenSea(new Set());
    const res = await run(http);
    expect(calls).toEqual([]);
    expect(res.report.status).toBe("unsupported");
  });
});

describe("OpenSea key on read-only hosting", () => {
  it("keeps working when the key file cannot be written", async () => {
    process.env.OPENSEA_KEY_STORE = path.join(tmpdir(), "no-such-dir-\0", "key.json"); // invalid path → write fails
    const { http, calls } = fakeOpenSea(new Set());
    const res = await run(http);
    expect(res.report.status).toBe("empty");
    expect(calls.at(-1)).toBe("GET opensea minted-1");
  });
});

/** OpenSea where minting is rate-limited (as on shared hosting). keylessOk = reads work without a key. */
function busyKeyService(opts: { keylessOk: boolean }) {
  const calls: string[] = [];
  const http: ProviderHttp = {
    async getJson<T>(provider: string, url: string, headers?: Record<string, string>) {
      const k = headers?.["x-api-key"];
      calls.push(`GET ${provider} ${k ?? "(no key)"}`);
      if (provider === "opensea" && k === undefined && !opts.keylessOk) throw new Error("opensea: HTTP 401");
      if (provider === "opensea" && k === "expired") throw new Error("opensea: HTTP 401");
      return { asset_events: [], next: null } as T;
    },
    async postJson<T>(provider: string): Promise<T> {
      calls.push(`POST ${provider}`);
      throw new Error("opensea: HTTP 429");
    },
  };
  return { http, calls };
}

describe("OpenSea when the free-key service is busy", () => {
  it("reads without a key instead of failing when a key can't be minted", async () => {
    const { http, calls } = busyKeyService({ keylessOk: true });
    const res = await run(http);
    expect(calls).toEqual(["POST opensea", "GET opensea (no key)"]);
    expect(res.report.status).toBe("empty");
    expect(res.report.message).toMatch(/without an API key/);
  });

  it("waits before trying to mint again, so it doesn't hammer the key service", async () => {
    const { http, calls } = busyKeyService({ keylessOk: true });
    await run(http);
    await run(http, NOW + 5 * 60_000);
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
    await run(http, NOW + 16 * 60_000);
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(2);
  });

  it("says exactly what to do when OpenSea refuses reads without a key (its current behaviour)", async () => {
    const { http, calls } = busyKeyService({ keylessOk: false });
    await expect(run(http)).rejects.toThrow(/Set OPENSEA_API_KEY.*15 minutes/);
    expect(calls).toEqual(["POST opensea", "GET opensea (no key)"]);
  });

  it("gives the same clear message when an expired key can't be renewed", async () => {
    process.env.OPENSEA_API_KEY = "expired";
    const { http, calls } = busyKeyService({ keylessOk: false });
    await expect(run(http)).rejects.toThrow(/Set OPENSEA_API_KEY/);
    expect(calls).toEqual(["GET opensea expired", "POST opensea"]);
  });
});
