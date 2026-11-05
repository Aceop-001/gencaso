import { round } from "../engine/positions";
import { CLOSING_TYPES, type FinancialEvent } from "../engine/schema";
import { rateOn } from "../fx/fx";
import type { CountryCode, Reference, TaxInput, TaxLine, TaxResult, TaxYear } from "./types";

/** A progressive bracket: income up to `upTo` (exclusive of previous) taxed at `rate`. */
export type Bracket = { upTo: number; rate: number };

export function progressiveTax(income: number, brackets: Bracket[]): number {
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (income <= prev) break;
    tax += (Math.min(income, b.upTo) - prev) * b.rate;
    prev = b.upTo;
  }
  return tax;
}

/** Tax attributable to `extra` income on top of `base` income under a schedule. */
export function incrementalTax(base: number, extra: number, schedule: (x: number) => number): number {
  return schedule(Math.max(0, base + extra)) - schedule(Math.max(0, base));
}

export const money = (n: number) => round(n, 2);

/** Per-event local-currency amounts, split by component. Events lacking an FX rate are reported. */
export interface LocalEvent {
  e: FinancialEvent;
  rate: number;
  realized: number;
  fee: number;
  funding: number;
  reward: number;
}

export function localize(input: TaxInput, currency: string): { rows: LocalEvent[]; missing: string[] } {
  const rows: LocalEvent[] = [];
  let noRate = 0;
  for (const e of input.events) {
    if (e.timestamp < input.taxYear.start || e.timestamp >= input.taxYear.end) continue;
    if (e.type === "DEPOSIT" || e.type === "WITHDRAWAL" || e.type === "TRANSFER") continue;
    const r = rateOn(input.fx, currency, e.timestamp);
    if (!r) {
      noRate++;
      continue;
    }
    rows.push({
      e,
      rate: r.rate,
      realized: e.realizedPnlUsd * r.rate,
      fee: e.feeUsd * r.rate,
      funding: e.fundingUsd * r.rate,
      reward: e.type === "REWARD" ? (e.amountUsd ?? 0) * r.rate : 0,
    });
  }
  const missing: string[] = [];
  if (noRate) missing.push(`${noRate} event(s) had no ${currency} exchange rate for their date and were excluded.`);
  return { rows, missing };
}

export function inYearCount(input: TaxInput) {
  return input.events.filter((e) => e.timestamp >= input.taxYear.start && e.timestamp < input.taxYear.end).length;
}

/** USD conversion of the final tax: rate at tax-year end, or the latest available before it. */
export function finalUsd(input: TaxInput, currency: string, taxLocal: number): Pick<TaxResult, "usdRate" | "taxUsd"> {
  const at = Math.min(input.taxYear.end - 1, Date.now());
  const r = rateOn(input.fx, currency, at) ?? latestRate(input, currency);
  return { usdRate: r, taxUsd: r ? money(taxLocal / r.rate) : null };
}

function latestRate(input: TaxInput, currency: string) {
  const t = input.fx.rates[currency];
  if (!t) return null;
  const dates = Object.keys(t).sort();
  const d = dates[dates.length - 1];
  return d ? { rate: t[d], date: d } : null;
}

export function sum<T>(rows: T[], f: (r: T) => number) {
  return rows.reduce((a, r) => a + f(r), 0);
}

export const isPerp = (r: LocalEvent) => r.e.category === "perp";
export const isPm = (r: LocalEvent) => r.e.category === "prediction";
export const isNft = (r: LocalEvent) => r.e.category === "nft";

const YEAR_MS = 365.25 * 86_400_000;

/** NFT sales in local currency: net result, split by holding period, plus gains-only for no-loss-offset regimes. */
export function nftResults(rows: LocalEvent[], longAfterMs = YEAR_MS) {
  const sells = rows.filter((r) => isNft(r) && r.e.type === "NFT_SELL");
  const held = (r: LocalEvent) => (r.e.openedAt !== undefined ? r.e.timestamp - r.e.openedAt : 0);
  const long = sells.filter((r) => held(r) > longAfterMs);
  return {
    count: sells.length,
    net: sum(sells, (r) => r.realized),
    long: sum(long, (r) => r.realized),
    short: sum(sells.filter((r) => held(r) <= longAfterMs), (r) => r.realized),
    longCount: long.length,
    /** Sum of profitable sales only — for regimes where NFT losses cannot offset gains */
    gainsOnly: sum(sells, (r) => Math.max(0, r.realized)),
    /** Gross sale value (all priced sales) — the base for turnover taxes */
    proceeds: sum(sells, (r) => Math.abs(r.e.exitValueUsd ?? 0) * r.rate),
    noBasis: sells.filter((r) => r.e.verification === "missing").length,
  };
}

/** Shared NFT caveats, added by modules that include NFT results. */
export function nftUncertainties(n: ReturnType<typeof nftResults>): string[] {
  if (!n.count) return [];
  const out = ["NFT gains use the gross sale price: marketplace fees and royalties paid on the sale would reduce the gain but are not in OpenSea's data."];
  if (n.noBasis) out.push(`${n.noBasis} NFT sale(s) have no known purchase price (minted or transferred in) and are left out; their gain is taxable once you add the cost.`);
  return out;
}

