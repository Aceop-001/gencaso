import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "@/components/Flag";
import { ProtocolLogo } from "@/components/ProtocolLogo";
import { RoadmapLists, roadmapMeta } from "@/components/RoadmapLists";
import { DocTable, Section, Subpage } from "@/components/Subpage";
import { COUNTRY_DOCS } from "@/lib/docsCountries";
import { PROTOCOLS } from "@/lib/registry";
import { SOCIAL } from "@/lib/social";
import { JURISDICTIONS } from "@/lib/tax";

export const metadata: Metadata = {
  title: "Docs · Gencaso",
  description: "How Gencaso works: supported protocols, country tax rules, calculations, downloads, limits and self-hosting.",
};

/** Countries whose results carry a "provisional" warning (rules new, pending or unclear). */
const PROVISIONAL = new Set(["CN", "ID", "PK", "KR", "LK", "TR", "UA", "VN"]);

const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "quick-start", title: "Quick start" },
  { id: "cefi", title: "CeFi mode (exchanges)" },
  { id: "results", title: "Reading your results" },
  { id: "protocols", title: "Supported protocols" },
  { id: "roadmap", title: "Roadmap (DefiLlama top 67)" },
  { id: "countries", title: "Countries & tax rules" },
  { id: "calculations", title: "How the numbers work" },
  { id: "downloads", title: "Downloads" },
  { id: "limits", title: "Limits & known gaps" },
  { id: "privacy", title: "Privacy & security" },
  { id: "self-hosting", title: "Self-hosting & API" },
  { id: "contributing", title: "Contributing" },
  { id: "faq", title: "FAQ" },
];

