import { describe, expect, it } from "vitest";
import { PositionBook } from "./positions";
import { dedupe, summarize } from "./summary";
import type { FinancialEvent } from "./schema";
import { buildMockEvents } from "../providers/mock";
import { classifyFill, normalizeFill, type HlFill } from "../providers/hyperliquid";
import { fromV2Activity, normalizeActivity, PolymarketDataProvider, type PmActivity } from "../providers/polymarket";
import { validateAddress } from "../validation";
import { eventLinks } from "../links";
import { BulkDataProvider, normalizeBulk, toMs, type BulkFill } from "../providers/bulk";
import { HertzFlowDataProvider, normalizeHzTrade, type HzTrade } from "../providers/hertzflow";

describe("PositionBook", () => {
  it("handles open, increase, partial close and full close with average cost", () => {
    const b = new PositionBook();
    expect(b.apply({ key: "k", timestamp: 1, side: 1, quantity: 1, price: 100 }).transition).toBe("OPEN");
    const inc = b.apply({ key: "k", timestamp: 2, side: 1, quantity: 1, price: 200 });
    expect(inc.transition).toBe("INCREASE");
    expect(inc.avgPriceAfter).toBe(150);
    const red = b.apply({ key: "k", timestamp: 3, side: -1, quantity: 0.5, price: 250 });
    expect(red.transition).toBe("REDUCE");
    expect(red.realizedPnl).toBe(50); // 0.5 * (250 - 150)
    const close = b.apply({ key: "k", timestamp: 4, side: -1, quantity: 1.5, price: 100 });
    expect(close.transition).toBe("CLOSE");
    expect(close.realizedPnl).toBe(-75); // 1.5 * (100 - 150)
    expect(close.openedAt).toBe(1);
    expect(b.get("k")).toBeUndefined();
  });

  it("realizes P&L on shorts and handles flips", () => {
    const b = new PositionBook();
    b.apply({ key: "s", timestamp: 1, side: -1, quantity: 2, price: 100 });
    const flip = b.apply({ key: "s", timestamp: 2, side: 1, quantity: 3, price: 80 });
    expect(flip.transition).toBe("FLIP");
    expect(flip.realizedPnl).toBe(40); // short 2 from 100 → 80
    expect(b.get("s")).toEqual({ size: 1, avgPrice: 80 });
  });

  it("settles prediction-market positions at 0 or 1", () => {
    const b = new PositionBook();
    b.apply({ key: "m", timestamp: 1, side: 1, quantity: 100, price: 0.3 });
    expect(b.settle("m", 1, 2)!.realizedPnl).toBe(70);
    b.apply({ key: "n", timestamp: 1, side: 1, quantity: 100, price: 0.4 });
    expect(b.settle("n", 0, 2)!.realizedPnl).toBe(-40);
  });

  it("rejects invalid fills", () => {
    expect(() => new PositionBook().apply({ key: "x", timestamp: 1, side: 1, quantity: 0, price: 1 })).toThrow();
  });
});

const ev = (p: Partial<FinancialEvent>): FinancialEvent => ({
  id: Math.random().toString(36),
  protocol: "mock",
  chain: "test",
  account: "t",
  timestamp: 0,
  category: "perp",
  type: "PERP_CLOSE",
  asset: "BTC",
  quantity: 1,
  realizedPnlUsd: 0,
  feeUsd: 0,
  fundingUsd: 0,
  fiat: { currency: "USD", source: "test" },
  source: "test",
  verification: "mock",
  confidence: 1,
  ...p,
});

describe("summarize", () => {
  it("never counts deposits/withdrawals as profit and counts fees/funding once", () => {
    const s = summarize([
      ev({ type: "DEPOSIT", category: "account", amountUsd: 10_000 }),
      ev({ type: "PERP_CLOSE", realizedPnlUsd: 500, feeUsd: 5 }),
      ev({ type: "PERP_CLOSE", realizedPnlUsd: -200, feeUsd: 3 }),
      ev({ type: "FUNDING", fundingUsd: -12 }),
      ev({ type: "FUNDING", fundingUsd: 4 }),
      ev({ type: "WITHDRAWAL", category: "account", amountUsd: 2_000 }),
    ]);
    expect(s.realizedProfit).toBe(500);
    expect(s.realizedLoss).toBe(200);
    expect(s.netRealized).toBe(300);
    expect(s.fees).toBe(8);
    expect(s.netFunding).toBe(-8);
    expect(s.netTradingResult).toBe(284);
    expect(s.deposits).toBe(10_000);
    expect(s.withdrawals).toBe(2_000);
  });

  it("dedupes by id", () => {
    const a = ev({ id: "x" });
    expect(dedupe([a, a, ev({ id: "y" })]).duplicates).toBe(1);
  });
});

