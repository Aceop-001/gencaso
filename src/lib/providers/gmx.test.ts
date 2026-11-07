import { describe, expect, it } from "vitest";
import { summarize } from "../engine/summary";
import { fromE30, normalizeGmx, type GmxPositionChange, type GmxTradeAction } from "./gmx";

/** Live check (2026-11-07): on four Arbitrum accounts these rules reproduced GMX's own accountStats
 *  (realizedPnl, realizedFees − realizedPriceImpact + swap costs, positiveFundingFeesUsd) to the cent. */
const ME = "0xab3067c58811ade7aa17b58808db3b4c2e86f603";
const MKT = "0x70d95587d40a2caf56bd97485ab3eec10bee6336";
const e30 = (usd: number) => (BigInt(Math.round(usd * 1e6)) * BigInt(10) ** BigInt(24)).toString();
// USDC collateral: 6 decimals, price 1 USD = 1e24 in GMX units (30 − 6)
const usdcFee = (usd: number) => ({ feesAmount: String(Math.round(usd * 1e6)), collateralTokenPriceMin: (BigInt(10) ** BigInt(24)).toString() });

const change = (o: Partial<GmxPositionChange>): GmxPositionChange => ({
  id: "c1", type: "increase", orderKey: "k1", positionKey: "p1", market: MKT, isLong: true,
  sizeInUsd: e30(10000), sizeDeltaUsd: e30(10000), sizeDeltaInTokens: "0", executionPrice: "0",
  basePnlUsd: "0", priceImpactUsd: "0", swapFeeUsd: "0", swapImpactUsd: "0", ...usdcFee(0), timestamp: 1_760_000_000, ...o,
});
const action = (o: Partial<GmxTradeAction>): GmxTradeAction => ({ orderKey: "k1", orderType: 2, fundingFeeReceivedUsd: "0", transactionHash: "0xtx", timestamp: 1_760_000_000, marketAddress: MKT, ...o });
const names = { [MKT]: "ETH/USD [ETH-USDC]" };

describe("GMX v2 → Gencaso events", () => {
  it("reads 30-decimal USD values exactly, including large and negative ones", () => {
    expect(fromE30(e30(1948004.93))).toBeCloseTo(1948004.93, 6);
    expect(fromE30((-BigInt(e30(56682.38))).toString())).toBeCloseTo(-56682.38, 6);
    expect(fromE30(null)).toBe(0);
  });

  it("open → partial close → full close: P&L on decreases, holding period from the first increase", () => {
    const ev = normalizeGmx("arbitrum", ME, [
      change({ id: "a", type: "increase", orderKey: "o1", timestamp: 1_700_000_000, ...usdcFee(10) }),
      change({ id: "b", type: "decrease", orderKey: "o2", timestamp: 1_700_100_000, sizeInUsd: e30(4000), sizeDeltaUsd: e30(6000), basePnlUsd: e30(900), ...usdcFee(6) }),
      change({ id: "c", type: "decrease", orderKey: "o3", timestamp: 1_700_200_000, sizeInUsd: "0", sizeDeltaUsd: e30(4000), basePnlUsd: (-BigInt(e30(150))).toString(), ...usdcFee(4) }),
    ], [action({ orderKey: "o1" }), action({ orderKey: "o2", orderType: 4 }), action({ orderKey: "o3", orderType: 4 })], names);
    expect(ev.map((e) => e.type)).toEqual(["PERP_INCREASE", "PERP_REDUCE", "PERP_CLOSE"]);
    expect(ev[1].realizedPnlUsd).toBeCloseTo(900, 6);
    expect(ev[2].realizedPnlUsd).toBeCloseTo(-150, 6);
    expect(ev[2].openedAt).toBe(1_700_000_000_000);
    expect(ev.map((e) => e.feeUsd)).toEqual([10, 6, 4]);
    expect(ev[1].asset).toBe("ETH");
    expect(ev[1].market?.name).toBe("ETH/USD [ETH-USDC] · long");
    expect(ev[1].txHash).toBe("0xtx");
  });

  it("negative price impact and collateral-swap costs are added to the fee; positive impact reduces it", () => {
    const [cost, gain] = normalizeGmx("arbitrum", ME, [
      change({ id: "x", priceImpactUsd: (-BigInt(e30(25))).toString(), swapFeeUsd: e30(2), swapImpactUsd: (-BigInt(e30(1))).toString(), ...usdcFee(5) }),
      change({ id: "y", orderKey: "k2", positionKey: "p2", priceImpactUsd: e30(3), ...usdcFee(5) }),
    ], [], names);
    expect(cost.feeUsd).toBeCloseTo(5 + 25 + 2 + 1, 6);
    expect(gain.feeUsd).toBeCloseTo(5 - 3, 6);
  });

  it("liquidations are labelled from the executed order type", () => {
    const [, liq] = normalizeGmx("arbitrum", ME, [
      change({ id: "a", orderKey: "o1" }),
      change({ id: "b", type: "decrease", orderKey: "liq", sizeInUsd: "0", basePnlUsd: (-BigInt(e30(800))).toString(), timestamp: 1_760_000_100 }),
    ], [action({ orderKey: "liq", orderType: 7 })], names);
    expect(liq.type).toBe("LIQUIDATION");
    expect(liq.realizedPnlUsd).toBeCloseTo(-800, 6);
  });

  it("funding received becomes a funding event; zero funding is ignored", () => {
    const ev = normalizeGmx("arbitrum", ME, [], [action({ orderKey: "f1", fundingFeeReceivedUsd: e30(12.5) }), action({ orderKey: "f2" })], names);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "FUNDING", fundingUsd: 12.5, id: "gmx-arbitrum-funding-f1" });
  });

  it("totals add up the way GMX's account stats do", () => {
    const ev = normalizeGmx("arbitrum", ME, [
      change({ id: "a", orderKey: "o1", ...usdcFee(10), priceImpactUsd: (-BigInt(e30(5))).toString() }),
      change({ id: "b", type: "decrease", orderKey: "o2", sizeInUsd: "0", basePnlUsd: e30(500), ...usdcFee(8), timestamp: 1_760_000_100 }),
    ], [action({ orderKey: "o2", fundingFeeReceivedUsd: e30(3) })], names);
    const s = summarize(ev);
    expect(s.netRealized).toBeCloseTo(500, 6);
    expect(s.fees).toBeCloseTo(23, 6);
    expect(s.netFunding).toBeCloseTo(3, 6);
    expect(s.netTradingResult).toBeCloseTo(480, 6);
  });
});
