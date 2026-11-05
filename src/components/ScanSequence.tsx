"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const STAGES = [
  "Validating address",
  "Querying supported protocols",
  "Retrieving trading history",
  "Normalising events",
  "Fetching historical FX rates",
];

/**
 * Wallet scanning state. Stages advance on a timer only up to the last one;
 * the sequence completes when the real response arrives — no fake results are shown.
 */
export function ScanSequence({ address, error, onRetry }: { address: string; error: string | null; onRetry: () => void }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 650);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.98 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      className="glass relative mx-auto w-full max-w-xl overflow-hidden rounded-[28px] p-7"
      role="status"
      aria-live="polite"
    >
      {!error && <div className="scan-line absolute inset-x-0 top-0 h-px" />}
      <div className="text-[11px] uppercase tracking-[0.24em] text-ink-3">{error ? "Analysis stopped" : "Scanning wallet"}</div>
      <div className="mt-2 truncate font-mono text-sm text-ink-2">{address === "demo" ? "demo · mock dataset" : address}</div>
      <div className="hairline my-5" />
      <ol className="space-y-3">
        {STAGES.map((s, i) => {
          const done = i < stage && !error;
          const active = i === stage && !error;
          return (
            <li key={s} className={`flex items-center gap-3 text-sm transition ${i <= stage ? "text-ink" : "text-ink-3"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${done ? "border-good/50 bg-good/15 text-good" : active ? "border-cyan/60 text-cyan" : "border-line text-ink-3"}`}>
                {done ? (
                  <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
                ) : active ? (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
                ) : null}
              </span>
              {s}
            </li>
          );
        })}
      </ol>
      {error && (
        <div className="mt-6 rounded-2xl border border-bad/30 bg-bad/10 p-4 text-sm text-ink" role="alert">
          {error}
          <button onClick={onRetry} className="ml-3 underline decoration-bad/50 underline-offset-4 hover:text-white">Back</button>
        </div>
      )}
    </motion.div>
  );
}