describe("mock provider", () => {
  it("is deterministic and fully labelled as mock", () => {
    const a = buildMockEvents().events;
    const b = buildMockEvents().events;
    expect(a).toEqual(b);
    expect(a.every((e) => e.verification === "mock")).toBe(true);
    expect(a.some((e) => e.type === "LIQUIDATION")).toBe(true);
    expect(a.some((e) => e.type === "PM_REDEEM")).toBe(true);
  });
});

describe("hyperliquid normalization", () => {
  const base: HlFill = { coin: "BTC", px: "100", sz: "1", side: "B", time: 1, startPosition: "0", dir: "Open Long", closedPnl: "0", hash: "h", oid: 1, tid: 9, fee: "0.5", feeToken: "USDC" };
  it("classifies fills from dir/startPosition", () => {
    expect(classifyFill(base)).toBe("PERP_OPEN");
    expect(classifyFill({ ...base, startPosition: "2" })).toBe("PERP_INCREASE");
    expect(classifyFill({ ...base, dir: "Close Long", startPosition: "1" })).toBe("PERP_CLOSE");
    expect(classifyFill({ ...base, dir: "Close Long", startPosition: "3" })).toBe("PERP_REDUCE");
    expect(classifyFill({ ...base, dir: "Short > Long" })).toBe("PERP_FLIP");
    expect(classifyFill({ ...base, liquidation: {} })).toBe("LIQUIDATION");
  });
  it("maps closedPnl and fee (negative fee = rebate)", () => {
    const e = normalizeFill({ ...base, dir: "Close Long", startPosition: "1", closedPnl: "37.5", fee: "-1.15" }, "0xabc");
    expect(e.realizedPnlUsd).toBe(37.5);
    expect(e.feeUsd).toBe(-1.15);
    expect(e.id).toBe("hl-fill-9");
    expect(e.verification).toBe("verified");
    expect(e.txHash).toBe("h");
  });
  it("drops all-zero hashes (internal fills have no transaction)", () => {
    expect(normalizeFill({ ...base, hash: "0x" + "0".repeat(64) }, "0xabc").txHash).toBeUndefined();
  });
});

describe("event links", () => {
  it("links Hyperliquid fills to the explorer and Polymarket trades to Polygonscan and the market", () => {
    const hl = normalizeFill({ coin: "BTC", px: "1", sz: "1", side: "B", time: 1, startPosition: "0", dir: "Open Long", closedPnl: "0", hash: "0xabc", oid: 1, tid: 2, fee: "0", feeToken: "USDC" }, "0x");
    expect(eventLinks(hl)).toEqual([{ label: "Explorer", href: "https://app.hyperliquid.xyz/explorer/tx/0xabc" }]);
    const { events } = normalizeActivity(
      [{ proxyWallet: "0x", timestamp: 1, conditionId: "c", type: "TRADE", size: 1, usdcSize: 0.5, transactionHash: "0xdef", price: 0.5, asset: "a", side: "BUY", outcomeIndex: 0, title: "M", slug: "will-it-rain", outcome: "Yes" }],
      "0x",
    );
    expect(eventLinks(events[0]).map((l) => l.href)).toEqual(["https://polygonscan.com/tx/0xdef", "https://polymarket.com/market/will-it-rain"]);
  });
  it("never links demo data", () => {
    expect(buildMockEvents().events.every((e) => eventLinks(e).length === 0)).toBe(true);
  });
});

