# Gencaso 🪼

**Get your crypto tax ready.** Paste a public wallet, pick a country, and get an auditable tax estimate in USD and your local currency for **Perpetual DEX, Prediction Market and NFT** activity. Switch between 22 countries instantly: the same data is re-taxed in your browser, with no new requests.

🌐 **[gencaso.xyz](https://gencaso.xyz)**

> Estimates only — not tax, legal or financial advice. Read-only: Gencaso never asks for private keys or seed phrases.

## What is Gencaso?

Perp, prediction-market and NFT traders have the messiest tax data in crypto: thousands of fills, hourly funding, markets that resolve to zero, NFTs paid in ETH. Gencaso pulls that history from each protocol's public data, turns it into one standard list of events, and applies the tax rules of the country you pick. Every figure links back to its transaction, and gaps such as missing history or unsettled law are shown, never hidden.

**How it works:** paste a public wallet → pick your country → get your estimated tax.

## Features

- **Live data:** Hyperliquid, Polymarket, Bulk Trade, HertzFlow, GMX (Arbitrum, Avalanche) and OpenSea (public APIs, read-only)
- **DeFi and CeFi modes:** combine up to 5 wallets, or upload exchange exports (read in your browser)
- **Roadmap:** DefiLlama's top 67 per category, shown in the docs; each is added once verified against real accounts
- **Never stuck on one source:** if OpenSea is down, NFT trades are rebuilt from on-chain data (Ethereum, Optimism, Base, Arbitrum, Polygon). With a Surf key, Surf fills in Hyperliquid history beyond the API's 10,000-fill limit and stands in for Polymarket when it's blocked
- **22 countries**, each a separate, versioned tax module with cited sources and a list of what remains uncertain
- **Every number traceable:** normalised events with explorer links, cost basis and fees
- **Accountant report:** one `.xlsx` (Summary, Tax calculation, Transactions, By asset) that opens in Google Sheets
- **Shareable tax card:** a PNG of the estimate, made in the browser
- No accounts, no tracking, no AI in the maths: profits, losses and tax are computed in code and covered by unit tests

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # financial and tax unit tests
npm run typecheck
npm run build
```

Click **Try the demo wallet** for a clearly labelled synthetic dataset.

### Optional environment variables

Put these in `.env.local` (never commit it):

| Variable | Purpose |
|---|---|
| `OPENSEA_API_KEY` | **Recommended.** OpenSea requires a key. Without one, Gencaso tries a free 7-day key; if OpenSea still can't be read, it rebuilds NFT trades from on-chain data on Ethereum, Optimism, Base, Arbitrum and Polygon (no key needed). Get a key at opensea.io (Settings → Developer) to cover every chain. |
| `OPENSEA_AUTO_KEY=0` | Turn automatic OpenSea keys off |
| `SURF_API_KEY` | Optional [Surf](https://asksurf.ai) Data API key (server-side only). Adds older Hyperliquid fills and a Polymarket stand-in. Without it, Surf is simply skipped. |
| `SURF_MIN_BALANCE` | Skip Surf when the workspace has fewer credits than this (default 500) |
| `SURF_MAX_PAGES` | Cap on Surf backfill pages per analysis (default 20) |

API usage counters: `GET /api/usage`.

## Coming soon 👀

Planned, not live yet:

- **More chains**: Solana, Base, Arbitrum and more wallets in one combined report
- **CeFi taxation**: centralised-exchange history alongside on-chain trades
- **Yield farming & more protocols**: staking, liquidity pools, lending and airdrops
- **Catch on-chain scammers**: work with governments to trace and flag scam wallets
- **Find your CA**: match with a crypto-savvy accountant in your country for quick confirmation
- **Surf fish**: live API usage per second
- **Web3 & AI hackathons**: remote hackathons open to builders in your country

Watch this repo for updates.

## Docs

Full user docs at `/docs` on the site · [Architecture](docs/ARCHITECTURE.md) · [Roadmap and verification log](docs/ROADMAP.md) · Legal page at `/legal`

## Contributing

Issues and pull requests are welcome, especially tax-rule corrections with a link to an official source.

## License

[MIT](LICENSE) © 2026 Aceop

Protocol names and logos in `public/protocols/` belong to their owners and are used only to show supported integrations; they are not covered by the MIT license. The caustic background is adapted from OpenDesign's Caustic Pool plugin (MIT).

Follow the build: [X @aceop_xyz](https://x.com/aceop_xyz) · [GitHub](https://github.com/Aceop-001)
