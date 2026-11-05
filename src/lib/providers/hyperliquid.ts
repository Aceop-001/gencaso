import type { EventType, FinancialEvent, OpenPosition } from "../engine/schema";
import { USDC_FIAT, type DataProvider, type ProviderContext, type ProviderResult } from "./types";

/**
 * HyperliquidDataProvider — read-only, public Info API.
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
 * Verified against the live API on 2026-11-02 (field names and shapes below).
 */

const INFO = "https://api.hyperliquid.xyz/info";
const FILL_PAGE = 2000; // max fills per userFillsByTime response
const MAX_FILL_PAGES = 5; // API only exposes the 10,000 most recent fills
const MAX_TIME_PAGES = 20;

export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  tid: number;
  fee: string;
  feeToken: string;
  liquidation?: unknown;
}

export interface HlLedger {
  time: number;
  hash: string;
  delta: { type: string; usdc?: string; amount?: string; fee?: string; token?: string; coin?: string; szi?: string; fundingRate?: string };
}

const num = (s: string | undefined) => (s === undefined ? 0 : Number(s));
/** Internal fills (e.g. liquidation engine) carry an all-zero hash: no transaction to link to. */
const realHash = (h: string | undefined) => (h && !/^0x0+$/.test(h) ? h : undefined);
const isSpot = (coin: string) => coin.startsWith("@") || coin.includes("/");

export function classifyFill(f: HlFill): EventType {
  if (f.liquidation) return "LIQUIDATION";
  const start = num(f.startPosition);
  const sz = num(f.sz);
  if (f.dir.includes(">")) return "PERP_FLIP"; // "Long > Short" / "Short > Long"
  if (f.dir.startsWith("Open")) return Math.abs(start) < 1e-12 ? "PERP_OPEN" : "PERP_INCREASE";
  if (f.dir.startsWith("Close")) return Math.abs(Math.abs(start) - sz) < 1e-9 ? "PERP_CLOSE" : "PERP_REDUCE";
  if (f.dir.toLowerCase().includes("liquidat")) return "LIQUIDATION";
  return "PERP_REDUCE";
}

export function normalizeFill(f: HlFill, account: string): FinancialEvent {
  const type = classifyFill(f);
  const known = /^(Open|Close)|>/.test(f.dir) || !!f.liquidation;
  const feeIsUsdc = f.feeToken === "USDC";
  return {
    id: `hl-fill-${f.tid}`,
    protocol: "hyperliquid",
    chain: "Hyperliquid L1",
    account,
    timestamp: f.time,
    category: "perp",
    type,
    asset: f.coin,
    quantity: num(f.sz),
    price: num(f.px),
    realizedPnlUsd: num(f.closedPnl),
    feeUsd: feeIsUsdc ? num(f.fee) : 0,
    fundingUsd: 0,
    fiat: USDC_FIAT,
    source: "Hyperliquid Info API · userFillsByTime",
    txHash: realHash(f.hash),
    verification: feeIsUsdc ? "verified" : "estimated",
    confidence: known ? 0.98 : 0.7,
    notes: feeIsUsdc ? undefined : `Fee paid in ${f.feeToken} (${f.fee}) not converted — excluded`,
  };
}

export function normalizeFunding(l: HlLedger, account: string): FinancialEvent {
  return {
    // One funding settlement per coin per timestamp, so this id is stable across syncs.
    id: `hl-funding-${l.time}-${l.delta.coin}`,
    protocol: "hyperliquid",
    chain: "Hyperliquid L1",
    account,
    timestamp: l.time,
    category: "perp",
    type: "FUNDING",
    asset: l.delta.coin ?? "?",
    quantity: Math.abs(num(l.delta.szi)),
    realizedPnlUsd: 0,
    feeUsd: 0,
    fundingUsd: num(l.delta.usdc),
    fiat: USDC_FIAT,
    source: "Hyperliquid Info API · userFunding",
    verification: "verified",
    confidence: 1,
  };
}

