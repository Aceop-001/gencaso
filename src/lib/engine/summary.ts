import { CLOSING_TYPES, type FinancialEvent } from "./schema";
import { round } from "./positions";

/**
 * Protocol-independent P&L aggregation over normalized events (USD).
 * Deposits, withdrawals and transfers are counted separately and never as profit.
 * Fees and funding live in their own fields, so each is counted exactly once.
 */
export interface PnlSummary {
  eventCount: number;
  closingEvents: number;
  /** Sum of positive realized P&L on closing events (before fees/funding) */
  realizedProfit: number;
  /** Sum of negative realized P&L on closing events, as a positive number */
  realizedLoss: number;
  netRealized: number;
  fundingReceived: number;
  fundingPaid: number;
  netFunding: number;
  /** Net fees paid (rebates reduce this) */
  fees: number;
  rewards: number;
  perp: { realized: number; fees: number; funding: number; net: number; liquidations: number };
  prediction: { realized: number; fees: number; net: number; winningMarkets: number; losingMarkets: number };
  /** NFT sales: realized gain vs. purchase price (gross of marketplace fees) */
  nft: { realized: number; sold: number; noBasis: number };
  /** realized + funding - fees + rewards */
  netTradingResult: number;
  deposits: number;
  withdrawals: number;
}

export function summarize(events: readonly FinancialEvent[]): PnlSummary {
  const s: PnlSummary = {
    eventCount: events.length,
    closingEvents: 0,
    realizedProfit: 0,
    realizedLoss: 0,
    netRealized: 0,
    fundingReceived: 0,
    fundingPaid: 0,
    netFunding: 0,
    fees: 0,
    rewards: 0,
    perp: { realized: 0, fees: 0, funding: 0, net: 0, liquidations: 0 },
    prediction: { realized: 0, fees: 0, net: 0, winningMarkets: 0, losingMarkets: 0 },
    nft: { realized: 0, sold: 0, noBasis: 0 },
    netTradingResult: 0,
    deposits: 0,
    withdrawals: 0,
  };
  const marketPnl = new Map<string, number>();

  for (const e of events) {
    switch (e.type) {
      case "DEPOSIT":
        s.deposits += e.amountUsd ?? 0;
        continue;
      case "WITHDRAWAL":
        s.withdrawals += e.amountUsd ?? 0;
        continue;
      case "TRANSFER":
        continue;
      case "REWARD":
        s.rewards += e.amountUsd ?? 0;
        continue;
    }
    if (CLOSING_TYPES.has(e.type)) {
      s.closingEvents++;
      if (e.realizedPnlUsd >= 0) s.realizedProfit += e.realizedPnlUsd;
      else s.realizedLoss += -e.realizedPnlUsd;
    }
    if (e.fundingUsd > 0) s.fundingReceived += e.fundingUsd;
    else s.fundingPaid += -e.fundingUsd;
    s.fees += e.feeUsd;

    if (e.category === "perp") {
      s.perp.realized += e.realizedPnlUsd;
      s.perp.fees += e.feeUsd;
      s.perp.funding += e.fundingUsd;
      if (e.type === "LIQUIDATION") s.perp.liquidations++;
    } else if (e.category === "prediction") {
      s.prediction.realized += e.realizedPnlUsd;
      s.prediction.fees += e.feeUsd;
      const k = `${e.protocol}:${e.market?.id ?? e.asset}`;
      marketPnl.set(k, (marketPnl.get(k) ?? 0) + e.realizedPnlUsd - e.feeUsd);
    } else if (e.category === "nft") {
      s.nft.realized += e.realizedPnlUsd;
      if (e.type === "NFT_SELL") {
        s.nft.sold++;
        if (e.verification === "missing") s.nft.noBasis++;
      }
    }
  }

  for (const v of marketPnl.values()) {
    if (v > 0) s.prediction.winningMarkets++;
    else if (v < 0) s.prediction.losingMarkets++;
  }
  s.netRealized = s.realizedProfit - s.realizedLoss;
  s.netFunding = s.fundingReceived - s.fundingPaid;
  s.perp.net = s.perp.realized + s.perp.funding - s.perp.fees;
  s.prediction.net = s.prediction.realized - s.prediction.fees;
  s.netTradingResult = s.netRealized + s.netFunding - s.fees + s.rewards;

  // Round everything for stable, reproducible output
  const r = (o: Record<string, unknown>) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === "number") o[k] = round(v, 6);
      else if (v && typeof v === "object") r(v as Record<string, unknown>);
    }
  };
  r(s as unknown as Record<string, unknown>);
  return s;
}

/** Remove duplicate events by id (idempotent ingestion). Returns kept events and duplicate count. */
export function dedupe(events: readonly FinancialEvent[]): { events: FinancialEvent[]; duplicates: number } {
  const seen = new Set<string>();
  const out: FinancialEvent[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  out.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  return { events: out, duplicates: events.length - out.length };
}

/** Daily net trading contribution, for charts. */
export function dailySeries(events: readonly FinancialEvent[]): Array<{ date: string; net: number; cumulative: number }> {
  const byDay = new Map<string, number>();
  for (const e of events) {
    if (e.type === "DEPOSIT" || e.type === "WITHDRAWAL" || e.type === "TRANSFER") continue;
    const d = new Date(e.timestamp).toISOString().slice(0, 10);
    const v = e.type === "REWARD" ? e.amountUsd ?? 0 : e.realizedPnlUsd + e.fundingUsd - e.feeUsd;
    byDay.set(d, (byDay.get(d) ?? 0) + v);
  }
  let cum = 0;
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, net]) => {
      cum += net;
      return { date, net: round(net, 2), cumulative: round(cum, 2) };
    });
}
