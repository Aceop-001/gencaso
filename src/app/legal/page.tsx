import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/Socials";
import { SOCIAL } from "@/lib/social";

export const metadata: Metadata = {
  title: "Legal · Gencaso",
  description: "Disclaimer, privacy and terms of use for Gencaso.",
};

const UPDATED = "5 November 2026";

const SECTIONS = [
  { id: "disclaimer", title: "Disclaimer" },
  { id: "privacy", title: "Privacy" },
  { id: "terms", title: "Terms of use" },
  { id: "third-parties", title: "Third-party data & trademarks" },
  { id: "contact", title: "Changes & contact" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="glass scroll-mt-24 rounded-3xl p-6 sm:p-8">
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-2 [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{children}</div>
    </section>
  );
}

export default function LegalPage() {
  return (
    <main className="relative min-h-dvh overflow-x-clip">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px]" style={{ background: "radial-gradient(60% 80% at 20% 0%, rgba(61,123,255,.18), transparent 70%), radial-gradient(50% 70% at 90% 10%, rgba(139,108,255,.12), transparent 70%)" }} />

      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60" aria-label="Gencaso home">
          <Logo size={32} />
          <span className="block pr-[0.08em] font-serif text-[26px] italic leading-none tracking-[-0.01em] text-white">Gencaso</span>
        </Link>
        <Link href="/" className="rounded-full border border-line px-4 py-1.5 text-xs text-ink-2 transition hover:border-line-strong hover:text-white">← Back to Gencaso</Link>
      </header>

      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
        <div className="max-w-2xl">
          <div className="text-[11px] uppercase tracking-[0.28em] text-cyan">Legal</div>
          <h1 className="mt-3 text-[clamp(36px,6vw,64px)] font-semibold leading-[0.98] tracking-[-0.04em] text-ink">
            The <span className="font-serif font-normal italic text-transparent bg-clip-text bg-[linear-gradient(100deg,#9ec3ff_0%,#38e1ff_45%,#b9a6ff_100%)]">fine print.</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">Plain-language terms for using Gencaso. Last updated {UPDATED}.</p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[220px_1fr]">
          <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:self-start">
            <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 transition hover:border-line-strong hover:text-white lg:rounded-xl lg:border-transparent lg:px-3 lg:py-2 lg:text-sm lg:hover:bg-surface-2">{s.title}</a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-4">
            <Section id="disclaimer" title="Disclaimer">
              <p><strong>Gencaso gives estimates, not advice.</strong> Nothing on this site is tax, legal, accounting or financial advice, and using it does not create any professional relationship.</p>
              <ul>
                <li>Figures are estimates based on public on-chain and exchange data and on our reading of each country&apos;s published rules. They can be incomplete or wrong, and tax law changes.</li>
                <li>Choosing a country shows how its rules would apply for comparison only. It does not change your tax residency or what you owe.</li>
                <li>Crypto tax treatment, especially for perpetual futures, prediction markets and NFTs, is unsettled in many countries. Results marked &quot;provisional&quot; rely on assumptions we explain on the results page.</li>
                <li>Always confirm your figures with a qualified tax professional before filing or paying anything.</li>
              </ul>
            </Section>

            <Section id="privacy" title="Privacy">
              <p><strong>We never ask for private keys, seed phrases or wallet signatures</strong>, and we never move funds. Gencaso only reads public data.</p>
              <ul>
                <li><strong>What you give us:</strong> a public wallet address and, optionally, a country, tax year and &quot;other income&quot; figure.</li>
                <li><strong>How it&apos;s used:</strong> the address is sent from our server to the public data sources listed below to fetch that wallet&apos;s activity. Tax is then calculated in your browser.</li>
                <li><strong>What we keep:</strong> fetched wallet data is held temporarily in server memory so repeat lookups and country switches are fast. It is not sold or shared, and it is cleared when the server restarts.</li>
                <li><strong>No accounts or tracking:</strong> there is no sign-up, and we don&apos;t use advertising or analytics cookies.</li>
                <li><strong>Your downloads:</strong> the spreadsheet and the tax card are created in your browser and saved to your device. Anything you share afterwards is up to you.</li>
                <li>Wallet activity is public by nature. Anyone can look up any address, on Gencaso or on a block explorer.</li>
              </ul>
            </Section>

            <Section id="terms" title="Terms of use">
              <p>By using Gencaso you agree to these terms. If you don&apos;t agree, please don&apos;t use the site.</p>
              <ul>
                <li><strong>As is:</strong> Gencaso is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, including accuracy, completeness or fitness for a particular purpose.</li>
                <li><strong>Your responsibility:</strong> you are responsible for your own tax filings and payments, and for checking any figure before relying on it.</li>
                <li><strong>Limitation of liability:</strong> to the fullest extent the law allows, Gencaso and its builder are not liable for any loss, penalty, interest or damage arising from use of, or reliance on, the site or its outputs.</li>
                <li><strong>Fair use:</strong> don&apos;t abuse, overload, scrape or attempt to break the service, and don&apos;t use it for anything unlawful, including harassing or targeting other people.</li>
                <li><strong>Availability:</strong> features, supported protocols and countries may change or stop at any time. Items marked &quot;Coming soon&quot; are plans, not promises.</li>
              </ul>
            </Section>

            <Section id="third-parties" title="Third-party data & trademarks">
              <ul>
                <li>Wallet data comes from public APIs of Hyperliquid, Polymarket, Bulk Trade, HertzFlow and OpenSea, and from data partners where enabled. Prices come from Coinbase and Hyperliquid, and exchange rates from the European Central Bank (via Frankfurter) and a public currency-rate dataset.</li>
                <li>We don&apos;t control these services. Their data can be delayed, limited or wrong, and their own terms apply.</li>
                <li>Names and logos of protocols and countries are used only to show what Gencaso supports. They belong to their owners, and their use doesn&apos;t imply endorsement or partnership.</li>
              </ul>
            </Section>

            <Section id="contact" title="Changes & contact">
              <p>We may update this page as Gencaso grows. The date at the top shows the latest version, and continued use means you accept it.</p>
              <p>
                Questions or corrections? Reach the builder on X at{" "}
                <a href={SOCIAL.x.url} target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">{SOCIAL.x.handle}</a> or open an issue on GitHub at{" "}
                <a href={SOCIAL.github.url} target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">{SOCIAL.github.handle}</a>.
              </p>
            </Section>
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
