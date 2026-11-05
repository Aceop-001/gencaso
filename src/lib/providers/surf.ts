import type { FinancialEvent, OpenPosition, ProtocolId } from "../engine/schema";
import { normalizeFill, type HlFill } from "./hyperliquid";
import { normalizeActivity, type PmActivity } from "./polymarket";
import type { DataProvider, ProviderContext, ProviderResult } from "./types";

/**
 * SurfDataProvider — the Surf (asksurf.ai) Data API. Surf is never a primary source: it makes the
 * direct providers' results more complete, and only where they are incomplete.
 *
 *  1. Older Hyperliquid fills (the main job). Hyperliquid's own API returns only a wallet's latest
 *     10,000 fills, so an active trader loses everything before that. Surf's warehouse holds it.
 *     Surf fetches only fills older than the earliest fill the direct provider already has, plus one
 *     day of overlap so the two sources can be cross-checked, and reuses Hyperliquid's own normalizer:
 *     each fill gets exactly the same event id (`hl-fill-<fill id>`) the direct provider would give
 *     it, so dedupe() removes it when both sources report it — a trade is never counted twice.
 *  2. Polymarket stand-in. Only when the direct Polymarket call failed and nothing is cached: Surf's
 *     Polymarket trades/positions are normalized through Polymarket's own activity normalizer.
 *  3. Cross-check. Over the overlapping period, realized P&L and fees are compared per coin between
 *     the two sources; a difference beyond $1 or 0.1% adds a warning. Direct data is never replaced.
 *     Funding is not compared: Surf's warehouse rows report funding_status "unavailable", so there is
 *     nothing trustworthy to compare Hyperliquid's own funding settlements against.
 *
 * Endpoints (read-only, server-side, `Authorization: Bearer $SURF_API_KEY`):
 *   GET /gateway/v1/hyperliquid/fills?address=&order=desc&from=&to=&limit=
 *   GET /gateway/v1/prediction-market/polymarket/trades?address=&type=all&limit=&offset=
 *   GET /gateway/v1/prediction-market/polymarket/positions?address=&limit=&offset=
 *   GET /gateway/v1/me/credits                        (free: 0 credits — the credit gate below)
 *
 * Credit gate: before any billable call, the free me/credits endpoint is asked for the workspace's
 * remaining balance. Below SURF_MIN_BALANCE (default 500) Surf is skipped with a warning and nothing
 * is fetched; if the balance cannot be read at all (a key without workspace access answers 401), Surf
 * is skipped the same way rather than spending blind. The direct providers' warning is left untouched,
 * so the report still says which part of the history is missing.
 *
 * Verified live on 2026-11-04 against wallet 0x15ba…7b29: every fill Surf returns in the period
 * Hyperliquid's own API still holds matches it exactly (fill id, size, price, closed P&L, fee, hash,
 * timestamp), and the 1,588 older fills Surf adds leave the overlapping period's totals unchanged.
 *
 * Cost: only the missing date range is fetched, every walk is capped (SURF_MAX_PAGES, default 20 pages
 * of 100 fills ≈ 40 credits), and a repeat analysis of the same wallet makes no Surf requests at all
 * (the orchestrator caches the result per address).
 */

export const SURF_BASE = "https://api.asksurf.ai/gateway/v1";
/** The base URL must include the /v1 suffix (SURF_API_BASE_URL, as set by Surf Studio, already does). */
const baseUrl = () => (process.env.SURF_API_BASE_URL?.trim() || SURF_BASE).replace(/\/+$/, "");
/** Surf is only used when a key is configured; without one GENCASO behaves exactly as it did before. */
export const surfConfigured = () => Boolean(process.env.SURF_API_KEY?.trim());

/**
 * Surf is a data source, not a trading protocol: registry.ts carries a source-only entry under this
 * id so the "Data sources" list can name it (the engine's ProtocolId union is not ours to extend).
 */
const SURF_PROTOCOL = "surf" as ProtocolId;

