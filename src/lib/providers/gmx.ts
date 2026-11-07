import { round } from "../engine/positions";
import type { FinancialEvent } from "../engine/schema";
import { toChecksumAddress } from "../keccak";
import type { DataProvider, ProviderHttp, ProviderResult } from "./types";

/**
 * GMXDataProvider — GMX v2 (Synthetics) perpetuals on Arbitrum and Avalanche, read-only, from GMX's
 * public Subsquid indexer (no key): `POST https://gmx.squids.live/gmx-synthetics-<chain>:prod/api/graphql`.
 *
 * - `positionChanges` (increase / decrease) carry realized P&L (`basePnlUsd`), price impact and fees.
 *   Their sums reproduce GMX's own per-account totals (`accountStats`: realizedPnl, realizedFees,
 *   realizedPriceImpact) exactly — checked on four live accounts on 2026-11-07.
 * - Funding received is `fundingFeeReceivedUsd` on executed `tradeActions`; its sum equals GMX's
 *   `positiveFundingFeesUsd`. Funding paid is part of GMX's position fees (`feesAmount`).
 * - Price impact (negative = cost) and collateral-swap fees are trading costs, so they go into the fee.
 * - Market names come from GMX's public REST API (`<chain>-api.gmxinfra.io/markets`).
 *
 * Amounts are USD with 30 decimals; fees are in collateral-token units × the collateral price (30 − decimals).
 * The indexer matches accounts only in EIP-55 checksum form.
 */

const CHAINS = [
  { chain: "arbitrum", squid: "https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql", api: "https://arbitrum-api.gmxinfra.io" },
  { chain: "avalanche", squid: "https://gmx.squids.live/gmx-synthetics-avalanche:prod/api/graphql", api: "https://avalanche-api.gmxinfra.io" },
] as const;
const PAGE = 250;
const MAX_PAGES = 80;
const LIQUIDATION = 7; // GMX OrderType.Liquidation
const E30 = BigInt(10) ** BigInt(30);

/** 30-decimal fixed point → number, without losing precision on large values. */
export const fromE30 = (v?: string | null) => {
  if (!v) return 0;
  const b = BigInt(v);
  const neg = b < BigInt(0);
  const a = neg ? -b : b;
  const n = Number(a / E30) + Number(a % E30) / 1e30;
  return neg ? -n : n;
};
/** token amount × price (30 − decimals) → USD */
const tokenUsd = (amount?: string | null, price?: string | null) => (amount && price ? fromE30((BigInt(amount) * BigInt(price)).toString()) : 0);

export interface GmxPositionChange {
  id: string;
  type: "increase" | "decrease";
  orderKey: string;
  positionKey: string;
  market: string;
  isLong: boolean;
  sizeInUsd: string;
  sizeDeltaUsd: string;
  sizeDeltaInTokens: string;
  executionPrice: string;
  basePnlUsd: string;
  priceImpactUsd: string;
  swapFeeUsd?: string | null;
  swapImpactUsd?: string | null;
  feesAmount: string;
  collateralTokenPriceMin: string;
  timestamp: number;
}
export interface GmxTradeAction {
  orderKey: string;
  orderType: number;
  fundingFeeReceivedUsd?: string | null;
  transactionHash: string;
  timestamp: number;
  marketAddress?: string | null;
}

/** Turn one chain's position changes and executed orders into Gencaso events. */
export function normalizeGmx(chain: string, account: string, changes: GmxPositionChange[], actions: GmxTradeAction[], marketNames: Record<string, string>): FinancialEvent[] {
  const me = account.toLowerCase();
  const byOrder = new Map(actions.map((a) => [a.orderKey, a]));
  const openedAt = new Map<string, number>();
  const events: FinancialEvent[] = [];
  const name = (m: string) => marketNames[m.toLowerCase()] ?? m;
  const assetOf = (m: string) => name(m).split(/[/ ]/)[0] || "GMX market";

  for (const c of [...changes].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))) {
    const ts = c.timestamp * 1000;
    const action = byOrder.get(c.orderKey);
    const sizeAfter = fromE30(c.sizeInUsd);
    const fee = tokenUsd(c.feesAmount, c.collateralTokenPriceMin) - fromE30(c.priceImpactUsd) + fromE30(c.swapFeeUsd) - fromE30(c.swapImpactUsd);
    const base = {
      id: `gmx-${chain}-${c.id}`,
      protocol: "gmx" as const,
      chain,
      account: me,
      timestamp: ts,
      category: "perp" as const,
      asset: assetOf(c.market),
      market: { id: c.market, name: `${name(c.market)} · ${c.isLong ? "long" : "short"}` },
      quantity: round(Math.abs(fromE30(c.sizeDeltaUsd)), 2), // GMX sizes are in USD
      feeUsd: round(fee, 6),
      fundingUsd: 0,
      fiat: { currency: "USD" as const, source: "GMX USD values (30-decimal fixed point)" },
      source: `GMX Subsquid · ${chain} · positionChanges`,
      txHash: action?.transactionHash,
      verification: "verified" as const,
      confidence: 1,
    };
    if (c.type === "increase") {
      if (!openedAt.has(c.positionKey)) openedAt.set(c.positionKey, ts);
      events.push({ ...base, type: "PERP_INCREASE", realizedPnlUsd: 0 });
      continue;
    }
    const closed = sizeAfter <= 0;
    events.push({
      ...base,
      type: action?.orderType === LIQUIDATION ? "LIQUIDATION" : closed ? "PERP_CLOSE" : "PERP_REDUCE",
      realizedPnlUsd: round(fromE30(c.basePnlUsd), 6),
      openedAt: openedAt.get(c.positionKey),
      notes: fromE30(c.priceImpactUsd) ? `Price impact ${fromE30(c.priceImpactUsd).toFixed(2)} USD counted in the fee` : undefined,
    });
    if (closed) openedAt.delete(c.positionKey);
  }

  for (const a of actions) {
    const recv = fromE30(a.fundingFeeReceivedUsd);
    if (recv <= 0) continue;
    const m = a.marketAddress ?? "";
    events.push({
      id: `gmx-${chain}-funding-${a.orderKey}`,
      protocol: "gmx",
      chain,
      account: me,
      timestamp: a.timestamp * 1000,
      category: "perp",
      type: "FUNDING",
      asset: m ? assetOf(m) : "GMX",
      market: m ? { id: m, name: name(m) } : undefined,
      quantity: 0,
      realizedPnlUsd: 0,
      feeUsd: 0,
      fundingUsd: round(recv, 6),
      fiat: { currency: "USD", source: "GMX USD values (30-decimal fixed point)" },
      source: `GMX Subsquid · ${chain} · tradeActions (funding received)`,
      txHash: a.transactionHash,
      verification: "verified",
      confidence: 1,
    });
  }
  return events;
}

