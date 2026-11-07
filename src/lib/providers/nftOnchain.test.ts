import { describe, expect, it } from "vitest";
import { fetchOnchainNftSales, netPayments, tradesFromTx } from "./nftOnchain";

/**
 * Fixtures mirror real Ethereum transactions of 0xd6c0…d5e8 (checked against OpenSea on 2026-11-05:
 * 14 of 14 trades matched; sales ~1% below OpenSea's gross price = the marketplace fee actually paid).
 */
const ME = "0xd6c045df17c7b8938746d72923a6c7696ea4d5e8";
const BUYER = "0xa88571efecbf8ac8470f4ff58026eb7e6a509229";
const VAULT = "0x000100abc0000000000000000000000000000000";
const FEE = "0x0000a26b00000000000000000000000000000000";
const SEAPORT = "0x0000000000000068f116a894984e2db1123eb395";
const PPG = "0xbd3531da5cf5857e7cfaa92426877b022e612cf8";
const eth = (n: number) => String(BigInt(Math.round(n * 1e6)) * BigInt(1e12));

const tx = (o: Partial<Parameters<typeof tradesFromTx>[2]> = {}) => ({
  hash: "0xabc",
  status: "ok",
  timestamp: "2026-11-02T19:28:59.000000Z",
  value: "0",
  from: { hash: "0xbundler" },
  to: { hash: SEAPORT },
  token_transfers: null,
  token_transfers_overflow: false,
  ...o,
});
const nft = (from: string, to: string, id = "8738", type = "ERC-721", value?: string) => ({
  transaction_hash: "0xabc",
  timestamp: "2026-11-02T19:28:59.000000Z",
  from: { hash: from },
  to: { hash: to },
  token: { address_hash: PPG, symbol: "PPG", name: "PudgyPenguins", type },
  total: { token_id: id, value: value ?? null },
});
const erc20 = (sym: string, from: string, to: string, amount: number, decimals = 18) => ({
  transaction_hash: "0xabc",
  timestamp: "2026-11-02T19:28:59.000000Z",
  from: { hash: from },
  to: { hash: to },
  token: { address_hash: "0xtoken", symbol: sym, type: "ERC-20", decimals: String(decimals) },
  total: { value: decimals === 18 ? eth(amount) : String(Math.round(amount * 10 ** decimals)), decimals: String(decimals) },
});
const internal = (from: string, to: string, amount: number, hash = "0xabc") => ({ transaction_hash: hash, from: { hash: from }, to: { hash: to }, value: eth(amount), success: true });
const qty = (p: { quantity: string; decimals: number }) => Number(p.quantity) / 10 ** p.decimals;

