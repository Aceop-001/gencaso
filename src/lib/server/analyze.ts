import { dedupe } from "../engine/summary";
import type { FinancialEvent, FxTable, OpenPosition, ProviderReport, WalletDataset } from "../engine/schema";
import { fetchFxTable, FX_CURRENCIES } from "../fx/fx";
import { BulkDataProvider } from "../providers/bulk";
import { GMXDataProvider } from "../providers/gmx";
import { HertzFlowDataProvider } from "../providers/hertzflow";
import { HyperliquidDataProvider } from "../providers/hyperliquid";
import { MockDataProvider } from "../providers/mock";
import { OpenSeaDataProvider } from "../providers/opensea";
import { PolymarketDataProvider } from "../providers/polymarket";
import { SurfDataProvider, surfConfigured } from "../providers/surf";
import type { DataProvider, ProviderResult } from "../providers/types";
import { validateAddress } from "../validation";
import { meteredHttp } from "./http";

/**
 * Wallet analysis orchestrator. Fetches each supported provider once, caches
 * the normalized dataset, and on later requests only syncs incrementally.
 * Tax calculation is NOT done here — the client reruns tax modules locally on
 * the cached dataset, so switching country never triggers a fetch.
 */

const FRESH_MS = 10 * 60_000;
const INCREMENTAL: Record<string, boolean> = { hyperliquid: true, polymarket: false, mock: false };
const PROVIDERS: DataProvider[] = [MockDataProvider, HyperliquidDataProvider, PolymarketDataProvider, BulkDataProvider, HertzFlowDataProvider, GMXDataProvider, OpenSeaDataProvider];

/** Bump when the normalized event shape changes, so older cached events are refetched in full. */
const EVENT_SCHEMA = 3; // 2: txHash + market slug for source links; 3: NFT events

interface CacheEntry {
  schema?: number;
  at: number;
  perProvider: Map<string, { events: FinancialEvent[]; open: OpenPosition[]; warnings: string[]; report: ProviderReport }>;
  fx?: { from: number; to: number; table: FxTable };
  /** Surf bookkeeping: the Hyperliquid gap already walked (earliest direct fill it was walked for)
   *  and whether the Polymarket stand-in already ran, so neither is repeated for this address. */
  surf?: { hyperliquid?: number; polymarket?: boolean };
}
const g = globalThis as unknown as { __gencasoCache?: Map<string, CacheEntry> };
const cache = (g.__gencasoCache ??= new Map());

