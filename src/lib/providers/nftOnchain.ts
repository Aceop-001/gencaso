import type { OsSale } from "./opensea";
import type { ProviderHttp } from "./types";

/**
 * On-chain backup for NFT trades, used when OpenSea's API is unavailable (no key, key service busy,
 * outage). Reads Blockscout's public API (no key) and rebuilds each trade from what actually moved in
 * the transaction:
 *
 *   1. `GET /api/v2/addresses/{addr}/token-transfers?type=ERC-721,ERC-1155` → the wallet's NFT moves.
 *   2. `GET /api/v2/addresses/{addr}/internal-transactions` → every ETH leg of the wallet (one paged
 *      read; the per-transaction endpoint takes 25 s+ on marketplace transactions, which would lose
 *      the whole run).
 *   3. For each transaction: `GET /api/v2/transactions/{hash}` (value, sender, ERC-20 transfers).
 *   4. The wallet's net payment in that transaction (ETH + WETH + Blur Pool ETH, or a stablecoin) is the
 *      price: NFT out + money in = sale; NFT in + money out = purchase (mints included).
 *
 * The price is the wallet's net cash flow, so marketplace fees and royalties paid by the seller are
 * already deducted (more precise than OpenSea's gross price). Gas is not included. Transfers with no
 * payment (gifts, airdrops, moves between your own wallets) are not trades and are skipped. Mixed
 * transactions (NFTs both in and out, or two currencies) are skipped and counted, never guessed.
 *
 * Output uses OpenSea's sale shape and chain names, so the same pricing, cost basis and event IDs apply.
 *
 * One unreadable transaction (a huge marketplace transaction can time out) never loses the rest: it is
 * counted and skipped. A whole run gets a wall-clock budget so the analysis still answers in time on
 * slow hosts, and what it could not read is reported instead of silently dropped.
 */

/** Blockscout instances that answer anonymous API requests. Base, Arbitrum and Polygon need a User-Agent. */
export const ONCHAIN_CHAINS: { chain: string; host: string }[] = [
  { chain: "ethereum", host: "https://eth.blockscout.com" },
  { chain: "optimism", host: "https://optimism.blockscout.com" },
  { chain: "base", host: "https://base.blockscout.com" },
  { chain: "arbitrum", host: "https://arbitrum.blockscout.com" },
  { chain: "polygon", host: "https://polygon.blockscout.com" },
];

/** Base, Arbitrum and Polygon refuse anonymous requests without one (HTTP 403). */
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; Gencaso/1.0)" };

const MAX_LIST_PAGES = 20; // 50 transfers per page
const MAX_TXS = 150; // per chain; 2–3 requests each
const MAX_INTERNAL_PAGES = 10; // 50 ETH legs per page, newest first
const MAX_REQUESTS_PER_CHAIN = 70; // keeps one busy chain from eating the whole budget
const MAX_REQUESTS = 250; // safety net for the whole run
/** The analysis has to answer inside the host's request timeout (60 s on the hosted preview). */
const BUDGET_MS = 28_000;
const ETH_LIKE = new Set(["WETH", "BETH"]); // BETH = Blur Pool, 1:1 ETH
const STABLES = new Set(["USDC", "USDT", "DAI", "USDC.E"]);
const DUST = 1e-9;

interface BsAddr { hash: string }
interface BsTransfer {
  transaction_hash: string;
  timestamp: string;
  from: BsAddr;
  to: BsAddr | null;
  token: { address_hash: string; symbol?: string | null; name?: string | null; type: string; decimals?: string | null };
  total?: { token_id?: string | null; value?: string | null; decimals?: string | null } | null;
}
interface BsPage<T> { items: T[]; next_page_params: Record<string, string | number> | null }
interface BsTx {
  hash: string;
  status: string | null;
  timestamp: string;
  value: string;
  from: BsAddr;
  to: BsAddr | null;
  token_transfers: BsTransfer[] | null;
  token_transfers_overflow: boolean | null;
}
interface BsInternal { transaction_hash: string; from: BsAddr; to: BsAddr | null; value: string; success?: boolean | null; error?: string | null }

export interface OnchainResult {
  sales: OsSale[];
  requests: number;
  chainsChecked: string[];
  skipped: { mixed: number; unpaid: number; capped: number; failed: number };
  failedChains: string[];
}

export interface OnchainOptions {
  /** Wall-clock budget for the whole run (tests pass a small one). */
  budgetMs?: number;
  now?: () => number;
}

const lc = (s?: string | null) => (s ?? "").toLowerCase();
const qs = (p: Record<string, string | number>) => Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
const wei = (v?: string | null) => Number(v ?? 0) / 1e18;

