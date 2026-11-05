import { PositionBook, round } from "../engine/positions";
import type { EventType, FinancialEvent, OpenPosition } from "../engine/schema";
import { USDC_FIAT, type DataProvider, type ProviderResult } from "./types";

/**
 * BulkDataProvider — Bulk Trade (Solana perps), read-only public account history.
 * Docs: https://docs.bulk.trade/api-reference/getAccount — `POST https://mainnet-api1.bulk.trade/api/v1/account`
 * with `{ type, user, limit, cursor }`, unsigned, keyed by the account's base58 public key.
 * (`exchange-api.bulk.trade` is TESTNET — the public SDK README shows it without saying so.)
 *
 * Realized P&L is rebuilt from fills with GENCASO's weighted-average PositionBook: Bulk's closed-
 * positions index lags far behind its fills, so it would miss recent closes and liquidations.
 * Conventions confirmed on live accounts: fill rows are from the queried account's perspective
 * (`isBuy` = its own side); fees are signed as P&L (negative = paid); funding `payment` negative = paid.
 *
 * STATUS: verified 2026-11-03 on two live mainnet accounts — rebuilt realized P&L, fees, funding and the
 * open position matched Bulk's own account totals (to $0.006 on $544k), and for one account
 * deposits + realized + fees + funding equalled its margin balance exactly.
 */

const API = "https://mainnet-api1.bulk.trade/api/v1";
const PAGE = 5000; // API maximum
const MAX_PAGES = 20;

export interface BulkFill {
  maker: string;
  taker: string;
  isBuy: boolean;
  symbol: string;
  amount: number;
  price: number;
  makerFee: number;
  takerFee: number;
  fee?: number;
  reason?: string | null;
  iso?: boolean;
  slot: number;
  sequence: number;
  timestamp: number;
}
export interface BulkFunding {
  symbol: string;
  size: number;
  payment: number;
  fundingRate: number;
  slot: number;
  sequence: number;
  timestamp: number;
}
export interface BulkActivity {
  activityType: string;
  status: string;
  from: string;
  to: string;
  symbol: string;
  amount: number;
  withdrawalId?: string;
  slot: number;
  sequence: number;
  timestamp: number;
}
interface BulkPage<T> {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean; coverage: "complete" | "partial" | "unknown" };
}
interface BulkMargin {
  realizedPnl: number;
  fees: number;
  funding: number;
  /** Cash balance excluding unrealized P&L */
  totalMargin?: number;
}

/** Bulk timestamps are u64 nanoseconds; accept seconds, ms, µs or ns and return ms. */
export function toMs(t: number): number {
  if (t > 1e17) return Math.floor(t / 1e6);
  if (t > 1e14) return Math.floor(t / 1e3);
  if (t > 1e11) return t;
  return t * 1000;
}

const BULK_FIAT = { ...USDC_FIAT, source: "USD-margined (USDC), assumed 1 USDC = 1 USD" };
const asset = (symbol: string) => symbol.replace(/-USD[CT]?$/i, "");
const TYPE: Record<string, EventType> = { OPEN: "PERP_OPEN", INCREASE: "PERP_INCREASE", REDUCE: "PERP_REDUCE", CLOSE: "PERP_CLOSE", FLIP: "PERP_FLIP" };

