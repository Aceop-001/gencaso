import { PositionBook, round, type FillResult } from "../engine/positions";
import type { EventType, FinancialEvent } from "../engine/schema";
import type { DataProvider, ProviderResult } from "./types";

/**
 * MockDataProvider — deterministic SYNTHETIC data for UI development and demos.
 * Every event is labelled verification: "mock". Nothing here is real trading
 * activity, and market names are prefixed with [DEMO].
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const START = Date.UTC(2025, 1, 3); // 3 Feb 2025
const END = Date.UTC(2026, 9, 20); // 20 Oct 2026

const PERP_TYPE: Record<FillResult["transition"], EventType> = {
  OPEN: "PERP_OPEN",
  INCREASE: "PERP_INCREASE",
  REDUCE: "PERP_REDUCE",
  CLOSE: "PERP_CLOSE",
  FLIP: "PERP_FLIP",
};

export function buildMockEvents(account = "demo"): { events: FinancialEvent[]; open: ReturnType<PositionBook["open"]> } {
  const r = rng(20251102);
  const book = new PositionBook();
  const events: FinancialEvent[] = [];
  let n = 0;
  const base = (ts: number) => ({
    id: `mock-${++n}`,
    protocol: "mock" as const,
    chain: "demo",
    account,
    timestamp: ts,
    fiat: { currency: "USD" as const, source: "Synthetic demo data" },
    source: "MockDataProvider",
    verification: "mock" as const,
    confidence: 1,
  });

  events.push({ ...base(START - DAY), category: "account", type: "DEPOSIT", asset: "USDC", quantity: 25_000, amountUsd: 25_000, realizedPnlUsd: 0, feeUsd: 0, fundingUsd: 0 });

  // Perpetuals: random-walk prices, swing trades with partial closes.
  const coins: Array<{ coin: string; px: number; vol: number; size: number }> = [
    { coin: "BTC", px: 96_000, vol: 0.025, size: 0.12 },
    { coin: "ETH", px: 2_700, vol: 0.035, size: 2.5 },
    { coin: "SOL", px: 200, vol: 0.045, size: 40 },
  ];
  for (let t = START; t < END; t += DAY) {
    for (const c of coins) {
      c.px *= 1 + (r() - 0.49) * c.vol;
      const key = `perp:${c.coin}`;
      const pos = book.get(key);
      const roll = r();
      let side: 1 | -1 | 0 = 0;
      let qty = 0;
      if (!pos && roll < 0.08) {
        side = r() < 0.55 ? 1 : -1;
        qty = c.size * (0.5 + r());
      } else if (pos && roll < 0.05) {
        side = pos.size > 0 ? 1 : -1; // scale in
        qty = Math.abs(pos.size) * 0.5;
      } else if (pos && roll < 0.14) {
        side = pos.size > 0 ? -1 : 1; // scale out or close
        qty = r() < 0.5 ? Math.abs(pos.size) : Math.abs(pos.size) * 0.5;
      }
      if (side !== 0) {
        const ts = t + Math.floor(r() * DAY * 0.9);
        const price = round(c.px, 2);
        const quantity = round(qty, 4);
        const res = book.apply({ key, timestamp: ts, side, quantity, price });
        const fee = round(quantity * price * 0.00045, 4);
        events.push({
          ...base(ts),
          category: "perp",
          type: PERP_TYPE[res.transition],
          asset: c.coin,
          quantity,
          price,
          entryValueUsd: res.closedQuantity ? res.entryValue : undefined,
          exitValueUsd: res.closedQuantity ? res.exitValue : undefined,
          realizedPnlUsd: res.realizedPnl,
          feeUsd: fee,
          fundingUsd: 0,
          openedAt: res.closedQuantity ? res.openedAt : undefined,
        });
      }
      // Daily funding settlement on open positions
      const open = book.get(key);
      if (open) {
        const rate = (r() - 0.35) * 0.0004;
        const funding = round(-Math.sign(open.size) * Math.abs(open.size) * c.px * rate, 4);
        if (funding !== 0) {
          events.push({ ...base(t + DAY - 1000), category: "perp", type: "FUNDING", asset: c.coin, quantity: Math.abs(open.size), realizedPnlUsd: 0, feeUsd: 0, fundingUsd: funding });
        }
      }
    }
  }

  // One liquidation of a leveraged SOL long
  {
    const ts = Date.UTC(2025, 10, 14, 9);
    const key = "perp:SOL-LIQ";
    book.apply({ key, timestamp: ts - 5 * DAY, side: 1, quantity: 60, price: 168.4 });
    events.push({ ...base(ts - 5 * DAY), category: "perp", type: "PERP_OPEN", asset: "SOL", quantity: 60, price: 168.4, realizedPnlUsd: 0, feeUsd: 4.55, fundingUsd: 0 });
    const res = book.apply({ key, timestamp: ts, side: -1, quantity: 60, price: 142.1 });
    events.push({ ...base(ts), category: "perp", type: "LIQUIDATION", asset: "SOL", quantity: 60, price: 142.1, entryValueUsd: res.entryValue, exitValueUsd: res.exitValue, realizedPnlUsd: res.realizedPnl, feeUsd: 8.53, fundingUsd: 0, openedAt: res.openedAt });
  }

  // Prediction markets (fictional markets, clearly marked)
  const markets = [
    { id: "demo-m1", name: "[DEMO] Will the Fed cut rates in March 2025?", outcome: "Yes", buy: 0.31, exit: 1, start: Date.UTC(2025, 1, 10) },
    { id: "demo-m2", name: "[DEMO] BTC above $120k on 30 Jun 2025?", outcome: "Yes", buy: 0.42, exit: 0, start: Date.UTC(2025, 3, 2) },
    { id: "demo-m3", name: "[DEMO] Team A wins the 2025 final?", outcome: "No", buy: 0.55, exit: 0.78, start: Date.UTC(2025, 6, 7) },
    { id: "demo-m4", name: "[DEMO] ETH ETF staking approved by Oct 2025?", outcome: "Yes", buy: 0.24, exit: 1, start: Date.UTC(2025, 7, 19) },
    { id: "demo-m5", name: "[DEMO] Election turnout above 65%?", outcome: "No", buy: 0.6, exit: 0, start: Date.UTC(2026, 0, 12) },
    { id: "demo-m6", name: "[DEMO] SOL flips ETH volume in Q2 2026?", outcome: "Yes", buy: 0.18, exit: 0.07, start: Date.UTC(2026, 2, 3) },
    { id: "demo-m7", name: "[DEMO] Major CEX lists HYPE spot by Aug 2026?", outcome: "Yes", buy: 0.47, exit: 1, start: Date.UTC(2026, 4, 21) },
    { id: "demo-m8", name: "[DEMO] Gold above $4,000 at end of 2026?", outcome: "Yes", buy: 0.52, exit: NaN, start: Date.UTC(2026, 8, 30) },
  ];
  for (const m of markets) {
    const key = `pm:${m.id}:${m.outcome}`;
    const market = { id: m.id, name: m.name, outcome: m.outcome };
    const shares1 = round(800 + r() * 2400, 2);
    const shares2 = round(shares1 * 0.5, 2);
    const p2 = round(m.buy * (0.9 + r() * 0.2), 3);
    for (const [i, [sh, px]] of [[shares1, m.buy], [shares2, p2]].entries()) {
      const ts = m.start + i * 3 * DAY;
      const res = book.apply({ key, timestamp: ts, side: 1, quantity: sh, price: px });
      events.push({ ...base(ts), category: "prediction", type: "PM_BUY", asset: `${m.outcome} share`, market, quantity: sh, price: px, realizedPnlUsd: res.realizedPnl, feeUsd: 0, fundingUsd: 0 });
    }
    if (Number.isNaN(m.exit)) continue; // still open
    const ts = m.start + 40 * DAY;
    const res = book.settle(key, m.exit, ts)!;
    const type: EventType = m.exit === 1 ? "PM_REDEEM" : m.exit === 0 ? "PM_SETTLE_LOSS" : "PM_SELL";
    events.push({
      ...base(ts),
      category: "prediction",
      type,
      asset: `${m.outcome} share`,
      market,
      quantity: res.closedQuantity,
      price: m.exit,
      entryValueUsd: res.entryValue,
      exitValueUsd: res.exitValue,
      realizedPnlUsd: res.realizedPnl,
      feeUsd: type === "PM_SELL" ? round(res.exitValue * 0.001, 4) : 0,
      fundingUsd: 0,
      openedAt: res.openedAt,
    });
  }

  events.push({ ...base(Date.UTC(2025, 8, 1)), category: "account", type: "REWARD", asset: "USDC", quantity: 312.5, amountUsd: 312.5, realizedPnlUsd: 0, feeUsd: 0, fundingUsd: 0, notes: "Referral reward" });
  events.push({ ...base(Date.UTC(2026, 3, 15)), category: "account", type: "REWARD", asset: "USDC", quantity: 540, amountUsd: 540, realizedPnlUsd: 0, feeUsd: 0, fundingUsd: 0, notes: "Trading incentive" });
  events.push({ ...base(Date.UTC(2025, 11, 20)), category: "account", type: "WITHDRAWAL", asset: "USDC", quantity: 8_000, amountUsd: 8_000, realizedPnlUsd: 0, feeUsd: 0, fundingUsd: 0 });

  events.sort((a, b) => a.timestamp - b.timestamp);
  return { events, open: book.open() };
}

export const MockDataProvider: DataProvider = {
  id: "mock",
  protocol: "mock",
  supports: (kind) => kind === "demo",
  async fetch(address): Promise<ProviderResult> {
    const { events, open } = buildMockEvents(address);
    return {
      events,
      openPositions: open.map((p) => ({
        protocol: "mock",
        asset: p.key.split(":").slice(1).join(":"),
        quantity: p.size,
        avgEntryPrice: p.avgPrice,
      })),
      warnings: ["Demo wallet: all figures are synthetic mock data, not real trading activity."],
      report: {
        provider: "MockDataProvider",
        protocol: "mock",
        status: "ok",
        eventCount: events.length,
        requests: 0,
        fromCache: false,
        message: "Synthetic data for demonstration",
        limitations: ["Not real data."],
      },
    };
  },
};