/**
 * Net amount the wallet received (+) or paid (−) per currency in one transaction.
 *
 * Smart-account wallets (EIP-7702 / 4337) often forward every incoming payment to a vault in the same
 * transaction. An outflow of exactly the amount just received, in the same currency, is that forward,
 * the wallet moving its own money, so it is not counted as a payment.
 */
export function netPayments(me: string, tx: BsTx, internals: BsInternal[], tokenTransfers: BsTransfer[]): { eth: number; stable: number; stableSymbol?: string; forwarded: number } {
  const flows: { currency: string; raw: string; amount: number; sign: 1 | -1 }[] = [];
  // Top-level value: only counts if this wallet is the sender or the recipient of the call itself
  if (tx.status !== "error" && tx.value && tx.value !== "0") {
    if (lc(tx.from.hash) === me) flows.push({ currency: "ETH", raw: tx.value, amount: wei(tx.value), sign: -1 });
    if (lc(tx.to?.hash) === me) flows.push({ currency: "ETH", raw: tx.value, amount: wei(tx.value), sign: 1 });
  }
  for (const i of internals) {
    if (i.success === false || i.error || !i.value || i.value === "0") continue;
    if (lc(i.to?.hash) === me) flows.push({ currency: "ETH", raw: i.value, amount: wei(i.value), sign: 1 });
    if (lc(i.from.hash) === me) flows.push({ currency: "ETH", raw: i.value, amount: wei(i.value), sign: -1 });
  }
  for (const t of tokenTransfers) {
    if (t.token.type !== "ERC-20") continue;
    const sym = (t.token.symbol ?? "").toUpperCase();
    if (!ETH_LIKE.has(sym) && !STABLES.has(sym)) continue;
    const raw = t.total?.value ?? "0";
    const dec = Number(t.total?.decimals ?? t.token.decimals ?? 18);
    const amount = Number(raw) / 10 ** dec;
    if (lc(t.to?.hash) === me) flows.push({ currency: sym, raw, amount, sign: 1 });
    if (lc(t.from.hash) === me) flows.push({ currency: sym, raw, amount, sign: -1 });
  }

  // Drop forwards: each outflow that exactly matches an unused inflow of the same currency
  const unusedIn = flows.filter((f) => f.sign === 1);
  let forwarded = 0;
  const counted = flows.filter((f) => {
    if (f.sign === 1) return true;
    const k = unusedIn.findIndex((i) => i.currency === f.currency && i.raw === f.raw);
    if (k < 0) return true;
    unusedIn.splice(k, 1);
    forwarded++;
    return false;
  });

  let eth = 0;
  let stable = 0;
  let stableSymbol: string | undefined;
  for (const f of counted) {
    if (f.currency === "ETH" || ETH_LIKE.has(f.currency)) eth += f.sign * f.amount;
    else {
      stable += f.sign * f.amount;
      stableSymbol = f.currency === "USDC.E" ? "USDC" : f.currency;
    }
  }
  return { eth, stable, stableSymbol, forwarded };
}

/** Turn one transaction's NFT moves + payments into OpenSea-shaped sale records (or nothing). */
export function tradesFromTx(me: string, chain: string, tx: BsTx, nftMoves: BsTransfer[], pay: ReturnType<typeof netPayments>): { sales: OsSale[]; skip?: "mixed" | "unpaid" } {
  const incoming = nftMoves.filter((t) => lc(t.to?.hash) === me && lc(t.from.hash) !== me);
  const outgoing = nftMoves.filter((t) => lc(t.from.hash) === me && lc(t.to?.hash) !== me);
  if (tx.status === "error" || (!incoming.length && !outgoing.length)) return { sales: [] };
  if (incoming.length && outgoing.length) return { sales: [], skip: "mixed" };

  const hasEth = Math.abs(pay.eth) > DUST;
  const hasStable = Math.abs(pay.stable) > 1e-6;
  if (hasEth && hasStable) return { sales: [], skip: "mixed" };
  const amount = hasEth ? pay.eth : pay.stable;
  const selling = outgoing.length > 0;
  // A sale must bring money in; a purchase (or paid mint) must send money out
  if (!(hasEth || hasStable) || (selling ? amount <= 0 : amount >= 0)) return { sales: [], skip: "unpaid" };

  const moves = selling ? outgoing : incoming;
  const units = moves.map((m) => Math.max(1, m.token.type === "ERC-1155" ? Number(m.total?.value ?? 1) : 1));
  const totalUnits = units.reduce((a, b) => a + b, 0);
  const symbol = hasEth ? "ETH" : pay.stableSymbol ?? "USDC";
  const decimals = hasEth ? 18 : 6;
  const ts = Math.floor(Date.parse(tx.timestamp) / 1000);
  const sales = moves.map((m, k): OsSale => {
    // Several NFTs in one transaction: the payment is split by units (noted on the event)
    const share = (Math.abs(amount) * units[k]) / totalUnits;
    const other = selling ? m.to?.hash ?? "" : m.from.hash;
    return {
      event_type: "sale",
      event_timestamp: ts,
      transaction: tx.hash,
      chain,
      seller: selling ? me : lc(other),
      buyer: selling ? lc(other) : me,
      quantity: units[k],
      payment: { quantity: String(Math.round(share * 10 ** decimals)), token_address: "", decimals, symbol },
      nft: { identifier: m.total?.token_id ?? "0", collection: m.token.symbol || m.token.name || "NFT", contract: lc(m.token.address_hash), name: m.token.name ? `${m.token.name} #${m.total?.token_id ?? ""}` : null },
    };
  });
  return { sales };
}

