import type { ProtocolId } from "./engine/schema";
import type { AddressKind } from "./validation";

/**
 * Protocol registry. `status` is only "live" once an integration has been
 * exercised against the real API. Entries marked "planned" are researched
 * targets, not supported protocols.
 */
export type IntegrationStatus = "live" | "implemented-unverified" | "planned";

export interface ProtocolEntry {
  id: ProtocolId;
  name: string;
  category: "perp" | "prediction" | "nft";
  chains: string[];
  website: string;
  docs: string;
  endpoints: string[];
  accountId: string;
  addressKinds: AddressKind[];
  history: string;
  txTypes: string[];
  status: IntegrationStatus;
  verifiedOn?: string;
  /** Official icon (from the project's own site), served from /public/protocols */
  logo?: string;
  limitations: string[];
}

export const PROTOCOLS: ProtocolEntry[] = [
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    logo: "/protocols/hyperliquid.png",
    category: "perp",
    chains: ["Hyperliquid L1"],
    website: "https://hyperliquid.xyz",
    docs: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint",
    endpoints: [
      "POST https://api.hyperliquid.xyz/info {type:userFillsByTime}",
      "POST https://api.hyperliquid.xyz/info {type:userFunding}",
      "POST https://api.hyperliquid.xyz/info {type:userNonFundingLedgerUpdates}",
      "POST https://api.hyperliquid.xyz/info {type:clearinghouseState}",
    ],
    accountId: "Public EVM address (master account or sub-account)",
    addressKinds: ["evm"],
    history: "Fills: max 2,000 per request, only the 10,000 most recent fills are retrievable. Funding/ledger paginated by time.",
    txTypes: ["fills (open/close/flip)", "liquidations", "funding", "deposits", "withdrawals", "transfers", "rewards"],
    status: "live",
    verifiedOn: "2026-11-02",
    limitations: [
      "Only the 10,000 most recent fills are available from the API — older history is reported as missing.",
      "closedPnl is reported by Hyperliquid per fill, excluding fees.",
      "Spot fills (coin names starting with @ or containing /) are excluded — out of scope.",
    ],
  },
  {
    id: "polymarket",
    name: "Polymarket",
    logo: "/protocols/polymarket.png",
    category: "prediction",
    chains: ["Polygon"],
    website: "https://polymarket.com",
    docs: "https://docs.polymarket.com",
    endpoints: ["GET https://data-api.polymarket.com/v2/activity?user=<proxyWallet>&start=1", "GET https://data-api.polymarket.com/v2/positions?user=<proxyWallet>&status=REDEEMABLE_LOST"],
    accountId: "Polymarket proxy wallet address (shown on the profile page), not necessarily the signing EOA",
    addressKinds: ["evm"],
    history: "Data API v2: cursor-paginated activity (v1 retired 2 Nov 2026); start=1 for full history.",
    txTypes: ["TRADE (buy/sell)", "REDEEM", "SPLIT", "MERGE", "REWARD", "YIELD", "MAKER/TAKER_REBATE", "MIGRATION"],
    status: "live",
    verifiedOn: "2026-11-03",
    limitations: [
      "Cost basis is rebuilt by GENCASO (weighted average). Checked against Polymarket's own closed-position P&L (Data API v2) for one live wallet: 83 of 84 markets within $0.02.",
      "Combo (multi-leg) positions and range-event operations are excluded with a warning.",
      "Trading fees are inferred as the difference between usdcSize and size × price.",
      "Losing positions that were never redeemed only become realized once the market resolves; unresolved ones are reported as open.",
    ],
  },
  {
    id: "bulk",
    name: "Bulk Trade",
    logo: "/protocols/bulk.png",
    category: "perp",
    chains: ["Solana"],
    website: "https://www.bulk.trade",
    docs: "https://github.com/bulk-trade/bulk-client",
    endpoints: [
      "POST https://mainnet-api1.bulk.trade/api/v1/account {type:fills|fundingHistory|activityHistory, user:<pubkey>, limit, cursor}",
      "POST https://mainnet-api1.bulk.trade/api/v1/account {type:fullAccount, user:<pubkey>} (totals for the self-check)",
    ],
    accountId: "Bulk account public key (base58) — the address on your Bulk account page, which may differ from the wallet that funds it",
    addressKinds: ["solana"],
    history: "Cursor-paginated fills, funding payments and account activity (up to 5,000 rows per page).",
    txTypes: ["Fill (open / increase / reduce / close / flip)", "Liquidation", "ADL", "Funding payment", "Deposit / withdrawal"],
    status: "live",
    verifiedOn: "2026-11-03",
    limitations: [
      "Realized P&L rebuilt from fills (weighted average); on two live accounts it matched Bulk's own realized, fee and funding totals (within $0.006 on $544k).",
      "No per-trade explorer link: Bulk matches trades inside its validator.",
      "exchange-api.bulk.trade is Bulk's testnet; mainnet is mainnet-api1.bulk.trade.",
    ],
  },
  {
    id: "hertzflow",
    name: "HertzFlow",
    logo: "/protocols/hertzflow.png",
    category: "perp",
    chains: ["BNB Chain"],
    website: "https://www.hertzflow.xyz",
    docs: "https://hertzflow.gitbook.io/hertzflow-docs",
    endpoints: ["GET https://data-statistics-query.mainnet.htzfl.link/api/v1/bsc/user/trades?user_address=<wallet>&limit=100&cursor=<next_cursor>"],
    accountId: "EVM wallet address (BNB Chain)",
    addressKinds: ["evm"],
    history: "Cursor-paginated trade history from the data-statistics service the HertzFlow app uses (not in the published docs).",
    txTypes: ["Market/limit open & increase", "Close / decrease (gross P&L, price impact, fees, funding, profit share, loss rebate)", "Liquidation"],
    status: "live",
    verifiedOn: "2026-11-03",
    limitations: [
      "Checked against BNB Chain receipts for one live wallet: all 6 closes paid out collateral + reported net within $0.01.",
      "The history endpoint is undocumented (used by HertzFlow's own app) and could change without notice.",
      "Hyper-mode profit share is treated as a trading fee; collateral is USD1 (HFUSD1), assumed 1 USD1 = 1 USD.",
    ],
  },
  {
    id: "opensea",
    name: "OpenSea",
    logo: "/protocols/opensea.png",
    category: "nft",
    chains: ["Ethereum", "Base", "Polygon", "Arbitrum", "ApeChain", "Ronin", "and other EVM chains OpenSea indexes"],
    website: "https://opensea.io",
    docs: "https://docs.opensea.io/reference/list_events_by_account",
    endpoints: [
      "GET https://api.opensea.io/api/v2/events/accounts/<wallet>?event_type=sale&limit=200&next=<cursor> (x-api-key)",
      "GET https://api.exchange.coinbase.com/products/<TOKEN>-USD/candles?granularity=86400 (payment token prices)",
    ],
    accountId: "EVM wallet address that bought or sold the NFTs",
    addressKinds: ["evm"],
    history: "Cursor-paginated sale events (200 per page) across all chains OpenSea indexes, including sales it indexes from other marketplaces such as Blur.",
    txTypes: ["NFT purchase", "NFT sale (gain vs. purchase price of the same token)"],
    status: "live",
    verifiedOn: "2026-11-03",
    limitations: [
      "Checked against Ethereum receipts for one live wallet: all 14 sales match on NFT, buyer/seller, time and price (WETH/BETH transfers, ETH value, Blur execution logs).",
      "Gains use the gross sale price: marketplace fees and royalties are not in OpenSea event data, so gains are slightly overstated.",
      "Crypto payments (ETH, WETH, BETH, POL, ...) are valued at the Coinbase daily close for the sale date.",
      "Minted or transferred-in NFTs have no purchase price in this data; their sales are flagged and not taxed.",
      "Uses OPENSEA_API_KEY if set; otherwise (or once that key expires) a free OpenSea key that the server renews automatically every 7 days.",
    ],
  },
  ...(
    [
      ["gmx", "GMX", "perp", ["Arbitrum", "Avalanche"], "https://gmx.io", "https://docs.gmx.io"],
      ["dydx", "dYdX", "perp", ["dYdX Chain"], "https://dydx.exchange", "https://docs.dydx.exchange"],
      ["aster", "Aster", "perp", ["BNB Chain", "Arbitrum"], "https://asterdex.com", "https://docs.asterdex.com"],
      ["drift", "Drift", "perp", ["Solana"], "https://drift.trade", "https://docs.drift.trade"],
      ["jupiter-perps", "Jupiter Perps", "perp", ["Solana"], "https://jup.ag/perps", "https://dev.jup.ag"],
      ["gains", "Gains Network", "perp", ["Arbitrum", "Polygon", "Base"], "https://gains.trade", "https://docs.gains.trade"],
      ["vertex", "Vertex", "perp", ["Arbitrum"], "https://vertexprotocol.com", "https://docs.vertexprotocol.com"],
      ["aevo", "Aevo", "perp", ["Aevo L2"], "https://aevo.xyz", "https://api-docs.aevo.xyz"],
      ["synthetix", "Synthetix", "perp", ["Base", "Optimism"], "https://synthetix.io", "https://docs.synthetix.io"],
      ["kalshi", "Kalshi", "prediction", ["Centralized (CFTC-regulated)"], "https://kalshi.com", "https://docs.kalshi.com"],
      ["azuro", "Azuro", "prediction", ["Polygon", "Gnosis", "Base"], "https://azuro.org", "https://gem.azuro.org"],
      ["overtime", "Overtime", "prediction", ["Optimism", "Arbitrum", "Base"], "https://overtimemarkets.xyz", "https://docs.overtime.io"],
      ["sxbet", "SX Bet", "prediction", ["SX Network"], "https://sx.bet", "https://api.docs.sx.bet"],
      ["predictfun", "Predict.fun", "prediction", ["Blast", "BNB Chain"], "https://predict.fun", "https://docs.predict.fun"],
    ] as const
  ).map(
    ([id, name, category, chains, website, docs]): ProtocolEntry => ({
      id,
      name,
      category,
      chains: [...chains],
      website,
      docs,
      endpoints: [],
      accountId: "To be verified against official documentation",
      addressKinds: (chains as readonly string[]).includes("Solana") ? ["solana"] : id === "kalshi" ? [] : ["evm"],
      history: "Not yet researched",
      txTypes: [],
      status: "planned",
      limitations: ["Not integrated. No data is retrieved for this protocol."],
    }),
  ),
];

export const protocolById = (id: ProtocolId) => PROTOCOLS.find((p) => p.id === id);
