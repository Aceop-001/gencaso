import { beforeEach, describe, expect, it } from "vitest";
import type { FinancialEvent } from "../engine/schema";
import { normalizeFill, type HlFill } from "./hyperliquid";
import { SurfDataProvider, crossCheckFills, surfFillEvent, surfFillToHlFill, type SurfActivity, type SurfDirectSnapshot, type SurfFill, type SurfPosition } from "./surf";
import type { ProviderHttp } from "./types";

/**
 * No network: every request goes through a fake ProviderHttp that routes on the request URL.
 * Shapes here mirror live responses verified on 2026-11-04 (see surf.ts).
 */

const ME = "0x15baf1cefcced43e971da85b7b4de5a0391f7b29";
const DAY = 86_400_000;
const BOUND = Date.parse("2025-11-08T15:44:46Z"); // the direct provider's earliest fill

const fill = (over: Partial<SurfFill>): SurfFill => ({
  symbol: "BTC",
  side: "buy",
  direction: "Open Long",
  price: 100,
  size: 1,
  start_position: 0,
  closed_pnl: 0,
  fee: 0.1,
  fee_token: "USDC",
  crossed: false,
  is_internal: false,
  time: Math.floor(BOUND / 1000),
  time_ms: BOUND,
  fill_id: "1",
  tx_index: 0,
  hash: "0xabc",
  ...over,
});

const gapFill = (id: string, daysBefore: number, over: Partial<SurfFill> = {}) =>
  fill({ fill_id: id, time_ms: BOUND - daysBefore * DAY, time: Math.floor((BOUND - daysBefore * DAY) / 1000), direction: "Close Long", start_position: 1, closed_pnl: 10, ...over });

const activity = (over: Partial<SurfActivity>): SurfActivity => ({
  timestamp: Math.floor(BOUND / 1000),
  condition_id: "0xcond",
  type: "order_filled",
  title: "Will X happen?",
  outcome: "Yes",
  side: "buy",
  size: 100,
  usdc_size: 40,
  price: 0.4,
  transaction_hash: "0xtx1",
  ...over,
});

const position = (over: Partial<SurfPosition>): SurfPosition => ({
  condition_id: "0xcond",
  question: "Will X happen?",
  outcome_label: "Yes",
  size: 100,
  avg_price: 0.4,
  cur_price: 0.6,
  current_value: 60,
  cash_pnl: 20,
  realized_pnl: 0,
  redeemable: false,
  ...over,
});

/** Fake Surf: `routes` receives the URL and returns the response body.
 *  The free credit check (me/credits) answers a healthy balance unless a test passes another one;
 *  "unreachable" makes the check itself fail, the way a key without workspace access does (401). */
function fakeSurf(routes: (url: string) => unknown, balance: number | "unreachable" = 1_000_000) {
  const calls: string[] = [];
  const http: ProviderHttp = {
    getJson: <T,>(provider: string, url: string): Promise<T> => {
      calls.push(`${provider} ${url}`);
      if (url.includes("/me/credits")) {
        if (balance === "unreachable") return Promise.reject(new Error("surf: HTTP 401"));
        return Promise.resolve({ data: { credit_balance: balance } } as T);
      }
      return Promise.resolve(routes(url) as T);
    },
    postJson: async (): Promise<never> => {
      throw new Error("Surf is read-only");
    },
  };
  return { http, calls };
}

const run = (http: ProviderHttp, direct: SurfDirectSnapshot) => SurfDataProvider.fetch(ME, { http, now: Date.now() }, direct);

/** The direct provider's events for the overlapping fills, so the cross-check has both sides. */
const directEvent = (id: string, over: Partial<FinancialEvent> = {}): FinancialEvent => ({
  ...normalizeFill({ coin: "BTC", px: "100", sz: "1", side: "B", time: BOUND + 60_000, startPosition: "0", dir: "Close Long", closedPnl: "0", hash: "0xabc", oid: 0, tid: Number(id), fee: "0.1", feeToken: "USDC" } satisfies HlFill, ME),
  ...over,
});

