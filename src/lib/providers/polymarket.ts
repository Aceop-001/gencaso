import { PositionBook, round } from "../engine/positions";
import type { EventType, FinancialEvent, OpenPosition } from "../engine/schema";
import { USDC_FIAT, type DataProvider, type ProviderResult } from "./types";

/**
 * PolymarketDataProvider — read-only public Data API v2.
 * Docs: https://docs.polymarket.com/migrate/data-api-v1-to-v2 (v1 retired 2 Nov 2026)
 * v2: `{ data, pagination }` envelope, snake_case fields, opaque cursor pagination,
 * `start=1` needed for full history (the default window is three years).
 *
 * STATUS: v1 tested live on 2026-11-02; migrated to v2 and re-verified on 2026-11-03 against
 * Polymarket's own per-position realized P&L (/v2/positions?status=CLOSED). Events stay
 * "estimated" because cost basis is reconstructed by GENCASO rather than reported per trade.
 *
 * Polymarket does not report realized P&L per trade, so cost basis is rebuilt
 * with GENCASO's weighted-average PositionBook per outcome token. That needs
 * the full history, so this provider always performs a full (not incremental) fetch.
 */

const DATA = "https://data-api.polymarket.com/v2";
const PAGE = 1000; // v2 maximum
const MAX_PAGES = 30;

/** Raw v2 rows (only the fields GENCASO reads). */
interface V2Activity {
  proxy_wallet: string;
  timestamp: number;
  condition_id: string;
  type: string;
  size: number;
  usdc_size: number;
  transaction_hash: string;
  price: number;
  token_id: string;
  side: string;
  outcome_index: number;
  title: string;
  slug: string;
  outcome: string;
  is_combo?: boolean;
}
interface V2Position {
  token_id: string;
  condition_id: string;
  current_size: number;
  avg_price: number;
  current_price: number;
  redeemable: boolean;
  title: string;
  outcome: string;
  end_date?: string;
}
interface V2Page<T> {
  data: T[] | null;
  pagination?: { has_more: boolean; next_cursor: string | null };
}

/** v2 → the internal (v1-shaped) row the normalizer works on. */
export function fromV2Activity(r: V2Activity): PmActivity {
  return {
    proxyWallet: r.proxy_wallet,
    timestamp: r.timestamp,
    conditionId: r.condition_id,
    type: r.type,
    size: r.size,
    usdcSize: r.usdc_size,
    transactionHash: r.transaction_hash,
    price: r.price,
    asset: r.token_id,
    side: r.side === "BUY" || r.side === "SELL" ? r.side : "",
    outcomeIndex: r.outcome_index,
    title: r.title,
    slug: r.slug,
    outcome: r.outcome,
    isCombo: r.is_combo,
  };
}
const fromV2Position = (r: V2Position): PmPosition => ({
  asset: r.token_id,
  conditionId: r.condition_id,
  size: r.current_size,
  avgPrice: r.avg_price,
  curPrice: r.current_price,
  redeemable: r.redeemable,
  title: r.title,
  outcome: r.outcome,
  endDate: r.end_date,
});

// Income-like activity: reported as rewards (never trading P&L)
const REWARD_TYPES: Record<string, string> = {
  REWARD: "Polymarket reward",
  YIELD: "Yield on collateral",
  REFERRAL_REWARD: "Referral reward",
  MAKER_REBATE: "Maker fee rebate — treated as income; some jurisdictions treat it as reducing trading costs",
  TAKER_REBATE: "Taker fee rebate — treated as income; some jurisdictions treat it as reducing trading costs",
};

export interface PmActivity {
  proxyWallet: string;
  timestamp: number; // seconds
  conditionId: string;
  type: "TRADE" | "SPLIT" | "MERGE" | "REDEEM" | "REWARD" | "CONVERSION" | string;
  size: number;
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string;
  side: "BUY" | "SELL" | "";
  outcomeIndex: number;
  title: string;
  slug: string;
  outcome: string;
  isCombo?: boolean;
}

interface PmPosition {
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  redeemable: boolean;
  title: string;
  outcome: string;
  endDate?: string;
}