const DAY_MS = 86_400_000;
/** Fills per request (the endpoint's maximum). */
const FILL_PAGE = 100;
/** Backfill budget: at most this many pages of older fills per analysis (~2,000 fills, ~40 credits).
 *  Override with SURF_MAX_PAGES (pages of 100 fills) to raise or lower it without touching the code. */
const FILL_MAX_PAGES_DEFAULT = 20;
/** Credit floor: Surf is skipped while the workspace has fewer credits left than this. The check itself
 *  is free (me/credits costs 0 credits), so the gate never adds to the bill. Override with SURF_MIN_BALANCE. */
const MIN_BALANCE_DEFAULT = 500;

/** Integer env override; an unparsable or too-small value falls back to the default. */
function envCount(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}
const fillMaxPages = () => envCount("SURF_MAX_PAGES", FILL_MAX_PAGES_DEFAULT, 1);
const minBalance = () => envCount("SURF_MIN_BALANCE", MIN_BALANCE_DEFAULT, 0);
/** A fills window returns at most ~2,000 fills, anchored on its OLDEST fill when it is too big, so the
 *  window is halved until one fits; then the walk is newest-first and always contiguous with the
 *  direct provider's history. */
const WINDOW_START_MS = 90 * DAY_MS;
const WINDOW_MIN_MS = DAY_MS;
const WINDOW_PROBES = 7;
/** One day of overlap above the direct provider's earliest fill — the cross-check needs both sources. */
const OVERLAP_MS = DAY_MS;
/** Polymarket stand-in budget (only used when the direct Polymarket call failed). */
const PM_PAGE = 500;
const PM_MAX_PAGES = 20;
const PM_POSITION_PAGE = 100;
const PM_POSITION_MAX_PAGES = 5;

/** Hyperliquid's own spot rule (kept identical to hyperliquid.ts): spot trading is out of scope. */
const isSpot = (coin: string) => coin.startsWith("@") || coin.includes("/");
const authHeader = (key: string) => ({ Authorization: `Bearer ${key}` });
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** One fill from Surf's Hyperliquid fills endpoint (fields as documented; all present in responses). */
export interface SurfFill {
  symbol: string;
  /** buy | sell */
  side: string;
  /** Hyperliquid's direction, e.g. "Open Long" / "Close Short" / "Long > Short" */
  direction: string;
  price: number;
  size: number;
  start_position: number;
  /** Realized P&L for this fill, USD */
  closed_pnl: number;
  /** Fee, USD (negative = rebate) */
  fee: number;
  fee_token: string;
  crossed: boolean;
  is_internal: boolean;
  /** Unix seconds */
  time: number;
  /** Unix milliseconds — the exact fill time Hyperliquid reports */
  time_ms: number;
  /** Hyperliquid's trade id, as a string — the same value as the direct API's `tid` */
  fill_id: string;
  tx_index: number;
  hash: string;
}

/**
 * Surf's fill → the shape Hyperliquid's own normalizer expects, so both sources produce identical
 * events (same id, size, price, P&L, fee, hash). Surf does not expose Hyperliquid's liquidation flag,
 * so a liquidation fill is classified by its direction like any other fill.
 */
export function surfFillToHlFill(f: SurfFill): HlFill {
  return {
    coin: f.symbol,
    px: String(f.price),
    sz: String(f.size),
    side: f.side?.toLowerCase() === "buy" ? "B" : "A",
    time: f.time_ms,
    startPosition: String(f.start_position),
    dir: f.direction,
    closedPnl: String(f.closed_pnl),
    hash: f.hash,
    oid: 0, // not exposed by Surf (the normalizer does not read it)
    tid: Number(f.fill_id),
    fee: String(f.fee),
    feeToken: f.fee_token,
  };
}

/**
 * A Surf fill as a GENCASO event: Hyperliquid's own normalization, sourced from Surf.
 * The fill id is Hyperliquid's trade id, so the event id is exactly the direct provider's
 * (`hl-fill-<id>`) and dedupe() removes it when both sources report the same fill.
 */
