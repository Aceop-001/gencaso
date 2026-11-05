"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { CausticBackground } from "@/components/CausticBackground";
import { LivingLogo } from "@/components/LivingLogo";
import { ProtocolLogo } from "@/components/ProtocolLogo";
import { Results } from "@/components/Results";
import { MoreMenu } from "@/components/MoreMenu";
import { ScanSequence } from "@/components/ScanSequence";
import { SiteFooter } from "@/components/Socials";
import { WalletBar } from "@/components/WalletBar";
import type { WalletDataset } from "@/lib/engine/schema";
import { PROTOCOLS } from "@/lib/registry";
import type { CountryCode } from "@/lib/tax";

type Phase = "idle" | "scanning" | "results";

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

  const analyse = useCallback(async (addr: string, refresh = false) => {
    setAddress(addr);
    setError(null);
    setPhase("scanning");
    try {
      const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addr, refresh }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setDataset(body as WalletDataset);
      setPhase("results");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const reset = () => {
    setPhase("idle");
    setDataset(null);
    setError(null);
  };

  const live = PROTOCOLS.filter((p) => p.status !== "planned");
  const planned = PROTOCOLS.filter((p) => p.status === "planned");

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
                      Perpetual DEXs + Prediction Markets + NFTs
                    </div>
                    <h1 className="text-[clamp(40px,7.4vw,88px)] font-semibold leading-[0.95] tracking-[-0.04em] text-ink">
                      Get your crypto tax
                      <br />
                      <span className="font-serif text-[1.08em] font-normal italic tracking-[-0.02em] text-transparent bg-clip-text bg-[linear-gradient(100deg,#9ec3ff_0%,#38e1ff_45%,#b9a6ff_100%)]">ready with Gencaso.</span>
                    </h1>
                    <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-ink-2">
                      Paste a public address, pick a country, and get an auditable tax estimate in USD — then switch countries instantly without rescanning.
                    </p>
                    <div className="relative z-20 mx-auto mt-10 max-w-4xl">
                      <WalletBar country={country} onCountry={setCountry} onSubmit={(a) => analyse(a)} busy={false} />
                    </div>
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-xs">
                      {live.map((p) => (
                        <span key={p.id} className="flex items-center gap-1.5 rounded-full border border-line bg-bg/40 px-3 py-1 text-ink-2 backdrop-blur">
                          <span className={`h-1.5 w-1.5 rounded-full ${p.status === "live" ? "bg-good" : "bg-warn"}`} />
                          <ProtocolLogo protocol={p.id} size={14} />
                          {p.name}
                          <span className="text-ink-3">{p.status === "live" ? "live" : "beta · unverified"}</span>
                        </span>
                      ))}
                      <span className="rounded-full border border-line bg-bg/40 px-3 py-1 text-ink-3 backdrop-blur" title={planned.map((p) => p.name).join(", ")}>
                        +{planned.length} planned
                      </span>
                    </div>
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
              <Results dataset={dataset} country={country} onCountry={setCountry} onReset={reset} onRefresh={() => analyse(dataset.address, true)} />
              </div>
            </motion.section>
          )
        )}
      </AnimatePresence>

      {phase !== "scanning" && <SiteFooter />}
    </main>
  );
}