/** Rebuild trades from fills (account perspective) plus funding and cash movements. */
export function normalizeBulk(account: string, fills: BulkFill[], funding: BulkFunding[], activity: BulkActivity[]) {
  const book = new PositionBook();
  const events: FinancialEvent[] = [];
  const base = { protocol: "bulk" as const, chain: "Bulk (Solana)", account, fiat: BULK_FIAT };
  const ordered = [...fills].sort((a, b) => a.slot - b.slot || a.sequence - b.sequence);
  for (const f of ordered) {
    const side = f.isBuy ? 1 : -1;
    const ownFee = f.maker === account ? f.makerFee : f.takerFee;
    const ts = toMs(f.timestamp);
    const res = book.apply({ key: f.symbol, timestamp: ts, side, quantity: f.amount, price: f.price });
    const reason = f.reason ?? undefined;
    const type: EventType = reason === "liquidation" ? "LIQUIDATION" : TYPE[res.transition];
    events.push({
      ...base,
      id: `bulk-fill-${f.slot}-${f.sequence}-${f.symbol}`,
      timestamp: ts,
      category: "perp",
      type,
      asset: asset(f.symbol),
      quantity: f.amount,
      price: f.price,
      entryValueUsd: res.closedQuantity ? round(res.entryValue, 6) : undefined,
      exitValueUsd: res.closedQuantity ? round(res.exitValue, 6) : undefined,
      realizedPnlUsd: round(res.realizedPnl, 6),
      feeUsd: round(-ownFee, 8), // Bulk signs fees as P&L: negative = paid, positive = maker rebate
      fundingUsd: 0,
      openedAt: res.openedAt,
      source: "Bulk exchange API · fills",
      verification: "verified",
      confidence: 0.97,
      notes: [f.maker === account ? "maker" : "taker", reason && reason !== "liquidation" ? reason : "", f.iso ? "isolated margin" : ""].filter(Boolean).join(" · ") || undefined,
    });
  }
  for (const p of funding)
    events.push({
      ...base,
      id: `bulk-funding-${p.slot}-${p.sequence}-${p.symbol}`,
      timestamp: toMs(p.timestamp),
      category: "perp",
      type: "FUNDING",
      asset: asset(p.symbol),
      quantity: Math.abs(p.size),
      realizedPnlUsd: 0,
      feeUsd: 0,
      fundingUsd: p.payment, // negative = paid
      source: "Bulk exchange API · fundingHistory",
      verification: "verified",
      confidence: 1,
    });
  for (const a of activity) {
    if (a.status !== "completed") continue; // failed withdrawals moved nothing
    const type: EventType = a.activityType === "deposit" ? "DEPOSIT" : a.activityType === "withdrawal" ? "WITHDRAWAL" : "TRANSFER";
    events.push({
      ...base,
      id: `bulk-activity-${a.slot}-${a.sequence}-${a.activityType}`,
      timestamp: toMs(a.timestamp),
      category: "account",
      type,
      asset: a.symbol,
      quantity: a.amount,
      amountUsd: a.amount,
      realizedPnlUsd: 0,
      feeUsd: 0,
      fundingUsd: 0,
      source: "Bulk exchange API · activityHistory",
      verification: "verified",
      confidence: 1,
      notes: type === "TRANSFER" ? `Bulk "${a.activityType}" — internal movement, not trading P&L` : undefined,
    });
  }
  const openPositions: OpenPosition[] = book
    .open()
    .filter((p) => Math.abs(p.size) > 1e-6) // float dust left after a full close is not a position
    .map((p) => ({ protocol: "bulk", asset: asset(p.key), quantity: p.size, avgEntryPrice: p.avgPrice }));
  return { events: events.sort((a, b) => a.timestamp - b.timestamp), openPositions };
}

