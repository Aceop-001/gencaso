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

describe("on-chain backup: resilience", () => {
  const list = (items: unknown[]) => ({ items, next_page_params: null });
  const txPage = (hash: string) => ({
    hash,
    status: "ok",
    timestamp: "2026-11-02T19:28:59.000000Z",
    value: "0",
    from: { hash: "0xbundler" },
    to: { hash: SEAPORT },
    token_transfers: [erc20("WETH", BUYER, ME, 2.2), erc20("WETH", ME, FEE, 0.022)],
    token_transfers_overflow: false,
  });
  const move = (hash: string) => ({ ...nft(ME, BUYER), transaction_hash: hash });

  function fake(routes: Record<string, unknown>, headers: Record<string, string>[] = []) {
    return {
      getJson: async (_p: string, url: string, h?: Record<string, string>) => {
        if (h) headers.push(h);
        for (const [k, v] of Object.entries(routes)) if (url.includes(k)) {
          if (v === "fail") throw new Error("blockscout: network error (timeout)");
          return typeof v === "function" ? (v as () => unknown)() : v;
        }
        throw new Error(`unexpected ${url}`);
      },
      postJson: async () => { throw new Error("not used"); },
    } as never;
  }
  const emptyChains = {
    "optimism.blockscout.com": list([]), "base.blockscout.com": list([]),
    "arbitrum.blockscout.com": list([]), "polygon.blockscout.com": list([]),
  };

  it("reads every ETH leg of the wallet in one paged list, not per transaction", async () => {
    const http = fake({
      [`/api/v2/addresses/${ME}/internal-transactions`]: list([internal(SEAPORT, ME, 1.0395, "0xgood")]),
      [`eth.blockscout.com/api/v2/addresses/${ME}/token-transfers`]: list([move("0xgood")]),
      "/transactions/0xgood": { ...txPage("0xgood"), token_transfers: null },
      ...emptyChains,
    });
    const r = await fetchOnchainNftSales(http, ME);
    expect(r.sales).toHaveLength(1);
    expect(qty(r.sales[0].payment!)).toBeCloseTo(1.0395, 6);
  });

  it("one unreadable transaction never loses the chain's other trades", async () => {
    const http = fake({
      ...emptyChains,
      [`eth.blockscout.com/api/v2/addresses/${ME}/token-transfers`]: list([move("0xgood"), move("0xslow")]),
      "/transactions/0xgood": txPage("0xgood"),
      "/transactions/0xslow": "fail",
      "/internal-transactions": list([]),
    });
    const r = await fetchOnchainNftSales(http, ME);
    expect(r.sales).toHaveLength(1);
    expect(r.sales[0].transaction).toBe("0xgood");
    expect(r.skipped.failed).toBe(1);
    expect(r.failedChains).toEqual([]);
    expect(r.chainsChecked).toContain("ethereum");
  });

  it("a chain that cannot be listed does not stop the others", async () => {
    const http = fake({
      "eth.blockscout.com/api/v2/addresses": "fail",
      "optimism.blockscout.com/api/v2/transactions/0xop/internal": list([]),
      "optimism.blockscout.com/api/v2/addresses": list([move("0xop")]),
      "optimism.blockscout.com/api/v2/transactions/0xop": txPage("0xop"),
      ...emptyChains,
    });
    const r = await fetchOnchainNftSales(http, ME);
    expect(r.failedChains).toEqual(["ethereum"]);
    expect(r.sales).toHaveLength(1);
    expect(r.chainsChecked).toEqual(expect.arrayContaining(["optimism", "base", "arbitrum", "polygon"]));
  });

  it("a spent budget reports capped work instead of running forever", async () => {
    const http = fake({ ...emptyChains, [`eth.blockscout.com/api/v2/addresses/${ME}/token-transfers`]: list([move("0xa"), move("0xb")]) });
    const r = await fetchOnchainNftSales(http, ME, { budgetMs: -1 });
    expect(r.sales).toEqual([]);
    expect(r.requests).toBe(0);
    expect(r.skipped.capped).toBeGreaterThan(0);
  });

  it("every request carries a User-Agent (Base, Arbitrum and Polygon need one)", async () => {
    const headers: Record<string, string>[] = [];
    const http = fake({ ...emptyChains, [`eth.blockscout.com/api/v2/addresses/${ME}/token-transfers`]: list([]) }, headers);
    await fetchOnchainNftSales(http, ME);
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) expect(h["User-Agent"]).toBeTruthy();
  });
});
