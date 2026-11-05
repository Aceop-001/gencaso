# GENCASO — Technical Architecture

> One wallet. Every trade. Your tax, calculated.

Repository state at start: empty workspace — no existing code to preserve. Stack chosen per brief:
Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Framer Motion · Recharts · Vitest.
Pinned to Next.js 15.5.28 / React 19.1.10 (patched backport line, Nov 2026). `package.json` overrides Next's
bundled postcss (→ 8.5.32) and sharp (→ 0.35.5), and image optimization is off (no next/image is used):
`npm audit --omit=dev` reports 0 vulnerabilities. Remaining advisories are dev-only (vitest 3, eslint tooling).
No database, Redis or ORM yet — nothing needs persistence until accounts/saved reports exist (see §4).

## 1. Request flow

```
Browser                                  Next.js server (Node)                    Public APIs
───────                                  ─────────────────────                    ───────────
[wallet][country][Analyse]
   │ POST /api/analyze {address}  ──►  rate limit (6/min/IP)
   │                                   validateAddress()  (rejects keys/seeds)
   │                                   cache hit (<10 min)? ── yes ─► return cached dataset (0 requests)
   │                                   per provider (parallel):
   │                                     MockDataProvider        (demo only)
   │                                     HyperliquidDataProvider ──────────────► api.hyperliquid.xyz/info
   │                                     PolymarketDataProvider  ──────────────► data-api.polymarket.com/v2
   │                                   dedupe + merge (incremental for HL)
   │                                   FX table, 1 request for full range ──────► api.frankfurter.dev (ECB)
   │                                   PKR/LKR/VND/NGN/AED/RUB/UAH, ≤1/active week ► cdn.jsdelivr.net (currency-api)
   │  ◄── WalletDataset (normalized events + fx + provider reports)
   │
   ├─ calculateTax(dataset, country, taxYear, profile)   ← pure, memoized, runs in the browser
   └─ country switch → calculateTax again. NO network request.
```

Wallet history is fetched once per analysis. Tax is computed client-side from the cached dataset, so
switching 🇮🇳 → 🇺🇸 → 🇬🇧 → 🇩🇪 → 🇦🇺 costs zero API calls (verified in the browser network log).

## 2. Code map

| Path | Responsibility |
|---|---|
| `src/lib/engine/schema.ts` | Universal `FinancialEvent` schema, `WalletDataset`, `FxTable` |
| `src/lib/engine/positions.ts` | Deterministic weighted-average position book (open/increase/reduce/close/flip, settle) |
| `src/lib/engine/summary.ts` | Protocol-independent P&L aggregation, dedupe, daily series |
| `src/lib/providers/*` | One provider per data source. Only place that knows raw API shapes |
| `src/lib/registry.ts` | Protocol registry (16 protocols, status `live` / `planned`) |
| `src/lib/fx/fx.ts` | Historical USD→INR/GBP/EUR/AUD (ECB) and date lookup |
| `src/lib/tax/jurisdictions/*` | Independent, versioned country modules |
| `src/lib/tax/index.ts` | Jurisdiction registry, tax-year discovery, memoized `calculateTax` |
| `src/lib/server/*` | Orchestrator + cache, metered HTTP (usage tracking, per-host spacing), rate limiter |
| `src/app/api/analyze` · `api/usage` | Analysis endpoint · API consumption monitor |
| `src/components/*` | Caustic background, wallet bar, country selector, scan sequence, results dashboard |

## 3. Normalized event schema

Every provider emits `FinancialEvent` (see `schema.ts`): id, protocol, chain, account, timestamp, category
(`perp` / `prediction` / `account`), event type, asset, market {id, name, outcome}, quantity, price,
entry value, exit value, realized P&L, fee, funding, amount (cash events), openedAt (holding period),
fiat currency + price source, data source, verification status (`verified` / `estimated` / `missing` /
`unsupported` / `mock`) and classification confidence. Events also keep the source transaction hash (and the Polymarket
market slug); `src/lib/links.ts` turns them into Hyperliquid explorer / Polygonscan / Polymarket links shown
in the events table and as clickable HYPERLINK cells in the accountant workbook. Mock events never link.

