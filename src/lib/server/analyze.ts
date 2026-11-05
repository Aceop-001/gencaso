import { dedupe } from "../engine/summary";
import type { FinancialEvent, FxTable, OpenPosition, ProviderReport, WalletDataset } from "../engine/schema";
import { fetchFxTable, FX_CURRENCIES } from "../fx/fx";
import { BulkDataProvider } from "../providers/bulk";
import { HertzFlowDataProvider } from "../providers/hertzflow";
import { HyperliquidDataProvider } from "../providers/hyperliquid";
import { MockDataProvider } from "../providers/mock";
import { OpenSeaDataProvider } from "../providers/opensea";
import { PolymarketDataProvider } from "../providers/polymarket";
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
const PROVIDERS: DataProvider[] = [MockDataProvider, HyperliquidDataProvider, PolymarketDataProvider, BulkDataProvider, HertzFlowDataProvider, OpenSeaDataProvider];

/** Bump when the normalized event shape changes, so older cached events are refetched in full. */
const EVENT_SCHEMA = 3; // 2: txHash + market slug for source links; 3: NFT events

interface CacheEntry {
  schema?: number;
  at: number;
  perProvider: Map<string, { events: FinancialEvent[]; open: OpenPosition[]; warnings: string[]; report: ProviderReport }>;
  fx?: { from: number; to: number; table: FxTable };
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