/** Per-market net results for prediction markets (local currency). */
export function marketResults(rows: LocalEvent[]): Array<{ key: string; name: string; net: number }> {
  const m = new Map<string, { name: string; net: number }>();
  for (const r of rows.filter(isPm)) {
    const key = `${r.e.protocol}:${r.e.market?.id ?? r.e.asset}`;
    const cur = m.get(key) ?? { name: r.e.market?.name ?? r.e.asset, net: 0 };
    cur.net += r.realized - r.fee;
    m.set(key, cur);
  }
  return [...m.entries()].map(([key, v]) => ({ key, ...v }));
}

export function utcYear(id: string, label: string, y: number, m: number, d: number): TaxYear {
  return { id, label, start: Date.UTC(y, m, d), end: Date.UTC(y + 1, m, d) };
}

export const COMMON_UNCERTAINTIES = [
  "Estimates only — not professional tax advice. Confirm with a qualified tax adviser before filing.",
  "USDC is assumed to equal 1 USD; stablecoin depegs are not adjusted for.",
];

/** Calendar-year tax year (1 Jan – 31 Dec). */
export function calendarYear(ms: number): TaxYear {
  const y = new Date(ms).getUTCFullYear();
  return { id: String(y), label: `${y} (1 Jan – 31 Dec)`, start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) };
}

/** Tax year starting on `month` (0-based) / `day`; `name(startYear)` gives its id. */
export function fiscalYear(ms: number, month: number, day: number, name: (startYear: number) => string): TaxYear {
  const d = new Date(ms);
  const afterStart = d.getUTCMonth() > month || (d.getUTCMonth() === month && d.getUTCDate() >= day);
  const y = afterStart ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const start = Date.UTC(y, month, day);
  const end = Date.UTC(y + 1, month, day);
  const fmt = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return { id: name(y), label: `${name(y)} (${fmt(start)} – ${fmt(end - 86_400_000)})`, start, end };
}

/** Bracket table given as [upper limit, rate] pairs (last limit Infinity). */
export const bands = (pairs: Array<[number, number]>): Bracket[] => pairs.map(([upTo, rate]) => ({ upTo, rate }));

/** Proceeds of a disposal (closing perp fill, prediction sell/redemption) in local currency: the base for turnover taxes. */
export function disposalValue(r: LocalEvent): number {
  if (!CLOSING_TYPES.has(r.e.type) || r.e.type === "PM_SETTLE_LOSS") return 0;
  return Math.abs(r.e.exitValueUsd ?? r.e.quantity * (r.e.price ?? 0)) * r.rate;
}

/** The figures most modules start from, in local currency. */
export function basics(input: TaxInput, currency: string) {
  const { rows, missing } = localize(input, currency);
  const markets = marketResults(rows);
  return {
    rows,
    missing,
    /** Perps: realized + funding − fees */
    perpNet: sum(rows.filter(isPerp), (r) => r.realized + r.funding - r.fee),
    rewards: sum(rows, (r) => r.reward),
    markets,
    pmNet: sum(markets, (m) => m.net),
    pmWins: sum(markets.filter((m) => m.net > 0), (m) => m.net),
    /** NFT sales (gain vs. purchase price) */
    nft: nftResults(rows),
    other: Math.max(0, input.profile.otherIncomeLocal),
    business: input.profile.traderType === "business",
  };
}

export const money0 = (n: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

/** Assemble a TaxResult with the shared fields filled in. */
export function buildResult(
  input: TaxInput,
  o: {
    country: CountryCode;
    version: string;
    rulesEffective: string;
    currency: string;
    rows: LocalEvent[];
    taxLocal: number;
    taxableLocal: number;
    lines: TaxLine[];
    methodology: string[];
    assumptions: string[];
    uncertainties: string[];
    missing: string[];
    reporting: string[];
    references: Reference[];
    carry?: number;
    unsupportedYear?: string;
    provisional?: string;
  },
): TaxResult {
  const taxLocal = money(Math.max(0, o.taxLocal));
  return {
    country: o.country,
    moduleVersion: o.version,
    rulesEffective: o.rulesEffective,
    taxYear: input.taxYear,
    currency: o.currency,
    ...finalUsd(input, o.currency, taxLocal),
    taxLocal,
    taxableLocal: money(Math.max(0, o.taxableLocal)),
    netTradingLocal: money(sum(o.rows, (r) => r.realized + r.funding - r.fee + r.reward)),
    lines: o.lines,
    methodology: o.methodology,
    assumptions: o.assumptions,
    // NFT caveats apply wherever NFT sales are in the year; Set drops ones a module already added
    uncertainties: [...new Set([...COMMON_UNCERTAINTIES, ...o.uncertainties, ...nftUncertainties(nftResults(o.rows))])],
    missing: o.unsupportedYear ? [...o.missing, `No verified parameters for ${o.unsupportedYear}; the nearest supported year's values were applied.`] : o.missing,
    reporting: o.reporting,
    references: o.references,
    carryForwardLossLocal: money(Math.max(0, o.carry ?? 0)),
    eventsInYear: inYearCount(input),
    unsupportedYear: o.unsupportedYear,
    provisional: o.provisional,
  };
}

/** Parameters for the requested year, else the nearest supported year (flagged as unsupported). */
export function yearParams<P>(table: Record<string, P>, id: string): { p: P; unsupported?: string } {
  if (id in table) return { p: table[id] };
  const keys = Object.keys(table).sort();
  const nearest = keys.filter((k) => k <= id).pop() ?? keys[0];
  return { p: table[nearest], unsupported: id };
}
