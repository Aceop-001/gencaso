import { round } from "../engine/positions";
import type { FinancialEvent } from "../engine/schema";
import { isAuthError, openSeaKey, rejectOpenSeaKey, type OpenSeaKey } from "../server/openseaKey";
import { fetchOnchainNftSales, ONCHAIN_CHAINS } from "./nftOnchain";
import type { DataProvider, ProviderHttp, ProviderResult } from "./types";

/**
 * OpenSeaDataProvider — NFT sales of a wallet, read-only, from the OpenSea API v2:
 * `GET https://api.opensea.io/api/v2/events/accounts/{address}?event_type=sale&limit=200&next=`
 * → `{ asset_events, next }`, newest first, across every chain OpenSea indexes. Needs an API key
 * (`x-api-key`), read server-side from OPENSEA_API_KEY and never sent to the browser.
 *
 * OpenSea's sale events include sales it indexes from other marketplaces (e.g. Blur, paid in BETH).
 * Payment is in crypto (ETH, WETH, BETH, ...), so each sale is valued in USD at that token's
 * Coinbase daily close (public candles, no key) for the UTC day of the sale.
 *
 * Cost basis is specific identification: each NFT (chain + contract + token id) carries the price it
 * was bought for; ERC-1155 units of the same token are averaged. Sales of NFTs with no purchase in
 * this history (minted, transferred in, or bought before it) have no known cost and are flagged.
 * Proceeds are the gross sale price: marketplace fees and creator royalties are not in the event
 * data, so gains are slightly overstated.
 */

const API = "https://api.opensea.io/api/v2/events/accounts";
const CANDLES = "https://api.exchange.coinbase.com/products";
const HL_INFO = "https://api.hyperliquid.xyz/info";
/** Priced from Hyperliquid's own daily candles (USDC-quoted): Coinbase has no HYPE candles for 2025 */
const HL_PRICED = new Set(["HYPE"]);
const PAGE = 200;
const MAX_PAGES = 50;
const DAY = 86_400_000;

export interface OsSale {
  event_type: string;
  closing_date?: number;
  event_timestamp: number;
  transaction?: string;
  chain: string;
  seller: string;
  buyer: string;
  quantity: number;
  payment?: { quantity: string; token_address: string; decimals: number; symbol: string } | null;
  nft?: { identifier: string; collection: string; contract: string; name?: string | null; opensea_url?: string } | null;
}

/** Coinbase USD product for a payment token; wrapped / marketplace-pool tokens track their base coin. */
const PRODUCT: Record<string, string> = {
  ETH: "ETH", WETH: "ETH", BETH: "ETH",
  POL: "POL", WPOL: "POL", MATIC: "POL", WMATIC: "POL",
  RON: "RONIN", WRON: "RONIN",
  APE: "APE", WAPE: "APE",
  SOL: "SOL", WSOL: "SOL",
  AVAX: "AVAX", WAVAX: "AVAX",
  BNB: "BNB", WBNB: "BNB",
  FLOW: "FLOW",
  HYPE: "HYPE", WHYPE: "HYPE",
};
const STABLE = new Set(["USDC", "USDC.E", "USDT", "DAI", "USDB"]);

export const productFor = (symbol?: string) => (symbol ? PRODUCT[symbol.toUpperCase()] : undefined);

/** Coinbase daily closes by UTC day, `product -> YYYY-MM-DD -> close`. */
export type DailyCloses = Record<string, Record<string, number>>;

/** Hyperliquid daily closes (USDC = 1 USD), one request for the whole range. */
export async function fetchHyperliquidCloses(http: ProviderHttp, coin: string, days: string[]): Promise<{ closes: Record<string, number>; requests: number }> {
  const sorted = [...new Set(days)].sort();
  const rows = await http.postJson<Array<{ t: number; c: string }>>("hyperliquid", HL_INFO, {
    type: "candleSnapshot",
    req: { coin, interval: "1d", startTime: Date.parse(sorted[0]), endTime: Date.parse(sorted[sorted.length - 1]) + DAY },
  });
  const closes: Record<string, number> = {};
  for (const r of rows) closes[new Date(r.t).toISOString().slice(0, 10)] = Number(r.c);
  return { closes, requests: 1 };
}