export function surfFillEvent(f: SurfFill, account: string): FinancialEvent {
  return { ...normalizeFill(surfFillToHlFill(f), account), source: "Surf Data API · hyperliquid/fills" };
}

/** Fills whose id is not Hyperliquid's numeric trade id cannot be matched to the direct provider's
 *  event ids, so they are left out (with a warning) rather than risk collapsing into one event. */
const usableFillId = (f: SurfFill) => Number.isSafeInteger(Number(f.fill_id));

/** One row of Surf's Polymarket activity feed (`type=trade|redemption|all`). */
export interface SurfActivity {
  timestamp: number; // seconds
  condition_id: string;
  /** Surf's activity type: "order_filled" for trades */
  type: string;
  title: string;
  outcome: string;
  side: string; // buy | sell
  size: number;
  usdc_size: number;
  price: number;
  transaction_hash: string;
}

/** One row of Surf's Polymarket wallet positions. */
export interface SurfPosition {
  condition_id: string;
  question: string;
  outcome_label: string;
  size: number;
  avg_price: number;
  cur_price: number;
  current_value: number;
  cash_pnl: number;
  realized_pnl: number;
  redeemable: boolean;
}

/** Surf's activity type → the type Polymarket's own normalizer switches on. */
const PM_ACTIVITY_TYPE: Record<string, string> = {
  order_filled: "TRADE",
  redeem: "REDEEM",
  merge: "MERGE",
  split: "SPLIT",
  reward: "REWARD",
  yield: "YIELD",
  referral_reward: "REFERRAL_REWARD",
  maker_rebate: "MAKER_REBATE",
  taker_rebate: "TAKER_REBATE",
  conversion: "CONVERSION",
  migration: "MIGRATION",
};

/**
 * Surf's activity row → Polymarket's activity shape. Surf's feed carries no outcome-token id, so the
 * position key is the condition id plus the outcome label — stable within an analysis, which is all
 * the cost-basis book needs.
 */
export function surfActivityToPmActivity(a: SurfActivity, account: string): PmActivity {
  const side = a.side?.toUpperCase();
  return {
    proxyWallet: account,
    timestamp: a.timestamp,
    conditionId: a.condition_id,
    type: PM_ACTIVITY_TYPE[a.type?.toLowerCase()] ?? a.type?.toUpperCase() ?? "TRADE",
    size: a.size,
    usdcSize: a.usdc_size,
    transactionHash: a.transaction_hash,
    price: a.price,
    asset: a.outcome ? `${a.condition_id}:${a.outcome}` : a.condition_id,
    side: side === "SELL" ? "SELL" : side === "BUY" ? "BUY" : "",
    outcomeIndex: 0,
    title: a.title,
    slug: "",
    outcome: a.outcome,
  };
}

/** What the direct providers already returned — Surf backfills around it. */
export interface SurfDirectSnapshot {
  /** Direct Hyperliquid fills: the earliest one Surf must not go past, and whether the 10,000-fill cap was hit. */
  hyperliquid?: { earliestFillMs: number; truncated: boolean; events: FinancialEvent[] };
  /** Direct Polymarket outcome: Surf stands in only when it failed and nothing is cached. */
  polymarket?: { failed: boolean; events: FinancialEvent[] };
  /** Event ids already in the dataset — Surf never duplicates or replaces them. */
  knownIds: Set<string>;
}

export interface SurfResult extends ProviderResult {
  /** Older Hyperliquid fills added, and how far back the contiguous coverage now reaches. */
  hyperliquid?: { added: number; fromMs: number; complete: boolean };
  /** Whether the Polymarket stand-in ran (successfully fetched — it may still have found nothing). */
  polymarketBackup: boolean;
  /** Nothing was fetched: the credit gate refused (balance below the floor, or the balance could not be read).
   *  The caller keeps its bookkeeping open so a later analysis can try again once the balance is back. */
  skipped?: boolean;
}

export interface SurfProvider extends Omit<DataProvider, "fetch"> {
  fetch(address: string, ctx: ProviderContext, direct: SurfDirectSnapshot): Promise<SurfResult>;
}

