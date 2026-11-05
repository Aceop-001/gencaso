# Gencaso

**Get your crypto tax ready.** Paste a public wallet, pick a country, and get an auditable tax estimate in USD for **Perpetual DEX, Prediction Market and NFT** activity. Switch between 22 countries instantly: the same data is re-taxed in your browser, with no new requests.

> Estimates only — not tax, legal or financial advice. Read-only: Gencaso never asks for private keys or seed phrases.

## Features

- **Live data:** Hyperliquid, Polymarket, Bulk Trade, HertzFlow and OpenSea (public APIs, read-only)
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
| `OPENSEA_API_KEY` | **Recommended.** OpenSea requires a key. Without one, Gencaso tries a free 7-day key, but OpenSea's key service is often busy (HTTP 429), so NFT data can be unavailable. Get a key at opensea.io (Settings → Developer). |
| `OPENSEA_AUTO_KEY=0` | Turn automatic OpenSea keys off |

API usage counters: `GET /api/usage`.

## Docs

Full user docs at `/docs` on the site · [Architecture](docs/ARCHITECTURE.md) · [Roadmap and verification log](docs/ROADMAP.md) · Legal page at `/legal`

## Contributing

Issues and pull requests are welcome, especially tax-rule corrections with a link to an official source.

## License

[MIT](LICENSE) © 2026 Aceop

Protocol names and logos in `public/protocols/` belong to their owners and are used only to show supported integrations; they are not covered by the MIT license. The caustic background is adapted from OpenDesign's Caustic Pool plugin (MIT).

Follow the build: [X @aceop_xyz](https://x.com/aceop_xyz) · [GitHub](https://github.com/Aceop-001)