/** Pure normalization of a chronological activity list (exported for tests). */
export function normalizeActivity(rows: PmActivity[], account: string, resolvedLosers: PmPosition[] = []) {
  const book = new PositionBook();
  const events: FinancialEvent[] = [];
  const warnings: string[] = [];
  const keysByCondition = new Map<string, Set<string>>();
  const meta = new Map<string, { title: string; outcome: string; conditionId: string }>();
  const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp);

  const base = (a: PmActivity, i: number) => ({
    id: `pm-${a.transactionHash}-${a.type}-${a.asset || a.conditionId}-${i}`,
    protocol: "polymarket" as const,
    chain: "Polygon",
    account,
    timestamp: a.timestamp * 1000,
    fiat: USDC_FIAT,
    source: "Polymarket Data API · activity",
    txHash: a.transactionHash || undefined,
    verification: "estimated" as const,
    feeUsd: 0,
    fundingUsd: 0,
  });
  const track = (cid: string, key: string, a: PmActivity) => {
    if (!keysByCondition.has(cid)) keysByCondition.set(cid, new Set());
    keysByCondition.get(cid)!.add(key);
    if (!meta.has(key)) meta.set(key, { title: a.title, outcome: a.outcome, conditionId: cid });
  };

  sorted.forEach((a, i) => {
    const market = { id: a.conditionId, name: a.title, outcome: a.outcome || undefined, slug: a.slug || undefined };
    if (a.isCombo) {
      warnings.push(`Polymarket: combo (multi-leg) activity on "${a.title}" is not supported and was excluded.`);
    } else if (a.type === "TRADE" && a.asset && a.size > 0) {
      const key = a.asset;
      track(a.conditionId, key, a);
      const side = a.side === "SELL" ? -1 : 1;
      const res = book.apply({ key, timestamp: a.timestamp * 1000, side, quantity: a.size, price: a.price });
      const type: EventType = side === 1 ? "PM_BUY" : "PM_SELL";
      // usdcSize is the cash actually paid/received; the gap to size × price is the trading fee.
      const gross = a.size * a.price;
      const fee = a.usdcSize > 0 ? Math.max(0, side === 1 ? a.usdcSize - gross : gross - a.usdcSize) : 0;
      events.push({
        ...base(a, i),
        category: "prediction",
        type,
        asset: a.outcome || a.asset,
        market,
        quantity: a.size,
        price: a.price,
        entryValueUsd: res.closedQuantity ? res.entryValue : undefined,
        exitValueUsd: res.closedQuantity ? res.exitValue : undefined,
        realizedPnlUsd: res.realizedPnl,
        feeUsd: round(fee, 6),
        openedAt: res.openedAt,
        confidence: 0.95,
      });
      if (res.transition === "FLIP") warnings.push(`Polymarket: sold more "${a.title}" shares than were bought in the retrieved history — earlier history may be missing.`);
    } else if (a.type === "REDEEM" || a.type === "MERGE") {
      // Close every tracked outcome token of this condition; proceeds = usdcSize.
      const keys = [...(keysByCondition.get(a.conditionId) ?? [])];
      let entry = 0;
      let qty = 0;
      for (const key of keys) {
        const pos = book.get(key);
        if (!pos || pos.size <= 0) continue;
        const closeQty = a.type === "MERGE" ? Math.min(pos.size, a.size) : pos.size;
        const res = book.apply({ key, timestamp: a.timestamp * 1000, side: -1, quantity: closeQty, price: 0 });
        entry += res.entryValue;
        qty += closeQty;
      }
      if (!keys.length) warnings.push(`Polymarket: ${a.type} for "${a.title}" without matching purchases in the retrieved history.`);
      events.push({
        ...base(a, i),
        category: "prediction",
        type: a.type === "REDEEM" ? "PM_REDEEM" : "PM_MERGE",
        asset: a.outcome || "USDC",
        market,
        quantity: qty,
        price: qty ? round(a.usdcSize / qty, 6) : undefined,
        entryValueUsd: round(entry, 6),
        exitValueUsd: a.usdcSize,
        realizedPnlUsd: round(a.usdcSize - entry, 6),
        confidence: keys.length ? 0.9 : 0.5,
      });
    } else if (a.type === "SPLIT") {
      // USDC -> one share of each outcome. Cost split evenly across outcomes (assumption).
      events.push({
        ...base(a, i),
        category: "prediction",
        type: "PM_SPLIT",
        asset: "USDC",
        market,
        quantity: a.size,
        realizedPnlUsd: 0,
        confidence: 0.6,
        notes: "Split cost allocated 50/50 to each outcome token (assumption).",
      });
      warnings.push(`Polymarket: SPLIT on "${a.title}" — outcome tokens are not individually identified by the activity feed; cost basis allocation is approximate.`);
    } else if (REWARD_TYPES[a.type]) {
      events.push({ ...base(a, i), category: "account", type: "REWARD", asset: "USDC", quantity: a.usdcSize, amountUsd: a.usdcSize, realizedPnlUsd: 0, confidence: a.type.endsWith("REBATE") ? 0.8 : 0.95, notes: REWARD_TYPES[a.type] });
    } else if (a.type === "MIGRATION") {
      // Collateral migration (e.g. USDC → pUSD): a 1:1 swap, not trading P&L
      events.push({ ...base(a, i), category: "account", type: "TRANSFER", asset: "USDC", quantity: a.usdcSize, amountUsd: a.usdcSize, realizedPnlUsd: 0, confidence: 0.9, notes: "Collateral migration — not a disposal" });
    } else {
      warnings.push(`Polymarket: unsupported activity type "${a.type}" ignored.`);
    }
  });

  // Resolved-but-unredeemed losing positions (curPrice 0, redeemable) are realized losses.
  for (const p of resolvedLosers) {
    const res = book.settle(p.asset, 0, p.endDate ? Date.parse(p.endDate) : Date.now());
    if (!res) continue;
    events.push({
      id: `pm-settle-loss-${p.asset}`,
      protocol: "polymarket",
      chain: "Polygon",
      account,
      timestamp: res.fill.timestamp,
      category: "prediction",
      type: "PM_SETTLE_LOSS",
      asset: p.outcome,
      market: { id: p.conditionId, name: p.title, outcome: p.outcome },
      quantity: res.closedQuantity,
      price: 0,
      entryValueUsd: res.entryValue,
      exitValueUsd: 0,
      realizedPnlUsd: res.realizedPnl,
      feeUsd: 0,
      fundingUsd: 0,
      fiat: USDC_FIAT,
      source: "Polymarket Data API · positions (resolved at 0)",
      verification: "estimated",
      confidence: 0.85,
      notes: p.endDate ? "Settlement time = market end date" : "Settlement time unknown — dated at analysis time",
    });
  }

  const openPositions: OpenPosition[] = book.open().map((p) => {
    const m = meta.get(p.key);
    return {
      protocol: "polymarket",
      asset: m?.outcome ?? p.key,
      market: m ? { id: m.conditionId, name: m.title, outcome: m.outcome } : undefined,
      quantity: p.size,
      avgEntryPrice: p.avgPrice,
    };
  });
  return { events, warnings, openPositions };
}