beforeEach(() => {
  process.env.SURF_API_KEY = "sk_test";
  delete process.env.SURF_API_BASE_URL;
  delete process.env.SURF_MIN_BALANCE;
  delete process.env.SURF_MAX_PAGES;
});

describe("Surf fills", () => {
  it("turn a Surf fill into exactly the event the direct Hyperliquid provider would produce", () => {
    const surf = fill({ fill_id: "298318293726767", symbol: "PUMP", side: "sell", direction: "Close Long", start_position: 2, size: 1.5, price: 0.0035, closed_pnl: 4.2, fee: 0.07, time_ms: 1761955200078, hash: "0xfeed" });
    const direct: HlFill = { coin: "PUMP", px: "0.0035", sz: "1.5", side: "A", time: 1761955200078, startPosition: "2", dir: "Close Long", closedPnl: "4.2", hash: "0xfeed", oid: 0, tid: 298318293726767, fee: "0.07", feeToken: "USDC" };
    const viaSurf = surfFillEvent(surf, ME);
    const viaDirect = normalizeFill(direct, ME);
    expect(viaSurf.id).toBe(viaDirect.id);
    expect(viaSurf.id).toBe("hl-fill-298318293726767");
    expect({ ...viaSurf, source: viaDirect.source }).toEqual(viaDirect);
    expect(viaSurf.source).toBe("Surf Data API · hyperliquid/fills");
    expect(surfFillToHlFill(surf).tid).toBe(298318293726767);
  });

  it("backfills only fills older than the direct provider's earliest, halving the window when it is too big", async () => {
    const overlap = fill({ fill_id: "9001", time_ms: BOUND + 60_000, time: Math.floor((BOUND + 60_000) / 1000), closed_pnl: 3, fee: 0.2 });
    const older = gapFill("1002", 2);
    const { http, calls } = fakeSurf((url) => {
      if (url.includes("order=asc")) return { data: [gapFill("1000", 40)] }; // the wallet's oldest fill
      if (url.includes("to_ms=")) return { data: [older], meta: { has_more: false } };
      if (url.includes("from=" + Math.floor((BOUND - 45 * DAY) / 1000))) return { data: [overlap, gapFill("1001", 1)], meta: { has_more: true } };
      return { data: [gapFill("capped", 10)], meta: { has_more: true } }; // a window that is too big starts at its oldest fill
    });
    const known = new Set(["hl-fill-9001"]);
    const res = await run(http, { hyperliquid: { earliestFillMs: BOUND, truncated: true, events: [directEvent("9001", { realizedPnlUsd: 3, feeUsd: 0.2 })] }, knownIds: known });

    expect(res.events.map((e) => e.id)).toEqual(["hl-fill-1001", "hl-fill-1002"]);
    expect(res.events.every((e) => e.source === "Surf Data API · hyperliquid/fills")).toBe(true);
    expect(res.hyperliquid).toEqual({ added: 2, fromMs: BOUND - 2 * DAY, complete: false });
    expect(res.report.status).toBe("ok");
    expect(res.report.eventCount).toBe(2);
    expect(res.report.requests).toBe(4); // 2 probes + 1 page + the oldest-fill check (the free balance check is not billed)
    const fillCalls = calls.filter((u) => u.includes("/hyperliquid/fills"));
    expect(fillCalls).toHaveLength(4);
    expect(calls[0]).toContain("/me/credits"); // the gate runs before any billable call
    expect(fillCalls[0]).toContain("from=" + Math.floor((BOUND - 90 * DAY) / 1000));
    expect(fillCalls[1]).toContain("from=" + Math.floor((BOUND - 45 * DAY) / 1000));
  });

  it("never adds a fill the direct provider already has, and skips spot fills", async () => {
    const { http } = fakeSurf((url) => {
      if (url.includes("order=asc")) return { data: [] };
      if (url.includes("to_ms=")) return { data: [], meta: { has_more: false } };
      return {
        data: [
          fill({ fill_id: "9001", time_ms: BOUND + 60_000 }), // overlap: the direct provider has it too
          fill({ fill_id: "9002", time_ms: BOUND - DAY, time: Math.floor((BOUND - DAY) / 1000) }), // already in the dataset
          gapFill("9003", 2, { symbol: "@107", side: "buy", direction: "Buy" }),
          gapFill("9004", 3),
        ],
        meta: { has_more: true },
      };
    });
    const res = await run(http, { hyperliquid: { earliestFillMs: BOUND, truncated: true, events: [] }, knownIds: new Set(["hl-fill-9001", "hl-fill-9002"]) });
    expect(res.events.map((e) => e.id)).toEqual(["hl-fill-9004"]);
    expect(res.hyperliquid?.added).toBe(1);
  });

  it("reports the wallet's history as complete when the oldest fill is inside the backfilled range", async () => {
    const oldest = gapFill("1001", 3);
    const { http } = fakeSurf((url) => {
      if (url.includes("order=asc")) return { data: [oldest] };
      if (url.includes("to_ms=")) return { data: [], meta: { has_more: false } };
      return { data: [fill({ fill_id: "9001", time_ms: BOUND + 60_000 }), oldest], meta: { has_more: true } };
    });
    const res = await run(http, { hyperliquid: { earliestFillMs: BOUND, truncated: true, events: [] }, knownIds: new Set() });
    expect(res.hyperliquid).toEqual({ added: 1, fromMs: BOUND - 3 * DAY, complete: true });
  });

  it("adds nothing and warns when even the smallest window is too big for the walk", async () => {
    const { http } = fakeSurf(() => ({ data: [fill({ time_ms: BOUND - 30 * DAY })], meta: { has_more: true } }));
    const res = await run(http, { hyperliquid: { earliestFillMs: BOUND, truncated: true, events: [] }, knownIds: new Set() });
    expect(res.events).toEqual([]);
    expect(res.report.status).toBe("empty");
    expect(res.warnings.join(" ")).toMatch(/too densely/);
  });

  it("adds nothing when the wallet has no fills in the window", async () => {
    const { http } = fakeSurf(() => ({ data: [], meta: { has_more: false, empty_reason: "no fills older than the requested boundary" } }));
    const res = await run(http, { hyperliquid: { earliestFillMs: BOUND, truncated: true, events: [] }, knownIds: new Set() });
    expect(res.events).toEqual([]);
    expect(res.report.message).toMatch(/no older Hyperliquid fills found/);
  });

  it("does not run the Hyperliquid walk when the direct history is complete", async () => {
    const { http, calls } = fakeSurf(() => ({ data: [] }));
    const res = await run(http, { hyperliquid: { earliestFillMs: BOUND, truncated: false, events: [] }, knownIds: new Set() });
    expect(calls).toEqual([]);
    expect(res.events).toEqual([]);
    expect(res.report.message).toMatch(/nothing to backfill/);
  });
});