export async function fetchDailyCloses(http: ProviderHttp, product: string, days: string[]): Promise<{ closes: Record<string, number>; requests: number }> {
  const closes: Record<string, number> = {};
  let requests = 0;
  const sorted = [...new Set(days)].sort();
  let i = 0;
  while (i < sorted.length) {
    // One request covers up to 300 days; skip ahead to the next uncovered day
    const start = Date.parse(sorted[i]);
    const end = start + 299 * DAY;
    const url = `${CANDLES}/${product}-USD/candles?granularity=86400&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`;
    const rows = await http.getJson<Array<[number, number, number, number, number, number]>>("coinbase", url);
    requests++;
    for (const [t, , , , close] of rows) closes[new Date(t * 1000).toISOString().slice(0, 10)] = close;
    while (i < sorted.length && Date.parse(sorted[i]) <= end) i++;
  }
  return { closes, requests };
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const timeOf = (s: OsSale) => (s.closing_date ?? s.event_timestamp) * 1000;
const tokenAmount = (p: NonNullable<OsSale["payment"]>) => Number(p.quantity) / 10 ** p.decimals;

/** USD value of a sale's payment, or null when the token or its price for that day is unknown. */
export function paymentUsd(s: OsSale, prices: DailyCloses): number | null {
  if (!s.payment) return null;
  const sym = s.payment.symbol?.toUpperCase();
  if (STABLE.has(sym)) return tokenAmount(s.payment);
  const product = productFor(sym);
  const close = product && (prices[product]?.[dayOf(timeOf(s))] ?? (product === "POL" ? prices.MATIC?.[dayOf(timeOf(s))] : undefined));
  return close ? tokenAmount(s.payment) * close : null;
}

/** Rebuild buys and sells (with specific-identification cost basis) from a wallet's sale events. */
/** "a, b and c" — chain lists read the same way wherever they are shown. */
const chainList = (chains: string[]) => (chains.length > 1 ? `${chains.slice(0, -1).join(", ")} and ${chains[chains.length - 1]}` : (chains[0] ?? ""));

/** Where the sale records came from: OpenSea's API (gross prices) or the on-chain backup (net cash flows). */
export type SaleOrigin = "opensea" | "onchain";

export function normalizeOsSales(sales: OsSale[], account: string, prices: DailyCloses, origin: SaleOrigin = "opensea"): { events: FinancialEvent[]; noBasis: { count: number; proceedsUsd: number }; unpriced: number } {
  const me = account.toLowerCase();
  const pools = new Map<string, { qty: number; cost: number; costKnown: boolean; since: number }>();
  const events: FinancialEvent[] = [];
  const noBasis = { count: 0, proceedsUsd: 0 };
  let unpriced = 0;

  const ordered = [...sales].filter((s) => s.nft && s.event_type === "sale").sort((a, b) => timeOf(a) - timeOf(b));
  for (const s of ordered) {
    const buying = s.buyer?.toLowerCase() === me;
    const selling = s.seller?.toLowerCase() === me;
    if (buying === selling) continue; // not this wallet's trade, or a self-trade
    const nft = s.nft!;
    const key = `${s.chain}:${nft.contract.toLowerCase()}:${nft.identifier}`;
    const qty = Math.max(1, s.quantity || 1);
    const usd = paymentUsd(s, prices);
    if (usd === null) unpriced++;
    const ts = timeOf(s);
    const sym = s.payment?.symbol ?? "unknown token";
    const paid = s.payment ? `${round(tokenAmount(s.payment), 6)} ${sym}` : "no payment data";
    const base = {
      id: `os-${s.chain}-${s.transaction ?? ts}-${nft.contract.toLowerCase()}-${nft.identifier}-${buying ? "b" : "s"}`,
      protocol: "opensea" as const,
      chain: s.chain,
      account: me,
      timestamp: ts,
      category: "nft" as const,
      asset: nft.collection,
      market: { id: key, name: nft.name || `${nft.collection} #${nft.identifier}`, slug: nft.opensea_url?.replace(/^https:\/\/opensea\.io\//, "") },
      quantity: qty,
      price: usd === null ? undefined : round(usd / qty, 6),
      fundingUsd: 0,
      feeUsd: 0,
      fiat: { currency: "USD" as const, source: STABLE.has(sym.toUpperCase()) ? `${sym} assumed = 1 USD` : HL_PRICED.has(productFor(sym) ?? "") ? `${sym} at Hyperliquid daily close (USDC)` : `${sym} at Coinbase ${productFor(sym) ?? "?"}-USD daily close` },
      source: origin === "onchain" ? `On-chain (Blockscout · ${s.chain}), OpenSea backup` : "OpenSea API v2 · events/accounts (sale)",
      txHash: s.transaction,
    };

    const pool = pools.get(key) ?? { qty: 0, cost: 0, costKnown: true, since: ts };
    if (buying) {
      if (!pool.qty) Object.assign(pool, { cost: 0, costKnown: true, since: ts });
      pool.qty += qty;
      pool.cost += usd ?? 0;
      pool.costKnown &&= usd !== null;
      pools.set(key, pool);
      events.push({ ...base, type: "NFT_BUY", realizedPnlUsd: 0, verification: usd === null ? "missing" : "verified", confidence: 0.97, notes: `Bought for ${paid}${usd === null ? " — no USD price for this token/date" : ""}` });
      continue;
    }

    // Sell: cost of the units this wallet bought in this history; the rest has no known basis
    const covered = Math.min(qty, pool.qty);
    const cost = covered && pool.qty ? (pool.cost * covered) / pool.qty : 0;
    const basisKnown = covered === qty && pool.costKnown;
    if (covered) {
      pool.cost -= cost;
      pool.qty -= covered;
    }
    pools.set(key, pool);
    const proceedsCovered = usd === null ? 0 : (usd * covered) / qty;
    if (!basisKnown) {
      noBasis.count++;
      noBasis.proceedsUsd += usd ?? 0;
    }
    events.push({
      ...base,
      type: "NFT_SELL",
      entryValueUsd: round(cost, 6),
      exitValueUsd: usd === null ? undefined : round(usd, 6),
      realizedPnlUsd: basisKnown && usd !== null ? round(proceedsCovered - cost, 6) : 0,
      openedAt: covered ? pool.since : undefined,
      verification: basisKnown && usd !== null ? "estimated" : "missing",
      confidence: 0.9,
      notes: [
        origin === "onchain" ? `Received ${paid} (net of marketplace fee and royalty, from on-chain transfers)` : `Sold for ${paid} (gross — marketplace fee and royalty not included)`,
        !basisKnown ? `no purchase in ${origin === "onchain" ? "this on-chain" : "OpenSea"} history (minted free, transferred in, or bought earlier): gain not counted` : "",
        usd === null ? "no USD price for this token/date" : "",
      ].filter(Boolean).join(" · "),
    });
  }
  return { events, noBasis, unpriced };
}

const NO_KEY_ERROR =
  "opensea: OpenSea needs an API key and a free one couldn't be created right now (its key service is busy). Set OPENSEA_API_KEY on the server; Gencaso tries again in 15 minutes.";

/** All sale events from OpenSea's API. Throws when OpenSea can't be read (no key, refused, outage). */
async function fetchOpenSeaSales(address: string, ctx: { http: ProviderHttp; now: number }, first: OpenSeaKey): Promise<{ sales: OsSale[]; truncated: boolean; requests: number; key: OpenSeaKey }> {
  let key = first;
  let requests = 0;
  const sales: OsSale[] = [];
  let next: string | null = null;
  let truncated = true;
  let renewed = false;
  const headers = (): Record<string, string> => (key.key ? { "x-api-key": key.key, accept: "application/json" } : { accept: "application/json" });
  for (let i = 0; i < MAX_PAGES; i++) {
    const url: string = `${API}/${address}?event_type=sale&limit=${PAGE}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    let res: { asset_events: OsSale[]; next?: string | null };
    try {
      res = await ctx.http.getJson("opensea", url, headers());
    } catch (e) {
      // OpenSea requires a key (since Nov 2026). Without one there is nothing to retry with.
      if (isAuthError(e) && key.source === "keyless") throw new Error(NO_KEY_ERROR);
      if (!isAuthError(e) || renewed) throw e;
      // Expired or revoked key: switch to (or renew) the automatic free key once, then retry this page
      rejectOpenSeaKey(key);
      const fresh = await openSeaKey(ctx.http, ctx.now);
      if (!fresh) throw e;
      if (fresh.source === "keyless") throw new Error(NO_KEY_ERROR);
      key = fresh;
      renewed = true;
      requests += 1 + (fresh.minted ? 1 : 0);
      res = await ctx.http.getJson("opensea", url, headers());
    }
    requests++;
    sales.push(...(res.asset_events ?? []));
    next = res.next ?? null;
    if (!next || !res.asset_events?.length) {
      truncated = false;
      break;
    }
  }
  return { sales, truncated, requests, key };
}

const LIMITS_OPENSEA = [
  "Gains = gross sale price − purchase price; marketplace fees and royalties are not in OpenSea's event data, so gains are slightly overstated",
  "Crypto payments valued at the daily close (UTC) of the sale date: Coinbase, or Hyperliquid for HYPE",
  "NFTs minted or transferred in have no purchase price here; their sales are flagged, not taxed",
];
const LIMITS_ONCHAIN = [
  "Backup source: NFT trades rebuilt from on-chain transfers (Blockscout) because OpenSea's API was unavailable",
  `Covers ${chainList(ONCHAIN_CHAINS.map((c) => c.chain))} only; NFT trades on other chains are missing until OpenSea is back`,
  "Prices are the wallet's net payment in each transaction, so marketplace fees and royalties are already deducted; gas is not included",
  "Several NFTs in one transaction share its payment by units; mixed swaps and unpaid transfers are skipped, not guessed",
  "Liquidity-position NFTs (Uniswap V3 and similar) are DeFi deposits, not NFT trades, and are excluded",
];

export const OpenSeaDataProvider: DataProvider = {
  id: "opensea",
  protocol: "opensea",
  supports: (kind) => kind === "evm",
  async fetch(address, ctx): Promise<ProviderResult> {
    const first = await openSeaKey(ctx.http, ctx.now);
    let requests = first?.minted || first?.mintFailed ? 1 : 0;
    const warnings: string[] = [];
    let sales: OsSale[] = [];
    let truncated = false;
    let key: OpenSeaKey | null = first;
    let origin: SaleOrigin = "opensea";
    let openSeaError: string | undefined;
    let backupNote = "";

    // 1. OpenSea's API
    if (first) {
      try {
        const r = await fetchOpenSeaSales(address, ctx, first);
        sales = r.sales;
        truncated = r.truncated;
        key = r.key;
        requests += r.requests;
      } catch (e) {
        openSeaError = (e as Error).message.replace(/^opensea: /, "");
      }
    } else openSeaError = "no OPENSEA_API_KEY is set and automatic free keys are off.";

    // 2. Backup: rebuild the trades from on-chain data
    if (openSeaError !== undefined) {
      const oc = await fetchOnchainNftSales(ctx.http, address);
      requests += oc.requests;
      if (!oc.chainsChecked.length) throw new Error(`opensea: ${openSeaError} The on-chain backup (Blockscout) is unavailable too.`);
      sales = oc.sales;
      origin = "onchain";
      // OpenSea being down is not the user's problem when the backup worked: one calm note, details in the source report
      const read = chainList(ONCHAIN_CHAINS.map((c) => c.chain).filter((c) => oc.chainsChecked.includes(c)));
      warnings.push(`NFT trades come from on-chain data (${read}) because OpenSea's API isn't available right now. NFTs on other chains (e.g. HyperEVM) aren't included.`);
      if (oc.failedChains.length) warnings.push(`On-chain NFT data for ${chainList(oc.failedChains)} couldn't be read this time; run the analysis again to include it.`);
      if (oc.skipped.mixed) warnings.push(`On-chain NFT backup: ${oc.skipped.mixed} transaction(s) mixed several NFTs or currencies and were skipped rather than guessed.`);
      if (oc.skipped.capped) warnings.push(`On-chain NFT backup: ${oc.skipped.capped} older NFT transaction(s) are beyond what the backup reads and aren't included.`);
      backupNote = `OpenSea: ${openSeaError}`;
    }

    // Price every payment token on the days it was used
    const need = new Map<string, string[]>();
    for (const s of sales) {
      const p = productFor(s.payment?.symbol);
      if (!p) continue;
      const days = need.get(p) ?? [];
      days.push(dayOf(timeOf(s)));
      need.set(p, days);
    }
    if (need.has("POL")) need.set("MATIC", need.get("POL")!); // POL replaced MATIC in Sept 2024
    const prices: DailyCloses = {};
    for (const [product, days] of need) {
      try {
        const r = HL_PRICED.has(product) ? await fetchHyperliquidCloses(ctx.http, product, days) : await fetchDailyCloses(ctx.http, product, days);
        prices[product] = r.closes;
        requests += r.requests;
      } catch (e) {
        if (product !== "MATIC") warnings.push(`OpenSea: ${product}-USD prices unavailable (${(e as Error).message}) — those sales have no USD value.`);
      }
    }

    const { events, noBasis, unpriced } = normalizeOsSales(sales, address, prices, origin);
    if (truncated) warnings.push(`OpenSea history stopped at ${(MAX_PAGES * PAGE).toLocaleString()} sales — older trades may be missing.`);
    if (noBasis.count)
      warnings.push(`${origin === "onchain" ? "NFTs" : "OpenSea"}: ${noBasis.count} NFT sale(s) (≈$${noBasis.proceedsUsd.toFixed(2)} proceeds) have no purchase in this history (minted, transferred in, or bought earlier). Their gain is not counted — add the cost manually.`);
    if (unpriced) warnings.push(`OpenSea: ${unpriced} sale(s) were paid in a token with no USD price for that date; they are excluded from P&L.`);

    return {
      events,
      openPositions: [],
      warnings,
      report: {
        provider: "OpenSeaDataProvider",
        protocol: "opensea",
        status: events.length ? "ok" : "empty",
        eventCount: events.length,
        requests,
        fromCache: false,
        message: [
          origin === "onchain" ? `Backup: NFT trades rebuilt from on-chain data (${chainList(ONCHAIN_CHAINS.map((c) => c.chain))}). ${backupNote}` : "",
          events.length ? "" : origin === "onchain" ? "No paid NFT trades found on-chain for this address." : "No NFT sales for this address on OpenSea.",
          origin === "opensea" && key?.source === "auto" ? `Using a free OpenSea key, renewed automatically (current one expires ${new Date(key.expiresAt!).toISOString().slice(0, 10)}).` : "",
        ].filter(Boolean).join(" ") || undefined,
        limitations: origin === "onchain" ? LIMITS_ONCHAIN : LIMITS_OPENSEA,
      },
    };
  },
};