export const PolymarketDataProvider: DataProvider = {
  id: "polymarket",
  protocol: "polymarket",
  supports: (kind) => kind === "evm",
  async fetch(address, ctx): Promise<ProviderResult> {
    let requests = 0;
    // Follow the opaque cursor until it runs out (or the page cap is hit)
    const all = async <T,>(first: string): Promise<{ rows: T[]; truncated: boolean }> => {
      const rows: T[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res: V2Page<T> = await ctx.http.getJson<V2Page<T>>("polymarket", cursor ? `${first}&cursor=${encodeURIComponent(cursor)}` : first);
        requests++;
        rows.push(...(res.data ?? []));
        cursor = res.pagination?.next_cursor ?? null;
        if (!cursor) return { rows, truncated: false };
      }
      return { rows, truncated: true };
    };
    const activity = await all<V2Activity>(`${DATA}/activity?user=${address}&limit=${PAGE}&start=1&sort_by=TIMESTAMP&sort_direction=ASC`);
    const rows = activity.rows.map(fromV2Activity);
    let losers: PmPosition[] = [];
    if (rows.length) {
      // Resolved, still-held losing positions: realized losses even though never redeemed
      const lost = await all<V2Position>(`${DATA}/positions?user=${address}&status=REDEEMABLE_LOST&limit=${PAGE}`);
      losers = lost.rows.map(fromV2Position).filter((p) => p.curPrice === 0);
    }
    const { events, warnings, openPositions } = normalizeActivity(rows, address, losers);
    if (activity.truncated) warnings.push(`Polymarket activity stopped at ${(MAX_PAGES * PAGE).toLocaleString()} rows — older activity may be missing.`);
    if (rows.length) warnings.push("Polymarket cost basis is reconstructed from activity (weighted average); figures are estimates.");
    return {
      events,
      openPositions,
      warnings,
      report: {
        provider: "PolymarketDataProvider",
        protocol: "polymarket",
        status: rows.length ? "ok" : "empty",
        eventCount: events.length,
        requests,
        fromCache: false,
        message: rows.length ? undefined : "No Polymarket activity for this address (Polymarket uses a proxy wallet — use the address from your profile).",
        limitations: ["Cost basis reconstructed by GENCASO", "Requires the Polymarket proxy wallet address"],
      },
    };
  },
};