describe("Surf cross-check", () => {
  const overlapFill = fill({ fill_id: "2001", closed_pnl: 100, fee: 1 });
  const direct = directEvent("2001", { realizedPnlUsd: 100, feeUsd: 1 });

  it("stays silent when both sources agree over the overlapping period", () => {
    expect(crossCheckFills([overlapFill], [direct])).toEqual([]);
  });

  it("warns when realized P&L or fees differ by more than $1", () => {
    const pnl = crossCheckFills([{ ...overlapFill, closed_pnl: 105 }], [direct]);
    expect(pnl.join(" ")).toMatch(/realized P&L for BTC differs/);
    const fees = crossCheckFills([{ ...overlapFill, fee: 4 }], [direct]);
    expect(fees.join(" ")).toMatch(/fees for BTC differ/);
  });

  it("ignores differences under $1 and under 0.1%", () => {
    expect(crossCheckFills([{ ...overlapFill, closed_pnl: 100.5 }], [direct])).toEqual([]);
    const big = directEvent("2001", { realizedPnlUsd: 100_000, feeUsd: 1 });
    expect(crossCheckFills([{ ...overlapFill, closed_pnl: 100_050 }], [big])).toEqual([]); // 0.05%
  });

  it("warns when Surf reports a fill Hyperliquid's own history does not hold", () => {
    expect(crossCheckFills([overlapFill], []).join(" ")).toMatch(/not in Hyperliquid's own history/);
  });
});

describe("Surf Polymarket stand-in", () => {
  const direct: SurfDirectSnapshot = { polymarket: { failed: true, events: [] }, knownIds: new Set() };

  it("normalizes trades through Polymarket's own normalizer when the direct call failed", async () => {
    const { http, calls } = fakeSurf((url) => {
      if (url.includes("/positions")) return { data: [position({})] };
      return { data: [activity({}), activity({ transaction_hash: "0xtx2", side: "sell", size: 40, usdc_size: 60, price: 1.5 })], meta: {} };
    });
    const res = await run(http, direct);
    expect(res.polymarketBackup).toBe(true);
    const buy = res.events.find((e) => e.type === "PM_BUY")!;
    const sell = res.events.find((e) => e.type === "PM_SELL")!;
    expect(buy.protocol).toBe("polymarket");
    expect(buy.source).toBe("Surf Data API · prediction-market/polymarket/trades");
    expect(buy.realizedPnlUsd).toBe(0);
    expect(sell.realizedPnlUsd).toBeCloseTo(44, 6); // 40 of 100 shares (cost $16) sold for $60
    expect(res.openPositions).toHaveLength(1);
    expect(res.openPositions[0].asset).toBe("Yes");
    expect(res.report.message).toMatch(/Polymarket stand-in: 2 events/);
    expect(calls.some((u) => u.includes("type=all"))).toBe(true);
  });

  it("treats a position resolved at zero as a realized loss", async () => {
    const { http } = fakeSurf((url) => {
      if (url.includes("/positions")) return { data: [position({ cur_price: 0, current_value: 0, cash_pnl: -40, redeemable: true })] };
      return { data: [activity({})], meta: {} };
    });
    const res = await run(http, direct);
    const loss = res.events.find((e) => e.type === "PM_SETTLE_LOSS")!;
    expect(loss.realizedPnlUsd).toBe(-40);
    expect(loss.source).toBe("Surf Data API · prediction-market/polymarket/positions");
    expect(res.openPositions).toEqual([]);
  });

  it("does not run when the direct Polymarket provider is healthy", async () => {
    const { http, calls } = fakeSurf(() => ({ data: [] }));
    const res = await run(http, { polymarket: { failed: false, events: [directEvent("x")] }, knownIds: new Set() });
    expect(calls).toEqual([]);
    expect(res.polymarketBackup).toBe(false);
  });
});

describe("Surf credit gate", () => {
  const direct = (): SurfDirectSnapshot => ({ hyperliquid: { earliestFillMs: BOUND, truncated: true, events: [] }, knownIds: new Set() });
  const fillsCalls = (calls: string[]) => calls.filter((u) => u.includes("/hyperliquid/fills"));
  /** A simple backfill: one probe that fits, one page, then the oldest-fill check. */
  const routes = (url: string) => {
    if (url.includes("order=asc")) return { data: [gapFill("1000", 40)] };
    if (url.includes("to_ms=")) return { data: [gapFill("1002", 2)], meta: { has_more: false } };
    // the window fits: its newest fill is the overlap day, the older fills follow
    return {
      data: [fill({ fill_id: "9001", time_ms: BOUND + 60_000, time: Math.floor((BOUND + 60_000) / 1000) }), gapFill("1001", 1)],
      meta: { has_more: true },
    };
  };

  it("checks the free balance first, then backfills when it is above the floor", async () => {
    process.env.SURF_MIN_BALANCE = "500";
    const { http, calls } = fakeSurf(routes, 500);
    const res = await run(http, direct());
    expect(res.skipped).toBeUndefined();
    expect(res.hyperliquid).toEqual({ added: 2, fromMs: BOUND - 2 * DAY, complete: false });
    expect(calls[0]).toContain("/me/credits"); // the gate runs before any billable call
    expect(fillsCalls(calls)).toHaveLength(3); // 1 probe + 1 page + the oldest-fill check
    expect(res.warnings.join(" ")).not.toMatch(/skipped/);
  });

  it("skips with a warning and spends nothing when the balance is below the floor", async () => {
    process.env.SURF_MIN_BALANCE = "500";
    const { http, calls } = fakeSurf(routes, 412);
    const res = await run(http, direct());
    expect(res.skipped).toBe(true);
    expect(res.events).toEqual([]);
    expect(res.openPositions).toEqual([]);
    expect(res.report.requests).toBe(0); // 0 Surf data calls
    expect(fillsCalls(calls)).toEqual([]);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/^Surf skipped: credit balance below the limit/);
    expect(res.warnings[0]).toContain("412");
    expect(res.warnings[0]).toContain("SURF_MIN_BALANCE is 500");
    expect(res.report.message).toMatch(/^skipped: credit balance below the limit/);
  });

  it("skips the same way when the balance cannot be checked at all, and says why", async () => {
    const { http, calls } = fakeSurf(routes, "unreachable");
    const res = await run(http, direct());
    expect(res.skipped).toBe(true);
    expect(fillsCalls(calls)).toEqual([]);
    expect(res.report.requests).toBe(0);
    expect(res.warnings[0]).toMatch(/^Surf skipped: credit balance could not be checked/);
    expect(res.warnings[0]).toContain("401");
  });

  it("defaults to a 500-credit floor, and runs at exactly the floor", async () => {
    expect((await run(fakeSurf(routes, 499).http, direct())).skipped).toBe(true);
    expect((await run(fakeSurf(routes, 500).http, direct())).skipped).toBeUndefined();
  });

  it("gates the Polymarket stand-in with the same check", async () => {
    const { http, calls } = fakeSurf(() => ({ data: [] }), 10);
    const res = await run(http, { polymarket: { failed: true, events: [] }, knownIds: new Set() });
    expect(res.skipped).toBe(true);
    expect(res.polymarketBackup).toBe(false);
    expect(calls.some((u) => u.includes("prediction-market"))).toBe(false);
  });

  it("honours SURF_MAX_PAGES instead of the built-in 20-page budget", async () => {
    process.env.SURF_MAX_PAGES = "2";
    // Every page is full and says there is more, so only the budget can stop the walk (ids must be numeric).
    const dense = (base: number) => ({
      data: [
        fill({ fill_id: String(base), time_ms: BOUND + 60_000, time: Math.floor((BOUND + 60_000) / 1000) }),
        ...Array.from({ length: 99 }, (_, i) => gapFill(String(base + 1 + i), 5 + i * 0.01)),
      ],
      meta: { has_more: true },
    });
    const { http, calls } = fakeSurf((url) => (url.includes("order=asc") ? { data: [] } : dense(url.includes("to_ms=") ? 2000 : 1000)));
    const res = await run(http, direct());
    expect(calls.filter((u) => u.includes("to_ms="))).toHaveLength(1); // one continuation page, then the budget stops it
    expect(res.hyperliquid?.added).toBe(198); // 99 older fills per page × 2 pages
  });
});

describe("Surf configuration", () => {
  it("stays disabled without a key and makes no requests", async () => {
    delete process.env.SURF_API_KEY;
    const { http, calls } = fakeSurf(() => ({ data: [] }));
    const res = await run(http, { hyperliquid: { earliestFillMs: BOUND, truncated: true, events: [] }, knownIds: new Set() });
    expect(calls).toEqual([]);
    expect(res.events).toEqual([]);
    expect(res.report.status).toBe("unsupported");
    expect(res.report.message).toMatch(/SURF_API_KEY/);
  });
});
