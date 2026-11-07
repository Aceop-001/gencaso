"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import type { CountryCode } from "@/lib/tax";
import { MAX_WALLETS, splitWallets } from "@/lib/engine/combine";
import { validateAddress } from "@/lib/validation";
import { CountrySelect } from "./CountrySelect";

/**
 * The primary interaction: [ wallet(s) ] [ country ] [ analyse ]. Several wallets (EVM and Solana,
 * separated by commas, spaces or new lines) are analysed together into one combined report.
 * Layered composition (glow halo → glass shell → input) inspired by the OpenDesign
 * careers showcase's layered stage; implemented natively, no showcase code used.
 */
export function WalletBar({
  country,
  onCountry,
  onSubmit,
  busy,
}: {
  country: CountryCode;
  onCountry: (c: CountryCode) => void;
  onSubmit: (addresses: string[]) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parts = splitWallets(value);
  const checks = parts.map((p) => validateAddress(p));
  const allOk = checks.length > 0 && checks.every((c) => c.ok);
  const badge = !allOk ? null : checks.length > 1 ? `${checks.length} wallets` : checks[0].kind === "demo" ? null : checks[0].kind === "evm" ? "EVM" : "Solana";

  const submit = (raw = value) => {
    const list = splitWallets(raw);
    if (!list.length) return setError("Enter a public wallet address.");
    if (list.length > MAX_WALLETS) return setError(`Up to ${MAX_WALLETS} wallets per report.`);
    const results = list.map((p) => validateAddress(p));
    const bad = results.findIndex((r) => !r.ok);
    if (bad >= 0) return setError(list.length > 1 ? `Wallet ${bad + 1}: ${results[bad].error ?? "invalid address"}` : results[bad].error ?? "Invalid address");
    if (list.length > 1 && results.some((r) => r.kind === "demo")) return setError("The demo wallet can't be combined with real wallets.");
    setError(null);
    onSubmit(results.map((r) => r.normalized!));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative w-full"
      noValidate
    >
      <div className="relative">
      {/* Halo layer */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-[28px]"
        animate={{ opacity: focused ? 1 : 0.35 }}
        transition={{ duration: 0.4 }}
        style={{
          background: "conic-gradient(from 210deg, rgba(61,123,255,.0), rgba(61,123,255,.55), rgba(56,225,255,.6), rgba(139,108,255,.35), rgba(61,123,255,.0))",
          filter: "blur(14px)",
        }}
      />
      <div className="glass relative flex flex-col gap-2 rounded-[28px] p-2 md:flex-row md:items-stretch">
        <label className="relative flex min-w-0 flex-1 items-center rounded-[22px] bg-bg/60 px-5 transition focus-within:bg-bg/80">
          <span className="sr-only">Public wallet address</span>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className={`mr-3 shrink-0 transition ${focused ? "text-cyan" : "text-ink-3"}`}>
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h12A2.5 2.5 0 0 1 20 7.5V9h-4a3 3 0 0 0 0 6h4v1.5a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 3 16.5v-9Z M16 11h5v2h-5a1 1 0 0 1 0-2Z" fill="currentColor" opacity=".9" />
          </svg>
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Enter wallet address  0x…  (add more with commas)"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-invalid={!!error}
            aria-describedby="wallet-help"
            className="h-16 w-full min-w-0 bg-transparent font-mono text-[15px] tracking-tight text-ink placeholder:font-sans placeholder:text-ink-3 focus:outline-none md:text-base"
          />
          {badge && (
            <motion.span key={badge} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="ml-2 shrink-0 whitespace-nowrap rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-good">
              {badge}
            </motion.span>
          )}
        </label>
        <div className="md:w-[220px]">
          <CountrySelect value={country} onChange={onCountry} />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="group relative h-16 overflow-hidden rounded-[22px] px-8 font-medium text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/70 disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #2f6bff 0%, #1fb6ff 60%, #38e1ff 100%)" }}
        >
          <span className="absolute inset-0 bg-[linear-gradient(120deg,transparent_30%,rgba(255,255,255,.35)_50%,transparent_70%)] translate-x-[-120%] transition-transform duration-700 group-hover:translate-x-[120%]" />
          <span className="relative flex items-center justify-center gap-2 tracking-wide">
            {busy ? "Analysing…" : "Analyse"}
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M3 8h9M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </button>
      </div>
      </div>
      <div id="wallet-help" className="mt-4 flex min-h-6 flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] text-ink-3" aria-live="polite">
        {error ? (
          <span role="alert" className="text-bad">{error}</span>
        ) : (
          <>
            <span className="flex items-center gap-1.5"><Lock /> Public address only — never your keys or seed phrase</span>
            <button
              type="button"
              onClick={() => {
                setValue("demo");
                submit("demo");
              }}
              className="rounded-full border border-line px-3 py-1 text-ink-2 transition hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
            >
              Try the demo wallet <span className="text-ink-3">(mock data)</span>
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function Lock() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
    </svg>
  );
}