describe("on-chain NFT backup", () => {
  it("accepted WETH offer: proceeds are net of the 1% marketplace fee", () => {
    const moves = [nft(ME, BUYER)];
    const pay = netPayments(ME, tx(), [], [erc20("WETH", BUYER, ME, 2.2), erc20("WETH", ME, FEE, 0.022)]);
    const r = tradesFromTx(ME, "ethereum", tx(), moves, pay);
    expect(r.sales).toHaveLength(1);
    expect(r.sales[0].seller).toBe(ME);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(2.178, 6);
    expect(r.sales[0].payment!.symbol).toBe("ETH");
    expect(r.sales[0].transaction).toBe("0xabc");
  });

  it("smart wallet that forwards ETH to its vault: the forward is not a payment", () => {
    // Real MAYC #1251 pattern: received 1.0395 ETH, forwarded exactly 1.0395 ETH to its vault
    const moves = [nft(ME, BUYER, "1251")];
    const pay = netPayments(ME, tx({ value: eth(1.05), from: { hash: BUYER } }), [internal(SEAPORT, FEE, 0.0105), internal(SEAPORT, ME, 1.0395), internal(ME, VAULT, 1.0395)], []);
    expect(pay.forwarded).toBe(1);
    const r = tradesFromTx(ME, "ethereum", tx(), moves, pay);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(1.0395, 6);
  });

  it("purchase paid in ETH from the wallet itself, with a refund", () => {
    const moves = [nft("0xseller", ME)];
    const t = tx({ from: { hash: ME }, value: eth(2.5) });
    const pay = netPayments(ME, t, [internal(SEAPORT, ME, 0.01)], []);
    const r = tradesFromTx(ME, "ethereum", t, moves, pay);
    expect(r.sales[0].buyer).toBe(ME);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(2.49, 6);
  });

  it("Blur purchase paid in BETH counts as ETH", () => {
    const moves = [nft("0xseller", ME)];
    const pay = netPayments(ME, tx(), [], [erc20("BETH", ME, "0xseller", 5.777)]);
    const r = tradesFromTx(ME, "ethereum", tx(), moves, pay);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(5.777, 6);
  });

  it("paid mint becomes a purchase (a cost basis OpenSea's feed doesn't have)", () => {
    const moves = [nft("0x0000000000000000000000000000000000000000", ME, "77")];
    const t = tx({ from: { hash: ME }, value: eth(0.08) });
    const r = tradesFromTx(ME, "ethereum", t, moves, netPayments(ME, t, [], []));
    expect(r.sales[0].buyer).toBe(ME);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(0.08, 6);
  });

  it("stablecoin sale keeps its currency", () => {
    const moves = [nft(ME, BUYER)];
    const pay = netPayments(ME, tx(), [], [erc20("USDC", BUYER, ME, 1500, 6)]);
    const r = tradesFromTx(ME, "ethereum", tx(), moves, pay);
    expect(r.sales[0].payment!.symbol).toBe("USDC");
    expect(qty(r.sales[0].payment!)).toBeCloseTo(1500, 6);
  });

  it("two NFTs sold in one transaction share the payment", () => {
    const moves = [nft(ME, BUYER, "1"), nft(ME, BUYER, "2")];
    const pay = netPayments(ME, tx(), [internal(SEAPORT, ME, 3)], []);
    const r = tradesFromTx(ME, "ethereum", tx(), moves, pay);
    expect(r.sales.map((s) => qty(s.payment!))).toEqual([1.5, 1.5]);
  });

  it("gifts and moves without payment are not trades", () => {
    const r = tradesFromTx(ME, "ethereum", tx(), [nft(ME, "0xfriend")], netPayments(ME, tx(), [], []));
    expect(r).toEqual({ sales: [], skip: "unpaid" });
  });

  it("NFT-for-NFT swaps and two-currency payments are skipped, never guessed", () => {
    expect(tradesFromTx(ME, "ethereum", tx(), [nft(ME, BUYER, "1"), nft(BUYER, ME, "2")], netPayments(ME, tx(), [internal(SEAPORT, ME, 1)], [])).skip).toBe("mixed");
    const two = netPayments(ME, tx(), [internal(SEAPORT, ME, 1)], [erc20("USDC", BUYER, ME, 100, 6)]);
    expect(tradesFromTx(ME, "ethereum", tx(), [nft(ME, BUYER)], two).skip).toBe("mixed");
  });

  it("failed transactions are ignored", () => {
    const t = tx({ status: "error" });
    expect(tradesFromTx(ME, "ethereum", t, [nft(ME, BUYER)], netPayments(ME, t, [internal(SEAPORT, ME, 1)], [])).sales).toEqual([]);
  });
});