describe("polymarket normalization", () => {
  const row = (p: Partial<PmActivity>): PmActivity => ({ proxyWallet: "0x", timestamp: 1, conditionId: "c1", type: "TRADE", size: 100, usdcSize: 40, transactionHash: "0xt", price: 0.4, asset: "a1", side: "BUY", outcomeIndex: 0, title: "Market", slug: "m", outcome: "Yes", ...p });
  it("rebuilds cost basis and realizes on sell and redeem", () => {
    const { events, openPositions } = normalizeActivity(
      [row({}), row({ timestamp: 2, side: "SELL", size: 50, price: 0.6, transactionHash: "0xs" }), row({ timestamp: 3, type: "REDEEM", asset: "", size: 50, usdcSize: 50, transactionHash: "0xr" })],
      "0x",
    );
    expect(events.find((e) => e.type === "PM_SELL")!.realizedPnlUsd).toBe(10); // 50 * (0.6 - 0.4)
    expect(events.find((e) => e.type === "PM_REDEEM")!.realizedPnlUsd).toBe(30); // 50 - 20
    expect(openPositions).toHaveLength(0);
  });

  it("infers trading fees from usdcSize vs size × price (shape seen on live API)", () => {
    const { events } = normalizeActivity([row({ size: 33.33, price: 0.85, usdcSize: 28.34466 })], "0x");
    expect(events[0].feeUsd).toBeCloseTo(0.01416, 5);
  });
});

describe("polymarket data api v2", () => {
  const v2 = (p: Record<string, unknown> = {}) => ({
    proxy_wallet: "0x", timestamp: 1, condition_id: "c1", type: "TRADE", size: 10, usdc_size: 4, transaction_hash: "0xt", price: 0.4,
    token_id: "tok", side: "BUY", outcome_index: 0, title: "M", slug: "m", outcome: "Yes", ...p,
  });

  it("maps snake_case v2 rows onto the normalizer's shape", () => {
    const a = fromV2Activity(v2());
    expect(a).toMatchObject({ conditionId: "c1", asset: "tok", usdcSize: 4, transactionHash: "0xt", side: "BUY", slug: "m" });
  });

  it("handles v2-only activity types and skips combos", () => {
    const rows = [
      v2({ type: "MAKER_REBATE", usdc_size: 1.5, token_id: "", side: "" }),
      v2({ type: "MIGRATION", usdc_size: 100, token_id: "", side: "", timestamp: 2 }),
      v2({ type: "TRADE", is_combo: true, timestamp: 3 }),
    ].map(fromV2Activity);
    const { events, warnings } = normalizeActivity(rows as PmActivity[], "0x");
    expect(events.map((e) => [e.type, e.realizedPnlUsd])).toEqual([["REWARD", 0], ["TRANSFER", 0]]);
    expect(warnings.some((w) => w.includes("combo"))).toBe(true);
  });

  it("follows cursors with full history and never sends offset", async () => {
    const urls: string[] = [];
    const pages: Record<string, unknown> = {
      first: { data: [v2()], pagination: { has_more: true, next_cursor: "abc" } },
      second: { data: [v2({ side: "SELL", price: 0.6, usdc_size: 6, timestamp: 2, transaction_hash: "0xs" })], pagination: { has_more: false, next_cursor: null } },
      lost: { data: [], pagination: { has_more: false, next_cursor: null } },
    };
    const http = {
      getJson: async <T,>(_: string, url: string) => {
        urls.push(url);
        return (url.includes("/positions") ? pages.lost : url.includes("cursor=abc") ? pages.second : pages.first) as T;
      },
      postJson: async <T,>() => ({}) as T,
    };
    const res = await PolymarketDataProvider.fetch("0xabc", { http, now: 0 });
    expect(urls[0]).toContain("https://data-api.polymarket.com/v2/activity?");
    expect(urls[0]).toContain("start=1");
    expect(urls.every((u) => !u.includes("offset"))).toBe(true);
    expect(urls[2]).toContain("status=REDEEMABLE_LOST");
    expect(res.events.find((e) => e.type === "PM_SELL")!.realizedPnlUsd).toBe(2); // 10 × (0.6 − 0.4)
  });
});

