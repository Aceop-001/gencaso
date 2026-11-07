import { describe, expect, it } from "vitest";
import { calculateTax, jurisdiction } from "../tax";
import { combineDatasets, splitWallets, walletLabel, walletsOf } from "./combine";
import type { FinancialEvent, WalletDataset } from "./schema";

const A = "0xaaaa000000000000000000000000000000000001";
const B = "0xbbbb000000000000000000000000000000000002";
const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const T = Date.UTC(2026, 2, 10);

const ev = (account: string, id: string, pnl: number, o: Partial<FinancialEvent> = {}): FinancialEvent => ({
  id, protocol: "hyperliquid", chain: "hyperliquid", account, timestamp: T, category: "perp", type: "PERP_CLOSE",
  asset: "BTC", quantity: 1, price: 100, realizedPnlUsd: pnl, feeUsd: 0, fundingUsd: 0,
  fiat: { currency: "USD", source: "t" }, source: "t", verification: "verified", confidence: 1, ...o,
});
const ds = (address: string, events: FinancialEvent[], o: Partial<WalletDataset> = {}): WalletDataset => ({
  address, isDemo: false, fetchedAt: T + 1, events,
  providers: [{ provider: "HyperliquidDataProvider", protocol: "hyperliquid", status: "ok", eventCount: events.length, requests: 1, fromCache: false, limitations: [] }],
  dataWarnings: [], openPositions: [], fx: { source: "t", rates: {}, missing: [] }, ...o,
});

describe("combined multi-wallet report", () => {
  it("a single wallet is returned unchanged", () => {
    const one = ds(A, [ev(A, "x", 10)]);
    expect(combineDatasets([one])).toBe(one);
    expect(walletLabel(one)).toBe("0xaaaa…0001");
  });

  it("merges every wallet's trades, so tax covers all of them", () => {
    const c = combineDatasets([ds(A, [ev(A, "a1", 1000)]), ds(B, [ev(B, "b1", 500)])]);
    expect(c.events).toHaveLength(2);
    expect(walletsOf(c)).toEqual([A, B]);
    expect(walletLabel(c)).toBe("2 wallets");
    const us = jurisdiction("US");
    const year = us.taxYearOf(T);
    const r = calculateTax(c, "US", year, { traderType: "individual", otherIncomeLocal: 0 });
    expect(r.netTradingLocal).toBeCloseTo(1500, 6);
  });

  it("keeps both sides when two of your own wallets traded against each other (same trade id)", () => {
    const c = combineDatasets([ds(A, [ev(A, "hl-fill-77", 40)]), ds(B, [ev(B, "hl-fill-77", -40)])]);
    expect(c.events).toHaveLength(2);
  });

  it("labels each source report and warning with its wallet", () => {
    const c = combineDatasets([ds(A, [], { dataWarnings: ["fill limit hit"] }), ds(B, [])]);
    expect(c.providers.map((p) => p.wallet)).toEqual([A, B]);
    expect(c.dataWarnings[0]).toBe("0xaaaa…0001: fill limit hit");
  });

  it("merges exchange-rate tables from every wallet", () => {
    const c = combineDatasets([
      ds(A, [], { fx: { source: "ECB", rates: { EUR: { "2026-03-10": 0.9 } }, missing: [] } }),
      ds(B, [], { fx: { source: "ECB", rates: { EUR: { "2026-03-11": 0.91 }, JPY: { "2026-03-11": 150 } }, missing: ["X"] } }),
    ]);
    expect(c.fx.rates.EUR).toEqual({ "2026-03-10": 0.9, "2026-03-11": 0.91 });
    expect(c.fx.rates.JPY["2026-03-11"]).toBe(150);
    expect(c.fx.missing).toEqual(["X"]);
  });

  it("moving funds between your own wallets is not income", () => {
    const out = ev(A, "w1", 0, { type: "WITHDRAWAL", category: "account", amountUsd: 5000 });
    const inn = ev(B, "d1", 0, { type: "DEPOSIT", category: "account", amountUsd: 5000 });
    const c = combineDatasets([ds(A, [out, ev(A, "a1", 100)]), ds(B, [inn])]);
    const r = calculateTax(c, "US", jurisdiction("US").taxYearOf(T), { traderType: "individual", otherIncomeLocal: 0 });
    expect(r.netTradingLocal).toBeCloseTo(100, 6);
  });

  it("warns that NFT cost basis is matched per wallet", () => {
    const nft = ev(A, "os-1", 0, { category: "nft", type: "NFT_SELL", protocol: "opensea" });
    const c = combineDatasets([ds(A, [nft]), ds(B, [])]);
    expect(c.dataWarnings.join(" ")).toMatch(/NFT cost basis is matched within each wallet/);
  });

  it("mixes EVM and Solana wallets", () => {
    const c = combineDatasets([ds(A, [ev(A, "a", 1)]), ds(SOL, [ev(SOL, "s", 2, { protocol: "bulk", chain: "solana" })])]);
    expect(c.events.map((e) => e.account)).toEqual(expect.arrayContaining([A, SOL]));
  });
});

describe("typing several wallets", () => {
  it("splits on commas, spaces, semicolons and new lines, and drops repeats", () => {
    expect(splitWallets(` ${A}, ${B}\n${SOL};${A.toUpperCase().replace("0X", "0x")} `)).toEqual([A, B, SOL]);
  });
  it("one wallet stays one wallet", () => {
    expect(splitWallets(A)).toEqual([A]);
  });
});