interface FillsPage {
  data?: SurfFill[];
  meta?: { has_more?: boolean; next_cursor?: string; empty_reason?: string };
}
interface ListPage<T> {
  data?: T[];
  meta?: { has_more?: boolean; total?: number; empty_reason?: string };
}

function fillsUrl(address: string, lo: number, hi: number, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ address, order: "desc", from: String(lo), to: String(hi), limit: String(FILL_PAGE), ...extra });
  return `${baseUrl()}/hyperliquid/fills?${q}`;
}

export interface HyperliquidBackfill {
  fills: SurfFill[];
  requests: number;
  /** The window was walked to its end: nothing between the oldest fill and the boundary is missing. */
  complete: boolean;
  /** Even the smallest window held more fills than one walk can take (a very high-frequency wallet). */
  capped: boolean;
}

/**
 * Walk older Hyperliquid fills backwards from `beforeMs` (the direct provider's earliest fill).
 * The window is halved until the endpoint returns one it can hold in full, then walked newest-first
 * with `to_ms` + `to_fill_id`, so the fills always join the direct history without a hole.
 */
async function backfillHyperliquid(ctx: ProviderContext, key: string, address: string, beforeMs: number): Promise<HyperliquidBackfill> {
  const hi = Math.floor((beforeMs + OVERLAP_MS) / 1000);
  let requests = 0;
  let window = WINDOW_START_MS;
  let lo = Math.floor((beforeMs - window) / 1000);
  let page: FillsPage | undefined;
  for (let probe = 0; probe < WINDOW_PROBES; probe++) {
    lo = Math.floor((beforeMs - window) / 1000);
    page = await ctx.http.getJson<FillsPage>("surf", fillsUrl(address, lo, hi), authHeader(key));
    requests++;
    const rows = page.data ?? [];
    // A window that fits ends on its newest fill; one that is too big is anchored on its oldest fill.
    if (rows.length && rows[0].time_ms >= beforeMs) break;
    if (!rows.length) return { fills: [], requests, complete: true, capped: false }; // nothing older in the window
    if (window <= WINDOW_MIN_MS) return { fills: [], requests, complete: false, capped: true };
    window = Math.max(Math.floor(window / 2), WINDOW_MIN_MS);
    page = undefined;
  }
  if (!page) return { fills: [], requests, complete: false, capped: true };

  const fills: SurfFill[] = [...(page.data ?? [])];
  while (page.meta?.has_more && fills.length < fillMaxPages() * FILL_PAGE) {
    const last = fills[fills.length - 1];
    page = await ctx.http.getJson<FillsPage>("surf", fillsUrl(address, lo, hi, { to_ms: String(last.time_ms), to_fill_id: last.fill_id }), authHeader(key));
    requests++;
    const rows = page.data ?? [];
    if (!rows.length) break;
    fills.push(...rows);
  }
  return { fills, requests, complete: !page.meta?.has_more, capped: false };
}

/**
 * Free balance check (me/credits costs 0 credits and is not recorded in usage history).
 * Returns the workspace's remaining credits, or why they could not be read — a failed check never
 * spends anything: the caller skips Surf instead of guessing.
 */