describe("bulk trade", () => {
  const ME = "ME";
  const fill = (p: Partial<BulkFill> = {}): BulkFill => ({
    maker: "OTHER", taker: ME, isBuy: true, symbol: "SOL-USD", amount: 10, price: 100, makerFee: 0.01, takerFee: -0.035,
    slot: 1, sequence: 0, timestamp: 1_790_000_000_000_000_000, ...p,
  });

  it("normalizes timestamps given in s, ms, µs or ns", () => {
    const ms = 1_790_100_000_000;
    expect([toMs(ms / 1000), toMs(ms), toMs(ms * 1000), toMs(ms * 1_000_000)]).toEqual([ms, ms, ms, ms]);
  });

  it("rebuilds realized P&L from the account's own fill side; Bulk fee signs are P&L (negative = paid)", () => {
    const { events, openPositions } = normalizeBulk(ME, [
      fill(), // taker buys 10 @ 100, pays 0.035
      fill({ maker: ME, taker: "OTHER", isBuy: false, amount: 4, price: 110, slot: 2 }), // maker sells 4 @ 110, earns 0.01 rebate
    ], [], []);
    expect(events.map((e) => [e.type, e.realizedPnlUsd, e.feeUsd])).toEqual([["PERP_OPEN", 0, 0.035], ["PERP_REDUCE", 40, -0.01]]);
    expect(openPositions).toEqual([{ protocol: "bulk", asset: "SOL", quantity: 6, avgEntryPrice: 100 }]);
    expect(events[0].timestamp).toBe(1_790_000_000_000);
  });

  it("marks liquidations, books funding as paid when negative, and ignores failed withdrawals", () => {
    const { events } = normalizeBulk(
      ME,
      [fill(), fill({ isBuy: false, reason: "liquidation", takerFee: 0, price: 90, slot: 2 })],
      [{ symbol: "SOL-USD", size: 10, payment: -0.34, fundingRate: 0.0000125, slot: 3, sequence: 0, timestamp: 1_790_000_100_000_000_000 }],
      [
        { activityType: "deposit", status: "completed", from: "VAULT", to: ME, symbol: "USDC", amount: 5000, slot: 0, sequence: 0, timestamp: 1_789_000_000_000_000_000 },
        { activityType: "withdrawal", status: "failed", from: ME, to: "W", symbol: "USDC", amount: 100, slot: 4, sequence: 0, timestamp: 1_790_000_200_000_000_000 },
      ],
    );
    expect(events.map((e) => e.type)).toEqual(["DEPOSIT", "PERP_OPEN", "LIQUIDATION", "FUNDING"]);
    expect(events.find((e) => e.type === "LIQUIDATION")!.realizedPnlUsd).toBe(-100);
    expect(events.find((e) => e.type === "FUNDING")!.fundingUsd).toBe(-0.34);
    expect(summarize(events).netTradingResult).toBeCloseTo(-100 - 0.035 - 0.34, 9);
  });

  it("queries mainnet, pages history, and warns when its totals disagree with Bulk's", async () => {
    const bodies: Record<string, unknown>[] = [];
    const http = {
      getJson: async <T,>() => ({}) as T,
      postJson: async <T,>(_: string, url: string, body: unknown) => {
        expect(url).toBe("https://mainnet-api1.bulk.trade/api/v1/account");
        const b = body as { type: string; cursor?: string };
        bodies.push(b);
        if (b.type === "fullAccount") return [{ fullAccount: { margin: { realizedPnl: 999, fees: -25, funding: 0 } } }] as T;
        if (b.type === "fills") return { data: b.cursor ? [] : [fill()], page: { nextCursor: b.cursor ? null : "c1", hasMore: !b.cursor, coverage: "unknown" } } as T;
        return { data: [], page: { nextCursor: null, hasMore: false, coverage: "unknown" } } as T;
      },
    };
    const res = await BulkDataProvider.fetch(ME, { http, now: 0 });
    expect(bodies.filter((b) => b.type === "fills")).toEqual([{ type: "fills", user: ME, limit: 5000 }, { type: "fills", user: ME, limit: 5000, cursor: "c1" }]);
    expect(res.events).toHaveLength(1);
    expect(res.warnings.some((w) => w.includes("realized P&L"))).toBe(true); // 0 rebuilt vs 999 reported
    expect(res.warnings.some((w) => w.includes("fees"))).toBe(true); // rebuilt fees −0.035 vs Bulk's −25 (beyond the $1 tolerance)
  });

  it("treats Bulk's 404 ACCOUNT_NOT_FOUND as no account, not an error", async () => {
    const http = { getJson: async <T,>() => ({}) as T, postJson: async <T,>(): Promise<T> => { throw new Error("bulk: HTTP 404"); } };
    const res = await BulkDataProvider.fetch("NEVER_TRADED", { http, now: 0 });
    expect(res.report.status).toBe("empty");
    expect(res.events).toHaveLength(0);
    expect(BulkDataProvider.supports("solana")).toBe(true);
    expect(BulkDataProvider.supports("evm")).toBe(false);
  });
});