Invariants (enforced by tests):
- Realized P&L, fees and funding live in separate fields → nothing is double-counted.
- `DEPOSIT` / `WITHDRAWAL` / `TRANSFER` never contribute to trading results.
- Event ids are stable across syncs → idempotent ingestion and duplicate removal.

## 4. Database schema (planned — not yet needed)

When persistence is introduced (saved reports, accounts, cross-instance caching), use PostgreSQL + Prisma:

```prisma
model Wallet        { id String @id; address String @unique; kind String; createdAt DateTime @default(now()); syncs SyncState[]; events Event[] }
model SyncState     { id String @id; walletId String; provider String; cursorMs BigInt; lastRunAt DateTime; status String; @@unique([walletId, provider]) }
model Event         { id String @id; walletId String; protocol String; chain String; ts DateTime; category String; type String; asset String;
                      marketId String?; marketName String?; outcome String?; quantity Decimal; price Decimal?; entryValueUsd Decimal?; exitValueUsd Decimal?;
                      realizedPnlUsd Decimal; feeUsd Decimal; fundingUsd Decimal; amountUsd Decimal?; openedAt DateTime?; source String;
                      verification String; confidence Float; raw Json?; @@index([walletId, ts]) }
model FxRate        { currency String; date DateTime @db.Date; perUsd Decimal; source String; @@id([currency, date]) }
model TaxCalculation{ id String @id; walletId String; country String; taxYear String; moduleVersion String; profile Json; datasetHash String;
                      result Json; createdAt DateTime @default(now()) }   // calculation history / audit
model ApiUsage      { id String @id; provider String; at DateTime; requests Int; bytes Int; errors Int }
```

Today the in-memory equivalents are: orchestrator cache (`analyze.ts`), FX cache, usage counters (`http.ts`).

## 5. Provider interface

```ts
interface DataProvider {
  id: string; protocol: ProtocolId;
  supports(kind: "evm" | "solana" | "demo"): boolean;
  fetch(address, { http, since?, now }): Promise<{ events, openPositions, warnings, report }>;
}
```
Providers receive a metered `http` object — they cannot reach the network any other way, so all
consumption is counted. `since` enables incremental sync (used for Hyperliquid, whose P&L is source-reported;
Polymarket refetches fully because cost basis needs the full history).

| Provider | Status | Notes |
|---|---|---|
| MockDataProvider | live | Deterministic synthetic data, every event labelled `mock`, markets prefixed `[DEMO]` |
| HyperliquidDataProvider | **live** (tested 2026-11-02) | `userFillsByTime`, `userFunding`, `userNonFundingLedgerUpdates`, `clearinghouseState`. 10,000-fill API cap flagged |
| PolymarketDataProvider | **live** (Data API v2, re-verified 2026-11-03) | `/v2/activity` (cursor paging, `start=1` for full history), `/v2/positions?status=REDEEMABLE_LOST`. 83/84 fully closed markets matched Polymarket's own realized P&L (`/v2/positions?status=CLOSED`) within $0.02. v1 was retired on 2 Nov 2026. Combo (multi-leg) activity is excluded with a warning |
| BulkDataProvider | **live** (verified 2026-11-03) | Bulk Trade (Solana perps), mainnet `POST mainnet-api1.bulk.trade/api/v1/account` (`exchange-api.bulk.trade` is testnet). Realized P&L rebuilt from fills (account-perspective `isBuy`; fees signed as P&L, negative = paid) + fundingHistory + activityHistory; the closed-positions index lags and is not used. Self-checks against `fullAccount` totals and cash balance. Two live accounts matched Bulk's realized/fee/funding totals (to $0.006 on $544k) |
| HertzFlowDataProvider | **live** (verified 2026-11-03) | BNB Chain, GMX v2-style. `GET data-statistics-query.mainnet.htzfl.link/api/v1/bsc/user/trades` (cursor) — the service HertzFlow's own app uses; undocumented. USD 30-dp, tokens 18-dp. Net per close = gross P&L + price impact − fees − profit share − liquidation fee + loss rebate; all 6 closes of one live wallet matched on-chain USD1 payouts within $0.01 |
| SurfDataProvider | disabled stub | Surf Data API base/auth/credits verified from docs; endpoint shapes not yet verified |

