import type { FinancialEvent } from "./engine/schema";

/**
 * Outbound links for a normalized event, so every figure can be checked at its source:
 *  - Hyperliquid: L1 explorer transaction (internal fills and funding have no transaction)
 *  - Polymarket: Polygon transaction on Polygonscan, and the market page
 *  - HertzFlow: BNB Chain transaction on BscScan
 *  - OpenSea: the sale transaction on that chain's explorer, and the NFT's OpenSea page
 * Mock events never link anywhere.
 */

export interface EventLink {
  label: string;
  href: string;
}

const EVM_EXPLORER: Record<string, string> = {
  ethereum: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  polygon: "https://polygonscan.com/tx/",
  matic: "https://polygonscan.com/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  ape_chain: "https://apescan.io/tx/",
  blast: "https://blastscan.io/tx/",
  avalanche: "https://snowtrace.io/tx/",
  bsc: "https://bscscan.com/tx/",
  ronin: "https://app.roninchain.com/tx/",
  zora: "https://explorer.zora.energy/tx/",
};

export function txUrl(e: FinancialEvent): string | undefined {
  if (!e.txHash || e.verification === "mock") return undefined;
  if (e.protocol === "hyperliquid") return `https://app.hyperliquid.xyz/explorer/tx/${e.txHash}`;
  if (e.protocol === "polymarket") return `https://polygonscan.com/tx/${e.txHash}`;
  if (e.protocol === "hertzflow") return `https://bscscan.com/tx/${e.txHash}`;
  if (e.protocol === "opensea" || e.protocol === "gmx") return EVM_EXPLORER[e.chain] ? `${EVM_EXPLORER[e.chain]}${e.txHash}` : undefined;
  return undefined;
}

export function marketUrl(e: FinancialEvent): string | undefined {
  if (e.verification === "mock" || !e.market?.slug) return undefined;
  if (e.protocol === "polymarket") return `https://polymarket.com/market/${e.market.slug}`;
  if (e.protocol === "opensea") return `https://opensea.io/${e.market.slug}`;
  return undefined;
}

export function eventLinks(e: FinancialEvent): EventLink[] {
  const links: EventLink[] = [];
  const tx = txUrl(e);
  if (tx) links.push({ label: e.protocol === "polymarket" ? "Polygonscan" : e.protocol === "hertzflow" ? "BscScan" : "Explorer", href: tx });
  const m = marketUrl(e);
  if (m) links.push({ label: e.protocol === "opensea" ? "NFT" : "Market", href: m });
  return links;
}