describe("hertzflow", () => {
  // Two real closes (BNB/USD short, hyper mode) whose net results were checked against BNB Chain payouts
  const profitable: HzTrade = {
    market_symbol: "BNB/USD", direction: "short", position_mode: "hyper", action_type: "market_close", display_action: "Market Close",
    size_in_usd: "0", size_delta_usd: "750420000000000000000000000000000", size_delta_tokens: "1000000000000000000",
    collateral_delta_amount: "50000000000000000000", collateral_token_price_min: "999700140000", execution_price: "750420000000000",
    funding_fee_amount: "181696982241631991", borrowing_fee_usd: "2426938634989648424502379414", position_fee_amount: "0",
    pnl_detail: { gross_pnl: "1380511114492903164203107555963", loss_rebate: "0", fees: "184064872991332753860067199414", price_impact: "-160458877828028584467554095", liquidation_fee: "0", profit_sharing: "798946655792253897298984740000" },
    action_time_ms: 1788513480000, tx_hash: "0x72dec4e3e9", log_index: 1,
  };
  const losing: HzTrade = {
    ...profitable, size_delta_usd: "961131462662075562892573450394210", size_delta_tokens: "1292637505932090574", collateral_delta_amount: "64021003400928485909",
    funding_fee_amount: "778848109446651074", borrowing_fee_usd: "31259712254023184193546915747",
    pnl_detail: { gross_pnl: "-13125610124038055902836518419202", loss_rebate: "0", fees: "809874276306575585402497275747", price_impact: "-1667789006140071269950022425", liquidation_fee: "0" },
    action_time_ms: 1788919912000, tx_hash: "0x07cc3da897", log_index: 615,
  };
  const net = (t: HzTrade) => { const e = normalizeHzTrade(t, "0xW")!; return e.realizedPnlUsd - e.feeUsd + e.fundingUsd; };

  it("reproduces the on-chain-verified net result of each close (profit share and funding included)", () => {
    expect(net(profitable)).toBeCloseTo(0.3973, 3);
    expect(net(losing)).toBeCloseTo(-13.9372, 3);
  });

  it("decodes 30-decimal USD and 18-decimal tokens into price and size, and links to BscScan", () => {
    const e = normalizeHzTrade(losing, "0xW")!;
    expect(e).toMatchObject({ type: "PERP_CLOSE", asset: "BNB", protocol: "hertzflow", txHash: "0x07cc3da897" });
    expect(e.quantity).toBeCloseTo(1.292638, 6);
    expect(e.price).toBeCloseTo(743.54, 1);
    expect(eventLinks(e)[0].href).toBe("https://bscscan.com/tx/0x07cc3da897");
  });

  it("ignores order bookkeeping and failed orders", () => {
    for (const a of ["created_tp", "updated_tp", "cancelled_tp", "failed_market_open"]) expect(normalizeHzTrade({ ...profitable, action_type: a, pnl_detail: undefined }, "0xW")).toBeNull();
    expect(normalizeHzTrade({ ...profitable, action_type: "market_open", pnl_detail: undefined }, "0xW")!.type).toBe("PERP_OPEN");
  });

  it("pages with next_cursor", async () => {
    const urls: string[] = [];
    const http = {
      postJson: async <T,>() => ({}) as T,
      getJson: async <T,>(_: string, url: string) => {
        urls.push(url);
        const first = !url.includes("cursor=");
        return { code: 200, data: { items: [first ? profitable : losing], next_cursor: first ? "abc" : null } } as T;
      },
    };
    const res = await HertzFlowDataProvider.fetch("0xW", { http, now: 0 });
    expect(urls[0]).toBe("https://data-statistics-query.mainnet.htzfl.link/api/v1/bsc/user/trades?user_address=0xW&limit=100");
    expect(urls[1]).toContain("cursor=abc");
    expect(res.events).toHaveLength(2);
  });
});

describe("address validation", () => {
  it("accepts EVM and demo, rejects private keys and seed phrases", () => {
    expect(validateAddress("0x339030695894d065719b8ee501459a467ef1388a").kind).toBe("evm");
    expect(validateAddress("demo").kind).toBe("demo");
    expect(validateAddress("0x" + "a".repeat(64)).ok).toBe(false);
    expect(validateAddress("abandon ".repeat(12)).ok).toBe(false);
    expect(validateAddress("0x123").ok).toBe(false);
  });
});