export const BulkDataProvider: DataProvider = {
  id: "bulk",
  protocol: "bulk",
  supports: (kind) => kind === "solana",
  async fetch(address, ctx): Promise<ProviderResult> {
    let requests = 0;
    const warnings: string[] = [];
    const post = async <T,>(body: Record<string, unknown>): Promise<T | null> => {
      requests++;
      try {
        return await ctx.http.postJson<T>("bulk", `${API}/account`, body);
      } catch (e) {
        // 404 ACCOUNT_NOT_FOUND: the address has never had a Bulk account — no activity, not a failure
        if (/HTTP 404/.test((e as Error).message)) return null;
        throw e;
      }
    };
    const history = async <T,>(type: string): Promise<T[] | null> => {
      const rows: T[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < MAX_PAGES; i++) {
        const res: BulkPage<T> | null = await post<BulkPage<T>>(cursor ? { type, user: address, limit: PAGE, cursor } : { type, user: address, limit: PAGE });
        if (!res) return i === 0 ? null : rows;
        rows.push(...res.data);
        if (i === 0 && res.page.coverage === "partial") warnings.push(`Bulk reports its ${type} history for this account as partial — older records may be missing.`);
        cursor = res.page.nextCursor;
        if (!cursor) return rows;
      }
      warnings.push(`Bulk ${type} history stopped at ${(MAX_PAGES * PAGE).toLocaleString()} rows — older records may be missing.`);
      return rows;
    };

    const fills = await history<BulkFill>("fills");
    const empty = (message: string): ProviderResult => ({
      events: [],
      openPositions: [],
      warnings,
      report: { provider: "BulkDataProvider", protocol: "bulk", status: "empty", eventCount: 0, requests, fromCache: false, message, limitations: [] },
    });
    if (!fills) return empty("No Bulk account for this Solana address (use the address shown on your Bulk account page).");
    const [funding, activity, full] = await Promise.all([
      history<BulkFunding>("fundingHistory"),
      history<BulkActivity>("activityHistory"),
      post<Array<{ fullAccount?: { margin?: BulkMargin; subAccounts?: { pubkey: string }[] } }> | { fullAccount?: { margin?: BulkMargin; subAccounts?: { pubkey: string }[] } }>({ type: "fullAccount", user: address }),
    ]);
    const { events, openPositions } = normalizeBulk(address, fills, funding ?? [], activity ?? []);

    // Self-check against Bulk's own running totals for the account
    const acct = Array.isArray(full) ? full[0]?.fullAccount : full?.fullAccount;
    if (acct?.margin) {
      const sum = (f: (e: FinancialEvent) => number) => events.reduce((s, e) => s + f(e), 0);
      const checks: Array<[string, number, number]> = [
        ["realized P&L", sum((e) => e.realizedPnlUsd), acct.margin.realizedPnl],
        ["fees", -sum((e) => e.feeUsd), acct.margin.fees],
        ["funding", sum((e) => e.fundingUsd), acct.margin.funding],
      ];
      for (const [label, ours, theirs] of checks)
        if (Math.abs(ours - theirs) > Math.max(1, Math.abs(theirs) * 1e-6))
          warnings.push(`Bulk ${label}: rebuilt ${ours.toFixed(2)} vs Bulk's account total ${theirs.toFixed(2)} — check before filing.`);
      // Cash check: deposits − withdrawals + realized + fees + funding should equal the balance Bulk reports
      if (acct.margin.totalMargin !== undefined) {
        const cash = sum((e) => (e.type === "DEPOSIT" ? e.amountUsd ?? 0 : e.type === "WITHDRAWAL" ? -(e.amountUsd ?? 0) : 0));
        const expected = cash + acct.margin.realizedPnl + acct.margin.fees + acct.margin.funding;
        const gap = acct.margin.totalMargin - expected;
        if (Math.abs(gap) > 1)
          warnings.push(
            `Bulk's reported balance (${acct.margin.totalMargin.toFixed(2)}) differs from its own deposit, withdrawal and P&L history by ${gap.toFixed(2)} USDC. Some balance changes are not in Bulk's public history; trades are unaffected, but ask Bulk to explain the difference.`,
          );
      }
    }
    if (acct?.subAccounts?.length) warnings.push(`This Bulk account has ${acct.subAccounts.length} sub-account(s); analyse each sub-account address separately.`);
    if (fills.some((f) => f.reason === "adl")) warnings.push("Bulk auto-deleveraging (ADL) closed part of a position; it is included as a normal close at Bulk's ADL price.");

    return {
      events,
      openPositions,
      warnings,
      report: {
        provider: "BulkDataProvider",
        protocol: "bulk",
        status: events.length ? "ok" : "empty",
        eventCount: events.length,
        requests,
        fromCache: false,
        message: events.length ? undefined : "No Bulk activity for this account.",
        limitations: [
          "Realized P&L rebuilt from fills (weighted average), checked against Bulk's account totals",
          "Bulk matches trades inside its validator: there is no per-trade explorer link",
          "Sub-accounts are separate addresses",
        ],
      },
    };
  },
};
