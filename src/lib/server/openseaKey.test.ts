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
