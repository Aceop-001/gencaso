"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { CausticBackground } from "@/components/CausticBackground";
import { CefiPanel } from "@/components/CefiPanel";
import { LivingLogo } from "@/components/LivingLogo";
import { ProtocolLogo } from "@/components/ProtocolLogo";
import { Results } from "@/components/Results";
import { MoreMenu } from "@/components/MoreMenu";
import { roadmapPlannedCount } from "@/components/RoadmapLists";
import Link from "next/link";
import { ScanSequence } from "@/components/ScanSequence";
import { SiteFooter } from "@/components/Socials";
import { WalletBar } from "@/components/WalletBar";
import { buildCefiDataset, type CefiUpload } from "@/lib/cefi/dataset";
import { combineDatasets, walletsOf } from "@/lib/engine/combine";
import type { WalletDataset } from "@/lib/engine/schema";
import { shortAddr } from "@/lib/format";
import { PROTOCOLS } from "@/lib/registry";
import type { CountryCode } from "@/lib/tax";

type Phase = "idle" | "scanning" | "results";
type Mode = "defi" | "cefi";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  // On the results dashboard the fish stays in front instead of diving behind the panels
  useEffect(() => {
    const root = document.documentElement;
    if (phase === "results") root.dataset.fishDepth = "front";
    else delete root.dataset.fishDepth;
    return () => {
      delete root.dataset.fishDepth;
    };
  }, [phase]);
  const [country, setCountry] = useState<CountryCode>("JP");
  const [address, setAddress] = useState("");
  const [dataset, setDataset] = useState<WalletDataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyse = useCallback(async (addrs: string[], refresh = false) => {
    setAddress(addrs.length > 1 ? `${addrs.length} wallets · ${addrs.map(shortAddr).join(", ")}` : addrs[0]);
    setError(null);
    setPhase("scanning");
    try {
      // Each wallet is analysed (and cached) on its own, then combined into one report
      const one = async (addr: string): Promise<WalletDataset> => {
        const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addr, refresh }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        return body as WalletDataset;
      };
      const settled = await Promise.allSettled(addrs.map(one));
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const failed = settled.flatMap((r, i) => (r.status === "rejected" ? [`${shortAddr(addrs[i])} could not be analysed: ${(r.reason as Error).message}`] : []));
      if (!ok.length) throw new Error(failed.join(" · "));
      const combined = combineDatasets(ok);
      setDataset(failed.length ? { ...combined, dataWarnings: [...failed, ...combined.dataWarnings] } : combined);
      setPhase("results");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // CeFi mode: files were read in the browser; only their dates go to the server, for exchange rates
  const analyseCefi = useCallback(async (uploads: CefiUpload[]) => {
    setAddress(`Exchange CSV · ${uploads.map((u) => u.fileName).join(", ")}`);
    setError(null);
    setPhase("scanning");
    try {
      const times = uploads.flatMap((u) => u.events.map((e) => e.timestamp));
      const res = await fetch("/api/fx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ times }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setDataset(buildCefiDataset(uploads, body));
      setPhase("results");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const [mode, setMode] = useState<Mode>("defi");

  const reset = () => {
    setPhase("idle");
    setDataset(null);
    setError(null);
  };

  const live = PROTOCOLS.filter((p) => p.status !== "planned");

  return (
    <main className="relative min-h-dvh overflow-x-hidden">
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          {/* Touch the jellyfish and it dodges, then comes back; it never navigates */}
          <LivingLogo />
          <button onClick={reset} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60" aria-label="GENCASO home">
            {/* Wordmark: one word in the headline's serif italic, plain white */}
            <span className="block pr-[0.08em] font-serif text-[26px] italic leading-none tracking-[-0.01em] text-white">Gencaso</span>
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-3">
          <span className="hidden rounded-full border border-line px-3 py-1 sm:inline">Read-only</span>
          <span className="whitespace-nowrap rounded-full border border-line px-3 py-1">Estimates<span className="hidden sm:inline"> · not tax advice</span></span>
          <MoreMenu />
        </div>
      </header>

      <AnimatePresence mode="wait">
        {phase !== "results" ? (
          <motion.section key="hero" exit={{ opacity: 0, transition: { duration: 0.35 } }} className="relative -mt-[76px] flex min-h-dvh flex-col items-center justify-center px-4 pb-16 pt-28 sm:px-6">
            <CausticBackground />
            <div className="relative z-10 mx-auto w-full max-w-4xl text-center">
              <AnimatePresence mode="wait">
                {phase === "idle" ? (
                  <motion.div key="input" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16, scale: 0.98 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}>
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-bg/40 whitespace-nowrap px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] text-ink-2 backdrop-blur sm:px-4 sm:text-[11px] sm:tracking-[0.24em]">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_var(--cyan)]" />
                      {mode === "defi" ? "Perpetual DEXs + Prediction Markets + NFTs" : "Centralised exchanges · futures P&L"}
                    </div>
                    <h1 className="text-[clamp(40px,7.4vw,88px)] font-semibold leading-[0.95] tracking-[-0.04em] text-ink">
                      Get your crypto tax
                      <br />
                      <span className="font-serif text-[1.08em] font-normal italic tracking-[-0.02em] text-transparent bg-clip-text bg-[linear-gradient(100deg,#9ec3ff_0%,#38e1ff_45%,#b9a6ff_100%)]">ready with Gencaso.</span>
                    </h1>
                    <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-ink-2">
                      {mode === "defi"
                        ? "Paste public wallets, pick a country, and get an auditable tax estimate in USD — then switch countries instantly without rescanning."
                        : "Upload your exchange export, pick a country, and get a tax estimate in USD — your trades never leave your device."}
                    </p>
                    <ModeSwitch mode={mode} onMode={setMode} />
                    <div className="relative z-20 mx-auto mt-6 max-w-4xl">
                      {mode === "defi" ? (
                        <WalletBar country={country} onCountry={setCountry} onSubmit={(a) => analyse(a)} busy={false} />
                      ) : (
                        <CefiPanel country={country} onCountry={setCountry} onSubmit={(u) => analyseCefi(u)} />
                      )}
                    </div>
                    {mode === "defi" && (
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-xs">
                      {live.map((p) => (
                        <span key={p.id} className="flex items-center gap-1.5 rounded-full border border-line bg-bg/40 px-3 py-1 text-ink-2 backdrop-blur">
                          <span className={`h-1.5 w-1.5 rounded-full ${p.status === "live" ? "bg-good" : "bg-warn"}`} />
                          <ProtocolLogo protocol={p.id} size={14} />
                          {p.name}
                          <span className="text-ink-3">{p.status === "live" ? "live" : "beta · unverified"}</span>
                        </span>
                      ))}
                      <Link href="/docs#roadmap" className="rounded-full border border-line bg-bg/40 px-3 py-1 text-ink-3 backdrop-blur transition hover:border-line-strong hover:text-white" title="DefiLlama's top 67 per category: the Gencaso roadmap">
                        +{roadmapPlannedCount} on the roadmap
                      </Link>
                    </div>
                    )}
                  </motion.div>
                ) : (
                  <ScanSequence key="scan" address={address} error={error} onRetry={reset} />
                )}
              </AnimatePresence>
            </div>
          </motion.section>
        ) : (
          dataset && (
            <motion.section key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-6xl px-4 pt-2 sm:px-6">
              {/* Ambient, non-interactive caustics: keeps moving, ignores clicks */}
              <CausticBackground variant="ambient" />
              <div className="relative z-10">
              <Results dataset={dataset} country={country} onCountry={setCountry} onReset={reset} onRefresh={() => analyse(walletsOf(dataset), true)} />
              </div>
            </motion.section>
          )
        )}
      </AnimatePresence>

      {phase !== "scanning" && <SiteFooter />}
    </main>
  );
}

/** DeFi (public wallets) or CeFi (uploaded exchange files). */
function ModeSwitch({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const opts: { id: Mode; label: string; sub: string }[] = [
    { id: "defi", label: "DeFi", sub: "wallets" },
    { id: "cefi", label: "CeFi", sub: "exchanges" },
  ];
  return (
    <div role="tablist" aria-label="Data source" className="mx-auto mt-8 inline-flex rounded-full border border-line bg-bg/50 p-1 backdrop-blur">
      {opts.map((o) => (
        <button
          key={o.id}
          role="tab"
          type="button"
          aria-selected={mode === o.id}
          onClick={() => onMode(o.id)}
          className={`rounded-full px-5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${mode === o.id ? "bg-[linear-gradient(135deg,#2f6bff,#38e1ff)] font-medium text-white shadow-[0_6px_20px_-8px_rgba(56,225,255,.7)]" : "text-ink-2 hover:text-white"}`}
        >
          {o.label} <span className={mode === o.id ? "text-white/80" : "text-ink-3"}>· {o.sub}</span>
        </button>
      ))}
    </div>
  );
}
