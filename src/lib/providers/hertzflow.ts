import { round } from "../engine/positions";
import type { EventType, FinancialEvent } from "../engine/schema";
import type { DataProvider, ProviderResult } from "./types";

/**
 * HertzFlowDataProvider — HertzFlow perps on BNB Chain (GMX v2-style contracts), read-only.
 * Source: the public "data-statistics-query" service the HertzFlow web app itself uses:
 * `GET https://data-statistics-query.mainnet.htzfl.link/api/v1/bsc/user/trades?user_address=&limit=&cursor=`
 * → `{ code: 200, data: { items, next_cursor } }`. Not in the published docs (which cover oracle prices
 * only); found in the app's own bundle.
 *
 * Units (GMX v2): USD values carry 30 decimals; token amounts 18 (collateral HFUSD1, index tokens).
 * Realized result of a closing trade = gross_pnl + price_impact − fees − profit_sharing − liquidation_fee
 * + loss_rebate, where `fees` = borrowing + funding (+ position fee), and `profit_sharing` is the
 * "hyper" mode's share of profits (no open/close fees in that mode).
 *
 * STATUS: verified 2026-11-03 against BNB Chain receipts for one live wallet — for all 6 closes, the
 * USD1 paid out on-chain equalled collateral + this net within $0.01.
 */

const API = "https://data-statistics-query.mainnet.htzfl.link/api/v1/bsc";
const PAGE = 100;
const MAX_PAGES = 100;

export interface HzTrade {
  market_symbol: string;
  direction: string;
  position_mode?: string;
  action_type: string;
  display_action?: string;
  size_in_usd: string;
  size_delta_usd: string;
  size_delta_tokens: string;
  collateral_delta_amount: string;
  collateral_token_price_min?: string;
  execution_price: string;
  funding_fee_amount?: string;
  borrowing_fee_usd?: string;
  position_fee_amount?: string;
  pnl_detail?: {
    initial_collateral_amount?: string;
    gross_pnl?: string;
    loss_rebate?: string;
    fees?: string;
    price_impact?: string;
    liquidation_fee?: string;
    profit_sharing?: string;
  };
  action_time_ms: number;
  tx_hash: string;
  log_index: number;
  position_key?: string;
}

const usd30 = (s?: string) => (s ? Number(BigInt(s)) / 1e30 : 0);
const amt18 = (s?: string) => (s ? Number(BigInt(s)) / 1e18 : 0);

/** Orders created/updated/cancelled and failed executions move no money. */
const isBookkeeping = (t: HzTrade) => /^(created|updated|cancelled|failed)_/.test(t.action_type);

export function normalizeHzTrade(t: HzTrade, account: string): FinancialEvent | null {
  if (isBookkeeping(t)) return null;
  const sizeUsd = usd30(t.size_delta_usd);
  const qty = amt18(t.size_delta_tokens);
  const price = qty > 0 ? sizeUsd / qty : usd30(t.execution_price) * 1e18; // price/1e12 for 18-dp index tokens
  const base = {
    id: `hz-${t.tx_hash}-${t.log_index}`,
    protocol: "hertzflow" as const,
    chain: "BNB Chain",
    account,
    timestamp: t.action_time_ms,
    category: "perp" as const,
    asset: t.market_symbol.replace(/\/USD$/, ""),
    quantity: qty,
    price: round(price, 6),
    fiat: { currency: "USD" as const, source: "USD1 collateral (HFUSD1), assumed 1 USD1 = 1 USD" },
    source: "HertzFlow data-statistics API · user/trades",
    txHash: t.tx_hash,
    verification: "verified" as const,
  };
  const p = t.pnl_detail;
  if (!p) {
    // Opening / increasing a position: no realized result; hyper mode has no opening fee
    const type: EventType = /increase/.test(t.action_type) ? "PERP_INCREASE" : "PERP_OPEN";
    return { ...base, type, realizedPnlUsd: 0, feeUsd: amt18(t.position_fee_amount), fundingUsd: 0, confidence: 0.95, notes: `${t.display_action ?? t.action_type} · ${t.direction} · ${t.position_mode ?? ""}`.trim() };
  }
  const collateralPrice = t.collateral_token_price_min ? Number(BigInt(t.collateral_token_price_min)) / 1e12 : 1;
  const fundingPaid = amt18(t.funding_fee_amount) * collateralPrice;
  const fees = usd30(p.fees);
  const profitShare = usd30(p.profit_sharing);
  const liqFee = usd30(p.liquidation_fee);
  const liquidated = /liquidat/.test(t.action_type);
  const type: EventType = liquidated ? "LIQUIDATION" : usd30(t.size_in_usd) > 0 ? "PERP_REDUCE" : "PERP_CLOSE";
  return {
    ...base,
    type,
    realizedPnlUsd: round(usd30(p.gross_pnl) + usd30(p.price_impact) + usd30(p.loss_rebate), 6),
    // Funding is reported separately below; everything else HertzFlow charges is a fee here
    feeUsd: round(Math.max(0, fees - fundingPaid) + profitShare + liqFee, 6),
    fundingUsd: round(-fundingPaid, 6),
    entryValueUsd: round(sizeUsd, 6),
    confidence: 0.98,
    notes: [
      `${t.display_action ?? t.action_type} · ${t.direction}`,
      profitShare ? `hyper-mode profit share $${profitShare.toFixed(4)} included in fees` : "",
      usd30(p.loss_rebate) ? `loss rebate $${usd30(p.loss_rebate).toFixed(4)} included in P&L` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export const HertzFlowDataProvider: DataProvider = {
  id: "hertzflow",
  protocol: "hertzflow",
  supports: (kind) => kind === "evm",
  async fetch(address, ctx): Promise<ProviderResult> {
    const rows: HzTrade[] = [];
    let cursor: string | null = null;
    let requests = 0;
    let truncated = true;
    for (let i = 0; i < MAX_PAGES; i++) {
      const url: string = `${API}/user/trades?user_address=${address}&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await ctx.http.getJson<{ code: number; msg?: string; data: { items: HzTrade[] | null; next_cursor: string | null } | null }>("hertzflow", url);
      requests++;
      if (res.code !== 200) throw new Error(`hertzflow: API code ${res.code}${res.msg ? ` (${res.msg})` : ""}`);
      const items = res.data?.items ?? [];
      rows.push(...items);
      cursor = res.data?.next_cursor ?? null;
      if (!cursor || !items.length) {
        truncated = false;
        break;
      }
    }
    const events = rows
      .map((t) => normalizeHzTrade(t, address))
      .filter((e): e is FinancialEvent => e !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
    const warnings: string[] = [];
    if (truncated) warnings.push(`HertzFlow history stopped at ${(MAX_PAGES * PAGE).toLocaleString()} records — older trades may be missing.`);
    return {
      events,
      openPositions: [],
      warnings,
      report: {
        provider: "HertzFlowDataProvider",
        protocol: "hertzflow",
        status: rows.length ? "ok" : "empty",
        eventCount: events.length,
        requests,
        fromCache: false,
        message: rows.length ? undefined : "No HertzFlow trades for this address.",
        limitations: [
          "Realized P&L per close as reported by HertzFlow (checked against on-chain payouts)",
          "Hyper-mode profit share is treated as a trading fee",
          "Order bookkeeping (TP/SL created, updated, cancelled) and failed orders are not financial events",
        ],
      },
    };
  },
};
