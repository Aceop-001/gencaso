import Link from "next/link";
import { LivingLogo } from "./LivingLogo";
import { SiteFooter } from "./Socials";

/** Shared layout for text pages (Docs, Legal): header, title, sticky contents list, footer. */
export function Subpage({
  eyebrow,
  title,
  accent,
  intro,
  sections,
  children,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  intro: React.ReactNode;
  sections: { id: string; title: string }[];
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-dvh overflow-x-clip">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px]" style={{ background: "radial-gradient(60% 80% at 20% 0%, rgba(61,123,255,.18), transparent 70%), radial-gradient(50% 70% at 90% 10%, rgba(139,108,255,.12), transparent 70%)" }} />

      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          {/* Same living jellyfish as the homepage: touch it and it dodges, then comes back */}
          <LivingLogo />
          <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60" aria-label="Gencaso home">
            <span className="block pr-[0.08em] font-serif text-[26px] italic leading-none tracking-[-0.01em] text-white">Gencaso</span>
          </Link>
        </div>
        <Link href="/" className="rounded-full border border-line px-4 py-1.5 text-xs text-ink-2 transition hover:border-line-strong hover:text-white">← Back to Gencaso</Link>
      </header>

      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
        <div className="max-w-2xl">
          <div className="text-[11px] uppercase tracking-[0.28em] text-cyan">{eyebrow}</div>
          <h1 className="mt-3 text-[clamp(36px,6vw,64px)] font-semibold leading-[0.98] tracking-[-0.04em] text-ink">
            {title} <span className="font-serif font-normal italic text-transparent bg-clip-text bg-[linear-gradient(100deg,#9ec3ff_0%,#38e1ff_45%,#b9a6ff_100%)]">{accent}</span>
          </h1>
          <div className="mt-4 text-[15px] leading-relaxed text-ink-2">{intro}</div>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-48px)] lg:self-start lg:overflow-y-auto">
            <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 transition hover:border-line-strong hover:text-white lg:rounded-xl lg:border-transparent lg:px-3 lg:py-2 lg:text-sm lg:hover:bg-surface-2">{s.title}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 space-y-4">{children}</div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="glass scroll-mt-24 rounded-3xl p-6 sm:p-8">
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-2 [&_code]:rounded-md [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-ink [&_h3]:pt-2 [&_h3]:text-[15px] [&_h3]:font-medium [&_h3]:text-ink [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_strong]:font-medium [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/** Scrollable table that never widens the page on phones. */
export function DocTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-line-strong text-[11px] uppercase tracking-[0.14em] text-ink-3">
            {head.map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top">
              {r.map((c, k) => <td key={k} className="px-2 py-2.5 text-ink-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