async function gql<T>(http: ProviderHttp, url: string, query: string): Promise<T> {
  const r = await http.postJson<{ data?: T; errors?: { message: string }[] }>("gmx", url, { query });
  if (r.errors?.length) throw new Error(`gmx: ${r.errors[0].message}`);
  return r.data as T;
}

export const GMXDataProvider: DataProvider = {
  id: "gmx",
  protocol: "gmx",
  supports: (kind) => kind === "evm",
  async fetch(address, ctx): Promise<ProviderResult> {
    const account = toChecksumAddress(address);
    const events: FinancialEvent[] = [];
    const warnings: string[] = [];
    let requests = 0;
    const active: string[] = [];
    for (const { chain, squid, api } of CHAINS) {
      const changes: GmxPositionChange[] = [];
      let truncated = true;
      for (let p = 0; p < MAX_PAGES; p++) {
        const d = await gql<{ positionChanges: GmxPositionChange[] }>(
          ctx.http,
          squid,
          `{ positionChanges(where: { account_eq: "${account}" }, orderBy: timestamp_ASC, limit: ${PAGE}, offset: ${p * PAGE}) { id type orderKey positionKey market isLong sizeInUsd sizeDeltaUsd sizeDeltaInTokens executionPrice basePnlUsd priceImpactUsd swapFeeUsd swapImpactUsd feesAmount collateralTokenPriceMin timestamp } }`,
        );
        requests++;
        changes.push(...d.positionChanges);
        if (d.positionChanges.length < PAGE) {
          truncated = false;
          break;
        }
      }
      if (!changes.length) continue;
      active.push(chain);
      if (truncated) warnings.push(`GMX ${chain}: history stopped at ${(MAX_PAGES * PAGE).toLocaleString()} position changes — older trades may be missing.`);

      const actions: GmxTradeAction[] = [];
      for (let p = 0; p < MAX_PAGES; p++) {
        const d = await gql<{ tradeActions: GmxTradeAction[] }>(
          ctx.http,
          squid,
          `{ tradeActions(where: { account_eq: "${account}", eventName_eq: "OrderExecuted" }, orderBy: timestamp_ASC, limit: ${PAGE}, offset: ${p * PAGE}) { orderKey orderType fundingFeeReceivedUsd transactionHash timestamp marketAddress } }`,
        );
        requests++;
        actions.push(...d.tradeActions);
        if (d.tradeActions.length < PAGE) break;
      }

      const marketNames: Record<string, string> = {};
      try {
        const m = await ctx.http.getJson<{ markets: { name: string; marketToken: string }[] }>("gmx", `${api}/markets`);
        requests++;
        for (const x of m.markets ?? []) marketNames[x.marketToken.toLowerCase()] = x.name;
      } catch {
        // Names are cosmetic; addresses are shown instead
      }
      events.push(...normalizeGmx(chain, address, changes, actions, marketNames));
    }

    return {
      events,
      openPositions: [],
      warnings,
      report: {
        provider: "GMXDataProvider",
        protocol: "gmx",
        status: events.length ? "ok" : "empty",
        eventCount: events.length,
        requests,
        fromCache: false,
        message: events.length ? `GMX v2 on ${active.join(" and ")}.` : "No GMX v2 trades for this address on Arbitrum or Avalanche.",
        limitations: [
          "GMX v2 (Synthetics) only; GMX v1 history is not included.",
          "Price impact and collateral-swap costs are counted as fees; funding paid is part of GMX's position fees.",
          "Open positions are not taxed and not listed.",
        ],
      },
    };
  },
};