export function normalizeLedger(l: HlLedger, account: string): FinancialEvent | null {
  const t = l.delta.type;
  const amount = Math.abs(num(l.delta.usdc ?? l.delta.amount));
  let type: EventType;
  if (t === "deposit") type = "DEPOSIT";
  else if (t === "withdraw") type = "WITHDRAWAL";
  else if (t === "rewardsClaim") type = "REWARD";
  else type = "TRANSFER";
  return {
    id: `hl-ledger-${l.hash}-${t}-${l.time}`,
    protocol: "hyperliquid",
    chain: "Hyperliquid L1",
    account,
    timestamp: l.time,
    category: "account",
    type,
    asset: l.delta.token ?? "USDC",
    quantity: amount,
    amountUsd: amount,
    realizedPnlUsd: 0,
    feeUsd: t === "withdraw" ? num(l.delta.fee) : 0,
    fundingUsd: 0,
    fiat: USDC_FIAT,
    source: "Hyperliquid Info API · userNonFundingLedgerUpdates",
    txHash: realHash(l.hash),
    verification: type === "TRANSFER" ? "estimated" : "verified",
    confidence: type === "TRANSFER" ? 0.8 : 1,
    notes: type === "TRANSFER" ? `Ledger type "${t}" — internal movement, not trading P&L` : undefined,
  };
}

async function pageByTime<T extends { time: number }>(
  ctx: ProviderContext,
  body: (start: number) => object,
  pageSize: number,
  maxPages: number,
): Promise<{ rows: T[]; requests: number; truncated: boolean }> {
  let start = ctx.since ?? 0;
  const rows: T[] = [];
  let requests = 0;
  for (let page = 0; page < maxPages; page++) {
    const batch = await ctx.http.postJson<T[]>("hyperliquid", INFO, body(start));
    requests++;
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, requests, truncated: false };
    // Resume from the last timestamp; duplicates at the boundary are removed by id later.
    start = batch[batch.length - 1].time;
  }
  return { rows, requests, truncated: true };
}

export const HyperliquidDataProvider: DataProvider = {
  id: "hyperliquid",
  protocol: "hyperliquid",
  supports: (kind) => kind === "evm",
  async fetch(address, ctx): Promise<ProviderResult> {
    const warnings: string[] = [];
    const limitations = ["Only the 10,000 most recent fills are retrievable from Hyperliquid."];

    const fills = await pageByTime<HlFill>(
      ctx,
      (startTime) => ({ type: "userFillsByTime", user: address, startTime, endTime: ctx.now, aggregateByTime: false }),
      FILL_PAGE,
      MAX_FILL_PAGES,
    );
    const funding = await pageByTime<HlLedger>(ctx, (startTime) => ({ type: "userFunding", user: address, startTime, endTime: ctx.now }), 500, MAX_TIME_PAGES);
    const ledger = await pageByTime<HlLedger>(ctx, (startTime) => ({ type: "userNonFundingLedgerUpdates", user: address, startTime, endTime: ctx.now }), 2000, MAX_TIME_PAGES);
    const state = await ctx.http.postJson<{ assetPositions?: Array<{ position: { coin: string; szi: string; entryPx: string; unrealizedPnl: string } }> }>(
      "hyperliquid",
      INFO,
      { type: "clearinghouseState", user: address },
    );
    const requests = fills.requests + funding.requests + ledger.requests + 1;

    const perpFills = fills.rows.filter((f) => !isSpot(f.coin));
    const spotSkipped = fills.rows.length - perpFills.length;
    if (spotSkipped) warnings.push(`${spotSkipped} Hyperliquid spot fills excluded (spot trading is outside GENCASO's scope).`);
    if (fills.rows.length >= FILL_PAGE * MAX_FILL_PAGES || fills.truncated) {
      const earliest = fills.rows.length ? new Date(Math.min(...fills.rows.map((f) => f.time))).toISOString().slice(0, 10) : "?";
      warnings.push(`Hyperliquid fill history hit the API's 10,000-fill limit — trades before ${earliest} are missing, so results for earlier tax years are incomplete (funding and transfers are still complete).`);
    }
    if (funding.truncated || ledger.truncated) warnings.push("Hyperliquid funding/ledger pagination was capped; some older entries may be missing.");

    const events: FinancialEvent[] = [
      ...perpFills.map((f) => normalizeFill(f, address)),
      ...funding.rows.filter((l) => l.delta.type === "funding").map((l) => normalizeFunding(l, address)),
      ...ledger.rows.map((l) => normalizeLedger(l, address)).filter((e): e is FinancialEvent => e !== null),
    ];

    const openPositions: OpenPosition[] = (state.assetPositions ?? []).map(({ position: p }) => ({
      protocol: "hyperliquid",
      asset: p.coin,
      quantity: num(p.szi),
      avgEntryPrice: num(p.entryPx),
      unrealizedPnlUsd: num(p.unrealizedPnl),
    }));

    return {
      events,
      openPositions,
      warnings,
      report: {
        provider: "HyperliquidDataProvider",
        protocol: "hyperliquid",
        status: events.length || openPositions.length ? "ok" : "empty",
        eventCount: events.length,
        requests,
        fromCache: false,
        limitations,
      },
    };
  },
};
