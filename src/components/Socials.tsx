import Link from "next/link";
import { SOCIAL } from "@/lib/social";

export function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

const LEGAL_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/legal#disclaimer", label: "Disclaimer" },
  { href: "/legal#privacy", label: "Privacy" },
  { href: "/legal#terms", label: "Terms of use" },
];

/** Site footer: brand, legal links and the builder's profiles. */
export function SiteFooter() {
  const social = "grid h-10 w-10 place-items-center rounded-full border border-line bg-bg/40 text-ink-2 backdrop-blur transition hover:border-line-strong hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60";
  return (
    <footer className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
      <div className="grid gap-8 border-t border-line py-10 sm:grid-cols-3 sm:items-start">
        <div className="text-center sm:text-left">
          <Link href="/" className="font-serif text-[28px] italic leading-none text-white">Gencaso</Link>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">Crypto tax estimates for Perp DEX, Prediction Market and NFT traders.</p>
        </div>

        <nav aria-label="Docs and legal" className="text-center">
          <div className="text-[11px] uppercase tracking-[0.2em] text-ink-3">Resources</div>
          <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}><Link href={l.href} className="text-ink-2 transition hover:text-white">{l.label}</Link></li>
            ))}
          </ul>
        </nav>

        <div className="text-center sm:text-right">
          <div className="text-[11px] uppercase tracking-[0.2em] text-ink-3">Follow the build</div>
          <div className="mt-3 flex justify-center gap-2 sm:justify-end">
            <a href={SOCIAL.x.url} target="_blank" rel="noopener noreferrer" aria-label={`X: ${SOCIAL.x.handle}`} title={SOCIAL.x.handle} className={social}><XIcon size={15} /></a>
            <a href={SOCIAL.github.url} target="_blank" rel="noopener noreferrer" aria-label={`GitHub: ${SOCIAL.github.handle}`} title={SOCIAL.github.handle} className={social}><GitHubIcon size={17} /></a>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center justify-between gap-2 border-t border-line py-5 text-[11px] text-ink-3 sm:flex-row">
        <span>© {new Date().getFullYear()} Gencaso</span>
        <span>Estimates only · not tax, legal or financial advice · read-only, never your keys</span>
      </div>
    </footer>
  );
}
