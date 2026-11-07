/**
 * Centralised exchanges planned for automatic import, ordered by DefiLlama's CEX ranking (reserves,
 * fetched 2026-11-07), with Coinbase and Kraken added for their US/EU users. None reads its own export
 * format yet: each needs real export files to verify before it's marked live. Until then, the Gencaso
 * CSV template works with any of them.
 */
export const PLANNED_EXCHANGES = [
  "Binance",
  "OKX",
  "Bybit",
  "Coinbase",
  "Kraken",
  "Bitfinex",
  "Bitget",
  "Gate",
  "Gemini",
  "Bitstamp",
  "MEXC",
  "HTX",
  "Deribit",
  "KuCoin",
  "Crypto.com",
  "BingX",
  "Backpack",
  "Bitvavo",
  "Phemex",
  "CoinDCX",
] as const;
