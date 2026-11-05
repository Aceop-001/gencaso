import type { FinancialEvent, OpenPosition, ProtocolId, ProviderReport } from "../engine/schema";
import type { AddressKind } from "../validation";

/** HTTP access handed to providers: metered, rate-limited, and the only way they reach the network. */
export interface ProviderHttp {
  getJson<T = unknown>(provider: string, url: string, headers?: Record<string, string>): Promise<T>;
  postJson<T = unknown>(provider: string, url: string, body: unknown): Promise<T>;
}

export interface ProviderContext {
  http: ProviderHttp;
  /** Only fetch activity at or after this time (ms) — incremental sync */
  since?: number;
  now: number;
}

export interface ProviderResult {
  events: FinancialEvent[];
  openPositions: OpenPosition[];
  warnings: string[];
  report: ProviderReport;
}

export interface DataProvider {
  id: string;
  protocol: ProtocolId;
  /** Whether this provider can be queried for the given address type */
  supports(kind: AddressKind): boolean;
  fetch(address: string, ctx: ProviderContext): Promise<ProviderResult>;
}

export const USDC_FIAT = { currency: "USD" as const, source: "USDC settlement, assumed 1 USDC = 1 USD" };
