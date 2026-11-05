import type { FxTable } from "../engine/schema";
import type { ProviderHttp } from "../providers/types";

/**
 * Historical fiat conversion.
 *  - ECB reference rates via the free Frankfurter API (https://frankfurter.dev): one request per
 *    analysis covers every ECB currency for the whole date range; results are cached by the caller.
 *  - Currencies the ECB does not publish (PKR, LKR, VND, NGN, AED, RUB, UAH): daily snapshots from fawazahmed0's
 *    currency-api on the jsDelivr CDN (data from March 2024). One request per day, so only days
 *    with activity are fetched — at most one per 6 days — and every day is cached for good.
 * Conversion uses the most recent rate on or before the event date (≤ 10 days back).
 */

export const ECB_CURRENCIES = ["INR", "GBP", "EUR", "AUD", "JPY", "KRW", "CNY", "IDR", "MYR", "PHP", "ZAR", "TRY", "SGD"] as const;
export const CDN_CURRENCIES = ["PKR", "LKR", "VND", "NGN", "AED", "RUB", "UAH"] as const;
export const FX_CURRENCIES = [...ECB_CURRENCIES, ...CDN_CURRENCIES];
export const FX_SOURCE = "European Central Bank reference rates via Frankfurter API; PKR/LKR/VND/NGN/AED/RUB/UAH via fawazahmed0 currency-api";

const CDN_FIRST_DAY = "2024-03-02";
const CDN_SPACING_DAYS = 6; // with the 10-day lookback in rateOn, every event still finds a rate
const CDN_MAX_REQUESTS = 150;
// Full USD table per day (all currencies), so adding a currency later never needs a refetch
const cdnCache = ((globalThis as unknown as { __gencasoCdnDay?: Map<string, Record<string, number>> }).__gencasoCdnDay ??= new Map());

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Days to fetch so every event day has a snapshot at most CDN_SPACING_DAYS earlier. */
function cdnDays(eventTimes: number[], toMs: number): string[] {
  const days = [...new Set([...eventTimes, toMs].map(day))].filter((d) => d >= CDN_FIRST_DAY).sort();
  let spacing = CDN_SPACING_DAYS;
  for (;;) {
    const picked: string[] = [];
    for (const d of days) if (!picked.length || Date.parse(d) - Date.parse(picked[picked.length - 1]) > spacing * 86_400_000) picked.push(d);
    if (picked.length <= CDN_MAX_REQUESTS || spacing >= 9) return picked.slice(-CDN_MAX_REQUESTS);
    spacing++;
  }
}

async function fetchCdnDay(http: ProviderHttp, d: string): Promise<Record<string, number> | null> {
  let usd = cdnCache.get(d);
  if (!usd) {
    const urls = [`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies/usd.json`, `https://${d}.currency-api.pages.dev/v1/currencies/usd.json`];
    for (const url of urls) {
      try {
        usd = (await http.getJson<{ date: string; usd: Record<string, number> }>("fx-cdn", url)).usd;
        cdnCache.set(d, usd);
        break;
      } catch {
        // try the mirror
      }
    }
  }
  if (!usd) return null; // not cached: may succeed next time
  const row: Record<string, number> = {};
  for (const c of CDN_CURRENCIES) if (usd[c.toLowerCase()]) row[c] = usd[c.toLowerCase()];
  return row;
}

export async function fetchFxTable(http: ProviderHttp, fromMs: number, toMs: number, eventTimes: number[] = []): Promise<FxTable> {
  // Pad the start by 10 days so the first event always has a prior business-day rate.
  const from = new Date(fromMs - 10 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(toMs).toISOString().slice(0, 10);
  const url = `https://api.frankfurter.dev/v1/${from}..${to}?base=USD&symbols=${ECB_CURRENCIES.join(",")}`;
  // The public endpoint occasionally returns a transient 522/timeout; retry once.
  let res: { rates: Record<string, Record<string, number>> };
  try {
    res = await http.getJson("fx", url);
  } catch {
    res = await http.getJson("fx", url);
  }
  const rates: FxTable["rates"] = {};
  for (const [date, row] of Object.entries(res.rates)) {
    for (const [cur, v] of Object.entries(row)) (rates[cur] ??= {})[date] = v;
  }

  // Non-ECB currencies, a few days in parallel
  const days = cdnDays(eventTimes, toMs);
  for (let i = 0; i < days.length; i += 6) {
    const batch = days.slice(i, i + 6);
    const rows = await Promise.all(batch.map((d) => fetchCdnDay(http, d)));
    batch.forEach((d, k) => {
      for (const [cur, v] of Object.entries(rows[k] ?? {})) (rates[cur] ??= {})[d] = v;
    });
  }
  return { source: FX_SOURCE, rates, missing: FX_CURRENCIES.filter((c) => !rates[c]) };
}

/** Units of `currency` per 1 USD on (or most recently before) the given date. */
export function rateOn(fx: FxTable, currency: string, ms: number): { rate: number; date: string } | null {
  if (currency === "USD") return { rate: 1, date: new Date(ms).toISOString().slice(0, 10) };
  const table = fx.rates[currency];
  if (!table) return null;
  const target = new Date(ms).toISOString().slice(0, 10);
  if (table[target]) return { rate: table[target], date: target };
  let best: string | null = null;
  for (const d of Object.keys(table)) if (d <= target && (!best || d > best)) best = d;
  if (!best) return null;
  // Do not reach back further than 10 days — treat as missing instead.
  if (Date.parse(target) - Date.parse(best) > 10 * 86_400_000) return null;
  return { rate: table[best], date: best };
}
