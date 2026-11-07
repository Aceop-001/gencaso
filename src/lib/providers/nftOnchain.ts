import type { OsSale } from "./opensea";
import type { ProviderHttp } from "./types";

/**
 * On-chain backup for NFT trades, used when OpenSea's API is unavailable (no key, key service busy,
 * outage). Reads Blockscout's public API (no key) and rebuilds each trade from what actually moved in
 * the transaction:
 *
 *   1. `GET /api/v2/addresses/{addr}/token-transfers?type=ERC-721,ERC-1155` → the wallet's NFT moves.
 *   2. Three more wallet-wide lists, each read only back to the oldest NFT move:
 *      `token-transfers?type=ERC-20` (WETH, Blur Pool, stablecoins), `internal-transactions` (ETH paid
 *      out by marketplace contracts) and `transactions` (value the wallet sent or received itself).
 *   3. The wallet's net payment in each NFT transaction (native coin + WETH/BETH, or a stablecoin) is the
 *      price: NFT out + money in = sale; NFT in + money out = purchase (mints included).
 *
 * Bulk lists only: no request is ever made per transaction, so a huge marketplace transaction can't time
 * out, and airdropped spam NFTs cost nothing. NFT transactions older than what the payment lists reached
 * are counted and reported, never guessed.
 *
 * The price is the wallet's net cash flow, so marketplace fees and royalties paid by the seller are
 * already deducted (more precise than OpenSea's gross price). Gas is not included. Transfers with no
 * payment (gifts, airdrops, moves between your own wallets) are not trades and are skipped. Mixed
 * transactions (NFTs both in and out, or two currencies) are skipped and counted, never guessed.
 *
 * Output uses OpenSea's sale shape and chain names, so the same pricing, cost basis and event IDs apply.
 *
 * Each chain runs in parallel with its own pacing, inside one wall-clock budget, so the analysis still
 * answers in time on slow hosts; what it could not read is reported instead of silently dropped.
 */

/** Blockscout instances that answer anonymous API requests (Base, Arbitrum and Polygon need a User-Agent),
 *  with each chain's native coin: Polygon's is POL, the others' is ETH. */
export const ONCHAIN_CHAINS: { chain: string; host: string; native: "ETH" | "POL" }[] = [
  { chain: "ethereum", host: "https://eth.blockscout.com", native: "ETH" },
  { chain: "optimism", host: "https://optimism.blockscout.com", native: "ETH" },
  { chain: "base", host: "https://base.blockscout.com", native: "ETH" },
  { chain: "arbitrum", host: "https://arbitrum.blockscout.com", native: "ETH" },
  { chain: "polygon", host: "https://polygon.blockscout.com", native: "POL" },
];

/** Base, Arbitrum and Polygon refuse anonymous requests without one (HTTP 403). */
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; Gencaso/1.0)" };

const MAX_NFT_PAGES = 20; // 50 NFT moves per page, newest first
const MAX_PAYMENT_PAGES = 30; // per payment list; read only back to the oldest NFT move
const MAX_REQUESTS = 400; // safety net for the whole run
/** The analysis has to answer inside the host's request timeout (60 s on the hosted preview). */
const BUDGET_MS = 28_000;
const ETH_LIKE = new Set(["WETH", "BETH"]); // BETH = Blur Pool, 1:1 ETH
const POL_LIKE = new Set(["WPOL", "WMATIC"]);
const STABLES = new Set(["USDC", "USDT", "DAI", "USDC.E"]);
const DUST = 1e-9;

/**
 * Liquidity-position NFTs (Uniswap V3 "UNI-V3-POS", PancakeSwap "PCS-V3-POS", Aerodrome "AERO-CL-POS", …)
 * are receipts for DeFi deposits: minting one while paying ETH into a pool is not an NFT purchase, and
 * withdrawing is not a sale. They are excluded so deposits never show up as NFT trades.
 */
export const isPositionNft = (token: { symbol?: string | null; name?: string | null }) =>
  /-POS$/i.test(token.symbol ?? "") || /positions? nft|liquidity position/i.test(token.name ?? "");

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
interface BsInternal { transaction_hash: string; timestamp?: string; from: BsAddr; to: BsAddr | null; value: string; success?: boolean | null; error?: string | null }
/** A transaction from the wallet-wide `transactions` list (the wallet sent it or was its direct recipient). */
interface BsWalletTx { hash: string; timestamp: string; status: string | null; value: string; from: BsAddr; to: BsAddr | null }

export interface OnchainResult {
  sales: OsSale[];
  requests: number;
  chainsChecked: string[];
  skipped: { mixed: number; unpaid: number; capped: number; failed: number; positions: number };
  failedChains: string[];
}