async function listAll<T>(http: ProviderHttp, url: string, maxPages: number, counter: { n: number }, stop?: () => boolean): Promise<{ items: T[]; capped: boolean }> {
  const items: T[] = [];
  let next: Record<string, string | number> | null = null;
  for (let i = 0; i < maxPages; i++) {
    if (stop?.()) return { items, capped: true };
    const page: BsPage<T> = await http.getJson<BsPage<T>>("blockscout", next ? `${url}${url.includes("?") ? "&" : "?"}${qs(next)}` : url, HEADERS);
    counter.n++;
    items.push(...(page.items ?? []));
    next = page.next_page_params;
    if (!next) return { items, capped: false };
  }
  return { items, capped: true };
}

/** NFT trades of `address` rebuilt from on-chain data on every supported chain. */
export async function fetchOnchainNftSales(http: ProviderHttp, address: string, opts: OnchainOptions = {}): Promise<OnchainResult> {
  const me = lc(address);
  const counter = { n: 0 };
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? BUDGET_MS);
  const outOfBudget = () => now() > deadline || counter.n >= MAX_REQUESTS;
  const result: OnchainResult = { sales: [], requests: 0, chainsChecked: [], skipped: { mixed: 0, unpaid: 0, capped: 0, failed: 0 }, failedChains: [] };

  // Chains run in parallel: each has its own host, and the whole run shares one budget.
  await Promise.all(
    ONCHAIN_CHAINS.map(async ({ chain, host }) => {
      const started = counter.n;
      const stop = () => outOfBudget() || counter.n - started >= MAX_REQUESTS_PER_CHAIN;
      try {
        const { items: moves, capped } = await listAll<BsTransfer>(http, `${host}/api/v2/addresses/${address}/token-transfers?type=ERC-721%2CERC-1155`, MAX_LIST_PAGES, counter, stop);
        result.chainsChecked.push(chain);
        if (capped) result.skipped.capped++;
        const byTx = new Map<string, BsTransfer[]>();
        for (const m of moves) byTx.set(m.transaction_hash, [...(byTx.get(m.transaction_hash) ?? []), m]);
        const hashes = [...byTx.keys()];
        if (hashes.length > MAX_TXS) result.skipped.capped += hashes.length - MAX_TXS;
        // All ETH legs of the wallet in one paged read, indexed by transaction.
        const internals = await listAll<BsInternal>(http, `${host}/api/v2/addresses/${address}/internal-transactions`, MAX_INTERNAL_PAGES, counter, stop);
        if (internals.capped) result.skipped.capped++;
        const internalsByTx = new Map<string, BsInternal[]>();
        for (const i of internals.items) internalsByTx.set(i.transaction_hash, [...(internalsByTx.get(i.transaction_hash) ?? []), i]);
        for (const hash of hashes.slice(0, MAX_TXS)) {
          if (stop()) {
            result.skipped.capped++;
            continue;
          }
          try {
            const tx = await http.getJson<BsTx>("blockscout", `${host}/api/v2/transactions/${hash}`, HEADERS);
            counter.n++;
            let tokenTransfers = tx.token_transfers ?? [];
            if (tx.token_transfers_overflow) {
              tokenTransfers = (await listAll<BsTransfer>(http, `${host}/api/v2/transactions/${hash}/token-transfers`, 5, counter, stop)).items;
            }
            const pay = netPayments(me, tx, internalsByTx.get(hash) ?? [], tokenTransfers);
            const r = tradesFromTx(me, chain, tx, byTx.get(hash)!, pay);
            result.sales.push(...r.sales);
            if (r.skip) result.skipped[r.skip]++;
          } catch {
            // One unreadable transaction (slow marketplace transaction, transient error) is counted,
            // never fatal: the chain's other trades are still rebuilt.
            result.skipped.failed++;
          }
        }
      } catch {
        result.failedChains.push(chain);
      }
    }),
  );

  result.requests = counter.n;
  return result;
}