## 6. Financial methodology

- Realized P&L: Hyperliquid's `closedPnl` per fill (source-verified). Polymarket: weighted-average cost per
  outcome token via `PositionBook`; REDEEM/MERGE close all held tokens of the condition at `usdcSize` proceeds;
  resolved-at-0 unredeemed positions become `PM_SETTLE_LOSS`.
- Fees: Hyperliquid `fee` (negative = maker rebate); Polymarket `usdcSize − size×price`.
- Funding: Hyperliquid `userFunding.delta.usdc` (+ received, − paid).
- Unrealized P&L: reported as open positions, never taxed.
- FX: each event converted at the ECB rate on its date (most recent prior business day, ≤ 10 days back,
  otherwise reported missing). Final tax → USD at the rate at tax-year end (or latest available).
  PKR, LKR, VND, NGN, AED, RUB and UAH are not published by the ECB: daily snapshots from fawazahmed0's currency-api
  (jsDelivr CDN, data from March 2024), fetched only for days with activity (≥ 6 days apart, ≤ 150 per
  analysis) and cached permanently (each day's full table, so new currencies need no refetch). Cached
  FX tables are refetched if they lack rates for a supported currency.
- No LLM is involved in any calculation. All functions are pure and reproducible; the workbook's Summary tab
  records the dataset fingerprint, module version, inputs and data warnings.

## 6a. Accountant workbook

`src/lib/workbook.ts` builds one .xlsx (opens directly in Google Sheets: File → Import → Upload) with four tabs:
Summary · Tax calculation (lines, SUM total, assumptions, uncertainties, reporting, references) · Transactions
(every event in the tax year: USD and local amounts, FX rate and date, data quality, transaction/market links,
SUM totals) · By asset or market. Amounts are numeric cells, dates are date cells, header rows are frozen.
The writer (`write-excel-file`) is loaded only when the user clicks download. It replaced the earlier
CSV / audit JSON / print-to-PDF exports.

## 7. Tax modules (v1.0.0 each)

Modules whose rules are new, pending or unclear set `provisional` on the result; the dashboard shows it as a
warning chip next to the module version.

| Country | Year | Perps | Prediction markets | Notes |
|---|---|---|---|---|
| 🇮🇳 India | FY Apr–Mar | s.115BBH 30%, no loss set-off (or business income at slabs if "Business") | s.115BB 30% on winning markets | 4% cess, surcharge, s.87A on slab income |
| 🇺🇸 USA | Calendar | Capital (ST/LT, §1222 netting), $3k loss limit | Capital (gambling alternative flagged) | Federal only, single filer, NIIT |
| 🇬🇧 UK | 6 Apr–5 Apr | CGT 18/24%, £3,000 AEA | Betting — not taxable | Basic-band allocation from other income |
| 🇩🇪 Germany | Calendar | §20 Termingeschäfte, 25% + Soli, €1,000 allowance | Gambling — not taxable | Rewards §22 Nr.3 (€256 Freigrenze, §32a tariff) |
| 🇦🇺 Australia | Jul–Jun | Net capital gain at marginal rates (or revenue account) | Gambling — not assessable | LITO, 2% Medicare, CGT discount >12 months |
| 🇨🇳 China* | Calendar | Property-transfer income 20% | Incidental income 20% per winning market | No crypto-specific law |
| 🇫🇷 France | Calendar | PFU 30% (2025) / 31.4% (2026) | Gambling — not taxable | Assumes the year's result was converted to EUR |
| 🇮🇩 Indonesia* | Calendar | Final tax 1% of sale value (0.2% before Aug 2025) | Same | PMK 50/2025; turnover-based |
| 🇯🇵 Japan | Calendar | Miscellaneous income 5–45% + 2.1% + 10% | Occasional income (½ of wins − ¥500k) | 20% separate tax expected 2028 |
| 🇲🇾 Malaysia | Calendar | Not taxable (business: 0–30%) | Gambling — not taxable | Badges of trade |
| 🇳🇬 Nigeria | Calendar | CGT 10% (2025) / income bands 0–25% (2026) | Same as perps | Nigeria Tax Act 2025 |
| 🇵🇰 Pakistan* | Jul–Jun | s.37 capital gains at non-salaried slabs | Same as perps | Crypto-specific rate proposed, unconfirmed |
| 🇵🇭 Philippines | Calendar | Graduated rates 0–35% | Same as perps | No crypto-specific BIR issuance |
| 🇷🇺 Russia | Calendar | Digital-currency base: 13% to ₽2.4m, 15% above | Same as perps | Federal Law 418-FZ (from 2025) |
| 🇸🇬 Singapore | Calendar (assessed next YA) | Not taxable (traders: 0–24%) | Gambling — not taxable | IRAS digital tokens guide |
| 🇿🇦 South Africa | Mar–Feb | CGT: R40k/R50k exclusion, 40% inclusion (traders: in full) | Capital (foreign gambling not excluded) | SARS tables to 2027 |
| 🇰🇷 South Korea* | Calendar | 0% to 2026; 22% above ₩2.5m from 2027 | Same as perps | Start date could slip again |
| 🇱🇰 Sri Lanka* | Apr–Mar | CGT 10%, 15% from 5 Jun 2026 | Same as perps | Amendment Act No. 11 of 2026 |
| 🇹🇷 Türkiye* | Calendar | No crypto tax in force | Same | 2026 bill status disputed |
| 🇻🇳 Vietnam* | Calendar | 0.1% of transfer value from 27 Mar 2026 | Same | Circular 32/2026; licensed platforms |
| 🇺🇦 Ukraine* | Calendar | 18% PIT + 5% military levy | Same as perps | Virtual-asset bill 10225-d pending |
| 🇦🇪 UAE (Dubai) | Calendar | No personal tax (business > AED 1m turnover: 9% above AED 375k) | Same | Corporate Tax for natural persons |

\* provisional

Each result lists what was taxed, the rule, the calculation, assumptions, uncertainties, missing data,
reporting obligations and references. Years without verified parameters are flagged.

## 8. Design system

Tokens in `src/app/globals.css`: `--bg #03060f`, midnight surfaces, electric blue `#3d7bff`, cyan `#38e1ff`,
restrained violet `#8b6cff`, good/bad/warn. Type: Geist (UI), Geist Mono (figures, tabular nums),
Instrument Serif italic (single display accent). Glass = translucent midnight + 18px blur + hairline border.

- **Caustic Pool background** — adapted from OpenDesign's official plugin (MIT, source inspected on GitHub:
  `nexu-io/open-design/plugins/_official/examples/webgl-caustic-pool/example.html`). Same caustic network and
  ripple model; recoloured, half-resolution rendering, pauses off-screen/hidden, reduced-motion static frame,
  CSS fallback without WebGL2, `pointer-events: none`. Landing hero only.
- **Careers showcase** — inspected; it is a design study, not an installable skill/plugin/component. Its
  patterns (layered stage, scene transitions that recede/blur, literal labels) informed the wallet bar halo
  layers, the scan → results transition and the blur-in final figure. No showcase code was used.
- Flags are inline SVG (emoji flags do not render on Windows).
- Protocol icons (`public/protocols/*.png`, 64 px) are each project's own site icon, shown beside every event's
  source link and on the landing page protocol badges (`ProtocolLogo`).