export interface OnchainOptions {
  /** Wall-clock budget for the whole run (tests pass a small one). */
  budgetMs?: number;
  now?: () => number;
  /** Page cap per payment list (tests pass a small one). */
  maxPaymentPages?: number;
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
export function netPayments(me: string, tx: BsTx, internals: BsInternal[], tokenTransfers: BsTransfer[], native: "ETH" | "POL" = "ETH"): { eth: number; pol: number; stable: number; stableSymbol?: string; forwarded: number } {
  const flows: { currency: string; raw: string; amount: number; sign: 1 | -1 }[] = [];
  // Top-level value: only counts if this wallet is the sender or the recipient of the call itself
  if (tx.status !== "error" && tx.value && tx.value !== "0") {
    if (lc(tx.from.hash) === me) flows.push({ currency: native, raw: tx.value, amount: wei(tx.value), sign: -1 });
    if (lc(tx.to?.hash) === me) flows.push({ currency: native, raw: tx.value, amount: wei(tx.value), sign: 1 });
  }
  for (const i of internals) {
    if (i.success === false || i.error || !i.value || i.value === "0") continue;
    if (lc(i.to?.hash) === me) flows.push({ currency: native, raw: i.value, amount: wei(i.value), sign: 1 });
    if (lc(i.from.hash) === me) flows.push({ currency: native, raw: i.value, amount: wei(i.value), sign: -1 });
  }
  for (const t of tokenTransfers) {
    if (t.token.type !== "ERC-20") continue;
    const sym = (t.token.symbol ?? "").toUpperCase();
    if (!ETH_LIKE.has(sym) && !POL_LIKE.has(sym) && !STABLES.has(sym)) continue;
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
  let pol = 0;
  let stable = 0;
  let stableSymbol: string | undefined;
  for (const f of counted) {
    if (f.currency === "ETH" || ETH_LIKE.has(f.currency)) eth += f.sign * f.amount;
    else if (f.currency === "POL" || POL_LIKE.has(f.currency)) pol += f.sign * f.amount;
    else {
      stable += f.sign * f.amount;
      stableSymbol = f.currency === "USDC.E" ? "USDC" : f.currency;
    }
  }
  return { eth, pol, stable, stableSymbol, forwarded };
}

/** Turn one transaction's NFT moves + payments into OpenSea-shaped sale records (or nothing). */
export function tradesFromTx(me: string, chain: string, tx: BsTx, nftMoves: BsTransfer[], pay: ReturnType<typeof netPayments>): { sales: OsSale[]; skip?: "mixed" | "unpaid" } {
  const incoming = nftMoves.filter((t) => lc(t.to?.hash) === me && lc(t.from.hash) !== me);
  const outgoing = nftMoves.filter((t) => lc(t.from.hash) === me && lc(t.to?.hash) !== me);
  if (tx.status === "error" || (!incoming.length && !outgoing.length)) return { sales: [] };
  if (incoming.length && outgoing.length) return { sales: [], skip: "mixed" };

  const legs = [
    { symbol: "ETH", amount: pay.eth, decimals: 18, dust: DUST },
    { symbol: "POL", amount: pay.pol ?? 0, decimals: 18, dust: DUST },
    { symbol: pay.stableSymbol ?? "USDC", amount: pay.stable, decimals: 6, dust: 1e-6 },
  ].filter((l) => Math.abs(l.amount) > l.dust);
  if (legs.length > 1) return { sales: [], skip: "mixed" };
  const selling = outgoing.length > 0;
  // A sale must bring money in; a purchase (or paid mint) must send money out
  if (!legs.length || (selling ? legs[0].amount <= 0 : legs[0].amount >= 0)) return { sales: [], skip: "unpaid" };
  const { amount, symbol, decimals } = legs[0];

  const moves = selling ? outgoing : incoming;
  const units = moves.map((m) => Math.max(1, m.token.type === "ERC-1155" ? Number(m.total?.value ?? 1) : 1));
  const totalUnits = units.reduce((a, b) => a + b, 0);
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

const tsOf = (item: { timestamp?: string }) => (item.timestamp ? Date.parse(item.timestamp) : NaN);

/**
 * Pages of a newest-first list. Stops at the end of the list, when `until` is reached (the page's oldest
 * item is older than it), at the page cap, or when the budget runs out.
 * `complete` = everything back to `until` (or the whole list) was read.
 */
async function listPages<T extends { timestamp?: string }>(
  http: ProviderHttp,
  provider: string,
  url: string,
  maxPages: number,
  counter: { n: number },
  stop: () => boolean,
  until?: number,
): Promise<{ items: T[]; complete: boolean; oldest: number }> {
  const items: T[] = [];
  let next: Record<string, string | number> | null = null;
  let oldest = Infinity;
  for (let i = 0; i < maxPages; i++) {
    if (stop()) return { items, complete: false, oldest };
    const page: BsPage<T> = await http.getJson<BsPage<T>>(provider, next ? `${url}${url.includes("?") ? "&" : "?"}${qs(next)}` : url, HEADERS);
    counter.n++;
    for (const it of page.items ?? []) {
      items.push(it);
      const t = tsOf(it);
      if (t < oldest) oldest = t;
    }
    next = page.next_page_params;
    if (!next) return { items, complete: true, oldest };
    if (until !== undefined && oldest < until) return { items, complete: true, oldest };
  }
  return { items, complete: false, oldest };
}

const groupBy = <T extends { transaction_hash: string }>(items: T[]) => {
  const m = new Map<string, T[]>();
  for (const it of items) m.set(it.transaction_hash, [...(m.get(it.transaction_hash) ?? []), it]);
  return m;
};

/** NFT trades of `address` rebuilt from on-chain data on every supported chain. */
export async function fetchOnchainNftSales(http: ProviderHttp, address: string, opts: OnchainOptions = {}): Promise<OnchainResult> {
  const me = lc(address);
  const counter = { n: 0 };
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? BUDGET_MS);
  const stop = () => now() > deadline || counter.n >= MAX_REQUESTS;
  const maxPaymentPages = opts.maxPaymentPages ?? MAX_PAYMENT_PAGES;
  const result: OnchainResult = { sales: [], requests: 0, chainsChecked: [], skipped: { mixed: 0, unpaid: 0, capped: 0, failed: 0, positions: 0 }, failedChains: [] };

  // Chains run in parallel, each paced on its own (separate hosts), inside one shared budget.
  await Promise.all(
    ONCHAIN_CHAINS.map(async ({ chain, host, native }) => {
      const provider = `blockscout-${chain}`;
      const base = `${host}/api/v2/addresses/${address}`;
      type Skipped = OnchainResult["skipped"];
      /** One attempt at a chain. Collects into its own result, merged only if the whole attempt succeeds. */
      const readChain = async (): Promise<{ sales: OsSale[]; skipped: Skipped; checked: boolean }> => {
        const sales: OsSale[] = [];
        const skipped: Skipped = { mixed: 0, unpaid: 0, capped: 0, failed: 0, positions: 0 };
        const nfts = await listPages<BsTransfer>(http, provider, `${base}/token-transfers?type=ERC-721%2CERC-1155`, MAX_NFT_PAGES, counter, stop);
        skipped.positions = new Set(nfts.items.filter((m) => isPositionNft(m.token)).map((m) => m.transaction_hash)).size;
        const moves = nfts.items.filter((m) => !isPositionNft(m.token));
        if (!nfts.complete) skipped.capped++; // older NFT moves exist beyond what was read
        if (!moves.length) return { sales, skipped, checked: nfts.complete };
        const byTx = groupBy(moves);
        const oldestNft = nfts.oldest;

        // Wallet-wide payment lists, each read only back to the oldest NFT move
        const erc20 = await listPages<BsTransfer>(http, provider, `${base}/token-transfers?type=ERC-20`, maxPaymentPages, counter, stop, oldestNft);
        const internals = await listPages<BsInternal>(http, provider, `${base}/internal-transactions`, maxPaymentPages, counter, stop, oldestNft);
        const own = await listPages<BsWalletTx>(http, provider, `${base}/transactions`, maxPaymentPages, counter, stop, oldestNft);

        // Payment data is only trusted back to where every list reached
        const cutoff = Math.max(...[erc20, internals, own].map((l) => (l.complete ? -Infinity : l.oldest)));
        const erc20ByTx = groupBy(erc20.items);
        const internalsByTx = groupBy(internals.items);
        const ownByHash = new Map(own.items.map((t) => [t.hash, t]));

        for (const [hash, txMoves] of byTx) {
          if (tsOf(txMoves[0]) < cutoff) {
            skipped.capped++;
            continue;
          }
          const mine = ownByHash.get(hash);
          const tx: BsTx = {
            hash,
            status: mine?.status ?? "ok", // NFT transfer logs only exist in successful transactions
            timestamp: txMoves[0].timestamp,
            value: mine?.value ?? "0",
            from: mine?.from ?? { hash: "" },
            to: mine?.to ?? null,
            token_transfers: erc20ByTx.get(hash) ?? [],
            token_transfers_overflow: false,
          };
          const pay = netPayments(me, tx, internalsByTx.get(hash) ?? [], tx.token_transfers ?? [], native);
          const r = tradesFromTx(me, chain, tx, txMoves, pay);
          sales.push(...r.sales);
          if (r.skip) skipped[r.skip]++;
        }
        return { sales, skipped, checked: true };
      };

      // An explorer hiccup (timeout, 5xx after retries) gets one more try before the chain is reported
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await readChain();
          result.sales.push(...r.sales);
          for (const k of Object.keys(r.skipped) as (keyof Skipped)[]) result.skipped[k] += r.skipped[k];
          if (r.checked) result.chainsChecked.push(chain);
          return;
        } catch {
          if (stop()) break;
        }
      }
      result.failedChains.push(chain);
    }),
  );

  result.requests = counter.n;
  return result;
}
