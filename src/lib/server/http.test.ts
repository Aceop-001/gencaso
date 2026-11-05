import { afterEach, describe, expect, it, vi } from "vitest";
import { meteredHttp, retryDelay } from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe("metered HTTP retries", () => {
  it("waits and retries when an API answers 429, then succeeds", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(reply(429, {}, { "retry-after": "1" })).mockResolvedValueOnce(reply(200, { ok: 1 }));
    vi.stubGlobal("fetch", fetch);
    const p = meteredHttp.getJson("test-retry", "https://example.test/a");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after two retries with a clear error", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => reply(503));
    vi.stubGlobal("fetch", fetch);
    const p = meteredHttp.getJson("test-503", "https://example.test/b");
    const check = expect(p).rejects.toThrow("test-503: HTTP 503");
    await vi.runAllTimersAsync();
    await check;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry errors that won't fix themselves (404, 401)", async () => {
    const fetch = vi.fn().mockImplementation(async () => reply(404));
    vi.stubGlobal("fetch", fetch);
    await expect(meteredHttp.getJson("test-404", "https://example.test/c")).rejects.toThrow("HTTP 404");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("caps a long Retry-After and falls back to backoff when it's missing", () => {
    expect(retryDelay(reply(429, {}, { "retry-after": "120" }), 0)).toBe(8_000);
    expect(retryDelay(reply(429), 0)).toBe(1_500);
    expect(retryDelay(reply(429), 1)).toBe(4_000);
  });
});