export async function analyzeWallet(input: string, opts: { refresh?: boolean } = {}): Promise<WalletDataset> {
  const check = validateAddress(input);
  if (!check.ok || !check.kind || !check.normalized) throw new UserError(check.error ?? "Invalid address");
  const address = check.normalized;
  const now = Date.now();
  const cached = cache.get(address);
  const entry: CacheEntry = cached?.schema === EVENT_SCHEMA ? cached : { schema: EVENT_SCHEMA, at: 0, perProvider: new Map() };
  const fresh = !opts.refresh && now - entry.at < FRESH_MS;

  const providers = PROVIDERS.filter((p) => p.supports(check.kind!));
  await Promise.all(
    providers.map(async (p) => {
      const prev = entry.perProvider.get(p.id);
      if (fresh && prev) {
        prev.report = { ...prev.report, fromCache: true, requests: 0 };
        return;
      }
      const since = prev && INCREMENTAL[p.id] && prev.events.length ? Math.max(...prev.events.map((e) => e.timestamp)) : undefined;
      let res: ProviderResult;
      try {
        res = await p.fetch(address, { http: meteredHttp, since, now });
      } catch (e) {
        const message = (e as Error).message;
        entry.perProvider.set(p.id, {
          events: prev?.events ?? [],
          open: prev?.open ?? [],
          warnings: [`${p.id}: data retrieval failed (${message})${prev ? " — showing previously cached data" : ""}.`],
          report: { provider: p.id, protocol: p.protocol, status: "error", eventCount: prev?.events.length ?? 0, requests: 0, fromCache: !!prev, message, limitations: [] },
        });
        return;
      }
      const merged = since !== undefined && prev ? [...prev.events, ...res.events] : res.events;
      const { events, duplicates } = dedupe(merged);
      // An incremental sync only sees new records, so keep earlier data-gap warnings (e.g. the fill limit)
      const kept = since !== undefined && prev ? prev.warnings.filter((w) => !/data retrieval failed|duplicate records removed/.test(w)) : [];
      const warnings = [...new Set([...kept, ...res.warnings])];
      if (duplicates && since === undefined) warnings.push(`${p.id}: ${duplicates} duplicate records removed.`);
      entry.perProvider.set(p.id, {
        events,
        open: res.openPositions,
        warnings,
        report: { ...res.report, eventCount: events.length, message: since !== undefined ? `Incremental sync: ${res.events.length - duplicates} new records` : res.report.message },
      });
    }),
  );

  // Surf (asksurf.ai) runs after the direct providers because it works from their results: it adds
  // Hyperliquid fills older than the direct API's 10,000-fill window, and stands in for Polymarket
  // only when that call failed. It never replaces direct data, and never fails the analysis.
  const surfPrev = entry.perProvider.get("surf");
  if (surfConfigured()) {
    const hl = entry.perProvider.get("hyperliquid");
    const pm = entry.perProvider.get("polymarket");
    const hlFills = (hl?.events ?? []).filter((e) => e.id.startsWith("hl-fill-"));
    const earliestFillMs = hlFills.length ? Math.min(...hlFills.map((e) => e.timestamp)) : 0;
    const truncated = (hl?.warnings ?? []).some((w) => w.includes("10,000-fill limit"));
    const pmFailed = pm?.report.status === "error";
    const wantHyperliquid = truncated && earliestFillMs > 0 && entry.surf?.hyperliquid !== earliestFillMs;
    const wantPolymarket = pmFailed && !(pm?.events.length) && !entry.surf?.polymarket;

    // A reachable direct Polymarket call replaces Surf's stand-in events (direct data always wins)
    if (surfPrev && !pmFailed && pm?.events.length) {
      const kept = surfPrev.events.filter((e) => e.protocol !== "polymarket");
      if (kept.length !== surfPrev.events.length) {
        surfPrev.events = kept;
        surfPrev.report = { ...surfPrev.report, eventCount: kept.length };
      }
      entry.surf = { ...entry.surf, polymarket: false };
    }

    // Nothing left to fetch: a fresh cache window, or both gaps already closed for this address
    if (surfPrev && (fresh || !(wantHyperliquid || wantPolymarket))) {
      surfPrev.report = { ...surfPrev.report, fromCache: true, requests: 0 };
    } else if (wantHyperliquid || wantPolymarket) {
      try {
        const res = await SurfDataProvider.fetch(
          address,
          { http: meteredHttp, now }, // Surf always fetches the missing range, so there is no `since`
          {
            hyperliquid: { earliestFillMs, truncated, events: hlFills },
            polymarket: { failed: pmFailed, events: pm?.events ?? [] },
            knownIds: new Set([...entry.perProvider.values()].flatMap((v) => v.events.map((e) => e.id))),
          },
        );
        const events = dedupe([...(surfPrev?.events ?? []), ...res.events]).events;
        entry.perProvider.set("surf", {
          events,
          open: [...(surfPrev?.open ?? []), ...res.openPositions],
          warnings: [...new Set([...(surfPrev?.warnings ?? []), ...res.warnings])],
          report: { ...res.report, eventCount: events.length },
        });
        if (wantHyperliquid && !res.skipped) entry.surf = { ...entry.surf, hyperliquid: earliestFillMs };
        if (res.polymarketBackup) entry.surf = { ...entry.surf, polymarket: true };

        // The direct provider's "trades before … are missing" warning now says what Surf recovered.
        if (res.hyperliquid && hl && res.hyperliquid.added > 0) {
          const from = new Date(res.hyperliquid.fromMs).toISOString().slice(0, 10);
          const added = res.hyperliquid.added.toLocaleString();
          const replacement = res.hyperliquid.complete
            ? `Hyperliquid's API only returns the 10,000 most recent fills. Surf added ${added} older fills, so this wallet's fill history is now complete back to ${from} (funding and transfers are complete).`
            : `Hyperliquid's API only returns the 10,000 most recent fills. Surf added ${added} older fills, so history now runs back to ${from}; trades before ${from} are still missing, so results for earlier tax years are incomplete (funding and transfers are complete).`;
          hl.warnings = hl.warnings.map((w) => (/trades before .+ are missing/.test(w) ? replacement : w));
        }
      } catch (e) {
        const message = (e as Error).message;
        entry.perProvider.set("surf", {
          events: surfPrev?.events ?? [],
          open: surfPrev?.open ?? [],
          warnings: [`surf: backfill failed (${message})${surfPrev ? " — showing previously cached Surf data" : ""}.`],
          report: { provider: "surf", protocol: "hyperliquid", status: "error", eventCount: surfPrev?.events.length ?? 0, requests: 0, fromCache: !!surfPrev, message, limitations: [] },
        });
      }
    }
  } else if (surfPrev) {
    // The key was removed between analyses: keep the cached Surf events, make no requests.
    surfPrev.report = { ...surfPrev.report, fromCache: true, requests: 0 };
  }

  if (!fresh) entry.at = now;

  const all = dedupe([...entry.perProvider.values()].flatMap((v) => v.events)).events;
  const dataWarnings = [...entry.perProvider.values()].flatMap((v) => v.warnings);

  // FX: one request for the full range, reused while the range is covered.
  let fx: FxTable = { source: "none", rates: {}, missing: [] };
  if (all.length) {
    const from = all[0].timestamp;
    const to = Math.min(now, all[all.length - 1].timestamp);
    // Reuse cached rates only if they cover the range and every supported currency (the list can grow)
    // (a refetch is cheap: ECB is one request and CDN days are cached for good)
    const covers = (t: FxTable) => FX_CURRENCIES.every((c) => t.rates[c]);
    if (entry.fx && entry.fx.from <= from && entry.fx.to >= to && covers(entry.fx.table)) fx = entry.fx.table;
    else {
      try {
        fx = await fetchFxTable(meteredHttp, from, to, all.map((e) => e.timestamp));
        entry.fx = { from, to, table: fx };
      } catch (e) {
        fx = { source: "unavailable", rates: {}, missing: [...FX_CURRENCIES] };
        dataWarnings.push(`Historical FX rates unavailable (${(e as Error).message}) — local-currency tax cannot be computed.`);
      }
    }
  }
  cache.set(address, entry);

  return {
    address,
    isDemo: check.kind === "demo",
    fetchedAt: entry.at,
    events: all,
    providers: [...entry.perProvider.values()].map((v) => v.report),
    dataWarnings,
    openPositions: [...entry.perProvider.values()].flatMap((v) => v.open),
    fx,
  };
}

export class UserError extends Error {}
