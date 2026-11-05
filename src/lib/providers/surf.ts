import type { DataProvider, ProviderResult } from "./types";

/**
 * SurfDataProvider — placeholder for Surf (asksurf.ai) Data API.
 *
 * What has been verified from docs.asksurf.ai/data-api/overview (2026-11-02):
 *   base URL https://api.asksurf.ai/gateway, Bearer `sk-` key, credit-based
 *   (Light 1 / Standard 2 / Heavy 4 credits), 100 req/min per key,
 *   30 free credits/day for anonymous IPs, GET /v1/me/credits costs 0 credits.
 *   Categories include Hyperliquid (fills, positions) and Prediction Market (positions).
 *
 * NOT yet verified: exact paths, parameters and response shapes of the
 * Hyperliquid / Prediction Market endpoints. Until they are, this provider
 * returns no events and is disabled unless SURF_API_KEY is set, so it never
 * spends credits by accident. Direct Hyperliquid/Polymarket providers are free
 * and remain the default source.
 */
export const SurfDataProvider: DataProvider = {
  id: "surf",
  protocol: "hyperliquid",
  supports: () => false,
  async fetch(): Promise<ProviderResult> {
    return {
      events: [],
      openPositions: [],
      warnings: [],
      report: {
        provider: "SurfDataProvider",
        protocol: "hyperliquid",
        status: "unsupported",
        eventCount: 0,
        requests: 0,
        fromCache: false,
        message: "Surf endpoints not yet verified — provider disabled.",
        limitations: ["Awaiting verification of Surf Data API endpoint shapes."],
      },
    };
  },
};

export const SURF_BASE = "https://api.asksurf.ai/gateway";
