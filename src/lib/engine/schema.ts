/**
 * Universal financial event schema.
 *
 * Every provider (mock, Hyperliquid, Polymarket, Surf, ...) normalizes its raw
 * data into FinancialEvent records. Financial calculations and tax modules only
 * ever see this schema — never provider-specific payloads.
 *
 * All monetary fields are denominated in USD. Hyperliquid settles in USDC and
 * Polymarket in USDC.e, so USD values assume USDC = 1 USD (see `fiat.source`).
 */

export type ProtocolId =
  | "mock"
  | "hyperliquid"
  | "polymarket"
  | "bulk"
  | "hertzflow"
  | "opensea"
  | "gmx"
  | "dydx"
  | "aster"
  | "drift"
  | "jupiter-perps"
  | "gains"
  | "vertex"
  | "aevo"
  | "synthetix"
  | "kalshi"
  | "azuro"
  | "overtime"
  | "sxbet"
  | "predictfun";

export type Category = "perp" | "prediction" | "nft" | "account";

export type EventType =
  // Perpetuals
  | "PERP_OPEN"
  | "PERP_INCREASE"
  | "PERP_REDUCE"
  | "PERP_CLOSE"
  | "PERP_FLIP"
  | "LIQUIDATION"
  | "FUNDING"
  // Prediction markets
  | "PM_BUY"
  | "PM_SELL"
  | "PM_REDEEM"
  | "PM_SETTLE_LOSS"
  | "PM_SPLIT"
  | "PM_MERGE"
  // NFTs
  | "NFT_BUY"
  | "NFT_SELL"
  // Account-level
  | "REWARD"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "TRANSFER";

/** verified = taken directly from the protocol's official API;
 *  estimated = derived by GENCASO from partial data;
 *  missing = needed data is absent; unsupported = recognised but not modelled;
 *  mock = synthetic demo data, never real. */
export type VerificationStatus = "verified" | "estimated" | "missing" | "unsupported" | "mock";

export interface MarketRef {
  id: string;
  name: string;
  outcome?: string;
  /** Protocol URL slug, used to link to the market page */
  slug?: string;
}

export interface FinancialEvent {
  id: string;
  protocol: ProtocolId;
  chain: string;
  account: string;
  /** Unix epoch, milliseconds */
  timestamp: number;
  category: Category;
  type: EventType;
  /** Traded asset / coin / outcome-token symbol */
  asset: string;
  market?: MarketRef;
  /** Absolute quantity traded (contracts / coins / shares) */
  quantity: number;
  /** Execution or settlement price per unit, USD */
  price?: number;
  /** Cost basis of the quantity closed (closing events only), USD */
  entryValueUsd?: number;
  /** Proceeds of the quantity closed (closing events only), USD */
  exitValueUsd?: number;
  /** Realized P&L before fees and funding, USD. 0 for opening events. */
  realizedPnlUsd: number;
  /** Fee paid (positive) or rebate received (negative), USD */
  feeUsd: number;
  /** Funding received (positive) or paid (negative), USD. Only on FUNDING events. */
  fundingUsd: number;
  /** Gross cash amount for DEPOSIT / WITHDRAWAL / TRANSFER / REWARD, USD */
  amountUsd?: number;
  /** For closing events: when the closed quantity was first opened (ms), if known */
  openedAt?: number;
  fiat: { currency: "USD"; source: string };
  source: string;
  /** On-chain / L1 transaction hash for this event, when the source provides one */
  txHash?: string;
  verification: VerificationStatus;
  /** 0..1 — confidence in the event-type classification */
  confidence: number;
  notes?: string;
}

/** Net economic contribution of an event to trading P&L (excludes deposits/withdrawals). */
export function tradingContributionUsd(e: FinancialEvent): number {
  if (e.type === "DEPOSIT" || e.type === "WITHDRAWAL" || e.type === "TRANSFER") return 0;
  if (e.type === "REWARD") return e.amountUsd ?? 0;
  return e.realizedPnlUsd + e.fundingUsd - e.feeUsd;
}

export const CLOSING_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  "PERP_REDUCE",
  "PERP_CLOSE",
  "PERP_FLIP",
  "LIQUIDATION",
  "PM_SELL",
  "PM_REDEEM",
  "PM_SETTLE_LOSS",
  "PM_MERGE",
  "NFT_SELL",
]);

export interface ProviderReport {
  provider: string;
  protocol: ProtocolId;
  status: "ok" | "empty" | "error" | "unsupported" | "unverified";
  eventCount: number;
  requests: number;
  fromCache: boolean;
  message?: string;
  limitations: string[];
  /** Set in a combined (multi-wallet) report: which wallet this source report is for */
  wallet?: string;
}

export interface WalletDataset {
  /** The wallet analysed; in a combined report, the first wallet (see `wallets`) */
  address: string;
  /** Combined report: every wallet included, in the order given. Absent for a single wallet. */
  wallets?: string[];
  isDemo: boolean;
  fetchedAt: number;
  events: FinancialEvent[];
  providers: ProviderReport[];
  /** Data issues detected during ingestion (gaps, truncation, duplicates) */
  dataWarnings: string[];
  /** Positions still open at fetch time — unrealized, never taxed here */
  openPositions: OpenPosition[];
  fx: FxTable;
}

export interface OpenPosition {
  protocol: ProtocolId;
  asset: string;
  market?: MarketRef;
  quantity: number;
  avgEntryPrice: number;
  markPrice?: number;
  unrealizedPnlUsd?: number;
}

/** currency -> ISO date (YYYY-MM-DD) -> units of currency per 1 USD */
export interface FxTable {
  source: string;
  rates: Record<string, Record<string, number>>;
  missing: string[];
}