export default function DocsPage() {
  const live = PROTOCOLS.filter((p) => p.status === "live");
  const planned = PROTOCOLS.filter((p) => p.status === "planned");

  return (
    <Subpage
      eyebrow="Docs"
      title="How Gencaso"
      accent="works."
      intro={<p>Everything about Gencaso: what it reads, how it calculates, what each country&apos;s rules are, and where its limits are. {JURISDICTIONS.length} countries, {live.length} live protocols.</p>}
      sections={SECTIONS}
    >
      <Section id="overview" title="Overview">
        <p>
          <strong>Gencaso estimates crypto tax for traders of Perpetual DEXs, Prediction Markets and NFTs.</strong> Paste a public wallet address and pick a country.
          Gencaso fetches the wallet&apos;s trading history from each supported protocol, turns it into one standard list of events, and applies that country&apos;s tax rules to show an estimated tax in USD and in local currency.
        </p>
        <ul>
          <li><strong>Read-only:</strong> only a public address is needed. Gencaso never asks for keys, seed phrases or signatures.</li>
          <li><strong>Instant country switching:</strong> the wallet&apos;s data is fetched once. Switching country re-runs the maths in your browser with 0 API calls.</li>
          <li><strong>Traceable:</strong> every figure comes from listed events, each with a link to its transaction or market.</li>
          <li><strong>No AI in the maths:</strong> profits, losses, fees and tax are computed by ordinary, unit-tested code. Nothing is guessed by a language model.</li>
          <li><strong>Honest about gaps:</strong> missing history, unsettled law and assumptions are shown next to the result, never hidden.</li>
        </ul>
        <p>Gencaso gives <strong>estimates, not tax advice</strong>. See the <Link href="/legal#disclaimer" className="text-cyan hover:underline">disclaimer</Link>.</p>
      </Section>

      <Section id="quick-start" title="Quick start">
        <ol>
          <li><strong>Paste a public address</strong> into the search box: an EVM address (<code>0x…</code>) or a Solana address.</li>
          <li><strong>Pick your country</strong> from the list. You can change it later without reloading anything.</li>
          <li><strong>Click Analyse.</strong> Gencaso checks every supported protocol for that address. Large wallets can take 10–30 seconds the first time.</li>
          <li><strong>Choose the tax year</strong>, trader type (individual or business) and any other income you have, since some countries tax at progressive rates.</li>
          <li><strong>Download</strong> the accountant spreadsheet or a shareable tax card.</li>
        </ol>
        <p>No wallet handy? Click <strong>Try the demo wallet</strong> on the homepage for a clearly labelled synthetic dataset.</p>
      </Section>

      <Section id="cefi" title="CeFi mode (exchanges)">
        <p>Centralised exchanges don&apos;t publish your trades, so in <strong>CeFi mode</strong> you upload an export instead of pasting a wallet. The file is read <strong>in your browser</strong>: your trades never leave your device. Only the dates are sent to the server, to fetch exchange rates.</p>
        <ol>
          <li>Switch to <strong>CeFi · exchanges</strong> on the homepage and click <strong>Download the CSV template</strong>.</li>
          <li>Copy rows from your exchange&apos;s futures P&amp;L or transaction-history export into it. Several files and exchanges can be uploaded together.</li>
          <li>Drop the file in, pick your country and click <strong>Calculate</strong>.</li>
        </ol>
        <DocTable
          head={["Column", "What to enter"]}
          rows={[
            [<code key="d">date</code>, "UTC date or date-time, e.g. 2026-03-10 or 2026-03-10T14:05:00Z"],
            [<code key="e">exchange</code>, "e.g. Binance (optional)"],
            [<code key="m">market</code>, "e.g. BTCUSDT (optional)"],
            [<code key="t">type</code>, "realized_pnl, funding, fee, deposit or withdrawal"],
            [<code key="a">amount_usd</code>, "realized_pnl and funding: signed (+ profit or received, − loss or paid). fee, deposit, withdrawal: positive. USDT and USDC count as USD."],
            [<code key="f">fee_usd</code>, "Optional fee paid on a realized_pnl row"],
            [<code key="n">note</code>, "Optional"],
          ]}
        />
        <p>Rows that can&apos;t be read are skipped and listed with their line number; nothing is guessed. Holding periods aren&apos;t in the template, so gains are treated as short-term. <strong>Automatic import</strong> of each exchange&apos;s own export format (Binance, OKX, Bybit, Coinbase, Kraken and more) is coming, and each one will be checked against real export files first.</p>
      </Section>

      <Section id="results" title="Reading your results">
        <h3>The headline</h3>
        <p>The big number is the <strong>estimated final tax</strong> for the selected country and tax year, in USD, with the local-currency amount underneath. The chips beside it show how long the recalculation took, the tax module version, and any <strong>provisional</strong> warning when a country&apos;s rules are unsettled.</p>
        <h3>Key figures</h3>
        <DocTable
          head={["Figure", "What it means"]}
          rows={[
            ["Realized profit / losses", "Sum of profitable and losing closed trades in the tax year, before fees and funding."],
            ["Net realized P&L", "Realized profit minus realized losses."],
            ["Funding (net)", "Perp funding received minus funding paid."],
            ["Trading fees", "Fees paid (maker rebates reduce this)."],
            ["Prediction markets", "Net result of resolved and sold prediction-market positions, with markets won and lost."],
            ["NFT sales", "Gain on NFTs sold, and how many sales had no known purchase price."],
            ["Taxable amount", "The amount the country's rules actually tax, which can differ a lot from your profit."],
            ["Estimated tax", "Tax under the selected country's rules, in USD and local currency."],
            ["Effective rate", "Estimated tax ÷ net trading result."],
          ]}
        />
        <h3>How this tax was calculated</h3>
        <p>Each tax line names what was taxed, the category (head of income), the base, the rate, the legal rule and a plain explanation. Below it are the <strong>methodology</strong>, <strong>assumptions</strong>, <strong>what remains uncertain</strong>, <strong>reporting requirements</strong> and <strong>legal references</strong> with links to official sources.</p>
        <h3>Data sources and quality labels</h3>
        <p>The Data sources panel shows each protocol&apos;s status (ok, empty, error), how many events and requests it used, and any data warnings. Every event carries a quality label:</p>
        <DocTable
          head={["Label", "Meaning"]}
          rows={[
            [<strong key="v">verified</strong>, "Taken directly from the protocol's official data."],
            [<strong key="e">estimated</strong>, "Derived by Gencaso from partial data."],
            [<strong key="m">missing</strong>, "Needed data is absent (for example an NFT sale with no purchase)."],
            [<strong key="u">unsupported</strong>, "Recognised but not modelled, so not included."],
            [<strong key="k">mock</strong>, "Synthetic demo data, never real."],
          ]}
        />
      </Section>

      <Section id="protocols" title="Supported protocols">
        <p>Live integrations were tested against real wallets on the date shown. Gencaso only labels a protocol live after its numbers have been checked against the protocol&apos;s own totals or on-chain data.</p>
        <div className="space-y-3">
          {live.map((p) => (
            <div key={p.id} className="rounded-2xl border border-line bg-surface-2/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <ProtocolLogo protocol={p.id} size={20} />
                <span className="text-[15px] font-medium text-ink">{p.name}</span>
                <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-ink-3">{p.category === "perp" ? "Perp DEX" : p.category === "prediction" ? "Prediction market" : "NFT"}</span>
                {p.verifiedOn && <span className="text-[11px] text-good">verified {p.verifiedOn}</span>}
              </div>
              <p className="mt-2 text-[13px] text-ink-3">Chains: {p.chains.join(", ")}. Address: {p.accountId}.</p>
              <p className="mt-1 text-[13px] text-ink-3">History: {p.history}</p>
              {p.limitations.length > 0 && (
                <ul className="mt-2 text-[13px] text-ink-3">
                  {p.limitations.map((l) => <li key={l}>{l}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p><strong>Planned</strong> ({planned.length}): {planned.map((p) => p.name).join(", ")}. These are not connected yet.</p>
      </Section>

      <Section id="roadmap" title="Roadmap (DefiLlama top 67)">
        <p>Where Gencaso is heading: the top {roadmapMeta.perCategory} protocols in each category on DefiLlama, ranked by total value locked (snapshot {roadmapMeta.fetchedOn}). <strong className="text-good">Live</strong> means supported and verified in Gencaso today; everything else is planned. Each one is added only after its numbers are checked against real accounts.</p>
        <RoadmapLists />
        <p className="text-xs text-ink-3">Source: {roadmapMeta.source}. Spot DEXs, lending, staking and yield also need Gencaso&apos;s upcoming spot cost-basis engine.</p>
      </Section>

      <Section id="countries" title="Countries & tax rules">
        <p>Each country is an independent, versioned module with its own tax-year calendar, rates for each supported year, legal references and caveats. The table summarises how each treats the three activity types for an individual investor. Many countries tax business traders differently; pick &quot;Business / trader&quot; on the results page to see that.</p>
        <DocTable
          head={["Country", "Perps", "Prediction markets", "NFTs", "Basis", "Module · years"]}
          rows={JURISDICTIONS.map((j) => {
            const d = COUNTRY_DOCS[j.code];
            return [
              <span key="c" className="flex items-center gap-2 whitespace-nowrap text-ink">
                <Flag code={j.code} size={18} />
                {j.name}
                {PROVISIONAL.has(j.code) && <span className="rounded-full border border-warn/40 px-1.5 text-[10px] text-warn" title="Rules new, pending or unclear">prov.</span>}
              </span>,
              d.perps,
              d.prediction,
              d.nfts,
              <span key="b" className="text-ink-3">{d.basis}</span>,
              <span key="m" className="block min-w-[96px] font-mono text-[12px] leading-relaxed text-ink-3">
                <span className="text-ink-2">{j.moduleVersion}</span>
                <br />
                {j.currency}
                {j.supportedYears.map((y) => <span key={y} className="block">{y}</span>)}
              </span>,
            ];
          })}
        />
        <p><span className="text-warn">prov.</span> = provisional: the country&apos;s crypto rules are new, pending or unclear, so the result relies on an assumption explained on the results page.</p>
        <p>Tax years outside the supported list are shown but flagged &quot;No verified rules&quot;. Rules are checked against official sources; each change is recorded in the <a href={`${SOCIAL.github.url}/blob/main/docs/ROADMAP.md`} target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">verification log</a>.</p>
      </Section>

      <Section id="calculations" title="How the numbers work">
        <h3>1. One standard event list</h3>
        <p>Every protocol&apos;s raw data is converted into the same event format: opens, increases, reduces, closes, flips, liquidations, funding, prediction-market buys, sells, redemptions and losses, NFT buys and sells, rewards, deposits and withdrawals. Each event keeps its timestamp, quantity, price, cost basis, proceeds, realized P&amp;L, fee, funding and transaction hash. Event IDs are stable, so repeated syncs never double-count.</p>
        <h3>2. Profit and loss</h3>
        <ul>
          <li><strong>Perps:</strong> realized P&amp;L as reported by the protocol for each fill, or rebuilt from fills where the protocol doesn&apos;t report it. Fees and funding are kept separate.</li>
          <li><strong>Prediction markets:</strong> weighted-average cost per outcome token. Redemptions and merges close positions at their payout; markets resolved against you become a realized loss.</li>
          <li><strong>NFTs:</strong> each token is matched to its own purchase (specific identification). Sales with no purchase in the history are flagged and not counted as gains.</li>
          <li><strong>Deposits, withdrawals and transfers</strong> never count as profit or loss.</li>
          <li><strong>Open positions</strong> are listed but never taxed: unrealized results aren&apos;t taxable anywhere Gencaso supports.</li>
        </ul>
        <h3>3. Prices and currency</h3>
        <ul>
          <li>Trades settle in stablecoins, valued at 1 USD.</li>
          <li>NFT payments in ETH, POL, SOL, HYPE and others use that day&apos;s closing price (Coinbase daily candles; Hyperliquid for HYPE).</li>
          <li>Each event is converted to local currency at the official rate on its date: European Central Bank rates, with a public currency-rate dataset for currencies the ECB doesn&apos;t publish (PKR, LKR, VND, NGN, AED, RUB, UAH).</li>
          <li>The final tax is shown in USD at the rate at the end of the tax year, or the latest available.</li>
        </ul>
        <h3>4. The tax</h3>
        <p>The country module groups events into its categories (for example capital gains, miscellaneous income or gambling), applies allowances, loss rules, holding-period discounts and rate tables for that year, and returns each line with its legal basis. Results are cached per country, year and profile, so switching back and forth is instant.</p>
      </Section>

      <Section id="downloads" title="Downloads">
        <h3>Report for your accountant (.xlsx)</h3>
        <p>One spreadsheet that opens directly in Excel or Google Sheets (File → Import → Upload), with four tabs:</p>
        <ul>
          <li><strong>Summary:</strong> wallet, country, tax year, inputs, totals, module version and data warnings.</li>
          <li><strong>Tax calculation:</strong> every tax line with base, rate, rule and explanation, plus assumptions, uncertainties, reporting duties and references.</li>
          <li><strong>Transactions:</strong> every event in the tax year with USD and local amounts, the exchange rate used, a data-quality label and clickable transaction links.</li>
          <li><strong>By asset / market:</strong> results grouped per coin or market.</li>
        </ul>
        <h3>Tax card (.png)</h3>
        <p>The <strong>Download tax card</strong> button on the results page saves a 2400×1350 image of the estimate, ready to share. It shows the country, amount, tax year, net trading result, taxable amount, effective rate and short wallet address, and always says &quot;Estimate · not tax advice&quot;. Demo-wallet cards are marked &quot;mock data&quot;.</p>
        <p>Both files are created in your browser. Nothing is uploaded.</p>
      </Section>

      <Section id="limits" title="Limits & known gaps">
        <ul>
          <li><strong>Hyperliquid&apos;s 10,000-fill limit:</strong> its API only returns a wallet&apos;s latest 10,000 fills. Gencaso tells you the date older trades are missing from; funding and transfers are still complete.</li>
          <li><strong>Network blocks:</strong> some networks block Polymarket&apos;s API. That source then shows an error and the rest of the analysis continues.</li>
          <li><strong>NFT proceeds are gross:</strong> marketplace fees and royalties aren&apos;t in the sale data. Minted, airdropped or transferred-in NFTs have no purchase price; add the cost yourself.</li>
          <li><strong>Out of scope:</strong> spot trading, staking, lending, liquidity pools and centralised exchanges. Some of these are on the roadmap in the ⋯ menu.</li>
          <li><strong>Unsettled law:</strong> how perps, prediction markets and NFTs are taxed is unclear in many countries. Provisional results say so.</li>
          <li><strong>Personal situation:</strong> Gencaso doesn&apos;t know your residency, other deductions, carried-forward losses from other sources or local and state taxes, unless the result says it includes them.</li>
        </ul>
      </Section>

      <Section id="privacy" title="Privacy & security">
        <ul>
          <li>Only public data is read. Inputs that look like private keys or seed phrases are rejected before anything is sent.</li>
          <li>API keys stay on the server and are never sent to your browser.</li>
          <li>Fetched wallet data is kept in server memory for up to 10 minutes of freshness and reused, then refreshed on the next analysis. Nothing is stored in a database.</li>
          <li>No accounts, no tracking or advertising cookies. Tax maths, the spreadsheet and the tax card all run in your browser.</li>
        </ul>
        <p>Full details are in the <Link href="/legal#privacy" className="text-cyan hover:underline">privacy policy</Link>.</p>
      </Section>

      <Section id="self-hosting" title="Self-hosting & API">
        <p>Gencaso is open source under the MIT license: <a href={SOCIAL.github.url} target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">{SOCIAL.github.handle}</a>. It runs on Node.js 20+ with Next.js 15, React 19 and TypeScript.</p>
        <pre className="overflow-x-auto rounded-2xl border border-line bg-[#050a1a] p-4 font-mono text-[12.5px] leading-relaxed text-ink">{`git clone ${SOCIAL.github.url}.git
cd gencaso
npm install
npm run dev     # http://localhost:3000
npm test        # financial and tax unit tests`}</pre>
        <h3>Environment variables (optional)</h3>
        <DocTable
          head={["Variable", "Purpose"]}
          rows={[
            [<code key="a">OPENSEA_API_KEY</code>, "Recommended. OpenSea requires an API key. Without one, Gencaso tries to get a free 7-day key, but OpenSea's key service often refuses (HTTP 429). Gencaso then rebuilds NFT trades from on-chain data on Ethereum, Optimism, Base, Arbitrum and Polygon (free, no key) and tries OpenSea again every 15 minutes. Get a key in your OpenSea account under Settings → Developer to cover every chain."],
            [<code key="b">OPENSEA_AUTO_KEY=0</code>, "Turns automatic OpenSea keys off."],
          ]}
        />
        <h3>Endpoints</h3>
        <DocTable
          head={["Endpoint", "What it does"]}
          rows={[
            [<code key="a">POST /api/analyze</code>, <span key="b">Body <code>{`{"address": "0x…", "refresh": false}`}</code>. Returns the wallet&apos;s normalised events, open positions, exchange rates, per-source reports and data warnings. Limited to 6 analyses per minute per IP. Repeat requests within 10 minutes reuse the cached data.</span>],
            [<code key="c">GET /api/usage</code>, "Requests, bytes and errors per data provider since the server started."],
          ]}
        />
      </Section>

      <Section id="contributing" title="Contributing">
        <ul>
          <li><strong>Found a wrong tax rule?</strong> Open an issue on <a href={`${SOCIAL.github.url}/issues`} target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">GitHub</a> with a link to the official source. Corrections with sources are the most valuable contribution.</li>
          <li><strong>Add a country:</strong> create a module in <code>src/lib/tax/jurisdictions/</code> that implements the <code>Jurisdiction</code> interface (tax-year calendar, supported years, <code>calculate</code>), register it in <code>src/lib/tax/index.ts</code>, and add tests.</li>
          <li><strong>Add a protocol:</strong> write a <code>DataProvider</code> in <code>src/lib/providers/</code> that converts the protocol&apos;s data into standard events, register it, and verify its totals against real wallets before marking it live.</li>
          <li>Run <code>npm test</code> and <code>npm run typecheck</code> before opening a pull request.</li>
        </ul>
      </Section>

      <Section id="faq" title="FAQ">
        <h3>Is this my real tax bill?</h3>
        <p>No. It&apos;s an estimate under the published rules for the selected country, based on public data. Use it to prepare and to talk to an accountant, not to file on its own.</p>
        <h3>Why does changing country not rescan my wallet?</h3>
        <p>The wallet&apos;s data doesn&apos;t depend on the country, so it&apos;s fetched once. Only the tax rules change, and they run in your browser.</p>
        <h3>Why is my tax higher than my profit would suggest?</h3>
        <p>Some countries tax each profitable trade without letting losses offset it (India, for example), or tax turnover instead of profit (Indonesia, Vietnam). The &quot;How this tax was calculated&quot; panel explains the rule.</p>
        <h3>Why is a number missing or marked provisional?</h3>
        <p>Either the source data is incomplete (see the data warnings) or the country&apos;s rules are unsettled. Gencaso shows the gap instead of guessing.</p>
        <h3>Is it safe to paste my address?</h3>
        <p>Yes. A public address can&apos;t move funds. Never paste a private key or seed phrase anywhere; Gencaso refuses them.</p>
        <h3>Who builds Gencaso?</h3>
        <p>Gencaso is built in the open by <a href={SOCIAL.x.url} target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">{SOCIAL.x.handle}</a>. Follow along on X or GitHub.</p>
      </Section>
    </Subpage>
  );
}