describe("on-chain backup: bulk reads", () => {
  const T = (iso: string) => `${iso}T12:00:00.000000Z`;
  const page = (items: unknown[], more = false) => ({ items, next_page_params: more ? { page: 2 } : null });
  const move = (hash: string, ts = T("2026-11-02"), from = ME, to = BUYER, token: Record<string, string> = {}) => ({
    ...nft(from, to),
    transaction_hash: hash,
    timestamp: ts,
    token: { address_hash: PPG, symbol: "PPG", name: "PudgyPenguins", type: "ERC-721", ...token },
  });
  const weth = (hash: string, from: string, to: string, amount: number, ts = T("2026-11-02")) => ({ ...erc20("WETH", from, to, amount), transaction_hash: hash, timestamp: ts });
  const leg = (hash: string, from: string, to: string, amount: number, ts = T("2026-11-02")) => ({ ...internal(from, to, amount, hash), timestamp: ts });

  /** Fake Blockscout: routes by chain host and list name; anything per-transaction is a test failure. */
  function fake(routes: Record<string, unknown>, log: string[] = []) {
    return {
      getJson: async (p: string, url: string, h?: Record<string, string>) => {
        log.push(`${p} ${url}`);
        if (!h?.["User-Agent"]) throw new Error("missing User-Agent");
        if (/\/api\/v2\/transactions\//.test(url)) throw new Error(`per-transaction request: ${url}`);
        for (const [k, v] of Object.entries(routes)) if (url.includes(k)) {
          if (v === "fail") throw new Error("blockscout: network error (timeout)");
          return typeof v === "function" ? (v as () => unknown)() : v;
        }
        return page([]); // every other list is empty
      },
      postJson: async () => { throw new Error("not used"); },
    } as never;
  }
  const NFTS = "token-transfers?type=ERC-721";
  const ERC20 = "token-transfers?type=ERC-20";
  const eth = (path: string) => `eth.blockscout.com/api/v2/addresses/${ME}/${path}`;

  it("prices trades from wallet-wide lists, with no per-transaction requests", async () => {
    const log: string[] = [];
    const http = fake({
      [eth(NFTS)]: page([move("0xsale")]),
      [eth(ERC20)]: page([weth("0xsale", BUYER, ME, 2.2), weth("0xsale", ME, FEE, 0.022)]),
    }, log);
    const r = await fetchOnchainNftSales(http, ME);
    expect(r.sales).toHaveLength(1);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(2.178, 6);
    expect(log.some((l) => /\/transactions\/0x/.test(l))).toBe(false);
    expect(r.failedChains).toEqual([]);
  });

  it("ETH paid out by a marketplace contract and forwarded to a vault (smart wallet)", async () => {
    const http = fake({
      [eth(NFTS)]: page([move("0xmayc")]),
      [eth("internal-transactions")]: page([leg("0xmayc", SEAPORT, FEE, 0.0105), leg("0xmayc", SEAPORT, ME, 1.0395), leg("0xmayc", ME, VAULT, 1.0395)]),
    });
    const r = await fetchOnchainNftSales(http, ME);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(1.0395, 6);
  });

  it("a purchase paid with the wallet's own transaction value", async () => {
    const http = fake({
      [eth(NFTS)]: page([move("0xbuy", T("2026-11-01"), "0xseller", ME)]),
      [eth("transactions")]: page([{ hash: "0xbuy", timestamp: T("2026-11-01"), status: "ok", value: String(BigInt(25) * BigInt(1e17)), from: { hash: ME }, to: { hash: SEAPORT } }]),
    });
    const r = await fetchOnchainNftSales(http, ME);
    expect(r.sales[0].buyer).toBe(ME);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(2.5, 6);
  });

  it("Polygon pays in POL, never counted as ETH", async () => {
    const http = fake({
      [`polygon.blockscout.com/api/v2/addresses/${ME}/${NFTS}`]: page([move("0xmint", T("2026-06-08"), "0x0000000000000000000000000000000000000000", ME)]),
      [`polygon.blockscout.com/api/v2/addresses/${ME}/transactions`]: page([{ hash: "0xmint", timestamp: T("2026-06-08"), status: "ok", value: String(BigInt(8) * BigInt(1e18)), from: { hash: ME }, to: { hash: "0xminter" } }]),
    });
    const r = await fetchOnchainNftSales(http, ME);
    expect(r.sales[0].chain).toBe("polygon");
    expect(r.sales[0].payment!.symbol).toBe("POL");
    expect(qty(r.sales[0].payment!)).toBeCloseTo(8, 6);
  });

  it("liquidity-position NFTs (Uniswap V3) are DeFi deposits, not NFT trades", async () => {
    const http = fake({
      [`arbitrum.blockscout.com/api/v2/addresses/${ME}/${NFTS}`]: page([move("0xlp", T("2026-03-23"), "0x0000000000000000000000000000000000000000", ME, { symbol: "UNI-V3-POS", name: "Uniswap V3 Positions NFT-V1" })]),
      [`arbitrum.blockscout.com/api/v2/addresses/${ME}/transactions`]: page([{ hash: "0xlp", timestamp: T("2026-03-23"), status: "ok", value: String(BigInt(27) * BigInt(1e17)), from: { hash: ME }, to: { hash: "0xnpm" } }]),
    });
    const r = await fetchOnchainNftSales(http, ME);
    expect(r.sales).toEqual([]);
    expect(r.skipped.positions).toBe(1);
  });

  it("free airdrops (spam) cost nothing and are not trades", async () => {
    const spam = Array.from({ length: 40 }, (_, k) => move(`0xspam${k}`, T("2026-10-01"), "0xspammer", ME));
    const log: string[] = [];
    const r = await fetchOnchainNftSales(fake({ [eth(NFTS)]: page(spam) }, log), ME);
    expect(r.sales).toEqual([]);
    expect(r.skipped.unpaid).toBe(40);
    expect(log.filter((l) => l.startsWith("blockscout-ethereum")).length).toBe(4); // 4 list reads, not 40+
  });

  it("payment lists stop once they reach back past the oldest NFT move", async () => {
    const log: string[] = [];
    const http = fake({
      [eth(NFTS)]: page([move("0xsale", T("2026-11-02"))]),
      // Newest-first page whose oldest item is already older than the NFT move: no need for page 2
      [eth(ERC20)]: page([weth("0xsale", BUYER, ME, 1, T("2026-11-02")), weth("0xold", BUYER, ME, 9, T("2026-01-01"))], true),
    }, log);
    const r = await fetchOnchainNftSales(http, ME);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(1, 6);
    expect(log.filter((l) => l.includes(ERC20) && l.includes("eth.blockscout")).length).toBe(1);
  });

  it("NFT moves older than the payment data that was read are reported, never guessed", async () => {
    const http = fake({
      [eth(NFTS)]: page([move("0xnew", T("2026-11-02")), move("0xold", T("2025-01-01"))]),
      // One page allowed, more pages exist, and they never reach back to 2025
      [eth(ERC20)]: page([weth("0xnew", BUYER, ME, 1, T("2026-11-02")), weth("0xx", BUYER, ME, 1, T("2026-10-01"))], true),
    });
    const r = await fetchOnchainNftSales(http, ME, { maxPaymentPages: 1 });
    expect(r.sales.map((s) => s.transaction)).toEqual(["0xnew"]);
    expect(r.skipped.capped).toBe(1);
  });

  it("a chain hiccup is retried once, and a failed attempt never double-counts", async () => {
    let calls = 0;
    const http = fake({
      [eth(NFTS)]: () => (++calls === 1 ? Promise.reject(new Error("blockscout: network error (timeout)")) : page([move("0xsale")])),
      [eth(ERC20)]: page([weth("0xsale", BUYER, ME, 2)]),
    });
    const r = await fetchOnchainNftSales(http, ME);
    expect(calls).toBe(2);
    expect(r.sales).toHaveLength(1);
    expect(r.failedChains).toEqual([]);
  });

  it("a chain that keeps failing is reported without touching the others", async () => {
    const http = fake({
      [eth(NFTS)]: "fail",
      [`optimism.blockscout.com/api/v2/addresses/${ME}/${NFTS}`]: page([move("0xop")]),
      [`optimism.blockscout.com/api/v2/addresses/${ME}/${ERC20}`]: page([weth("0xop", BUYER, ME, 1)]),
    });
    const r = await fetchOnchainNftSales(http, ME);
    expect(r.failedChains).toEqual(["ethereum"]);
    expect(r.sales.map((s) => s.chain)).toEqual(["optimism"]);
    expect(r.chainsChecked).toEqual(expect.arrayContaining(["optimism", "base", "arbitrum", "polygon"]));
  });

  it("a spent budget makes no requests and reports the gap", async () => {
    const r = await fetchOnchainNftSales(fake({}), ME, { budgetMs: -1 });
    expect(r.requests).toBe(0);
    expect(r.sales).toEqual([]);
    expect(r.skipped.capped).toBeGreaterThan(0);
  });
});