async function creditBalance(ctx: ProviderContext, key: string): Promise<{ balance: number } | { error: string }> {
  try {
    const page = await ctx.http.getJson<{ data?: { credit_balance?: unknown } }>("surf", `${baseUrl()}/me/credits`, authHeader(key));
    const raw = page?.data?.credit_balance;
    const balance = typeof raw === "string" ? Number(raw) : raw;
    if (typeof balance !== "number" || !Number.isFinite(balance)) return { error: "the response carried no balance" };
    return { balance };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The wallet's oldest fill, so the warning can say whether the Hyperliquid gap is now fully closed. */
async function oldestFillMs(ctx: ProviderContext, key: string, address: string): Promise<number | undefined> {
  const q = new URLSearchParams({ address, order: "asc", from: "2016-01-01", limit: String(FILL_PAGE) });
  const page = await ctx.http.getJson<FillsPage>("surf", `${baseUrl()}/hyperliquid/fills?${q}`, authHeader(key));
  return (page.data ?? []).find((f) => !isSpot(f.symbol))?.time_ms;
}

/**
 * Cross-check the overlapping period: the same fills are held by both sources, so realized P&L and
 * fees must agree per coin. Direct data is never modified — a difference only adds a warning.
 */
export function crossCheckFills(overlap: SurfFill[], directEvents: FinancialEvent[]): string[] {
  const directById = new Map(directEvents.map((e) => [e.id, e]));
  const perCoin = new Map<string, { surfPnl: number; surfFee: number; directPnl: number; directFee: number; missing: number }>();
  for (const f of overlap) {
    if (isSpot(f.symbol)) continue;
    const agg = perCoin.get(f.symbol) ?? { surfPnl: 0, surfFee: 0, directPnl: 0, directFee: 0, missing: 0 };
    const d = directById.get(`hl-fill-${f.fill_id}`);
    agg.surfPnl += f.closed_pnl;
    agg.surfFee += f.fee;
    if (d) {
      agg.directPnl += d.realizedPnlUsd;
      agg.directFee += d.feeUsd;
    } else {
      agg.missing++;
    }
    perCoin.set(f.symbol, agg);
  }
  const warnings: string[] = [];
  for (const [coin, a] of perCoin) {
    if (a.missing) warnings.push(`Surf: ${a.missing} fill(s) of ${coin} from Surf are not in Hyperliquid's own history for the overlapping period.`);
    // $1 or 0.1%, whichever is larger — the direct figures are the ones GENCASO keeps
    const pnlDiff = Math.abs(a.surfPnl - a.directPnl);
    const feeDiff = Math.abs(a.surfFee - a.directFee);
    if (pnlDiff > Math.max(1, Math.abs(a.directPnl) * 0.001)) {
      warnings.push(`Surf: realized P&L for ${coin} differs between Surf ($${a.surfPnl.toFixed(2)}) and Hyperliquid ($${a.directPnl.toFixed(2)}) in the overlapping period — Hyperliquid's figures are kept.`);
    }
    if (feeDiff > Math.max(1, Math.abs(a.directFee) * 0.001)) {
      warnings.push(`Surf: fees for ${coin} differ between Surf ($${a.surfFee.toFixed(2)}) and Hyperliquid ($${a.directFee.toFixed(2)}) in the overlapping period — Hyperliquid's figures are kept.`);
    }
  }
  return warnings;
}

/** Polymarket stand-in: trades/positions from Surf, normalized exactly like the direct provider. */
async function polymarketStandIn(ctx: ProviderContext, key: string, address: string) {
  let requests = 0;
  const activity: SurfActivity[] = [];
  for (let page = 0; page < PM_MAX_PAGES; page++) {
    const res = await ctx.http.getJson<ListPage<SurfActivity>>(
      "surf",
      `${baseUrl()}/prediction-market/polymarket/trades?address=${address}&type=all&limit=${PM_PAGE}&offset=${page * PM_PAGE}`,
      authHeader(key),
    );
    requests++;
    const batch = res.data ?? [];
    activity.push(...batch);
    if (batch.length < PM_PAGE) break;
  }

  const positions: SurfPosition[] = [];
  let positionsOk = false;
  try {
    for (let page = 0; page < PM_POSITION_MAX_PAGES; page++) {
      const res = await ctx.http.getJson<ListPage<SurfPosition>>(
        "surf",
        `${baseUrl()}/prediction-market/polymarket/positions?address=${address}&limit=${PM_POSITION_PAGE}&offset=${page * PM_POSITION_PAGE}`,
        authHeader(key),
      );
      requests++;
      positionsOk = true;
      const batch = res.data ?? [];
      positions.push(...batch);
      if (batch.length < PM_POSITION_PAGE) break;
    }
  } catch {
    positionsOk = false; // open positions fall back to the cost-basis book below
  }

  const rows = activity.map((a) => surfActivityToPmActivity(a, address)).sort((a, b) => a.timestamp - b.timestamp);
  // Resolved-at-zero positions are realized losses even when never redeemed (same rule as the direct provider)
  const losers = positions
    .filter((p) => p.cur_price === 0)
    .map((p) => ({ asset: `${p.condition_id}:${p.outcome_label}`, conditionId: p.condition_id, size: p.size, avgPrice: p.avg_price, curPrice: p.cur_price, redeemable: p.redeemable, title: p.question, outcome: p.outcome_label }));
  const normalized = normalizeActivity(rows, address, losers);
  const openPositions: OpenPosition[] = positionsOk
    ? positions
        .filter((p) => p.cur_price > 0)
        .map((p) => ({
          protocol: "polymarket" as const,
          asset: p.outcome_label,
          market: { id: p.condition_id, name: p.question, outcome: p.outcome_label },
          quantity: p.size,
          avgEntryPrice: p.avg_price,
          markPrice: p.cur_price,
          unrealizedPnlUsd: p.cash_pnl,
        }))
    : normalized.openPositions;
  const events = normalized.events.map((e) => ({
    ...e,
    source: e.id.startsWith("pm-settle-loss-") ? "Surf Data API · prediction-market/polymarket/positions" : "Surf Data API · prediction-market/polymarket/trades",
  }));
  return { events, openPositions, warnings: normalized.warnings, requests, rows: activity.length, truncated: activity.length >= PM_MAX_PAGES * PM_PAGE };
}

export const SurfDataProvider: SurfProvider = {
  id: "surf",
  protocol: SURF_PROTOCOL,
  supports: (kind) => kind === "evm",
  async fetch(address, ctx, direct): Promise<SurfResult> {
    const limitations = [
      "Surf fills gaps only — the direct Hyperliquid and Polymarket APIs stay the primary sources.",
      "Surf's fills carry no Hyperliquid liquidation flag, so liquidations it supplies are classified by direction like any other fill.",
      "Funding is not cross-checked: Surf's warehouse rows report funding_status \"unavailable\".",
      "Polymarket cost basis supplied by Surf is reconstructed from activity (weighted average); figures are estimates.",
    ];
    const key = process.env.SURF_API_KEY?.trim();
    if (!key) {
      return {
        events: [],
        openPositions: [],
        warnings: [],
        polymarketBackup: false,
        report: { provider: "SurfDataProvider", protocol: SURF_PROTOCOL, status: "unsupported", eventCount: 0, requests: 0, fromCache: false, message: "SURF_API_KEY is not set — Surf is disabled.", limitations },
      };
    }

    const events: FinancialEvent[] = [];
    const openPositions: OpenPosition[] = [];
    const warnings: string[] = [];
    const parts: string[] = [];
    let requests = 0;
    let errors = 0;
    let hyperliquid: SurfResult["hyperliquid"];
    let polymarketBackup = false;

    const wantHyperliquid = Boolean(direct.hyperliquid?.truncated && direct.hyperliquid.earliestFillMs > 0);
    const wantPolymarket = Boolean(direct.polymarket?.failed && !direct.polymarket.events.length);

    // 0. Credit gate — runs only when there is something to fetch, before any billable call.
    //    Surf is skipped when the workspace is below the floor, or when the balance cannot be read at all
    //    (a key without workspace access answers 401 here): no balance, no spending.
    if (wantHyperliquid || wantPolymarket) {
      const gate = await creditBalance(ctx, key);
      const floor = minBalance();
      const skip = (warning: string, message: string): SurfResult => ({
        events: [],
        openPositions: [],
        warnings: [warning],
        polymarketBackup: false,
        skipped: true,
        report: { provider: "SurfDataProvider", protocol: SURF_PROTOCOL, status: "empty", eventCount: 0, requests: 0, fromCache: false, message, limitations },
      });
      if ("error" in gate) {
        return skip(
          `Surf skipped: credit balance could not be checked (${gate.error}). Nothing was spent — Hyperliquid's own data is unchanged.`,
          `skipped: credit balance could not be checked (${gate.error})`,
        );
      }
      if (gate.balance < floor) {
        return skip(
          `Surf skipped: credit balance below the limit — ${gate.balance.toLocaleString()} credits left, SURF_MIN_BALANCE is ${floor.toLocaleString()}. Hyperliquid's own data is unchanged.`,
          `skipped: credit balance below the limit (${gate.balance.toLocaleString()} < ${floor.toLocaleString()})`,
        );
      }
    }

    // 1. Older Hyperliquid fills + cross-check against the overlapping period
    if (wantHyperliquid && direct.hyperliquid) {
      const hl = direct.hyperliquid;
      try {
        const backfill = await backfillHyperliquid(ctx, key, address, hl.earliestFillMs);
        requests += backfill.requests;
        if (backfill.capped) {
          warnings.push("Surf: this wallet trades too densely for the Hyperliquid backfill budget — its history before the 10,000-fill limit is still missing.");
          parts.push("no older fills added (backfill budget)");
        } else {
          const overlap = backfill.fills.filter((f) => f.time_ms >= hl.earliestFillMs);
          warnings.push(...crossCheckFills(overlap, hl.events));
          const older = backfill.fills.filter((f) => f.time_ms < hl.earliestFillMs && !isSpot(f.symbol));
          const unusable = older.filter((f) => !usableFillId(f)).length;
          if (unusable) warnings.push(`Surf: ${unusable} older fill(s) had no usable fill id and were left out.`);
          const fresh = older.filter(usableFillId).map((f) => surfFillEvent(f, address)).filter((e) => !direct.knownIds.has(e.id));
          if (fresh.length) {
            events.push(...fresh);
            const fromMs = Math.min(...fresh.map((e) => e.timestamp));
            let complete = false;
            try {
              const first = await oldestFillMs(ctx, key, address);
              requests++;
              complete = first !== undefined && first >= fromMs;
            } catch {
              complete = false; // the coverage start stands; only the wording of the warning depends on this
            }
            hyperliquid = { added: fresh.length, fromMs, complete };
            parts.push(`${fresh.length.toLocaleString()} older Hyperliquid fills back to ${isoDay(fromMs)}${complete ? " (history complete)" : ""}`);
          } else {
            parts.push("no older Hyperliquid fills found");
          }
        }
      } catch (e) {
        errors++;
        warnings.push(`Surf: Hyperliquid backfill failed (${(e as Error).message}) — Hyperliquid's own data is unchanged.`);
      }
    }

    // 2. Polymarket stand-in, only when the direct call failed and nothing is cached
    if (wantPolymarket) {
      try {
        const pm = await polymarketStandIn(ctx, key, address);
        requests += pm.requests;
        warnings.push(...pm.warnings);
        if (pm.truncated) warnings.push(`Surf: Polymarket activity stopped at ${(PM_MAX_PAGES * PM_PAGE).toLocaleString()} rows — older activity may be missing.`);
        polymarketBackup = true; // the stand-in ran; whether it found activity or not, it must not run again
        const fresh = pm.events.filter((e) => !direct.knownIds.has(e.id));
        if (fresh.length) {
          events.push(...fresh);
          openPositions.push(...pm.openPositions);
          parts.push(`Polymarket stand-in: ${fresh.length.toLocaleString()} events`);
        } else {
          parts.push("no Polymarket activity found");
        }
      } catch (e) {
        errors++;
        warnings.push(`Surf: Polymarket stand-in failed (${(e as Error).message}) — other results are unaffected.`);
      }
    }

    if (!parts.length && !errors) parts.push("nothing to backfill");

    return {
      events,
      openPositions,
      warnings,
      hyperliquid,
      polymarketBackup,
      report: {
        provider: "SurfDataProvider",
        protocol: SURF_PROTOCOL,
        status: events.length ? "ok" : errors ? "error" : "empty",
        eventCount: events.length,
        requests,
        fromCache: false,
        message: parts.join(" · "),
        limitations,
      },
    };
  },
};
