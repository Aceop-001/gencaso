import { describe, expect, it } from "vitest";
import { normalizeOsSales, type OsSale } from "./opensea";

const ME = "0xd6c045df17c7b8938746d72923a6c7696ea4d5e8";
const OTHER = "0x0000000000000000000000000000000000000001";
const sale = (side: "buy" | "sell", day: string, eth: number, id = "1", symbol = "WETH"): OsSale => ({
  event_type: "sale",
  event_timestamp: Date.parse(`${day}T12:00:00Z`) / 1000,
  closing_date: Date.parse(`${day}T12:00:00Z`) / 1000,
  transaction: `0x${day.replace(/-/g, "")}${side}${id}`,
  chain: "ethereum",
  seller: side === "sell" ? ME : OTHER,
  buyer: side === "buy" ? ME : OTHER,
  quantity: 1,
  payment: { quantity: String(BigInt(Math.round(eth * 1e6)) * BigInt(1e12)), token_address: "0x", decimals: 18, symbol },
  nft: { identifier: id, collection: "pudgypenguins", contract: "0xBd3531dA5CF5857e7CfAA92426877b022e612cf8", name: `Pudgy Penguin #${id}` },
});
const PRICES = { ETH: { "2026-10-01": 2_000, "2026-10-05": 2_500 } };

describe("OpenSea sales", () => {
  it("values payments at the daily close and matches each sale to the same NFT's purchase", () => {
    const { events } = normalizeOsSales([sale("sell", "2026-10-05", 1.5), sale("buy", "2026-10-01", 1)], ME, PRICES);
    const [buy, sell] = events;
    expect(buy.type).toBe("NFT_BUY");
    expect(buy.price).toBe(2_000);
    expect(sell.type).toBe("NFT_SELL");
    expect(sell.entryValueUsd).toBe(2_000);
    expect(sell.exitValueUsd).toBe(3_750);
    expect(sell.realizedPnlUsd).toBe(1_750);
    expect(sell.openedAt).toBe(buy.timestamp);
  });
  it("flags a sale with no purchase in the history instead of inventing a cost", () => {
    const { events, noBasis } = normalizeOsSales([sale("sell", "2026-10-05", 1, "7")], ME, PRICES);
    expect(events[0].realizedPnlUsd).toBe(0);
    expect(events[0].verification).toBe("missing");
    expect(noBasis).toEqual({ count: 1, proceedsUsd: 2_500 });
  });
  it("leaves a payment token with no price unvalued", () => {
    const { events, unpriced } = normalizeOsSales([sale("buy", "2026-10-01", 1, "1", "DOGE")], ME, PRICES);
    expect(events[0].price).toBeUndefined();
    expect(unpriced).toBe(1);
  });
});

describe("HYPE payments", () => {
  it("are valued from the HYPE daily close", () => {
    const s = { ...sale("sell", "2025-10-01", 1214, "1629", "HYPE"), chain: "hyperevm" };
    const { events } = normalizeOsSales([s], ME, { HYPE: { "2025-10-01": 47.274 } });
    expect(events[0].exitValueUsd).toBeCloseTo(57_390.636, 3);
    expect(events[0].fiat.source).toMatch(/Hyperliquid/);
  });
});
